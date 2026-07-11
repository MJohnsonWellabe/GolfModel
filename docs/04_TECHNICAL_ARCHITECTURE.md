# 04_TECHNICAL_ARCHITECTURE.md

# Johnson's Golf
## Technical Architecture
Version 1.0

---

# Purpose

This document defines the technical architecture of Johnson's Golf.

Its purpose is to ensure the project remains maintainable, scalable, performant, and easy to expand over many years.

Every engineering decision should prioritize readability, modularity, and long-term flexibility over short-term convenience.

The codebase should always be organized so a new developer or AI assistant can quickly understand how the game works.

---

# Technical Philosophy

Johnson's Golf is expected to grow continuously.

The architecture should support:

- Additional courses
- Additional golfers
- Additional game modes
- New gameplay systems
- Cosmetics
- Accounts
- Progression
- Online tournaments
- Cloud saves
- Future multiplayer features

No gameplay feature should require rewriting core systems.

---

# Core Technology Stack

> **Stack note (current):** the game shipped on **Babylon.js** (true 3D), not
> Phaser. The 2D Phaser front-end was retired early in the v2 pivot. The 3D game
> lives in `src/slice3d/`; a pure engine-agnostic gameplay core (physics, aim,
> AI, courses) sits under it. Treat the "Phaser scene" language below as historic
> intent — the *responsibilities* still map onto the Babylon scenes/overlays, but
> the framework is Babylon + a single `index.html` overlay UI. Backend is a single
> Firebase Realtime Database over REST (no Firestore).

Frontend

- TypeScript
- Babylon.js (true 3D; was Phaser 3 in the retired 2D build)
- Vite

Backend

- Firebase Authentication
- Firebase Firestore
- Firebase Realtime Database (existing leaderboards)
- Firebase Cloud Storage
- Firebase Cloud Functions (future)

Deployment

- GitHub Pages, published by GitHub Actions (current)
  - `.github/workflows/deploy.yml` tests, builds (`dist/`), and deploys on push
  - The build is never committed; `docs/` holds design documentation
- Future custom domain

---

# Project Structure

```
src/

assets/
audio/
images/
fonts/

core/
physics/
rendering/
camera/
input/
audio/

data/
courses/
golfers/
clubs/
cosmetics/

firebase/
auth/
database/
leaderboards/

scenes/
Title
MainMenu
GolferSelect
CourseSelect
Store
Tournament
Game
Results

systems/
Swing
Wind
Physics
Putting
Spin
AI
Fire
Economy
Progression

ui/
HUD
Menus
Buttons
Dialogs
Store
Leaderboard

utils/

config/
```

Every folder should have a single responsibility.

---

# Core Systems

The game should be composed of independent systems.

Examples:

Swing System

Physics System

Wind System

Spin System

Camera System

Rendering System

Audio System

Save System

Tournament System

Economy System

These systems should communicate through well-defined interfaces.

Avoid direct coupling whenever possible.

---

# Scene Architecture

Each Phaser scene should have one clear responsibility.

Title

Splash screen.

Main Menu

Navigation.

Golfer Select

Choose golfer.

Course Select

Choose course.

Gameplay

Golf only.

Store

Purchases.

Tournament

Online events.

Results

Round summary.

Scenes should never contain business logic unrelated to their purpose.

---

# Data Driven Design

Gameplay values should never be hardcoded.

Examples:

Golfer stats

Club distances

Wind values

Coin rewards

Store prices

Tournament rules

Physics constants

Perfect zones

These values should exist in configuration files that can be adjusted without modifying gameplay code.

---

# Course Architecture

Every course should be self-contained.

Each course should include:

Hole layouts

Terrain

Hazards

Tee boxes

Pins

Trees

Buildings

Camera presets

Lighting settings

Ambient sounds

Course data should be reusable.

Adding a new course should require minimal code changes.

---

# Golfer Data

Each golfer should be defined entirely by data.

Example

```
Name

Power

Accuracy

Approach

Chipping

Putting

Appearance

Swing Animation

Voice

Unlock Status
```

Gameplay code should not care which golfer is selected.

---

# Physics System

The physics engine should remain isolated.

Responsibilities:

Ball flight

Bounce

Roll

Spin

Surface interaction

Wind

Collision

Slope

The renderer should never perform gameplay calculations.

---

# Camera System

Camera behavior should exist independently of gameplay.

Supported modes:

Tee

Swing

Flight

Landing

Green

Replay

Future cameras should plug into the same system.

---

# Rendering

Rendering should focus entirely on presentation.

Responsibilities:

Terrain

Lighting

Shadows

Particles

Water

Trees

Buildings

Sky

HUD

Rendering code should never affect gameplay outcomes.

---

# Animation

Animation should be event-driven.

Examples:

Swing begins

Impact

Ball lands

Birdie

Hole complete

Store purchase

Achievement unlocked

Animations should react to gameplay rather than control gameplay.

---

# Audio

Audio should use categorized sound groups.

Examples:

Environment

Swing

Impact

UI

Celebration

Music

Players should be able to independently control volume categories.

---

# Input System

Touch input should remain centralized.

Supported actions:

Tap

Double Tap

Drag

Hold

Swipe

Future controller support should require minimal changes.

---

# Save System

Progression is account-gated (see docs 08 §Account Philosophy).

Signed-out players

Ephemeral. The live profile is an empty `defaultProfile()`; nothing is written
to local storage, so a signed-out browser always shows a clean slate (0 coins,
no records). Play is allowed but does not persist.

Signed-in players

The Firebase account (`profiles/{uid}`) is the source of truth, cached locally
for offline play. There is no anonymous auto-sign-in — the cloud is touched only
after a Google sign-in.

Sign-out resets the live profile to empty and clears the local caches; the first
sign-in on a device merges any pre-existing local progress up once
(`mergeProfiles`, grow-only counters) so nothing is lost.

Key modules: `src/profile/Profile.ts` (profile shape, `mergeProfiles`,
`clearLocalProfile`), `src/firebase/FirebaseClient.ts` (`isSignedIn`,
`signInWithGoogle`, `signOutAccount`, `cloudSyncProfile`), wired in
`src/slice3d/main.ts` (`persistProfile`, `adoptCloudAccount`, `doSignOut`).

---

# Firebase Architecture

Firebase will serve as the backend.

Authentication

Guest

Google

Email

Future Apple

Firestore

Users

Inventory

Progression

Achievements

Career Stats

Tournament Data

Realtime Database

Leaderboards

Live tournament updates (future)

Cloud Storage

Cosmetic assets

Future replay files

Cloud Functions

Coin rewards

Tournament validation

Daily challenges

Future notifications

---

# Firestore Collections

```
users

inventory

profiles

statistics

progression

achievements

tournaments

friends

dailyChallenges

settings
```

Each collection should remain independent.

Avoid deeply nested documents whenever possible.

---

# User Profile Structure

```
User

UID

Display Name

Coins

XP

Level

Appearance

Owned Cosmetics

Equipped Cosmetics

Club Upgrades

Career Statistics

Achievements

Tournament History

Settings
```

---

# Inventory Structure

```
Inventory

Golf Balls

Shirts

Dresses

Shoes

Hats

Club Skins

Club Upgrades
```

Inventory should support future cosmetic additions without schema changes.

---

# Tournament Structure

Each tournament should contain:

Tournament ID

Creator

Course

Start Time

End Time

Participants

Scores

Leaderboard

Winner

Tournament data should be shareable using a unique link.

---

# Economy System

The economy should remain data-driven.

Coins awarded

Store prices

Unlock levels

Upgrade costs

Daily rewards

Everything should be configurable.

---

# Configuration

A centralized configuration system should define:

Physics constants

Graphics quality

Gameplay tuning

Economy values

Camera settings

Animation timing

Audio settings

Changing these values should not require code rewrites.

---

# Error Handling

The game should never crash because an online service is unavailable.

Examples:

Firebase offline

Network timeout

Missing cosmetic

Corrupt save

Missing leaderboard

The player should continue playing whenever possible.

Gracefully degrade functionality.

---

# Performance Targets

Target Frame Rate

60 FPS

Minimum

30 FPS

Target Load Time

Under 5 seconds

Target Round Length

3–5 minutes

Memory usage should remain appropriate for mid-range mobile devices.

---

# Optimization Priorities

Prioritize:

Efficient rendering

Texture reuse

Object pooling

Minimal garbage collection

Small bundle size

Lazy loading

Avoid unnecessary allocations during gameplay.

---

# Code Standards

Use descriptive naming.

Favor composition over inheritance.

Keep functions focused.

Avoid duplicated logic.

Avoid magic numbers.

Comment only where intent is unclear.

Refactor frequently.

Readable code is preferred over clever code.

---

# Testing Requirements

Every major feature should be tested for:

Gameplay

Performance

Mobile usability

Regression issues

Firebase integration

Guest compatibility

Browser compatibility

Existing features should continue functioning after every implementation.

---

# Refactoring Policy

At the conclusion of every development phase:

Remove dead code.

Simplify architecture.

Improve naming.

Reduce duplication.

Optimize performance.

Update documentation.

Do not allow technical debt to accumulate.

---

# Scalability

The architecture should comfortably support:

20+ golfers

20+ courses

Hundreds of cosmetics

Thousands of tournaments

Cloud saves

Future multiplayer

Without requiring major redesign.

---

# Final Engineering Principle

Every technical decision should make the next feature easier to build.

Johnson's Golf is intended to become a long-term project rather than a one-time release.

The architecture should always favor maintainability, scalability, performance, and clarity over short-term implementation speed.
