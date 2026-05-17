from backend.readiness import READINESS, is_live


def test_phase_bumped_to_desktop_launch():
    assert READINESS["phase"] == 6
    assert READINESS["phase_name"] == "desktop-launch"


def test_click_indicator_live():
    assert is_live("server_to_client", "click_indicator")


def test_clear_indicator_live():
    assert is_live("server_to_client", "clear_indicator")
