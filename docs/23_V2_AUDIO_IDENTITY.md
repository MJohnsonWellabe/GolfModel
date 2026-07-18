# V2 Audio Identity — Audit, System Design, Implementation

**Status:** IMPLEMENTATION RECORD (Prompts 11–12; behind the `audio` flag)
**Constitution:** rule 14 (audio obeys one source of truth), rule 2
(nothing on input paths), Phase 5 exit criterion (understandable muted,
richer with sound on)

## Audit — what exists today

**Assets (12 wavs under `assets/sfx/`):** ambience (one shared 700KB bed),
chime, fire, hit, hole, impact-driver, impact-iron, impact-wedge, putt,
splash, swing, ui.

**Playback (`main.ts play()`):** per-key base-volume table
(`sounds`), one cached decoded `HTMLAudioElement` per key, cloned only on
overlapping same-key play, volume computed FIRST so a muted player allocates
nothing. This is the good part of the pipeline — cache, overlap, and
mute-guard behavior are already correct.

**Preferences:** `profile.settings.sound` and `.ambience` (0..1 sliders),
device-mirrored, applied at play time (sfx) and pushed live to the loop
(ambience). One source of truth — preserved by this phase.

**Ambience:** ONE `ambience.wav` loop for all four courses, started on first
user gesture (autoplay-policy safe), never varied.

**Gaps found:**

| # | Gap | Consequence |
|---|-----|-------------|
| 1 | No playback variation on impacts/putt/swing | The same wav byte-identical every shot reads mechanical after a 3-hole round |
| 2 | No landing/surface feedback | A drive thumping into fairway vs sand vs rough is silent; the ONLY landing tell is visual |
| 3 | One shared ambient bed | Courses are visually distinct (constitution 12) but acoustically identical |
| 4 | `ui.wav`/`hit.wav` shipped but never played | Dead assets |
| 5 | No loudness normalization pass | Handled adequately by the per-key volume table; deferred until real assets change |
| 6 | Tree/structure impacts silent | Physics doesn't surface mid-flight collision events; needs an engine seam first (documented limitation) |

## System design

A thin **WebAudio layer** (`src/core/audio/`) behind the `audio` flag
(dev-on / prod-off), degrading silently to the existing HTMLAudio path when
WebAudio is unavailable or the flag is off:

- **`engine.ts`** — one lazy `AudioContext` (created on demand from
  gesture-driven call sites, so autoplay policy is never violated), one
  master gain per category (sfx / ambience). Ambience gain tracks the
  existing slider; sfx keeps computing its final volume at the call site so
  the "muted → zero work" guarantee is unchanged.
- **`variation.ts`** — PURE per-key variation table + `variedParams()`
  (rate/gain jitter, injectable RNG, unit-tested). Impacts ±7%, putt ±5%,
  swing ±4% rate; ±8–12% gain. Controlled variation, not randomness soup.
- **`sfx.ts`** — buffer cache (`fetch`+`decodeAudioData` once per key) +
  `playBuffer(key, volume, {rate, lowpassHz})`. Returns false on any
  failure so the caller falls back to the proven HTMLAudio path.
- **`beds.ts`** — procedural per-course ambient beds synthesized from one
  shared noise buffer (no new downloads, nothing to license, ~zero bytes):
  - **Sable Bay (coastal):** low-passed noise surf with a slow swell LFO.
  - **Port Johnson (harbor):** slower, deeper surf + a rare (75–120 s),
    quiet synthesized foghorn — the bible's harbor identity.
  - **Wildwood (forest):** faint high leaf-hiss + sparse two-tone songbird
    chirps (4–9 s apart, gentle envelopes).
  - **Timberline (alpine):** band-passed wind with a long-period gust LFO —
    deliberately the quietest course.
  All nodes hang off the ambience master gain (slider + mute apply
  instantly), start only after the existing first-gesture hook, stop/start
  cleanly on course change, and are fully disconnected on stop.

## What was implemented (this branch)

1. `play()` routes through the WebAudio path with variation when
   `flag('audio')` is on and the context is available; otherwise byte-for-
   byte today's behavior. Per-key variation per the table above.
2. Landing thumps: at non-putt touchdown, a soft surface-shaped `hit`
   (green/fairway bright and quiet; rough darker; sand deep + low-passed).
   Water stays with the existing splash; holed-out still gets `hole`.
3. Per-course ambient beds replace the shared wav while the flag is on
   (the wav remains the flag-off path); bed switches on round/course start.
4. `ui.wav` finally earns its place: a quiet confirmation tick on the
   results screen's primary continuation actions only (Replay / Play Next)
   — not on every tap in the game.

## Loudness and safety

- Base volumes stay in the one `sounds` table; variation jitters ±1 dB
  around it. Bed gains are conservative (≤0.5 pre-slider).
- Every WebAudio call is wrapped; failure → silent fallback, never a crash
  (release gate: "analytics failures crashing the game" applies to audio
  too in spirit).
- No audio work happens pre-gesture, while muted, or on pointer-input paths
  (the landing thump fires from the flight tick, not input).

## Known limitations

- Tree/structure impact sounds need a physics event seam (gap #6) — small
  engine change, deferred to keep this phase presentation-only.
- Procedural beds are a taste call: parameters are data at the top of
  `beds.ts`, one number per mood, tuned on real devices during the Matt
  playtest pass. If a bed doesn't land, `?ff.audio=off` reverts wholesale.
- Loudness normalization of the wavs themselves deferred until assets next
  change (gap #5).

## Rollback

Flip `audio` off — the entire layer (variation, thumps, beds, UI tick)
reverts to today's pipeline. No asset was modified or removed.
