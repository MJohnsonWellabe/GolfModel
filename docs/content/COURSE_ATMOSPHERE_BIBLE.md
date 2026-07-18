# Course Atmosphere Bible

**Status:** ACTIVE PLAN (visual layer implemented behind the `atmosphere`
flag; ambient audio beds are specified here and delivered by the Phase 5
audio system)
**Owner system:** `src/slice3d/atmosphere.ts` (ambient life),
`src/core/rendering/Theme.ts` (`atmosphere` theme key), course JSON themes
**Constitution:** rule 12 (every course needs an identity); Pillars —
atmospheric effects may not obstruct aim, target, ball, cup, or slope
readability

## Design rules (apply to every course)

1. **Sky and margins only.** Ambient life lives high in the sky or beyond the
   playable corridor. Nothing crosses the aim line at readable altitude;
   nothing animates on or near greens.
2. **Procedural, pooled, alloc-free.** Every mover is a billboard quad with a
   DynamicTexture silhouette (the proven gull/cloud pattern): positions
   advance in place each frame, flocks loop so the sky is never empty, zero
   per-frame allocation, zero draw-call growth over time.
3. **Parked-RTT safe.** Ambient mesh names (`bird*`, `butterfly*`, `hawk*`,
   `mist*`) match none of the water-reflection render-list patterns, so
   ambient motion can never force a mirror redraw while the camera is parked.
4. **Frozen-capture safe.** All movers respect `isFrozen()` (screenshot
   harness) and pause with the scene's own render loop when hidden
   (`onBeforeRenderObservable` never fires on a backgrounded tab).
5. **Disposal by construction.** Everything parents to the hole scene and
   dies with `scene.dispose()` — the repeat-round soak's mesh/material/
   observer comparison is the regression guard.
6. **Budgets.** Per hole: ≤ 6 ambient movers, ≤ 3 small DynamicTextures
   (64–128px), 1 observer. Device-quality tiers are unnecessary at this size;
   if a course ever wants more, the count is the quality dial and must scale
   DOWN on weak devices, never up.
7. **Audio pairing** (Phase 5 delivers): one looping ambient bed per course
   at a conservative level under the centralized ambience volume; never a
   second simultaneous bed; beds duck to silence while globally muted.

## Course identities

### Sable Bay — "the postcard island links"

- **Visual motif:** open ocean horizon (no dunes), sailboats, gulls.
- **Ambient life (implemented):** 4 drifting gulls high over the sea line.
  Sailboats bob (pre-existing). Nothing on the turf side.
- **Landmark language:** the island green silhouette against flat blue.
- **Ambient bed (Phase 5):** low surf wash + sparse gull cries baked into the
  loop. Bright, midday energy.
- **Light/time assumption:** high sun, minimal haze.

### Wildwood — "the flowering parkland"

- **Visual motif:** azalea/cherry bloom, garden beds, broadleaf woods against
  distant peaks.
- **Ambient life (implemented):** 3 butterflies fluttering low over the rough
  margins (bloom colors: white/pink/gold) + 2 small songbirds crossing high.
  Butterflies wander around fixed anchor points OUTSIDE the fairway corridor.
- **Landmark language:** garden beds and blossom trees at decision corners.
- **Ambient bed (Phase 5):** songbird chatter over a soft leaf rustle.
  Morning energy.
- **Light/time assumption:** soft mid-morning, gentle haze.

### Timberline — "the high alpine"

- **Visual motif:** conifers, wispy cirrus, thin bright air, no backdrop
  ridge (the treeline IS the horizon).
- **Ambient life (implemented):** 2 hawks soaring in slow circles very high +
  3 translucent mist wisps drifting along the treetops far from play.
- **Landmark language:** lone pines at carry corners; the water reflects sky.
- **Ambient bed (Phase 5):** mountain wind with occasional distant hawk cry.
  Sparse, airy mix — the quietest course by design.
- **Light/time assumption:** crisp alpine light, low haze, cool tint.

### Port Johnson — "the working harbor"

- **Visual motif:** harbor water, boats, coastal structures, gulls.
- **Ambient life (implemented):** 4 gulls (shared coastal pattern — the two
  links courses deliberately share a flock; their identity split is
  harbor-vs-island scenery and, in Phase 5, their beds).
- **Landmark language:** man-made edges: walls, moored boats, harbor line.
- **Ambient bed (Phase 5):** slower harbor lap + rope/creak accents + a rare,
  distant foghorn (long cooldown; never during putting concentration is not
  detectable, so simply keep it rare and quiet).
- **Light/time assumption:** slightly hazier, later-day warmth.

### Red Hollow — "the desert canyon" (expansion, `newCourses` flag)

- **Visual motif:** emerald fairway ribbons through red-rock waste; terracotta
  mesa horizon (`hillTint`); no trees — stone/scrub scatter.
- **Ambient life (implemented):** 2 vultures riding slow, wide thermals very
  high (`desert` preset). Deliberately no mist, no birdsong.
- **Ambient bed:** hot dry wind (higher band than alpine, slower gusts) with
  sparse insect clicks.
- **Light/time assumption:** hard midday desert light, warm dust haze.

### Kettle Barrens — "the sand barrens" (expansion, `newCourses` flag)

- **Visual motif:** rolling golden fescue, pale blowout sand, sparse pines;
  treeline horizon under wispy cirrus.
- **Ambient life (implemented):** the `forest` preset (butterflies over the
  fescue margins + songbirds) — prairie life shares its silhouettes.
- **Ambient bed:** soft prairie wind under sparse meadow chirps (`prairie`).
- **Light/time assumption:** open midwestern light, gentle haze.

## Data model

Course JSON opts in via the theme block: `"atmosphere": "coastal" | "forest"
| "alpine" | "none"`. Unset defaults to `coastal` when `backdrop === 'sea'`
(preserves the shipped gull behavior), else `none`. The whole layer sits
behind the `atmosphere` feature flag (dev-on / prod-off).

## Validation checklist (per course, before prod flag flip)

- Repeat-round soak: mesh/material/observer counts return to baseline.
- Parked-RTT freeze test stays green (aim-drag cadence unchanged).
- Screenshot harness: frozen captures are pixel-stable.
- Real-device pass: no readable-altitude crossings of the aim corridor.
