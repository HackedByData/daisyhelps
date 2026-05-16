import json

from backend.messages import click_indicator_msg, clear_indicator_msg


def test_click_indicator_msg_full_schema():
    msg = click_indicator_msg(
        x=842, y=537,
        ref_width=1920, ref_height=1080,
        label="Join button", confidence=None,
    )
    assert msg == {
        "type": "click_indicator",
        "x": 842, "y": 537,
        "ref_width": 1920, "ref_height": 1080,
        "label": "Join button",
        "confidence": None,
    }


def test_click_indicator_msg_defaults_label_and_confidence_to_none():
    msg = click_indicator_msg(x=10, y=20, ref_width=100, ref_height=200)
    assert msg["label"] is None
    assert msg["confidence"] is None


def test_click_indicator_msg_survives_json_roundtrip():
    msg = click_indicator_msg(x=1, y=2, ref_width=3, ref_height=4, label="x", confidence=None)
    assert json.loads(json.dumps(msg)) == msg


def test_clear_indicator_msg():
    assert clear_indicator_msg() == {"type": "clear_indicator"}
