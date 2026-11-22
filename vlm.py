"""A thin wrapper around an OpenAI-compatible vision-language model, and the
first task built on it: look at a labelled image and say whether the boxes are
right.

Where the model lives comes from vlm.env (see vlm.env.example) or the
environment, never from the code, so the repository can be public. Stdlib plus
Pillow, like the rest of the server: one POST to <base>/chat/completions.

The review is advisory. Results go to their own log, next to the human review
log but never into it, so the model can be judged before anyone trusts it.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

KEYS = ("VLM_BASE_URL", "VLM_API_KEY", "VLM_MODEL", "VLM_TIMEOUT", "VLM_WORKERS",
        "VLM_MAX_SIDE", "VLM_THINKING", "VLM_MAX_TOKENS")
ISSUES = ("missing_box", "wrong_class", "loose_box", "false_positive", "duplicate", "other")


# ---------------------------------------------------------------- config

@dataclass(frozen=True)
class Config:
    base_url: str
    api_key: str
    model: str
    timeout: float = 120.0
    workers: int = 2
    max_side: int = 1280
    # None: leave it to the server. True/False: ask a reasoning model (Qwen3 and
    # the like, through vLLM's chat_template_kwargs) to think first, or not.
    thinking: bool | None = None
    max_tokens: int = 1024      # thinking counts against it


def read_env_file(path: Path) -> dict:
    """KEY=VALUE lines; '#' comments, blank lines and surrounding quotes allowed."""
    out = {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return out
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[k.strip()] = v
    return out


def load_config(env_file: Path | None = None) -> Config | None:
    """The file first, then the environment on top — so compose's env_file and a
    local vlm.env both work. None when no endpoint is configured."""
    vals = read_env_file(env_file) if env_file else {}
    vals.update({k: os.environ[k] for k in KEYS if os.environ.get(k)})
    base, model = vals.get("VLM_BASE_URL", "").rstrip("/"), vals.get("VLM_MODEL", "")
    if not base or not model:
        return None

    def num(key, cast, default):
        try:
            return cast(vals[key]) if vals.get(key) else default
        except ValueError:
            return default

    think = vals.get("VLM_THINKING", "").strip().lower()
    return Config(base_url=base, api_key=vals.get("VLM_API_KEY", ""), model=model,
                  timeout=num("VLM_TIMEOUT", float, 120.0),
                  workers=max(1, num("VLM_WORKERS", int, 2)),
                  max_side=max(256, num("VLM_MAX_SIDE", int, 1280)),
                  thinking={"on": True, "true": True, "1": True, "off": False,
                            "false": False, "0": False}.get(think),
                  max_tokens=max(16, num("VLM_MAX_TOKENS", int, 1024)))


# ---------------------------------------------------------------- client

class VLMError(Exception):
    pass


def chat(cfg: Config, messages: list, **extra) -> str:
    """One chat completion; the text of the first choice."""
    payload = {"model": cfg.model, "messages": messages, "max_tokens": cfg.max_tokens, **extra}
    if cfg.thinking is not None:
        payload["chat_template_kwargs"] = {"enable_thinking": cfg.thinking}
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{cfg.base_url}/chat/completions", data=body, method="POST",
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {cfg.api_key}"} if cfg.api_key else {})})
    try:
        with urllib.request.urlopen(req, timeout=cfg.timeout) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode("utf-8", "replace")
        raise VLMError(f"HTTP {e.code} from the model server: {detail}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        reason = getattr(e, "reason", e)
        raise VLMError(f"cannot reach the model server: {reason}") from e
    except json.JSONDecodeError as e:
        raise VLMError("the model server did not answer with JSON") from e
    try:
        choice = data["choices"][0]
        text = choice["message"].get("content") or ""
    except (KeyError, IndexError, TypeError, AttributeError) as e:
        raise VLMError("unexpected answer shape from the model server") from e
    if not text.strip() and choice.get("finish_reason") == "length":
        # A reasoning model writes its thinking elsewhere first; out of tokens
        # before the answer, it returns nothing at all.
        raise VLMError(f"the model used all {cfg.max_tokens} tokens before answering — "
                       "set VLM_THINKING=off or raise VLM_MAX_TOKENS")
    return text


def image_part(jpeg: bytes) -> dict:
    return {"type": "image_url",
            "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()}}


# ---------------------------------------------------------------- the picture

# Fixed, high-contrast hues per class index; the number on each box is what the
# model refers to, so it must stay legible on any photo.
PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300",
           "#4a3aa7", "#e34948"]


def overlay(path: Path, boxes: list, classes: list, max_side: int) -> bytes:
    """The image with every box drawn and tagged "<n> <class>", as JPEG."""
    from PIL import Image, ImageDraw, ImageFont, ImageOps

    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
    scale = min(1.0, max_side / max(im.size))
    if scale < 1:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.BILINEAR)
    W, H = im.size
    d = ImageDraw.Draw(im)
    size = max(12, round(min(W, H) / 40))
    try:
        font = ImageFont.load_default(size=size)
    except TypeError:                       # Pillow < 10.1
        font = ImageFont.load_default()
    line = max(2, round(min(W, H) / 300))
    for n, (c, x, y, w, h) in enumerate(boxes, 1):
        col = PALETTE[int(c) % len(PALETTE)]
        x0, y0, x1, y1 = (x - w / 2) * W, (y - h / 2) * H, (x + w / 2) * W, (y + h / 2) * H
        d.rectangle([x0, y0, x1, y1], outline=col, width=line)
        tag = f"{n} {classes[c] if 0 <= c < len(classes) else c}"
        tx0, ty0, tx1, ty1 = d.textbbox((0, 0), tag, font=font)
        tw, th = tx1 - tx0 + 6, ty1 - ty0 + 4
        ty = y0 - th if y0 - th >= 0 else y0
        d.rectangle([x0, ty, x0 + tw, ty + th], fill=col)
        d.text((x0 + 3, ty + 2 - ty0), tag, fill="white", font=font)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88)
    return buf.getvalue()


# ---------------------------------------------------------------- the task

SYSTEM = (
    "You check object-detection labels. You are shown a photo with the labelled "
    "bounding boxes drawn on it; each box is tagged with its number and class. "
    "Judge only what is visible. Answer with a single JSON object and nothing else."
)


def prompt(classes: list, boxes: list) -> str:
    listed = "\n".join(f"  {n}: {classes[b[0]] if 0 <= b[0] < len(classes) else b[0]}"
                       for n, b in enumerate(boxes, 1)) or "  (none — the image is labelled empty)"
    return f"""The classes in this dataset are: {", ".join(classes)}.

The image has {len(boxes)} labelled box(es):
{listed}

Check the labels:
- missing_box: a visible object of one of the classes has no box
- wrong_class: a box has the wrong class
- loose_box: a box clearly does not fit its object (too big, too small, shifted)
- false_positive: a box surrounds no object of its class
- duplicate: two boxes label the same object
- other: anything else wrong with the labels

Answer exactly in this JSON shape:
{{"verdict": "ok" or "not_ok",
  "issues": [{{"type": one of {list(ISSUES)}, "box": box number or null, "class": class name or null, "note": short description}}],
  "reason": one sentence summing up}}
Use "ok" with an empty issues list when the labels are correct."""


THINK = re.compile(r"<think>.*?</think>", re.S)
FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)


def parse(text: str) -> dict:
    """The model's JSON, normalised. Tolerates thinking blocks, code fences and
    prose around the object; anything unusable raises VLMError."""
    text = THINK.sub("", text).strip()
    m = FENCE.search(text)
    if m:
        text = m.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise VLMError("the model did not answer with JSON")
    try:
        obj = json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise VLMError("the model's JSON could not be read") from e
    verdict = str(obj.get("verdict", "")).lower().replace(" ", "_").replace("-", "_")
    if verdict not in ("ok", "not_ok"):
        raise VLMError(f"unknown verdict {obj.get('verdict')!r}")
    issues = []
    for it in obj.get("issues") or []:
        if not isinstance(it, dict):
            continue
        kind = str(it.get("type", "other")).lower()
        box = it.get("box")
        issues.append({"type": kind if kind in ISSUES else "other",
                       "box": box if isinstance(box, int) else None,
                       "class": it.get("class") if isinstance(it.get("class"), str) else None,
                       "note": str(it.get("note", ""))[:300]})
    # An "ok" that lists problems is not ok.
    if issues and verdict == "ok":
        verdict = "not_ok"
    return {"verdict": verdict, "issues": issues, "reason": str(obj.get("reason", ""))[:500]}


def review_image(cfg: Config, path: Path, boxes: list, classes: list) -> dict:
    jpeg = overlay(path, boxes, classes, cfg.max_side)
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": [image_part(jpeg),
                                             {"type": "text", "text": prompt(classes, boxes)}]}]
    t0 = time.monotonic()
    text = chat(cfg, messages, temperature=0)
    try:
        out = parse(text)
    except VLMError:
        # One nudge: models sometimes add prose the first time.
        messages += [{"role": "assistant", "content": text},
                     {"role": "user", "content": "Answer again with only the JSON object."}]
        out = parse(chat(cfg, messages, temperature=0))
    out["ms"] = round((time.monotonic() - t0) * 1000)
    return out


def ping(cfg: Config) -> dict:
    """Does the server answer, and does the model take images? A tiny red square
    and a one-word question."""
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (220, 30, 30)).save(buf, "JPEG")
    t0 = time.monotonic()
    text = chat(cfg, [{"role": "user", "content": [
        image_part(buf.getvalue()),
        {"type": "text", "text": "What colour is this image? Answer with one word."}]}],
        temperature=0)
    text = THINK.sub("", text).strip()
    return {"answer": text[:100], "sees_images": "red" in text.lower(),
            "ms": round((time.monotonic() - t0) * 1000)}


# ---------------------------------------------------------------- results log

def read_results(path: Path) -> dict:
    """{image: latest result}. Append-only like the review log; the last line
    for an image wins, a torn line is skipped."""
    out = {}
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(rec, dict) and rec.get("image"):
                    out[rec["image"]] = rec
    except OSError:
        pass
    return out


# ---------------------------------------------------------------- the job

@dataclass
class Job:
    """One review run over a list of images, in the background. Only one runs at
    a time: the model server is shared, and a second run would only queue."""
    version: str
    split: str
    total: int
    started_by: str
    model: str
    done: int = 0
    errors: int = 0
    started: float = field(default_factory=time.time)
    finished: float | None = None
    stopped: bool = False
    last_error: str = ""
    cancel: threading.Event = field(default_factory=threading.Event)

    def view(self):
        return {"version": self.version, "split": self.split, "total": self.total,
                "done": self.done, "errors": self.errors, "model": self.model,
                "started_by": self.started_by, "started": self.started,
                "finished": self.finished, "stopped": self.stopped,
                "running": self.finished is None, "last_error": self.last_error}


_job_lock = threading.Lock()
_job: Job | None = None


def current_job():
    with _job_lock:
        return _job


def start(cfg: Config, version, split, items, classes, out_path: Path, who: str) -> Job:
    """items: [(image name, image path, boxes)]. Each result is appended to
    out_path as it lands, so a stop or a restart keeps what was done."""
    global _job
    with _job_lock:
        if _job and _job.finished is None:
            raise RuntimeError("a VLM review is already running")
        job = _job = Job(version, split, len(items), who or "anon", cfg.model)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_lock = threading.Lock()

    def one(item):
        name, path, boxes = item
        if job.cancel.is_set():
            return
        rec = {"image": name, "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
               "model": cfg.model, "by": job.started_by, "boxes": len(boxes)}
        try:
            rec.update(review_image(cfg, path, boxes, classes))
        except (VLMError, OSError) as e:
            rec.update(verdict="error", issues=[], reason=str(e))
        line = json.dumps(rec, separators=(",", ":")) + "\n"
        with write_lock:            # the counters too: workers finish together
            with open(out_path, "a", encoding="utf-8") as fh:
                fh.write(line)
            job.done += 1
            if rec["verdict"] == "error":
                job.errors += 1
                job.last_error = rec["reason"]

    def run():
        try:
            with ThreadPoolExecutor(cfg.workers) as pool:
                list(pool.map(one, items))
        finally:
            job.stopped = job.cancel.is_set()
            job.finished = time.time()

    threading.Thread(target=run, daemon=True, name="vlm-review").start()
    return job


def stop():
    job = current_job()
    if job and job.finished is None:
        job.cancel.set()
    return job
