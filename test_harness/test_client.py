"""Python WebSocket client for the Daisy Helps backend.

Connects to /ws/{session_id}, sends a config, optionally streams a fixture WAV
as audio_chunks, optionally sends a screenshot fixture, then prints all
server messages with timestamps. Received audio is concatenated into output.pcm.

Usage:
    python -m test_harness.test_client --url ws://localhost:8000 --language en
    python -m test_harness.test_client --url wss://api.daisyhelps.com --audio test_harness/fixtures/hello.wav
    python -m test_harness.test_client --url ws://localhost:8000 --screenshot test_harness/fixtures/email_screen.png --text "find the zoom link in my email"
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import time
import uuid
import wave
from pathlib import Path

import websockets


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="ws://localhost:8000", help="ws:// or wss:// base")
    p.add_argument("--language", default="en", choices=["en", "es"])
    p.add_argument("--audio", help="path to a 16 kHz mono 16-bit WAV to stream")
    p.add_argument("--screenshot", help="path to a PNG to send before the audio/text")
    p.add_argument("--text", help="send this as user_text after config (mutually exclusive with --audio)")
    args = p.parse_args()

    sid = str(uuid.uuid4())
    url = f"{args.url.rstrip('/')}/ws/{sid}"
    print(f"[{ts()}] connecting {url}")

    output_pcm = Path("output.pcm")
    output_pcm.write_bytes(b"")

    async with websockets.connect(url, max_size=16 * 1024 * 1024) as ws:
        recv_task = asyncio.create_task(receive_loop(ws, output_pcm))

        await ws.send(json.dumps({"type": "config", "language": args.language}))
        print(f"[{ts()}] sent config language={args.language}")

        if args.screenshot:
            data = base64.b64encode(Path(args.screenshot).read_bytes()).decode("ascii")
            await ws.send(json.dumps({"type": "screenshot", "data": data}))
            print(f"[{ts()}] sent screenshot ({len(data)} chars b64)")

        if args.text:
            await ws.send(json.dumps({"type": "user_text", "text": args.text}))
            print(f"[{ts()}] sent user_text {args.text!r}")
        elif args.audio:
            await stream_wav(ws, args.audio)
        else:
            print(f"[{ts()}] no audio/text - receiving server messages until Ctrl-C")

        try:
            await asyncio.wait_for(recv_task, timeout=60)
        except asyncio.TimeoutError:
            print(f"[{ts()}] timed out after 60s")

    print(f"[{ts()}] done. audio saved to {output_pcm}")


async def stream_wav(ws, wav_path: str):
    with wave.open(wav_path, "rb") as w:
        assert w.getframerate() == 16000, f"WAV must be 16kHz, got {w.getframerate()}"
        assert w.getnchannels() == 1, "WAV must be mono"
        assert w.getsampwidth() == 2, "WAV must be 16-bit"
        pcm = w.readframes(w.getnframes())

    chunk_size = 1600 * 2  # 100ms at 16kHz 16-bit
    seq = 0
    for i in range(0, len(pcm), chunk_size):
        chunk = pcm[i:i+chunk_size]
        b64 = base64.b64encode(chunk).decode("ascii")
        await ws.send(json.dumps({"type": "audio_chunk", "data": b64, "sequence": seq}))
        seq += 1
        await asyncio.sleep(0.1)  # pace at real-time
    print(f"[{ts()}] streamed {seq} audio chunks")


async def receive_loop(ws, output_pcm: Path):
    async for raw in ws:
        try:
            msg = json.loads(raw)
        except Exception:
            print(f"[{ts()}] << (non-json) {raw[:80]}")
            continue
        mtype = msg.get("type")
        if mtype == "audio_chunk":
            data = base64.b64decode(msg["data"])
            with output_pcm.open("ab") as f:
                f.write(data)
            print(f"[{ts()}] << audio_chunk seq={msg.get('sequence')} ({len(data)}b)")
        elif mtype == "audio_end":
            print(f"[{ts()}] << audio_end")
            return  # one full turn -> exit
        else:
            print(f"[{ts()}] << {json.dumps(msg)[:200]}")


def ts() -> str:
    return time.strftime("%H:%M:%S")


if __name__ == "__main__":
    asyncio.run(main())
