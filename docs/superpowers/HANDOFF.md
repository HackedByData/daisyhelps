# Handoff Note — Daisy Helps Backend

**Last updated:** 2026-05-16
**Status:** Spec approved, plan complete, ready to execute. No implementation code yet.
**Next step:** Execute the plan with `superpowers:subagent-driven-development`.

---

## What this project is

Daisy Helps is a voice AI companion backend that walks tech-novice and elderly users through computer tasks (one step at a time) by voice, with screenshot vision. Rebrand of an open-source "Rosa" hackathon spec. The user owns `daisyhelps.com`.

## Where to look

| Artifact | Path |
|---|---|
| Design spec (approved) | `docs/superpowers/specs/2026-05-16-daisy-helps-backend-design.md` |
| Implementation plan (36 tasks, 6 phases) | `docs/superpowers/plans/2026-05-16-daisy-helps-backend.md` |
| Source prompt (historical) | `rosa-claude-code-prompt.md` — untracked; user will decide its fate later |

## Locked-in decisions (don't re-brainstorm)

- **Persona:** Daisy = calm patient teacher (warm but grounded; less grandmotherly than Rosa)
- **STT:** Groq Whisper Large v3 Turbo (user switched from OpenAI mid-brainstorm for latency)
- **LLM:** Claude Haiku 4.5 for text turns, Claude Sonnet 4.6 for screenshot turns
- **TTS:** ElevenLabs streaming, separate EN + ES voice IDs
- **VAD:** `silero-vad` PyPI package (not `torch.hub` — see DECISIONS rationale)
- **Deploy:** Render at `api.daisyhelps.com` (Vercel was rejected; doesn't support long-lived FastAPI WebSockets)
- **Pace:** hackathon + targeted unit tests (VAD, LLM router, session, WS messages)
- **Demo task:** join a Zoom call with the doctor (unchanged from Rosa source)

## Parallel frontend development model

A Claude design agent builds the frontend **in parallel** with the backend. Three pieces support this — they are not optional:

1. **`docs/API.md` is complete from Phase 0 Task 6a.** Every message type and endpoint documented before pipeline code lands.
2. **`GET /api/status` endpoint** (Phase 0 Task 3b) returns readiness flags backed by `backend/readiness.py`. The frontend reads it to know which features are `live` vs `stubbed`.
3. **WS handler accepts every documented message from Phase 0.** Stubbed types return `error: not_yet_implemented` so the frontend can wire the entire protocol on Day 0 and watch features come online.

Each phase flips the relevant readiness flags in `backend/readiness.py`:
- Phase 1: most of the voice loop goes live
- Phase 2: `screenshot` + `screenshot_request` go live
- Phases 3–5: phase number bumps; verify behavior matches docs

## API keys (already obtained by the user)

The user has these in `.env` at the repo root:
- `ANTHROPIC_API_KEY`
- `GROQ_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID_EN`
- `ELEVENLABS_VOICE_ID_ES`
- `LOG_LEVEL` (optional)

**Do not read `.env` directly.** Backend code loads it via `pydantic-settings`. The template is `.env.example` (created in Phase 0 Task 1).

## Git safety at handoff time

- Repo is on `main`, ~3 commits ahead of `origin/main` (the brainstorm + plan commits).
- **No `.gitignore` exists yet** — Phase 0 Task 1 creates it. Until then, do NOT run `git add -A` or you will stage `.env` with secrets. Stage by explicit file path.
- User has consented to working on `main` for this hackathon-scope build, but confirm once before the first implementation commit.
- `rosa-claude-code-prompt.md` is untracked. Leave it alone unless the user asks otherwise.

## Execution

Use `superpowers:subagent-driven-development`. The plan was written for that skill:
- Fresh implementer subagent per task
- Two-stage review after each task (spec compliance, then code quality)
- Continuous execution — no "should I continue?" check-ins between tasks
- Stop only on genuine BLOCKED (e.g., Render account issue), ambiguity, or all-tasks-complete

Start with Phase 0 Task 1 (`.gitignore`, `requirements.txt`, `pyproject.toml`, `.env.example`, package markers). Each subsequent task is fully specified in the plan with complete code and exact commands.

## Environment

- Windows 11, PowerShell primary, Bash available
- Python 3.11+ expected
- Plan commands use Bash-style syntax that works in both PowerShell and Git Bash (venv activation is the only place that diverges; the plan shows both)
