# Mobile UI and UX Principles

**Status:** AUTHORITATIVE

## Objective

The game should feel designed for a phone, not compressed onto one.

## Primary-screen rule

On a 360×800 viewport, the primary action should be visible without scrolling whenever practical. This applies especially to:

- starting a round
- swing and putting controls
- results
- Replay
- Play Next
- Daily entry
- Weekly entry
- Store purchase confirmation
- profile settings

Use progressive disclosure for secondary information such as scorecards, detailed records, achievement lists, and help text.

## Hierarchy

Each screen should answer three questions immediately:

1. Where am I?
2. What matters now?
3. What should I do next?

Avoid giving equal visual weight to every available system.

## Touch interaction

- Use forgiving touch targets.
- Do not place destructive or expensive actions beside routine actions without protection.
- Avoid hover-only information.
- Preserve stable control positions during interaction.
- Prevent the page from scrolling or zooming during committed gameplay gestures.
- Keep aim-drag processing lightweight.

## Gameplay HUD

The HUD should prioritize information required for the current shot:

- target and aim
- club
- wind
- lie and elevation when meaningful
- power and accuracy state
- score and hole context

Progression, Store, and Live Ops information should not compete with the shot.

## Results screen

The collapsed results state should include:

- round score
- personal-best comparison
- important record or near-miss
- one contextual objective
- Replay
- named Play Next destination

The scorecard and additional detail may expand. Primary continuation actions remain visible.

## Navigation

- Keep navigation depth shallow.
- Preserve back behavior.
- Avoid returning the player to the home screen between consecutive rounds.
- Preserve compatible settings between Replay and Play Next.
- Do not reset sound, character, Pal, control, or visual preferences during navigation.

## Motion

Motion should communicate hierarchy, continuity, and reward.

- Keep routine transitions brief.
- Allow major celebrations to be skipped or naturally bypassed.
- Respect reduced-motion preference.
- Avoid moving primary buttons while the player is about to tap.
- Do not use motion to disguise loading or create artificial delay.

## Text and readability

- Use short labels.
- Prefer plain golf language.
- Avoid tiny decorative text.
- Keep contrast readable over course backgrounds.
- Ensure status is not indicated by color alone.
- Explain uncommon terms contextually rather than through permanent clutter.

## Settings

Settings require one effective source of truth. A change should apply immediately and persist through refresh, Replay, Play Next, sign-in, profile merge, and scene changes.

For audio specifically, no music, ambience, UI sound, gameplay effect, or celebration may bypass the effective mute state.

## Store

Store items should communicate:

- item identity
- price
- ownership state
- preview
- whether an item is cosmetic

Do not create urgency that misleads players. Purchases require clear balance feedback and safe insufficient-funds handling.

## Admin UX

Admin surfaces may be denser than player screens, but should still prioritize validation, preview, staging, publishing, rollback, and audit clarity. Admin tools must not expose controls that appear to work while public pages still use hardcoded values.

## Accessibility

Support:

- readable contrast
- sound-independent feedback
- reduced motion
- keyboard operation where practical
- adequate touch sizes
- focus visibility
- descriptive image alt text in marketing and content tools

## Review checklist

Before accepting a UI phase:

- test 360×800 without primary-action scrolling
- test portrait mobile browser chrome changes
- test touch only
- test muted
- test reduced motion
- test guest and signed-in states
- test loading, empty, offline, and error states
- test Replay and Play Next transitions

The interface should feel calm, direct, and confident.