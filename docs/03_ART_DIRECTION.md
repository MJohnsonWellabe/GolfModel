# 03_ART_DIRECTION.md

**Status:** AUTHORITATIVE (domain: art direction & course visual identity) — the concrete authoring spec behind Design Constitution rule 12.

# Bite-Sized Golf
## Art Direction & Presentation Guide
Version 1.0

---

# Purpose

This document defines the visual identity, presentation, animation, audio, and overall feel of Johnson's Golf.

Every artistic decision should reinforce one central goal:

**Johnson's Golf should feel like a premium console golf game that happens to run on a phone.**

Players should never think:

"This looks like a browser game."

Instead they should think:

"I can't believe this runs in my browser."

---

# Visual Identity

Johnson's Golf exists between realism and stylization.

NOT:

• Mario Golf

• Wii Sports Golf

• Cartoon golf

NOT:

• PGA Tour simulator

• Hyper realistic simulation

Instead:

Modern Everybody's Golf

Classic EA Sports Tiger Woods

Nintendo-quality polish

Bright

Beautiful

Readable

Premium

Warm

Inviting

---

# Emotional Goals

Every screen should create emotion.

Main Menu

Comfortable.

Professional.

Inviting.

First Tee

Excitement.

Standing over Ball

Confidence.

Ball Flight

Wonder.

Approach Shot

Focus.

Long Putt

Tension.

Birdie

Satisfaction.

Eagle

Celebration.

Hole Finish

Momentum.

The player should constantly feel rewarded by presentation.

---

# Graphics Pillars

Everything should support these pillars.

## Depth

Nothing should appear flat.

Ground should have:

texture

variation

shadow

light

elevation

Small elevation changes dramatically improve realism.

---

## Lighting

Lighting sells quality.

Morning sunlight.

Soft shadows.

Warm highlights.

Tree shadows.

Cloud shadows (future).

Sun direction should remain consistent.

Never use flat lighting.

---

## Terrain

Terrain should feel alive.

Fairway

Healthy green.

Subtle mowing patterns — and a DIFFERENT one per course (`theme.mowPattern`),
part of each course's identity: Wildwood wears the diamond checkerboard,
Timberline an axis-aligned cross grid, Sable Bay straight seaside stripes,
Port Johnson the classic 45° links diagonal. Turf palettes shift with them
(Timberline cooler blue-green, Sable Bay turquoise-leaning).

Light texture variation.

Rough

Longer grass.

Slight color difference.

Different lighting response.

Fringe

Distinct transition.

Greens

Smooth.

Highly maintained.

Visually readable.

---

# Course Identity

Each course should have its own personality.

Players should recognize a course immediately.

Examples:

Augusta-inspired

Bright.

Lush.

Perfect.

Scottish Links

Brown.

Windy.

Firm.

Mountain Course

Pine trees.

Elevation.

Cool colors.

Future desert course

Sand.

Rock.

Cactus.

Golden lighting.

---

# Trees

Trees should not be generic circles.

Each tree should have:

unique silhouette

depth

shadow

layering

slight animation

Tree trunks should always be visible.

## Species per course

Each course's `theme` block picks its woods mix from the converted nature
props (`treeKeys`, plus `accentTreeKeys` for ~15% rare mix-ins and
`scatterKeys` for rough-only forest-floor props):

- **Timberline** — conifer forest: spruce, tall spruce, pine; birch
  accents; ferns, stumps and logs on the forest floor; denser backdrop
  wall (`backdropTreeStep`).
- **Wildwood Glen** — broadleaf parkland (Bethpage-style championship):
  oak, maple, birch, aspen, poplar plus the original generic trees, planted
  denser than before (dense `visualSpacing`, escapable collision `spacing`);
  white-and-pink flower gardens by every green (per-bed `colors`); no conifers.
- **Sable Bay** — sparse coastal: the generic wind-shaped set plus scattered
  shore rocks (`stone_*` in `scatterKeys`); the sea is the scenery.
- **Port Johnson Links** — open links: a couple of wind-bent broadleaf only,
  a very sparse backdrop (`backdropTreeStep: 120`); the character comes from the
  turf, the sky and the sand, not trees.

Species is art only — it never changes physics. Density does (see the
Course Design Bible's `spacing` rule).

## The shared premium look (all courses)

The polished rendering system — lush lit grass, real turf/rough/sand grain,
sculpted deep bunkers, wispy painted sky, flower scatter, and **two-tone
straight mowing columns on the greens** (`greenColumns`, a light/dark stripe
running in the direction of play, the green's answer to the fairway's mowing) —
lives in `DEFAULT_THEME` so every course inherits it. Courses override only the
palette, tree species, backdrop and density for their identity. `theme.tallGrass`
adds links marram/fescue (tall rough tufts, and grass growing through
`waste: true` bunkers).

Canopies should feel full.

---

# Water

Water should become one of the prettiest parts of every course.

Requirements:

reflection

small waves

shore blending

depth coloring

animated highlights

Water should feel dangerous.

Players should hate seeing their ball head toward it.

---

# Sand

Sand should appear soft.

Rounded edges.

Small ripples.

Color variation.

Landing should create:

small puff

ball depression

subtle particles

---

# Buildings

Buildings should look believable.

Especially the Road Hole hotel.

Requirements:

windows

brick texture

roof details

shadow

depth

Proper collision.

The ball should never pass through buildings.

---

# Sky

Sky should create atmosphere.

Soft gradient.

Light clouds.

Subtle movement.

Warm sunlight.

Never a flat blue background.

## Per-course sky

The dome gradient, haze, and clouds are driven by each course's `theme`
block (see `src/data/courses/*.json`, rendered by `src/slice3d/course3d.ts`):

- **Timberline** — a vivid, bright day: a deep saturated‑azure zenith
  (`skyTop`) fading to a clean cool blue→white horizon (`skyBottom` /
  `horizonTint`), reduced haze so distance reads clear. Clouds use
  `cloudStyle: "wispy"` — soft, feathered, semi‑transparent *painted* clouds
  (billboards, not the hard low‑poly mesh blobs): rounded, softly‑painted
  cumulus mounds plus thin cirrus streaks scattered across the dome, so they
  read see‑through against the blue like the references. Timberline also uses
  `backdrop: "none"` — no ridges or feature peak; the dense conifer wall
  (`backdropTreeStep`) plus open sky is the horizon.
  The warm sun disc stays for sunlight. Note this leans brighter/cooler than
  the generic "mountain course = cool, avoid oversaturation" guideline, by
  design from sky references.
- All courses now share the soft **wispy** painted clouds by default
  (`cloudStyle` promoted to `DEFAULT_THEME`), and `horizonTint` derives from each
  course's own `skyBottom`, so the sunlit horizon band reads right under a
  `peaks`, `sea` or `none` backdrop. Sable Bay and **Port Johnson Links** use the
  `sea` backdrop (a horizon sea plane + low dunes) — the ocean is the scenery.

## Painted skies — one weather per course

Owner report: *"I want courses to have their own unique skies and clouds."*
Everything above still described **one** sky: a single four-stop gradient shape
and a single canvas-painted cloud set, differing only by eleven colour tuples —
Timberline East and West were byte-identical. Every course now has its own.

The owner's choice was **stylised, built from CC0 sources** — not photoreal.
`scripts/convert-skies.mjs` downloads a CC0 Poly Haven sky HDRI, MEASURES three
things out of it — the clear-sky ramp at every elevation, the cloud field, and
the colour temperature of the solar aureole — and repaints them as **flat
posterised bands** in the game's own flat-shaded language. No photograph ships;
the committed output is 2-5KB of painted bands per style. Sources and licences
are in `docs/technical/ASSET_ATTRIBUTION.md`; the recipe is in the script header.

**A style's `haze` must be the haze of the JSON THE GAME LOADS.** The bottom
bands ramp onto `theme.haze` so the dome meets the EXP2 fog invisibly; get it
wrong and a pale band sits above the horizon on every hole of that course. Three
styles shipped with the value from `src/data/courses/<id>.json` when production
runs `courseRebuilds` and loads `v2/<id>.json` — Port Johnson's was 24/28/30 out.
`tests/unit/skyAssets.test.ts` now resolves every course through `coursesFor`,
the same roster the game builds from, and reads the shipped PNG's bottom row.

**Course-card art is re-shot from the game**, not painted:
`tests/visual/courseArt.spec.ts` boots each course at a chosen hole at
1600x1000 with quality pinned to Full, hides the HUD and writes a contact sheet
to `tests/visual/__shots__/art/`. Re-run it whenever the skies, the far field or
a hole's composition changes, then `node scripts/optimize-marketing.mjs`.
Timberline West has its own picture now — it reused East's, which made the two
Timberlines look like the same course on the card.

A course opts in with three theme keys:

| Key | What it does |
|---|---|
| `skyStyle` | Names the style. Loads `assets/textures/sky/<style>_ramp.png` (8×256 dome ramp), `_cumulus.png` (512×320) and `_cirrus.png` (512×96). |
| `cloudCover` | How cloudy — 1 = the historical 6 cumulus + 10 cirrus billboards. |
| `sunTint` | Sun-disc colour, measured off the source's aureole. |

The eight styles, and the weather each course now gets:

| Course | Style | The look |
|---|---|---|
| Red Hollow | `storm_canyon` | Storm light over the canyon: bruised blue, torn stacked cloud. |
| Sable Bay | `sea_haze` | Sea haze — the ramp barely changes hue, it just goes pale. |
| Port Johnson Links | `links_coast` | A blown grey coast: deliberately the least blue sky on the roster. |
| Timberline East | `alpine_clear` | Alpine clarity, deep zenith, almost no cloud (`cloudCover: 0.5`). |
| Timberline West | `alpine_broken` | The same range at a different hour: high cirrus fans, warmer light. |
| Wild Prairie | `prairie_gold` | Golden hour — blue zenith over a gold horizon band. |
| Maple Vale | `autumn_overcast` | A low grey autumn lid with almost no ramp in it. |
| Wildwood Glen | `parkland_bright` | Bright parkland noon, the friendliest sky here. |

Three rules the system keeps:

- **The procedural sky remains the fallback.** A course (or the daily hole) that
  names no `skyStyle` renders exactly what it always did.
- **The GPU cost does not move.** The three PNGs are the exact dimensions of the
  DynamicTextures they replace, because the reported-slow courses are already
  fill-rate bound on sky pixels (`docs/technical/PERFORMANCE_AND_QUALITY_GATES.md`).
- **`skyStyle` governs the DOME, not the cloud system.** A course that claimed
  the mesh clouds keeps them — Maple Vale flies its volumetric puffs under the
  new autumn dome rather than losing an authored identity.

`tests/unit/skyAssets.test.ts` fails if a course names a style whose files are
missing, if a style outgrows its budget, or if two different places end up
sharing a sky.

---

# Camera Philosophy

The camera is one of the biggest opportunities to make Johnson's Golf feel premium.

The camera should always tell a story.

Never remain static.

---

# Tee Shot Camera

Behind golfer.

Slight elevation.

Wide field of view.

Shows intended line.

Smooth movement.

---

# Swing Camera

Small zoom toward golfer.

Minor camera shake on impact.

Follow-through.

---

# Ball Flight Camera

Transition immediately after impact.

Follow behind ball.

Dynamic zoom.

Rotate naturally.

Keep landing area visible.

Never lose the ball.

The player should enjoy watching every shot.

---

# Landing Camera

Zoom toward landing.

Watch bounce.

Watch rollout.

Stop naturally.

No sudden cuts.

---

# Putting Camera

Lower angle.

More intimate.

Clearly display slope.

Help players understand green contours.

---

# Camera Animation

Every transition should ease.

No instant jumps.

No snapping.

Everything should glide.

Professional games move the camera constantly but subtly.

---

# Character Design

Golfers should appear expressive.

Friendly.

Confident.

Distinct.

Different body types.

Different swings.

Different personalities.

Avoid exaggerated cartoon proportions.

---

# Animation

Every action deserves animation.

Walking.

Club selection.

Practice waggle.

Swing.

Reaction.

Celebration.

Disappointment.

Idle.

The player should never stare at a frozen character.

---

# Swing Animation

Weight transfer.

Hip rotation.

Shoulder turn.

Follow through.

Club flex.

Balanced finish.

Good swings should look satisfying.

---

# Ball Animation

Compression at impact.

Small launch particles.

Shadow beneath ball.

Spin visible.

Landing bounce.

Roll naturally.

---

# UI Philosophy

The interface should disappear.

The player should think about golf.

Not menus.

Every button should have purpose.

Avoid clutter.

---

# HUD

Display only:

Wind

Club

Distance

Lie

Swing meter

Strike location

Mini map

Score

Nothing else unless necessary.

---

# Colors

Use premium golf colors.

Forest Green

Emerald

Deep Blue

Cream

White

Charcoal

Accent colors only where needed.

Avoid oversaturation.

---

# Typography

Modern.

Clean.

Readable.

Large enough for phones.

Never decorative.

Always legible.

---

# Audio Philosophy

Sound is half of presentation.

Every shot deserves satisfying feedback.

---

# Club Impact

Each club should sound different.

Driver

Powerful crack.

Iron

Sharp strike.

Wedge

Soft click.

Putter

Gentle tap.

---

# Environment

Birds.

Wind.

Leaves.

Water.

Crowd applause (future).

The course should feel alive.

---

# Music

Relaxing.

Acoustic.

Light jazz.

Country club.

Never distracting.

Menus and gameplay should have different musical moods.

---

# Visual Effects

Keep effects tasteful.

Examples:

Ball trail.

Sand particles.

Water splash.

Leaf movement.

Fire mode glow.

Perfect swing flash.

Birdie celebration.

Hole-in-one celebration.

Avoid excessive particle spam.

---

# Performance Targets

Maintain:

60 FPS on modern phones.

Minimum 30 FPS on older devices.

Loading under 5 seconds.

Minimal battery drain.

Graphics quality should degrade gracefully if needed.

---

# Accessibility

High contrast mode.

Colorblind support.

Reduced motion option.

Scalable UI.

Readable fonts.

---

# Polish Checklist

Before every release ask:

Does this screen feel premium?

Does this animation feel intentional?

Does this sound satisfying?

Does this camera move naturally?

Does this course look alive?

Would someone mistake this for a commercial game?

If not, continue polishing.

---

# Art Direction Summary

Johnson's Golf should never try to impress players through realism alone.

Instead it should impress them through polish.

Beautiful lighting.

Smooth animation.

Satisfying cameras.

Readable environments.

Consistent art direction.

Thoughtful details.

When every element works together, the player should forget they are playing a browser game and simply enjoy playing golf.
