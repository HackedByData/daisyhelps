import pytest

from backend.pipeline.locator import png_dimensions


def _fake_png(width: int, height: int) -> bytes:
    """Synthesize a minimal PNG: 8-byte signature + 13-byte IHDR length + 'IHDR' + width + height.
    Only the first 24 bytes are inspected by png_dimensions; we don't need a valid IDAT.
    """
    return (
        b"\x89PNG\r\n\x1a\n"          # PNG signature
        + b"\x00\x00\x00\x0d"         # IHDR chunk length = 13
        + b"IHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
    )


def test_png_dimensions_extracts_size():
    png = _fake_png(1920, 1080)
    assert png_dimensions(png) == (1920, 1080)


def test_png_dimensions_handles_non_standard_size():
    png = _fake_png(3840, 2160)
    assert png_dimensions(png) == (3840, 2160)


def test_png_dimensions_rejects_bad_magic():
    with pytest.raises(ValueError):
        png_dimensions(b"not a png" + b"\x00" * 20)


def test_png_dimensions_rejects_too_short():
    with pytest.raises(ValueError):
        png_dimensions(b"\x89PNG\r\n\x1a\n")  # signature only, no IHDR


import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from backend.pipeline import locator as locator_mod
from backend.pipeline.locator import ClickTarget, locate_click_target


def _tool_use_block(x: int, y: int):
    return SimpleNamespace(
        type="tool_use",
        name="computer",
        input={"action": "left_click", "coordinate": [x, y]},
    )


def _text_block(text: str):
    return SimpleNamespace(type="text", text=text)


def _mock_client_returning(content_blocks):
    """Build a mock that quacks like AsyncAnthropic for a single .beta.messages.create call."""
    response = SimpleNamespace(content=content_blocks)
    client = MagicMock()
    client.beta.messages.create = AsyncMock(return_value=response)
    return client


def test_locate_click_target_returns_coords_on_success(monkeypatch):
    png = _fake_png(1920, 1080)
    client = _mock_client_returning([_text_block("Join button"), _tool_use_block(842, 537)])
    monkeypatch.setattr(locator_mod, "_client", lambda: client)

    result = asyncio.run(locate_click_target(png, "Click the Join button.", "en"))

    assert result == ClickTarget(x=842, y=537, ref_width=1920, ref_height=1080, label="Join button")
    # Verify we asked Sonnet with computer tool sized to the screenshot
    args, kwargs = client.beta.messages.create.call_args
    assert kwargs["model"] == "claude-sonnet-4-6"
    tool = kwargs["tools"][0]
    assert tool["type"] == "computer_20250124"
    assert tool["display_width_px"] == 1920
    assert tool["display_height_px"] == 1080
    assert kwargs.get("betas") == ["computer-use-2025-01-24"]
    # And the call must be on the beta path, not the stable one.
    client.beta.messages.create.assert_awaited_once()
    client.messages.create.assert_not_called()


def test_locate_click_target_returns_none_when_no_tool_use(monkeypatch):
    png = _fake_png(1920, 1080)
    client = _mock_client_returning([_text_block("I cannot determine the target.")])
    monkeypatch.setattr(locator_mod, "_client", lambda: client)

    result = asyncio.run(locate_click_target(png, "Click somewhere.", "en"))
    assert result is None


def test_locate_click_target_returns_none_when_out_of_bounds(monkeypatch):
    png = _fake_png(1920, 1080)
    client = _mock_client_returning([_tool_use_block(5000, 5000)])  # outside screenshot
    monkeypatch.setattr(locator_mod, "_client", lambda: client)

    result = asyncio.run(locate_click_target(png, "Click somewhere.", "en"))
    assert result is None


def test_locate_click_target_returns_none_on_exception(monkeypatch):
    png = _fake_png(1920, 1080)
    client = MagicMock()
    client.beta.messages.create = AsyncMock(side_effect=RuntimeError("network down"))
    monkeypatch.setattr(locator_mod, "_client", lambda: client)

    result = asyncio.run(locate_click_target(png, "Click somewhere.", "en"))
    assert result is None


def test_locate_click_target_returns_none_when_action_is_not_left_click(monkeypatch):
    png = _fake_png(1920, 1080)
    block = SimpleNamespace(
        type="tool_use",
        name="computer",
        input={"action": "type", "text": "hello"},
    )
    client = _mock_client_returning([block])
    monkeypatch.setattr(locator_mod, "_client", lambda: client)

    result = asyncio.run(locate_click_target(png, "Click somewhere.", "en"))
    assert result is None


def test_locate_click_target_returns_none_on_bad_png(monkeypatch):
    # No client should be needed — png_dimensions raises before any API call.
    client = MagicMock()
    client.beta.messages.create = AsyncMock()
    monkeypatch.setattr(locator_mod, "_client", lambda: client)

    result = asyncio.run(locate_click_target(b"not a png at all", "Click somewhere.", "en"))
    assert result is None
    client.beta.messages.create.assert_not_called()


def test_locate_click_target_trims_long_label(monkeypatch):
    png = _fake_png(1920, 1080)
    long_text = "x" * 500
    client = _mock_client_returning([_text_block(long_text), _tool_use_block(10, 10)])
    monkeypatch.setattr(locator_mod, "_client", lambda: client)

    result = asyncio.run(locate_click_target(png, "Click.", "en"))
    assert result is not None
    assert len(result.label) <= 80
