"""Build a class-balanced training set from reviewed images.

The selection logic of select_balanced_dataset.py, run over Pick's candidates
instead of a folder walk, and reporting what happened to *every* image so the
Build tab can colour each one:

1. shots     group consecutive frames of each folder into shots
2. dedup     drop near-duplicate frames inside each shot (dHash)
3. split     optional: whole shots to train or val, stratified on each shot's rarest class
4. balance   per split: a share of empty images, then a random image of the least
             represented class until the budget is reached

Pure apart from reading pixels for dHash; pick.py gathers the candidates and
writes the zip.
"""

from __future__ import annotations

import random
import re
import threading
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

# Frames are consecutive video: a frame-number jump larger than this starts a new shot.
SHOT_GAP = 8
FRAME_RE = re.compile(r"^(?P<prefix>.*?)(?P<num>\d+)$")
# Stratification key for empty images, next to the class ids.
EMPTY = -1

# What the Build tab colours an image by.
TRAIN, VAL, TEST = "train", "val", "test"
NOT_TAKEN = "not_taken"        # eligible, but the budget was reached first
DUPLICATE = "duplicate"        # dropped as a near-duplicate of a kept frame
UNREQUESTED = "unrequested"    # only classes nobody asked to balance
EXCLUDED = "excluded"          # held back by review, or not labelled at all


@dataclass
class Candidate:
    """One image. `folder` + stem decide its shot; `path` is read for dHash."""
    key: str
    folder: str
    stem: str
    path: Path
    instances: dict[int, int]          # class id -> box count; empty for negatives
    excluded: str = ""                 # why it can never be selected, if so


@dataclass
class Options:
    num_images: int
    classes: list[int]
    empty_percent: float = 10.0
    val_fraction: float = 0.0
    by_instances: bool = True
    max_repeats: int = 1
    dedup: bool = True
    hamming: int = 16
    window: int = 12
    seed: int = 42

    def check(self):
        if self.num_images <= 0:
            raise ValueError("number of images must be positive")
        if not 0 <= self.empty_percent <= 100:
            raise ValueError("empty percent must be between 0 and 100")
        if not 0 <= self.val_fraction < 1:
            raise ValueError("val fraction must be in [0, 1)")
        if self.max_repeats < 1:
            raise ValueError("max repeats must be at least 1")
        if not 0 <= self.hamming <= 256 or self.window < 1:
            raise ValueError("bad dedup settings")
        if not self.classes:
            raise ValueError("pick at least one class to balance")


@dataclass
class Selection:
    pool: list[int]
    empty: list[int]
    empty_target: int
    positives: list[int]
    positive_target: int
    counts: Counter
    exhausted: set


@dataclass
class Result:
    """Every candidate's fate plus the script's report, per split."""
    state: list[str]
    reason: list[str]
    repeats: list[int]                 # times listed in its split; 0 if not selected
    splits: dict[str, Selection] = field(default_factory=dict)
    report: dict = field(default_factory=dict)


# --------------------------------------------------------------- shots and dedup

def group_shots(cands: list[Candidate], indices: list[int]) -> list[list[int]]:
    """Runs of consecutive frames of one folder, as candidate indices in frame order.

    Neighbouring video frames are near-identical: dedup compares frames inside a shot,
    and the split keeps every shot whole so the same instant is never in train and val.
    """
    sequences: dict[tuple[str, str], list[tuple[int, int]]] = defaultdict(list)
    for index in indices:
        c = cands[index]
        match = FRAME_RE.match(c.stem)
        prefix, number = (match["prefix"], int(match["num"])) if match else (c.stem, 0)
        sequences[(c.folder, prefix)].append((number, index))

    shots = []
    for key in sorted(sequences):
        frames = sorted(sequences[key])
        current = [frames[0][1]]
        for (previous, _), (number, index) in zip(frames, frames[1:]):
            if number - previous > SHOT_GAP:
                shots.append(current)
                current = []
            current.append(index)
        shots.append(current)
    return shots


_hash_lock = threading.Lock()
_hashes: dict[tuple[str, int, int], int] = {}


def dhash(path: Path) -> int:
    """256-bit difference hash, the same bits as the script's numpy version.
    Cached on path, size and mtime: every change of option re-runs the preview."""
    st = path.stat()
    key = (str(path), st.st_size, st.st_mtime_ns)
    with _hash_lock:
        if key in _hashes:
            return _hashes[key]
    from PIL import Image

    with Image.open(path) as image:
        small = image.convert("L").resize((17, 16), Image.BILINEAR)
    px = small.tobytes()             # mode L: one byte per pixel, row by row
    bits = 0
    for row in range(16):
        line = px[row * 17:(row + 1) * 17]
        for a, b in zip(line, line[1:]):
            bits = (bits << 1) | (b > a)
    with _hash_lock:
        _hashes[key] = bits
    return bits


def deduplicate(cands, shots, hamming, window, reason):
    """Keep a frame only if it differs by more than `hamming` dHash bits from each of
    the last `window` kept frames of its shot. Dropped frames get their reason."""
    indices = [index for shot in shots for index in shot]

    def safe(index):
        try:
            return dhash(cands[index].path)
        except OSError:
            return None            # unreadable: never treated as a duplicate

    with ThreadPoolExecutor(8) as pool:
        hashes = dict(zip(indices, pool.map(safe, indices)))

    kept_shots, dropped = [], {}
    for shot in shots:
        kept: list[int] = []
        for index in shot:
            near = None
            if hashes[index] is not None:
                for other in kept[-window:]:
                    if hashes[other] is None:
                        continue
                    d = (hashes[index] ^ hashes[other]).bit_count()
                    if d <= hamming:
                        near = (other, d)
                        break
            if near:
                dropped[index] = near
                reason[index] = f"{near[1]} bits from {cands[near[0]].stem}"
            else:
                kept.append(index)
        kept_shots.append(kept)
    return kept_shots, dropped


# --------------------------------------------------------------------------- split

def split_shots(cands, shots, class_ids, val_fraction, by_instances, rng):
    """Assign whole shots to train or val so each class lands ~val_fraction in val.

    Shots go rarest content first; val takes a shot only if that brings val's amount of
    the shot's rarest class (or of empty images) closer to val_fraction of its total.
    A class in one or two shots therefore stays in train only.
    """
    wanted = set(class_ids)

    def contents(shot):
        amounts: Counter = Counter()
        for index in shot:
            instances = cands[index].instances
            if not instances:
                amounts[EMPTY] += 1
            for class_id, boxes in instances.items():
                if class_id in wanted:
                    amounts[class_id] += boxes if by_instances else 1
        return amounts

    shot_contents = [contents(shot) for shot in shots]
    totals: Counter = sum(shot_contents, Counter())

    order = list(range(len(shots)))
    rng.shuffle(order)
    order.sort(key=lambda shot: min((totals[key] for key in shot_contents[shot]), default=0))

    in_val: Counter = Counter()
    train, val = [], []
    for shot in order:
        amounts = shot_contents[shot]
        if not amounts:
            # Only unrequested classes: never selected, so the side does not matter.
            train.extend(shots[shot])
            continue
        rarest = min(amounts, key=lambda key: totals[key])
        target = val_fraction * totals[rarest]
        if abs(in_val[rarest] + amounts[rarest] - target) < abs(in_val[rarest] - target):
            in_val.update(amounts)
            val.extend(shots[shot])
        else:
            train.extend(shots[shot])
    return train, val


# ------------------------------------------------------------------------- balance

class ClassPools:
    """Per-class queues of candidate images in random order, refilled for each repeat pass."""

    def __init__(self, members, max_repeats, rng):
        self.members = members
        self.max_repeats = max_repeats
        self.rng = rng
        self.uses: Counter = Counter()
        self.passes = {class_id: 1 for class_id in members}
        self.pools = {class_id: self._shuffled(class_id) for class_id in members}

    def _shuffled(self, class_id):
        pool = list(self.members[class_id])
        self.rng.shuffle(pool)
        return pool

    def take(self, class_id):
        """A random image of the class not yet used in this pass; None once it is exhausted."""
        while True:
            pool = self.pools[class_id]
            while pool:
                index = pool.pop()
                # Images already taken through another class this pass are skipped.
                if self.uses[index] < self.passes[class_id]:
                    self.uses[index] += 1
                    return index
            if self.passes[class_id] >= self.max_repeats:
                return None
            self.passes[class_id] += 1
            self.pools[class_id] = self._shuffled(class_id)


def select_positives(cands, pool, class_ids, target, by_instances, max_repeats, rng):
    """Add a random image of the least represented class until target is reached.

    The image is drawn uniformly from that class, not chosen to avoid the other classes
    it contains, so crowded multi-class frames keep their natural share.
    """
    members = {class_id: [] for class_id in class_ids}
    for index in pool:
        for class_id in cands[index].instances:
            if class_id in members:
                members[class_id].append(index)

    pools = ClassPools(members, max_repeats, rng)
    counts: Counter = Counter()
    active = {class_id for class_id in class_ids if members[class_id]}
    exhausted = set(class_ids) - active
    selected = []

    while len(selected) < target and active:
        lagging = min(active, key=lambda class_id: (counts[class_id], rng.random()))
        index = pools.take(lagging)
        if index is None:
            active.discard(lagging)
            exhausted.add(lagging)
            continue
        selected.append(index)
        for class_id, boxes in cands[index].instances.items():
            if class_id in members:
                counts[class_id] += boxes if by_instances else 1

    return selected, counts, exhausted


def select(cands, pool, num_images, opt: Options, max_repeats, rng) -> Selection:
    negatives = [index for index in pool if not cands[index].instances]
    empty_target = round(num_images * opt.empty_percent / 100)
    empty = rng.sample(negatives, min(empty_target, len(negatives)))
    positive_target = num_images - len(empty)
    positives, counts, exhausted = select_positives(
        cands, pool, opt.classes, positive_target, opt.by_instances, max_repeats, rng)
    return Selection(pool, empty, empty_target, positives, positive_target, counts, exhausted)


# -------------------------------------------------------------------------- report

def scene_stats(cands, indices):
    labeled = [cands[index] for index in indices if cands[index].instances]
    if not labeled:
        return None
    return {
        "boxes_per_image": round(sum(sum(c.instances.values()) for c in labeled) / len(labeled), 2),
        "multi_class": round(sum(len(c.instances) > 1 for c in labeled) / len(labeled), 3),
    }


def split_report(cands, sel: Selection, opt: Options):
    unit = "instances" if opt.by_instances else "images"
    available: Counter = Counter()
    for index in sel.pool:
        for class_id, boxes in cands[index].instances.items():
            available[class_id] += boxes if opt.by_instances else 1
    picked = [sel.counts[c] for c in opt.classes if sel.counts[c]]
    others: Counter = Counter()
    for index in set(sel.positives):
        for class_id in cands[index].instances:
            if class_id not in opt.classes:
                others[class_id] += 1
    return {
        "unit": unit,
        "classes": [{"id": c, "available": available[c], "selected": sel.counts[c],
                     "exhausted": c in sel.exhausted} for c in opt.classes],
        "imbalance": round(max(picked) / min(picked), 2) if picked else None,
        "scenes_available": scene_stats(cands, sel.pool),
        "scenes_selected": scene_stats(cands, sel.positives),
        "unrequested_in_selected": dict(others.most_common()),
        "empty": {"selected": len(sel.empty), "requested": sel.empty_target,
                  "available": sum(1 for i in sel.pool if not cands[i].instances)},
        "labeled": {"selected": len(sel.positives), "unique": len(set(sel.positives)),
                    "requested": sel.positive_target},
        "images": len(sel.empty) + len(sel.positives),
        "unique_images": len(set(sel.empty) | set(sel.positives)),
    }


# ---------------------------------------------------------------------------- run

def build(cands: list[Candidate], opt: Options) -> Result:
    opt.check()
    rng = random.Random(opt.seed)
    n = len(cands)
    state = [""] * n
    reason = [""] * n
    repeats = [0] * n

    wanted = set(opt.classes)
    eligible = []
    for i, c in enumerate(cands):
        if c.excluded:
            state[i], reason[i] = EXCLUDED, c.excluded
        else:
            eligible.append(i)
    if not eligible:
        raise ValueError("no eligible images: everything is excluded by review")

    shots = group_shots(cands, eligible)
    dropped = {}
    if opt.dedup:
        shots, dropped = deduplicate(cands, shots, opt.hamming, opt.window, reason)
        for i in dropped:
            state[i] = DUPLICATE
    kept = sum(map(len, shots))

    budgets = {TEST: opt.num_images}
    pools = {TEST: [index for shot in shots for index in shot]}
    shares = {}
    if opt.val_fraction:
        val_images = round(opt.num_images * opt.val_fraction)
        budgets = {TRAIN: opt.num_images - val_images, VAL: val_images}
        pools[TRAIN], pools[VAL] = split_shots(
            cands, shots, opt.classes, opt.val_fraction, opt.by_instances, rng)
        for class_id in opt.classes:
            amount = {
                name: sum(cands[i].instances.get(class_id, 0) if opt.by_instances
                          else class_id in cands[i].instances for i in pools[name])
                for name in (TRAIN, VAL)
            }
            total = amount[TRAIN] + amount[VAL]
            shares[class_id] = round(amount[VAL] / total, 3) if total else None

    side = {}
    for name, pool in pools.items():
        for i in pool:
            side[i] = name

    result = Result(state, reason, repeats)
    for name, budget in budgets.items():
        sel = select(cands, pools[name], budget, opt,
                     opt.max_repeats if name == TRAIN else 1, rng)
        result.splits[name] = sel
        for i in sel.empty + sel.positives:
            repeats[i] += 1
            state[i] = name
            reason[i] = "empty image" if not cands[i].instances else ""
        result.report[name] = split_report(cands, sel, opt)

    for i in pools[TEST] if TEST in pools else pools[TRAIN] + pools[VAL]:
        if state[i]:
            continue
        if cands[i].instances and not set(cands[i].instances) & wanted:
            state[i], reason[i] = UNREQUESTED, "only classes not being balanced"
        else:
            state[i] = NOT_TAKEN
            reason[i] = f"{side[i]} budget reached" if opt.val_fraction else "budget reached"

    result.report["scan"] = {
        "candidates": n,
        "excluded": n - len(eligible),
        "eligible": len(eligible),
        "duplicates": len(dropped),
        "kept": kept,
        "shots": len(shots),
        "empty": sum(1 for i in eligible if not cands[i].instances),
        "unrequested_only": sum(1 for i in eligible if cands[i].instances
                                and not set(cands[i].instances) & wanted),
    }
    if shares:
        result.report["val_share"] = shares
    return result
