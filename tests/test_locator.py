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
