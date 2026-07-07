# Johnson's Golf

Version 2 of the golf project: a golf game. This branch (`version2`) is a clean slate — the earlier golf betting model lives on the repo's other branches and is unrelated to this project.

> **Status:** Project scaffold only. The design documents below are placeholder stubs awaiting their real content, and `package.json` is a minimal manifest to be fleshed out once the technical architecture doc is in place.

## Documentation map

All project knowledge lives in `docs/`, in reading order:

| Doc | Purpose |
| --- | --- |
| `docs/01_PROJECT_VISION.md` | Why this game exists and what it aims to be |
| `docs/02_GAME_DESIGN_DOCUMENT.md` | Core gameplay, mechanics, and systems |
| `docs/03_ART_DIRECTION.md` | Visual style and art guidelines |
| `docs/03B_REFERENCE_GUIDE.md` | Reference material supporting the art direction |
| `docs/04_TECHNICAL_ARCHITECTURE.md` | Tech stack, engine, and code architecture |
| `docs/05_DEVELOPMENT_ROADMAP.md` | Milestones and build order |
| `docs/06_CLAUDE_WORKFLOW.md` | How Claude Code should work in this repo |
| `docs/07_PLAYER_EXPERIENCE.md` | UX, onboarding, and player journey |
| `docs/08_LIVE_SERVICE_AND_PROGRESSION.md` | Progression systems and live-service plans |
| `docs/09_PRODUCT_REQUIREMENTS.md` | Concrete product requirements |
| `docs/10_COURSE_DESIGN_BIBLE.md` | Rules and patterns for designing courses |

Before making design or implementation decisions, consult the relevant doc — especially `06_CLAUDE_WORKFLOW.md` once populated.

## Repo layout

- `docs/` — design documentation (source of truth for all decisions)
- `src/` — game source code
- `assets/` — art, audio, and other game assets
