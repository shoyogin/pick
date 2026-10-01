import threading
from http.server import ThreadingHTTPServer

import pytest
from PIL import Image

import pick as m

CLASSES = "car\nperson\ntent\n"
LABEL = "0 0.5 0.5 0.2 0.2\n1 0.25 0.25 0.1 0.1\n"


def make_version(root, name, images="abcd", splits=("train",)):
    for split in splits:
        (root / name / "images" / split).mkdir(parents=True)
        (root / name / "labels" / split).mkdir(parents=True)
        for n in images:
            Image.new("RGB", (64, 48), "grey").save(root / name / "images" / split / f"{n}.jpg")
            (root / name / "labels" / split / f"{n}.txt").write_text(LABEL)


@pytest.fixture
def db(tmp_path, monkeypatch):
    """The server module pointed at a throwaway dataset, with clean caches.

    v1 is a flat version with a classes.txt; online/t0 sits in a group whose
    classes.txt it inherits."""
    root = tmp_path / "ds"
    make_version(root, "v1")
    (root / "v1" / "classes.txt").write_text(CLASSES)
    make_version(root, "online/t0", images="ab")
    (root / "online" / "classes.txt").write_text("drone\nbird\n")
    for d in ("review", "cache"):
        (tmp_path / d).mkdir()

    monkeypatch.setattr(m, "ROOT", root.resolve())
    monkeypatch.setattr(m, "REVIEW", (tmp_path / "review").resolve())
    monkeypatch.setattr(m, "CACHE_DIR", (tmp_path / "cache").resolve())
    monkeypatch.setattr(m, "USER_HEADER", None)
    monkeypatch.setattr(m, "WEB", None)
    m._flags.clear()
    m._scan_cache.clear()
    yield m
    m._flags.clear()
    m._scan_cache.clear()


@pytest.fixture
def server(db):
    """The real HTTP handler on an ephemeral port."""
    srv = ThreadingHTTPServer(("127.0.0.1", 0), m.Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()
