"""Daisy Helps backend — FastAPI app entrypoint."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from loguru import logger

from backend.logging_setup import configure_logging

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


@app.get("/test")
async def test_page():
    if not TEST_PAGE_PATH.exists():
        return JSONResponse({"error": "test page not built yet"}, status_code=404)
    return FileResponse(TEST_PAGE_PATH, media_type="text/html")
