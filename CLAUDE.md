# Claude Instructions

Before making any changes:

1. Read `docs/README.md` — it defines the governing documentation set and the
   precedence order (executive vision → design constitution → V2 roadmap →
   domain specs → implementation records → archive).
2. Read `docs/vision/00_EXECUTIVE_VISION.md` and
   `docs/vision/01_DESIGN_CONSTITUTION.md`.
3. Read the domain documents relevant to the work, and the current phase in
   `docs/roadmap/CLAUDE_PHASE_SEQUENCE.md` when following the V2 roadmap.
4. Respect `docs/technical/PERFORMANCE_AND_QUALITY_GATES.md` — performance is
   a release criterion, and analytics/persistence stay off critical input
   paths.

Working principles:

5. Never sacrifice polish for speed.
6. Keep the game in a working state after every change.
7. Refactor when appropriate — never leave a file in worse condition than you
   found it.
8. Keep rendering separate from gameplay, UI separate from physics, Firebase
   isolated behind its modules, and configuration data-driven.
9. Update documentation if behavior changes.
10. Do not introduce placeholder implementations unless explicitly requested.
11. Prefer production-quality solutions over temporary fixes.
12. Dispose what you create: observers, scenes, textures, timers, listeners,
    and audio must not accumulate across rounds.
