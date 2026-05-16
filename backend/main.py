"""Daisy Helps backend — FastAPI app entrypoint."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from loguru import logger
from pydantic import ValidationError

from backend.logging_setup import configure_logging
from backend.messages import (
    ConfigMessage,
    error_msg,
    parse_client_message,
    status_msg,
)
from backend.readiness import READINESS, is_live

TEST_PAGE_PATH = Path(__file__).resolve().parent.parent / "test_harness" / "test_page.html"


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    logger.info("Daisy Helps backend starting")
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
    return JSONResponse({
        "service": "daisy-helps-backend",
        "status": "running",
        "docs": "/docs",
    })


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
    logger.info(f"WS connect session_id={session_id}")
    await websocket.send_json(status_msg("idle"))

    # Per-session local state (placeholder; replaced by SessionStore in Phase 1)
    language = "en"

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
                    error_msg("not_yet_implemented", f"{mtype} is not live in phase {0}")
                )
                continue

            # Live handlers (Phase 0 only handles `config`)
            if isinstance(msg, ConfigMessage):
                language = msg.language
                logger.info(f"session={session_id} language={language}")
                # Acknowledge by emitting a fresh status
                await websocket.send_json(status_msg("idle"))

    except WebSocketDisconnect:
        logger.info(f"WS disconnect session_id={session_id}")
