"""Daisy Helps backend — FastAPI app entrypoint."""
from __future__ import annotations

import asyncio
import base64
import re
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
    clear_indicator_msg,
    click_indicator_msg,
    daisy_text_msg,
    error_msg,
    parse_client_message,
    status_msg,
    transcript_msg,
)
from backend.pipeline.llm import stream_response
from backend.pipeline.locator import locate_click_target
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

# Observational "open" patterns to strip before scanning for click intent:
# e.g. "is open", "is already open", "was still open", "'s open".
# Python stdlib re doesn't support variable-length lookbehinds, so we
# pre-strip these phrases instead of trying to write one giant pattern.
_OBSERVATIONAL_OPEN_RE = re.compile(
    r"\b(?:is|was|are|were|'s|s)\s+(?:\w+\s+){0,3}open\b",
    re.IGNORECASE,
)


class _ClickIntentMatcher:
    """Acts like a compiled regex (exposes .search) but pre-strips observational
    'is/was/are open' phrases so they don't trigger on the bare 'open' keyword."""

    def __init__(self, pattern: re.Pattern[str]):
        self._pattern = pattern

    def search(self, text: str):
        cleaned = _OBSERVATIONAL_OPEN_RE.sub(" ", text)
        return self._pattern.search(cleaned)


# Imperative verbs in Daisy's response that indicate she's asking the user to act
# on a specific UI element. Used to gate the click-indicator locator call.
_CLICK_INTENT_RE = _ClickIntentMatcher(re.compile(
    r"\b(click|tap|press|select|choose|open|hit"
    r"|haz\s+clic|presiona|toca|selecciona|abre|elige|pulsa)\b",
    re.IGNORECASE,
))

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
    # Cancel the in-flight turn first.
    task = session.current_turn_task
    if task and not task.done():
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    session.current_turn_task = None

    # And any pending indicator call from this turn.
    itask = session.current_indicator_task
    if itask and not itask.done():
        itask.cancel()
        try:
            await itask
        except (asyncio.CancelledError, Exception):
            pass
    session.current_indicator_task = None

    if send_audio_end and session.status == "speaking":
        try:
            await websocket.send_json(audio_end_msg())
            await websocket.send_json(status_msg("listening"))
            session.set_status("listening")
        except Exception:
            pass


async def _emit_indicator(
    websocket: WebSocket,
    image_bytes: bytes,
    guidance_text: str,
    language: str,
):
    """Best-effort: ask the locator for a click target, send click_indicator if found.

    Swallows all exceptions — the indicator is additive and must never disturb
    the rest of the turn.
    """
    try:
        target = await locate_click_target(image_bytes, guidance_text, language)
    except Exception as e:
        logger.warning(f"indicator: locator raised ({e}); skipping")
        return
    if target is None:
        return
    try:
        await websocket.send_json(click_indicator_msg(
            x=target.x,
            y=target.y,
            ref_width=target.ref_width,
            ref_height=target.ref_height,
            label=target.label,
            confidence=None,
        ))
    except Exception as e:
        logger.warning(f"indicator: send failed ({e})")


async def _run_turn(
    websocket: WebSocket,
    session: Session,
    utterance_audio: bytes | None,
    user_text: str | None,
):
    """Run a full turn: STT (if audio) → LLM stream → TTS stream."""
    try:
        # Clear any prior turn's click indicator — fulfills the "indicator clears
        # on next user utterance" lifecycle. Send-errors are swallowed; the rest
        # of the turn must proceed regardless.
        try:
            await websocket.send_json(clear_indicator_msg())
        except Exception:
            pass

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

        # TTS — best-effort. A failure here (e.g. ElevenLabs 401 on free tier)
        # must not abort the rest of the turn: the user still needs the final
        # daisy_text frame, the click_indicator pointer, and a clean return to
        # idle. Without this guard, every TTS-down moment silently drops the
        # click pointer because the emit call below was unreachable.
        session.set_status("speaking")
        await websocket.send_json(status_msg("speaking"))

        seq = 0
        try:
            async for audio_chunk in stream_tts(llm_stream_with_emit(), session.language):
                b64 = base64.standard_b64encode(audio_chunk).decode("ascii")
                await websocket.send_json(audio_chunk_msg(b64, sequence=seq))
                seq += 1
        except asyncio.CancelledError:
            raise
        except Exception as tts_exc:
            logger.warning(f"TTS failed mid-turn ({tts_exc}); continuing with indicator + cleanup")
            try:
                await websocket.send_json(error_msg("tts_failed", str(tts_exc)))
            except Exception:
                pass

        # Final daisy_text frame (non-partial) with full text. May be partial
        # if TTS died before the LLM stream fully drained — that's acceptable:
        # the captions already showed each delta as it arrived.
        full = "".join(llm_text_acc)
        await websocket.send_json(daisy_text_msg(full, partial=False))
        session.append_assistant(full)

        await websocket.send_json(audio_end_msg())

        # Click-indicator: best-effort, post-audio. Only fires when a screenshot
        # was actually consumed this turn AND Daisy asked the user to click.
        if image_bytes is not None and _CLICK_INTENT_RE.search(full):
            session.current_indicator_task = asyncio.create_task(
                _emit_indicator(websocket, image_bytes, full, session.language)
            )

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
