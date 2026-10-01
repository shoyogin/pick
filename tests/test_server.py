import io
import json
import urllib.request
import zipfile
from pathlib import Path
from urllib.error import HTTPError

import pytest

import pick as m


class Sink(io.RawIOBase):
    """A non-seekable writer, so zipfile streams the way the server does."""
    def __init__(self):
        self.buf = bytearray()

    def write(self, data):
        self.buf += data
        return len(data)

    def close(self):
        pass


def export(version):
    sink = Sink()
    skip, extra = m.download_plan(version)
    m.zip_into(sink, m.ROOT / version, "x", skip=skip, extra=extra)
    return zipfile.ZipFile(io.BytesIO(bytes(sink.buf)))


def images_in(z):
    return sorted(Path(n).name for n in z.namelist() if n.endswith(".jpg"))


def call(base, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method="POST" if data else "GET",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            status, raw = r.status, r.read()
    except HTTPError as e:
        status, raw = e.code, e.read()
    try:
        return status, json.loads(raw or b"{}")
    except ValueError:
        return status, raw.decode()      # some refusals are plain text


# ------------------------------------------------------------- class names

@pytest.mark.parametrize("text, want", [
    ("car\nperson\n", ["car", "person"]),
    ("  0 car\n  2 tent", ["car", "1", "tent"]),           # gap keeps its index
    ("0: car\n1, person\n", ["car", "person"]),
    ("# names\n\ncar\n", ["car"]),
    ("3d-printer\nf16\n747 jet\n", ["3d-printer", "f16", "747 jet"]),  # not indices
    ("\n# only comments\n", []),
])
def test_classes_txt(text, want):
    assert m.parse_classes_txt(text) == want


def test_nested_versions_and_inherited_classes(db):
    assert db.list_versions() == ["online/t0", "v1"]
    assert db.read_classes("v1") == (["car", "person", "tent"], "v1/classes.txt")
    assert db.read_classes("online/t0") == (["drone", "bird"], "online/classes.txt")
    assert db.version_of(Path("online/t0/images/train")) == "online/t0"
    assert db.version_of(Path("online")) == ""


# ------------------------------------------------------------------ review

def test_legacy_note_is_one_comment_not_a_pile_of_drafts(db):
    entry = db.blank_entry()
    for note in ("box is", "box is off", "box is off, wrong class"):
        db.replay(entry, {"image": "a.jpg", "status": "drop", "note": note,
                          "reviewer": "alice", "ts": "t"})
    assert entry["status"] == "no"
    assert [c["text"] for c in db.thread(entry)] == ["box is off, wrong class"]


def test_relabel_four_eyes_and_revert(db):
    db.append_flag("v1", "train", "a.jpg", "no", "carol")
    db.append_labels("v1", "train", "a.jpg", [[2, 0.5, 0.5, 0.2, 0.2]], "alice")
    entry = db.load_flags("v1", "train")["a.jpg"]
    assert (entry["status"], entry["boxes_by"]) == ("review", "alice")

    with pytest.raises(PermissionError):
        db.append_flag("v1", "train", "a.jpg", "ok", "alice")      # own redraw
    db.append_flag("v1", "train", "a.jpg", "no", "alice")           # withdrawing is fine
    db.append_flag("v1", "train", "a.jpg", "ok", "bob")
    assert db.load_flags("v1", "train")["a.jpg"]["status"] == "ok"

    db.revert_labels("v1", "train", "a.jpg", "bob")
    entry = db.load_flags("v1", "train")["a.jpg"]
    assert (entry["status"], entry["boxes"]) == ("no", None)


@pytest.mark.parametrize("bad", [
    [[0, 0.5]], [[0, 0.5, 0.5, float("nan"), 0.1]], [[-1, 0.5, 0.5, 0.1, 0.1]],
    [["x", 0.5, 0.5, 0.1, 0.1]], "not a list", [[0, 0.5, 0.5, 0.1, 0.1]] * 1001,
])
def test_bad_boxes_are_refused(bad):
    with pytest.raises(ValueError):
        m.clean_boxes(bad)


def test_boxes_off_the_edge_are_clamped():
    assert m.clean_boxes([[0, 0.5, 0.5, 2, 2]]) == [[0, 0.5, 0.5, 1.0, 1.0]]


def test_replay_from_disk_matches_the_cache(db):
    db.append_flag("v1", "train", "a.jpg", "no", "carol")
    db.append_labels("v1", "train", "a.jpg", [[1, 0.4, 0.4, 0.2, 0.2]], "alice")
    db.append_comment("v1", "train", "a.jpg", "redrawn", "alice")
    cached = db.flag_view(db.load_flags("v1", "train")["a.jpg"])
    db._flags.clear()
    assert db.flag_view(db.load_flags("v1", "train")["a.jpg"]) == cached


# ---------------------------------------------------------------- comments

def test_editing_a_comment_keeps_its_author_and_place(db):
    db.append_comment("v1", "train", "a.jpg", "frist", "alice")
    db.append_comment("v1", "train", "a.jpg", "second", "bob")
    first = db.thread(db.load_flags("v1", "train")["a.jpg"])[0]
    db.append_comment("v1", "train", "a.jpg", "first", "alice", first["id"])
    db._flags.clear()
    thread = db.thread(db.load_flags("v1", "train")["a.jpg"])
    assert [c["text"] for c in thread] == ["first", "second"]
    assert thread[0]["edited"] and thread[0]["reviewer"] == "alice"


def test_only_the_author_may_change_a_comment(db):
    db.append_comment("v1", "train", "a.jpg", "mine", "alice")
    cid = db.thread(db.load_flags("v1", "train")["a.jpg"])[0]["id"]
    with pytest.raises(PermissionError):
        db.append_comment("v1", "train", "a.jpg", "hijacked", "eve", cid)
    with pytest.raises(PermissionError):
        db.delete_comment("v1", "train", "a.jpg", cid, "eve")


def test_unattributed_comments_can_be_cleaned_up_by_anyone(db):
    db.append_comment("v1", "train", "a.jpg", "orphan", db.UNOWNED)
    cid = db.thread(db.load_flags("v1", "train")["a.jpg"])[0]["id"]
    db.delete_comment("v1", "train", "a.jpg", cid, "bob")
    assert db.thread(db.load_flags("v1", "train")["a.jpg"]) == []


# ------------------------------------------------------------------ export

def test_export_holds_back_rejects_fixes_and_deletions(db):
    db.append_flag("v1", "train", "a.jpg", "ok", "bob")
    db.append_flag("v1", "train", "b.jpg", "no", "bob")
    db.append_labels("v1", "train", "c.jpg", [[0, 0.5, 0.5, 0.2, 0.2]], "alice")  # review
    db.append_flag("v1", "train", "d.jpg", "deleted", "bob")
    z = export("v1")
    assert images_in(z) == ["a.jpg"]
    held = z.read("x/EXCLUDED.csv").decode()
    for line in ("b.jpg,no", "c.jpg,review", "d.jpg,deleted"):
        assert line in held


def test_unflagged_images_ship_as_they_are(db):
    db.append_flag("v1", "train", "a.jpg", "no", "bob")
    assert images_in(export("v1")) == ["b.jpg", "c.jpg", "d.jpg"]


def test_accepted_fix_ships_with_the_corrected_label_once(db):
    db.append_flag("v1", "train", "a.jpg", "no", "carol")
    db.append_labels("v1", "train", "a.jpg", [[2, 0.4, 0.4, 0.2, 0.2]], "alice")
    db.append_flag("v1", "train", "a.jpg", "ok", "bob")
    z = export("v1")
    labels = [n for n in z.namelist() if n.endswith("labels/train/a.txt")]
    assert len(labels) == 1
    assert z.read(labels[0]).decode() == "2 0.400000 0.400000 0.200000 0.200000\n"
    assert (db.ROOT / "v1/labels/train/a.txt").read_text() == "0 0.5 0.5 0.2 0.2\n1 0.25 0.25 0.1 0.1\n"
    assert "a.jpg,1,alice" in z.read("x/CORRECTED.csv").decode()


def test_deleted_images_stay_out_of_the_fix_queue(db):
    db.append_flag("v1", "train", "a.jpg", "no", "bob")
    db.append_flag("v1", "train", "b.jpg", "deleted", "bob")
    flags = db.load_flags("v1", "train")
    assert sorted(k for k, v in flags.items() if v["status"] in ("no", "review")) == ["a.jpg"]


# -------------------------------------------------------------------- HTTP

def test_http_round_trip(server):
    status, body = call(server, "/api/versions")
    assert status == 200 and body["versions"] == ["online/t0", "v1"]

    status, body = call(server, "/api/flag", {"v": "v1", "split": "train",
                                              "image": "a.jpg", "status": "no"})
    assert status == 200 and body["flag"]["status"] == "no"

    status, body = call(server, "/api/queue?v=v1")
    assert status == 200 and [i["name"] for i in body["items"]] == ["a.jpg"]

    status, body = call(server, "/api/review/summary?v=v1")
    assert body["no"] == 1 and body["unflagged"] == 3


def test_http_refuses_paths_out_of_the_root(server):
    assert call(server, "/api/version?v=../../etc")[0] == 403
    assert call(server, "/api/flag", {"v": "../..", "split": "train",
                                      "image": "a.jpg", "status": "no"})[0] in (403, 404)
