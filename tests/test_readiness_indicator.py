from backend.readiness import READINESS, is_live


def test_phase_bumped_to_click_indicator():
    assert READINESS["phase"] == 5
    assert READINESS["phase_name"] == "click-indicator"


def test_click_indicator_live():
    assert is_live("server_to_client", "click_indicator")


def test_clear_indicator_live():
    assert is_live("server_to_client", "clear_indicator")
