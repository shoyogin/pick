import io
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from PIL import Image

import vlm
from test_server import call


class FakeVLM(BaseHTTPRequestHandler):
    """Just enough of /v1/chat/completions: checks the request, answers like a
    chatty model would — thinking block and code fence included."""
    seen = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeVLM.seen.append({"auth": self.headers.get("Authorization"), "body": body})
        parts = body["messages"][-1]["content"]
        text = parts[-1]["text"] if isinstance(parts, list) else parts
        if "What colour" in text:
            answer = "<think>it is red</think>Red"
        else:
            answer = ('<think>looking</think>Here you go:\n```json\n'
                      '{"verdict": "not_ok", "issues": [{"type": "loose_box", "box": 2, '
                      '"class": "person", "note": "too wide"}], "reason": "box 2 is loose"}\n```')
        out = json.dumps({"choices": [{"message": {"content": answer}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


@pytest.fixture
def fake_vlm(monkeypatch):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeVLM)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    FakeVLM.seen = []
    monkeypatch.setenv("VLM_BASE_URL", f"http://127.0.0.1:{srv.server_address[1]}/v1")
    monkeypatch.setenv("VLM_API_KEY", "secret-key")
    monkeypatch.setenv("VLM_MODEL", "fake-vl")
    yield srv
    srv.shutdown()
    srv.server_close()


def test_config_file_with_environment_on_top(tmp_path, monkeypatch):
    for k in vlm.KEYS:
        monkeypatch.delenv(k, raising=False)
    f = tmp_path / "vlm.env"
    f.write_text('# comment\nVLM_BASE_URL="http://h:8000/v1/"\nVLM_MODEL=m1\nVLM_WORKERS=4\n')
    cfg = vlm.load_config(f)
    assert (cfg.base_url, cfg.model, cfg.workers, cfg.api_key) == ("http://h:8000/v1", "m1", 4, "")
    monkeypatch.setenv("VLM_MODEL", "m2")
    assert vlm.load_config(f).model == "m2"
    assert vlm.load_config(tmp_path / "missing.env") is None     # model alone is not enough


def test_no_endpoint_means_switched_off(tmp_path, monkeypatch):
    for k in vlm.KEYS:
        monkeypatch.delenv(k, raising=False)
    assert vlm.load_config(None) is None
    (tmp_path / "vlm.env").write_text("VLM_BASE_URL=\nVLM_MODEL=x\n")
    assert vlm.load_config(tmp_path / "vlm.env") is None


@pytest.mark.parametrize("text, verdict", [
    ('{"verdict": "ok", "issues": [], "reason": "fine"}', "ok"),
    ('Sure!\n```json\n{"verdict": "NOT OK", "issues": [], "reason": "x"}\n```', "not_ok"),
    ('<think>hmm {"a": 1}</think>{"verdict": "ok", "issues": [{"type": "missing_box"}]}', "not_ok"),
])
def test_parse_tolerates_what_models_write(text, verdict):
    assert vlm.parse(text)["verdict"] == verdict


@pytest.mark.parametrize("text", ["no json here", '{"verdict": "maybe"}', "{broken"])
def test_parse_refuses_what_it_cannot_use(text):
    with pytest.raises(vlm.VLMError):
        vlm.parse(text)


def test_overlay_is_a_capped_jpeg(tmp_path):
    p = tmp_path / "big.png"
    Image.new("RGB", (3000, 1500), "grey").save(p)
    data = vlm.overlay(p, [[0, 0.5, 0.5, 0.2, 0.2], [7, 0.1, 0.1, 0.1, 0.1]], ["car"], 1000)
    im = Image.open(io.BytesIO(data))
    assert im.format == "JPEG" and max(im.size) == 1000


def test_unreachable_server_is_a_clear_error(monkeypatch):
    cfg = vlm.Config(base_url="http://127.0.0.1:9/v1", api_key="", model="m", timeout=2)
    with pytest.raises(vlm.VLMError, match="cannot reach"):
        vlm.ping(cfg)


def test_review_over_http_is_a_report_next_to_the_human_one(server, db, fake_vlm):
    db.append_flag("v1", "train", "a.jpg", "ok", "carol")

    status, st = call(server, "/api/vlm/status")
    assert st["configured"] and st["model"] == "fake-vl" and "secret" not in json.dumps(st)

    status, ping = call(server, "/api/vlm/ping", {})
    assert status == 200 and ping["sees_images"] and ping["answer"] == "Red"

    status, body = call(server, "/api/vlm/start", {"v": "v1", "split": "train", "limit": 3})
    assert status == 200 and body["job"]["total"] == 3
    for _ in range(100):
        if not call(server, "/api/vlm/status")[1]["job"]["running"]:
            break
        time.sleep(0.05)

    _, res = call(server, "/api/vlm/results?v=v1&split=train")
    checked = {r["name"]: r["vlm"] for r in res["items"] if r["vlm"]}
    assert sorted(checked) == ["a.jpg", "b.jpg", "c.jpg"]
    assert checked["a.jpg"]["issues"][0] == {"type": "loose_box", "box": 2,
                                            "class": "person", "note": "too wide"}
    assert res["summary"] == {"checked": 3, "ok": 0, "not_ok": 3, "error": 0, "total": 4}
    assert res["agreement"]["ok/not_ok"] == 1           # carol said OK, the model did not

    # Sent with the key, the image as a data URL, and the boxes listed by number.
    req = FakeVLM.seen[-1]
    assert req["auth"] == "Bearer secret-key"
    parts = req["body"]["messages"][1]["content"]
    assert parts[0]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert "1: car" in parts[1]["text"] and "2: person" in parts[1]["text"]

    # The human review log is untouched; the model's results live beside it.
    assert db.load_flags("v1", "train")["a.jpg"]["status"] == "ok"
    assert (db.REVIEW / "vlm" / "v1__train.jsonl").is_file()

    # "todo" skips what is already checked.
    status, body = call(server, "/api/vlm/start", {"v": "v1", "split": "train"})
    assert status == 200 and body["job"]["total"] == 1


def test_switched_off_without_config(server, monkeypatch):
    for k in vlm.KEYS:
        monkeypatch.delenv(k, raising=False)
    _, st = call(server, "/api/vlm/status")
    assert st["configured"] is False
    status, body = call(server, "/api/vlm/start", {"v": "v1", "split": "train"})
    assert status == 400 and "vlm.env" in body["error"]


def test_thinking_switch_and_running_out_of_tokens(tmp_path, monkeypatch):
    for k in vlm.KEYS:
        monkeypatch.delenv(k, raising=False)
    f = tmp_path / "vlm.env"
    f.write_text("VLM_BASE_URL=http://h/v1\nVLM_MODEL=m\nVLM_THINKING=off\nVLM_MAX_TOKENS=50\n")
    cfg = vlm.load_config(f)
    assert cfg.thinking is False and cfg.max_tokens == 50
    f.write_text("VLM_BASE_URL=http://h/v1\nVLM_MODEL=m\n")
    assert vlm.load_config(f).thinking is None          # not sent at all

    answers = iter([{"choices": [{"message": {"content": "", "reasoning_content": "hmm"},
                                  "finish_reason": "length"}]}])
    sent = []

    class R(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            pass

    def fake_urlopen(req, timeout):
        sent.append(json.loads(req.data))
        return R(json.dumps(next(answers)).encode())

    monkeypatch.setattr(vlm.urllib.request, "urlopen", fake_urlopen)
    cfg = vlm.Config(base_url="http://h/v1", api_key="", model="m", thinking=False, max_tokens=50)
    with pytest.raises(vlm.VLMError, match="VLM_THINKING=off or raise VLM_MAX_TOKENS"):
        vlm.chat(cfg, [{"role": "user", "content": "hi"}])
    assert sent[0]["chat_template_kwargs"] == {"enable_thinking": False}
    assert sent[0]["max_tokens"] == 50
