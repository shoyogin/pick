import io
import json
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path

from PIL import Image

import builder as b
from conftest import make_version
from test_server import call


def cand(name, inst, folder="f", excluded=""):
    return b.Candidate(key=name, folder=folder, stem=name, path=Path("/nonexistent"),
                       instances=inst, excluded=excluded)


def pool(n_car=30, n_bus=6, n_empty=10):
    # Spaced frame numbers: every image is its own shot.
    cs = [cand(f"car{i * 100}", {0: 1}) for i in range(n_car)]
    cs += [cand(f"bus{i * 100}", {1: 1}) for i in range(n_bus)]
    cs += [cand(f"neg{i * 100}", {}) for i in range(n_empty)]
    return cs


def test_balances_the_rare_class_first_and_reports_it():
    res = b.build(pool(), b.Options(num_images=12, classes=[0, 1], empty_percent=0,
                                    dedup=False))
    picked = Counter(s for s in res.state if s == b.TEST)
    rep = res.report["test"]
    assert picked[b.TEST] == 12
    assert {c["id"]: c["selected"] for c in rep["classes"]} == {0: 6, 1: 6}
    assert rep["imbalance"] == 1.0


def test_review_exclusions_are_never_selected():
    cs = pool()
    cs.append(cand("bus999900", {1: 1}, excluded="marked Not OK"))
    res = b.build(cs, b.Options(num_images=40, classes=[0, 1], dedup=False))
    assert res.state[-1] == b.EXCLUDED and res.reason[-1] == "marked Not OK"
    assert res.repeats[-1] == 0


def test_same_seed_same_selection_and_shots_stay_whole():
    cs = [cand(f"frame{i:04d}", {i % 3: 1}, folder=f"cam{i // 20}") for i in range(80)]
    opt = dict(num_images=40, classes=[0, 1, 2], val_fraction=0.25, dedup=False, seed=7)
    one, two = b.build(cs, b.Options(**opt)), b.build(cs, b.Options(**opt))
    assert one.state == two.state
    # cam folders are single shots (consecutive frames): never split across sides.
    for cam in range(4):
        sides = {one.state[i] for i in range(cam * 20, cam * 20 + 20)} - {b.NOT_TAKEN}
        assert len(sides) <= 1


def test_oversampling_repeats_train_only():
    res = b.build(pool(n_car=20, n_bus=2, n_empty=0),
                  b.Options(num_images=20, classes=[0, 1], val_fraction=0.0,
                            max_repeats=3, dedup=False))
    assert max(res.repeats) == 1                # test lists never repeat
    res = b.build(pool(n_car=40, n_bus=4, n_empty=0),
                  b.Options(num_images=30, classes=[0, 1], val_fraction=0.1,
                            max_repeats=3, dedup=False, seed=1))
    assert all(res.repeats[i] <= 1 for i, s in enumerate(res.state) if s == b.VAL)


def test_near_duplicates_are_dropped_with_a_reason(tmp_path):
    cs = []
    for i, shade in enumerate([10, 10, 200]):
        p = tmp_path / f"frame{i:04d}.jpg"
        img = Image.new("RGB", (64, 48), (shade,) * 3)
        if shade == 200:
            img.paste((0, 0, 0), (0, 0, 32, 48))           # a real change
        img.save(p)
        cs.append(b.Candidate(key=p.name, folder="cam", stem=p.stem, path=p,
                              instances={0: 1}))
    res = b.build(cs, b.Options(num_images=3, classes=[0], empty_percent=0))
    assert res.state[1] == b.DUPLICATE and "frame0000" in res.reason[1]
    assert res.state[0] != b.DUPLICATE and res.state[2] != b.DUPLICATE


def test_build_over_http_uses_review_and_logs_history(server, db):
    make_version(db.ROOT, "v2", images="efgh")
    (db.ROOT / "v2" / "classes.txt").write_text("car\nperson\ntent\n")
    db.append_flag("v1", "train", "a.jpg", "no", "carol")
    db.append_flag("v1", "train", "b.jpg", "deleted", "carol")
    db.append_flag("v1", "train", "c.jpg", "no", "carol")             # fixed, then accepted
    db.append_labels("v1", "train", "c.jpg", [[2, 0.5, 0.5, 0.2, 0.2]], "alice")
    db.append_flag("v1", "train", "c.jpg", "ok", "bob")

    req = {"versions": ["v1", "v2"], "num": 4, "empty": 0, "dedup": False,
           "reviewer": "dana"}
    status, view = call(server, "/api/build", req)
    assert status == 200, view
    state = {f"{i['v']}/{i['name']}": i["state"] for i in view["items"]}
    assert state["v1/a.jpg"] == state["v1/b.jpg"] == "excluded"
    assert state["v1/c.jpg"] == "test"                  # accepted fix is eligible
    assert sum(s == "test" for s in state.values()) == 4

    _, hist = call(server, "/api/build/history")
    run = hist["history"][0]
    assert run["kind"] == "preview" and run["reviewer"] == "dana"
    assert run["params"]["seed"] == 42 and run["params"]["versions"] == ["v1", "v2"]

    q = urllib.parse.quote(json.dumps(req))
    with urllib.request.urlopen(f"{server}/build.zip?p={q}") as r:
        z = zipfile.ZipFile(io.BytesIO(r.read()))
    names = z.namelist()
    root = names[0].split("/")[0]
    lbl = f"{root}/labels/test/v1/train/c.txt"
    assert z.read(lbl).decode().startswith("2 ")       # the corrected label ships
    listed = z.read(f"{root}/test.txt").decode().split()
    assert len(listed) == 4 and all(p.startswith("./images/test/") for p in listed)
    assert json.loads(z.read(f"{root}/manifest.json"))["seed"] == 42
    _, hist = call(server, "/api/build/history")
    assert hist["history"][0]["kind"] == "download"


def test_versions_with_different_classes_are_refused(server):
    status, body = call(server, "/api/build", {"versions": ["v1", "online/t0"], "num": 2})
    assert status == 400 and "different classes" in body["error"]


def test_counts_leave_out_review_exclusions_and_cap_the_build(server, db):
    db.append_flag("v1", "train", "a.jpg", "no", "carol")
    db.append_flag("v1", "train", "b.jpg", "deleted", "carol")
    status, counts = call(server, "/api/build/counts?v=v1")
    assert status == 200
    assert counts["total"] == 4 and counts["eligible"] == 2
    assert counts["excluded"] == {"marked Not OK": 1, "deleted": 1}

    status, body = call(server, "/api/build", {"versions": ["v1"], "num": 3, "dedup": False})
    assert status == 400 and "only 2 are eligible" in body["error"]
    assert call(server, "/api/build", {"versions": ["v1"], "num": 2, "empty": 0,
                                       "dedup": False})[0] == 200


def test_history_keeps_the_newest_hundred_runs(server, db):
    for seed in range(105):
        assert call(server, "/api/build", {"versions": ["v1"], "num": 2, "empty": 0,
                                           "dedup": False, "seed": seed})[0] == 200
    lines = (db.REVIEW / "builds.jsonl").read_text().splitlines()
    assert len(lines) == db.BUILD_HISTORY_MAX == 100
    _, hist = call(server, "/api/build/history")
    seeds = [h["params"]["seed"] for h in hist["history"]]
    assert seeds[0] == 104 and seeds[-1] == 5          # the five oldest are gone
