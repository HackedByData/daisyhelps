"""Feature readiness flags. Returned by GET /api/status.

Each phase flips flags from STATUS_STUBBED to STATUS_LIVE as features land.
The frontend agent reads this to know what to expect from the backend.

This is the single source of truth — when in doubt, this dict wins.
"""

STATUS_LIVE = "live"
STATUS_STUBBED = "stubbed"

READINESS: dict = {
    "service": "daisy-helps-backend",
    "version": "0.1.0",
    "phase": 0,
    "phase_name": "scaffold",
    "http": {
        "GET /healthz": STATUS_LIVE,
        "GET /": STATUS_LIVE,
        "GET /test": STATUS_LIVE,
        "GET /api/status": STATUS_LIVE,
        "WS /ws/{session_id}": STATUS_LIVE,
    },
    "client_to_server": {
        "config": STATUS_LIVE,
        "audio_chunk": STATUS_STUBBED,
        "user_text": STATUS_STUBBED,
        "screenshot": STATUS_STUBBED,
        "interrupt": STATUS_STUBBED,
        "language_change": STATUS_STUBBED,
        "end_session": STATUS_STUBBED,
    },
    "server_to_client": {
        "status": STATUS_LIVE,
        "error": STATUS_LIVE,
        "transcript": STATUS_STUBBED,
        "daisy_text": STATUS_STUBBED,
        "audio_chunk": STATUS_STUBBED,
        "audio_end": STATUS_STUBBED,
        "screenshot_request": STATUS_STUBBED,
    },
}


def is_live(category: str, key: str) -> bool:
    return READINESS.get(category, {}).get(key) == STATUS_LIVE
