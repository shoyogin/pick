"""Regression tests for the fixes from the code review (fix/agent-code-review)."""
import json
import threading
import time
import urllib.request
from urllib.error import HTTPError

import pytest

from test_server import export, images_in


def test_a_save_during_the_first_read_is_not_lost(db, monkeypatch):
    """A save racing the first read of a log must reach the cache, or the export
    ships an image that is "no" on disk.

    The dangerous moment is after the read reaches end-of-file and before the
    result is stored: a line appended then is too late to be read, and the store
    overwrites the cache without it. The reader is held exactly there while
    another thread saves."""
    db.append_flag("v1", "train", "a.jpg", "ok", "bob")
    db._flags.clear()                                  # as after "Rescan disk"

    at_eof = threading.Event()

    class HeldAtEOF:
        def __init__(self, fh):
            self.fh = fh

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.fh.close()

        def __iter__(self):
            yield from self.fh
            at_eof.set()
            time.sleep(0.1)                            # the gap, held open

    def opener(path, mode="r", *a, **k):
        fh = open(path, mode, *a, **k)
        reading_log = str(path).endswith(".jsonl") and "r" in mode
        return HeldAtEOF(fh) if reading_log else fh

    monkeypatch.setattr(db, "open", opener, raising=False)
    writer = threading.Thread(target=lambda: (
        at_eof.wait(2), db.append_flag("v1", "train", "b.jpg", "no", "carol")))
    writer.start()
    db.load_flags("v1", "train")
    writer.join()
    monkeypatch.delattr(db, "open")

    on_disk = {json.loads(line)["image"]: json.loads(line)["status"]
               for line in open(db.review_path("v1", "train"))}
    cached = {k: v["status"] for k, v in db.load_flags("v1", "train").items()}
    assert on_disk == {"a.jpg": "ok", "b.jpg": "no"}
    assert cached == on_disk
    assert "b.jpg" not in images_in(export("v1"))


@pytest.mark.parametrize("body", [
    [], "x", 42, None,
    {"v": "v1", "split": "train", "image": "a.jpg", "status": "ok", "reviewer": 123},
    {"v": "v1", "split": "train", "image": "a.jpg", "status": 7},
])
def test_malformed_bodies_get_400_without_internals(server, body):
    req = urllib.request.Request(server + "/api/flag", data=json.dumps(body).encode(),
                                 method="POST", headers={"Content-Type": "application/json"})
    with pytest.raises(HTTPError) as err:
        urllib.request.urlopen(req)
    assert err.value.code == 400
    assert "Traceback" not in err.value.read().decode()


def test_zip_does_not_follow_symlinks_out_of_the_root(db, tmp_path):
    secret = tmp_path / "outside.txt"
    secret.write_text("SECRET")
    (db.ROOT / "v1/labels/train/leak.txt").symlink_to(secret)
    names = export("v1").namelist()
    assert not any("leak" in n for n in names)
    assert len([n for n in names if n.endswith(".jpg")]) == 4      # the rest still ships


def test_images_are_not_publicly_cacheable(server):
    with urllib.request.urlopen(server + "/img?t=1&v=v1&split=train&n=a.jpg") as r:
        assert r.headers["Cache-Control"].startswith("private")
