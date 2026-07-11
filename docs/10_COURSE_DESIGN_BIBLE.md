# 10_COURSE_DESIGN_BIBLE.md

# Johnson's Golf
## Course Design Bible
Version 1.0

---

# Purpose

This document defines the philosophy, standards, and design process for every golf course created for Johnson's Golf.

Courses are the heart of the game.

Great golf games are remembered by their holes more than their menus, progression systems, or graphics.

Every course should feel memorable, beautiful, strategically interesting, and replayable.

The goal is for players to recognize and remember individual holes long after they finish a round.

---

# Core Philosophy

Every hole should ask the player a question.

Examples:

Can you carry the bunker?

Do you lay up?

Do you attack the pin?

Do you play away from trouble?

Can you shape the shot?

Will the wind change your decision?

If a hole can be played exactly the same way every time, it should be redesigned.

---

# Design Pillars

Every hole should contain some combination of:

Risk

Reward

Decision

Personality

Replayability

Visual identity

No hole should exist simply to connect two great holes.

Every hole deserves to be memorable.

---

# The Three Levels of Strategy

Every hole should offer three approaches.

## Conservative

Safest line.

Easy par.

Limited birdie opportunity.

Ideal for beginners.

---

## Balanced

Moderate risk.

Moderate reward.

Most common strategy.

---

## Aggressive

Highest reward.

Highest danger.

Requires precise execution.

Creates exciting moments.

---

# Hole Variety

Avoid repetition.

Across a course, players should encounter:

Long holes.

Short holes.

Wide fairways.

Narrow fairways.

Doglegs.

Elevation changes.

Reachable par fives.

Demanding par threes.

Strategic par fours.

Every hole should feel different.

---

# Risk vs Reward

Players should always understand the tradeoff.

Example:

Carry a lake.

Reward:

Short wedge approach.

Risk:

Penalty stroke.

Example:

Aim at tucked pin.

Reward:

Birdie chance.

Risk:

Greenside bunker.

Players should never be punished without first making a decision.

---

# Fairness

Johnson's Golf should challenge players fairly.

Avoid:

Blind hazards.

Random bounces.

Hidden penalties.

Impossible recovery shots.

Punishment should come from poor decisions or poor execution.

Never from surprises.

---

# Course Flow

The course should build naturally.

Opening hole

Comfortable introduction.

Middle holes

Increase strategic demands.

Closing hole

Memorable finish.

Players should feel the course tells a story.

---

# Hole Design Standards

Every hole should include:

Distinct landing areas.

Meaningful hazards.

Interesting approach angles.

Visible landmarks.

Multiple strategies.

Reward for excellent execution.

No filler holes.

---

# Green Design

Greens should be readable but challenging.

Every green should include:

Gentle contours.

Subtle breaks.

Interesting pin positions.

Safe miss locations.

Dangerous miss locations.

Players should need to think before putting.

---

# Pin Placement

Each green should support multiple pin locations.

Easy

Medium

Hard

Tournament

Pin positions should dramatically change strategy without making the hole unfair.

---

# Bunkers

Bunkers should create decisions.

Never decorate.

Fairway bunkers:

Influence tee shots.

Greenside bunkers:

Influence approaches.

Waste bunkers:

Create visual character.

Each bunker should have purpose.

---

# Water Hazards

Water should create tension.

Water should rarely be unavoidable.

Instead it should tempt aggressive players.

Water is most effective when players choose whether to challenge it.

---

# Trees

Trees should define strategy.

Examples:

Block one angle.

Reward another.

Force recovery shots.

Create visual framing.

Trees should rarely exist only for decoration.

## Woods density (`spacing`)

A `type: "trees"` hazard may author `"spacing"` — the grid step in world
units between trunks (default 52; lower is denser). Density is **gameplay,
not art**: the same tree positions drive ball-flight collision, the baked
drop shadows, and the 3D props, so a denser polygon is a genuinely harder
place to escape from.

Fairness rule: densify the flanking margins, never the driving line. A
recovery line must always exist (the Pine Alley precedent — an unavoidable
centre block breaks this Bible). After densifying, verify the AI still
finishes the hole near par.

---

# Rough

Rough should punish poor accuracy without becoming frustrating.

Light rough

Minor penalty.

Heavy rough

Significant penalty.

Recovery should remain possible.

---

# Elevation

Elevation creates memorable golf.

Examples:

Downhill drives.

Uphill approaches.

Elevated greens.

Valleys.

Ridges.

Elevation should influence both visuals and club selection.

---

# Wind

Courses should be designed with wind in mind.

Some holes become dramatically different depending on conditions.

This increases replayability.

---

# Signature Holes

Every course should contain at least one signature hole.

Characteristics:

Visually stunning.

Strategically unique.

Memorable.

Rewarding.

Difficult to forget.

Players should immediately recognize the hole.

---

# Finish Holes

The final hole should encourage drama.

Examples:

Risk-reward drive.

Island green.

Reachable par five.

Dangerous approach.

Players should feel excitement finishing a round.

---

# Visual Storytelling

Every course should have its own personality.

Players should recognize a course from a single screenshot.

Examples:

Championship Parkland

Scottish Links

Mountain Resort

Desert Oasis

Autumn Forest

Tropical Paradise

Each course should feel like a destination.

---

# Environmental Details

Courses should feel alive.

Examples:

Moving trees.

Birds.

Water movement.

Cloud shadows.

Flowers.

Bridges.

Stone walls.

Clubhouses.

Spectators (future).

Small details create immersion.

## Flower gardens (`gardens`)

Beyond the ambient wildflowers scattered across the rough, a hole may author
one or more **`gardens`** — hand-placed, purely decorative flower beds at a
specific spot (e.g. behind a green). A garden is an ellipse
(`cx, cy, rx, ry, rot`) plus density/mix knobs (`density`, `bloomChance`,
`bushChance`, `flowerKeys`); see `types.ts` `GardenBed`.

Unlike a `trees` hazard, a garden is **art, not gameplay**: it carries no
collision and is invisible to physics and the AI. The 3D scatter plants blooms
on the `rough` surface only, so a bed never buries the green, fringe, bunkers,
or a tree's hitbox. The rough turf under a bed is painted as **bark mulch** in
the baked ground texture (so the blooms rise out of earth, not grass), and the
ambient grass/scatter is kept out of the footprint. The bed paints a **left→right rainbow** — each bloom's hue
comes from its position along the bed's major axis (pink · purple · blue ·
green · yellow · white) — so it reads as organized beds of color, not random
speckle. Blooms are the genuinely-3D nature-kit meshes (`flower_f/g/h`
clusters, `flower_e` sunflower) rather than flat cards, so they hold up close
up; some bands prefer a species (sunflowers in yellow, leafy plants in green).
First used behind Timberline hole 2 ("The Hollow").

---

# Difficulty Curve

Difficulty should increase naturally.

Opening holes

Teach.

Middle holes

Challenge.

Final holes

Test.

The course should never feel exhausting.

---

# Three-Hole Challenge Philosophy

Each three-hole course should contain:

One welcoming hole.

One strategic hole.

One memorable finishing hole.

This creates satisfying pacing for quick play sessions.

---

# Replayability

Players should make different decisions depending on:

Wind.

Golfer attributes.

Tournament pressure.

Pin placement.

Confidence.

No two rounds should feel identical.

---

# Course Expansion Standards

Future courses should introduce:

New visuals.

New strategic ideas.

New memorable holes.

Not simply harder holes.

Every new course should teach players something new.

---

# Real-World Inspiration

Johnson's Golf should take inspiration from famous golf architecture without directly copying it.

Examples of inspiration:

Strategic bunkering.

Natural terrain.

Creative green complexes.

Iconic risk-reward holes.

Courses should feel authentic while remaining original.

---

# The "Favorite Hole" Test

After playing a course, players should be able to answer:

"What was your favorite hole?"

If every hole feels equally forgettable, the course needs more personality.

---

# The "Different Golfer" Test

Playing the same course with different golfers should encourage different strategies.

Long hitters may attack.

Accurate golfers may position.

Short-game specialists may recover.

Courses should reward every style of play.

---

# The "One More Round" Test

Players should finish a course believing:

"I know how I could play that better."

This feeling drives replayability.

---

# Course Creation Checklist

Before a new course is approved:

☐ Every hole has a unique identity.

☐ Every hole offers meaningful decisions.

☐ Risk and reward are balanced.

☐ Greens require thoughtful putting.

☐ Hazards serve gameplay, not decoration.

☐ Visual theme is consistent.

☐ Signature hole exists.

☐ Finishing hole is memorable.

☐ Course is enjoyable for beginners.

☐ Course rewards skilled players.

☐ Multiple strategies exist throughout.

☐ The course feels distinct from every other course.

---

# Final Design Principle

A great golf game is ultimately a collection of great golf holes.

Johnson's Golf should strive to create courses that players look forward to playing again and again.

Every hole should tell its own story.

Every course should create lasting memories.

If players finish a round already planning how they'll attack the course differently next time, then the course has achieved its purpose.
