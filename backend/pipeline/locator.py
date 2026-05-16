"""Claude computer-use 'look but don't act' locator for the click indicator.

Used to compute a single (x, y) target on a screenshot the user just shared,
so the frontend can draw a visual highlight at that point. We never execute
the click — Daisy's product principle is 'guide, never do'.
"""
from __future__ import annotations


def png_dimensions(png: bytes) -> tuple[int, int]:
    """Read width and height from the PNG IHDR chunk (bytes 16-23).

    Avoids a Pillow dependency — we only need two big-endian uint32s.
    """
    if len(png) < 24 or png[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    width = int.from_bytes(png[16:20], "big")
    height = int.from_bytes(png[20:24], "big")
    return width, height
