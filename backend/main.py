"""Daisy Helps backend — FastAPI app entrypoint."""
from __future__ import annotations

import asyncio
import base64
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from loguru import logger
from pydantic import ValidationError

from backend.logging_setup import configure_logging
from backend.messages import (
    AudioChunkMessage,
    ConfigMessage,
    EndSessionMessage,
    InterruptMessage,
    LanguageChangeMessage,
    ScreenshotMessage,
    UserTextMessage,
    audio_chunk_msg,
    audio_end_msg,
    daisy_text_msg,
    error_msg,
    parse_client_message,
    status_msg,
    transcript_msg,
)
from backend.pipeline.llm import stream_response
from backend.pipeline.stt import make_stt_provider
from backend.pipeline.tts import stream_tts
from backend.pipeline.vad import VADBuffer
from backend.readiness import READINESS, is_live
from backend.session import Session, SessionStore

TEST_PAGE_PATH = Path(__file__).resolve().parent.parent / "test_harness" / "test_page.html"

# Words that suggest the user might want Daisy to look at the screen.
_VISUAL_HINT_WORDS = (
    "screen", "page", "see", "look", "show", "click", "button", "window",
    "email", "tab", "browser", "open",
    "pantalla", "página", "ver", "mirar", "mostrar", "haz clic", "botón", "ventana",
    "correo", "pestaña", "navegador", "abrir",
)

session_store = SessionStore()
stt_provider = None  # type: ignore[assignment]


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    logger.info(f"Daisy Helps backend starting (phase {READINESS['phase']})")
    global stt_provider
    stt_provider = make_stt_provider()
    yield
    logger.info("Daisy Helps backend shutting down")


app = FastAPI(title="Daisy Helps Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://daisyhelps.com",
        "https://www.daisyhelps.com",
        "https://api.daisyhelps.com",
    ],
    allow_origin_regex=r"^http://localhost:\d+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return JSONResponse({"status": "ok"})


@app.get("/")
async def root():
    return JSONResponse({"service": "daisy-helps-backend", "status": "running", "docs": "/docs"})


@app.get("/api/status")
async def api_status():
    return JSONResponse(READINESS)


@app.get("/test")
async def test_page():
    if not TEST_PAGE_PATH.exists():
        return JSONResponse({"error": "test page not built yet"}, status_code=404)
    return FileResponse(TEST_PAGE_PATH, media_type="text/html")


@app.websocket("/ws/{session_id}")
async def ws_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        await websocket.send_json(error_msg("bad_session_id", "session_id must be a UUID"))
        await websocket.close()
        return

    session = session_store.create(sid)
    session.vad_buffer = VADBuffer(sample_rate=16000, silence_ms=700)

    logger.info(f"WS connect session={sid}")
    await websocket.send_json(status_msg("idle"))

    try:
        while True:
            raw = await websocket.receive_json()
            try:
                msg = parse_client_message(raw)
            except (ValidationError, ValueError) as e:
                await websocket.send_json(error_msg("bad_message", str(e)))
                continue

            mtype = msg.type
            if not is_live("client_to_server", mtype):
                await websocket.send_json(
                    error_msg("not_yet_implemented", f"{mtype} is not live in phase {READINESS['phase']}")
                )
                continue

            if isinstance(msg, ConfigMessage):
                session.set_language(msg.language)
                logger.info(f"session={sid} language={msg.language}")

            elif isinstance(msg, AudioChunkMessage):
                pcm = base64.standard_b64decode(msg.data)
                utterance = session.vad_buffer.ingest(pcm)
                if utterance is not None:
                    await _start_turn(websocket, session, utterance_audio=utterance, user_text=None)

            elif isinstance(msg, UserTextMessage):
                await _start_turn(websocket, session, utterance_audio=None, user_text=msg.text)

            elif isinstance(msg, ScreenshotMessage):
                try:
                    png = base64.b64decode(msg.data, validate=True)
                    if len(png) < 8 or png[:8] != b"\x89PNG\r\n\x1a\n":
                        raise ValueError("not a PNG")
                    session.set_screenshot(png)
                    logger.info(f"session={sid} screenshot received ({len(png)}b)")
                except Exception as e:
                    await websocket.send_json(error_msg("screenshot_invalid", str(e)))

            elif isinstance(msg, InterruptMessage):
                await _cancel_turn(websocket, session)

            elif isinstance(msg, LanguageChangeMessage):
                session.set_language(msg.language)
                logger.info(f"session={sid} language switched to {msg.language}")

            elif isinstance(msg, EndSessionMessage):
                await websocket.close()
                break

    except WebSocketDisconnect:
        logger.info(f"WS disconnect session={sid}")
    except Exception:
        logger.exception("WS error")
    finally:
        await _cancel_turn(websocket, session, send_audio_end=False)
        session_store.remove(sid)


async def _start_turn(
    websocket: WebSocket,
    session: Session,
    utterance_audio: bytes | None,
    user_text: str | None,
):
    """Cancel any in-flight turn and start a new one."""
    await _cancel_turn(websocket, session)
    session.current_turn_task = asyncio.create_task(
        _run_turn(websocket, session, utterance_audio, user_text)
    )


async def _cancel_turn(websocket: WebSocket, session: Session, send_audio_end: bool = True):
    task = session.current_turn_task
    if task and not task.done():
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    session.current_turn_task = None
    if send_audio_end and session.status == "speaking":
        try:
            await websocket.send_json(audio_end_msg())
            await websocket.send_json(status_msg("listening"))
            session.set_status("listening")
        except Exception:
            pass


async def _run_turn(
    websocket: WebSocket,
    session: Session,
    utterance_audio: bytes | None,
    user_text: str | None,
):
    """Run a full turn: STT (if audio) → LLM stream → TTS stream."""
    try:
        # Transcribe if audio
        if utterance_audio is not None:
            session.set_status("listening")
            await websocket.send_json(status_msg("listening"))
            text = await stt_provider.transcribe(utterance_audio, session.language)
            await websocket.send_json(transcript_msg(text, final=True))
        else:
            text = user_text or ""
            await websocket.send_json(transcript_msg(text, final=True))

        if not text.strip():
            session.set_status("idle")
            await websocket.send_json(status_msg("idle"))
            return

        session.append_user(text)

        # LLM
        session.set_status("thinking")
        await websocket.send_json(status_msg("thinking"))

        # Vision: attach screenshot if fresh; otherwise proactively ask for one when the user mentions visual cues
        image_bytes = None
        if session.has_fresh_screenshot():
            image_bytes = session.consume_screenshot()
        else:
            lower = text.lower()
            if any(w in lower for w in _VISUAL_HINT_WORDS):
                await websocket.send_json(
                    {"type": "screenshot_request", "reason": "I'd like to see what you're looking at"}
                )

        # Collect LLM stream into a queue so we can fan out to (a) a chained TTS, (b) daisy_text emission
        llm_text_acc = []

        async def llm_stream_with_emit():
            async for delta in stream_response(session.messages[:-1], text, image_bytes, session.language):
                llm_text_acc.append(delta)
                await websocket.send_json(daisy_text_msg(delta, partial=True))
                yield delta

        # TTS
        session.set_status("speaking")
        await websocket.send_json(status_msg("speaking"))

        seq = 0
        async for audio_chunk in stream_tts(llm_stream_with_emit(), session.language):
            b64 = base64.standard_b64encode(audio_chunk).decode("ascii")
            await websocket.send_json(audio_chunk_msg(b64, sequence=seq))
            seq += 1

        # Final daisy_text frame (non-partial) with full text
        full = "".join(llm_text_acc)
        await websocket.send_json(daisy_text_msg(full, partial=False))
        session.append_assistant(full)

        await websocket.send_json(audio_end_msg())
        session.set_status("idle")
        await websocket.send_json(status_msg("idle"))

    except asyncio.CancelledError:
        logger.info("turn cancelled (interrupt)")
        raise
    except Exception as e:
        logger.exception("turn failed")
        try:
            await websocket.send_json(error_msg("turn_failed", str(e)))
        except Exception:
            pass
