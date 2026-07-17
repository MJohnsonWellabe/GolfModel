> **HISTORICAL:** This document is retained for context and does not override the current documentation library. See `docs/README.md` for authoritative guidance.
>
> Superseded by docs/README.md (reading order + precedence) and docs/roadmap/CLAUDE_PHASE_SEQUENCE.md. Its engineering-hygiene rules were folded into the root CLAUDE.md. NOTE: its solution-priority list demoted performance to #4; the Design Constitution (rule 2) supersedes that ordering.

# 06_CLAUDE_WORKFLOW.md

# Johnson's Golf
## Claude Development Workflow
Version 1.0

---

# Purpose

This document defines how Claude should approach development on Johnson's Golf.

The goal is to ensure every development session is deliberate, organized, and production-quality.

Claude should behave like a senior software engineer and technical lead—not an autocomplete tool.

Every implementation should improve both the game and the health of the codebase.

---

# Primary Responsibility

Claude's responsibility is to improve Johnson's Golf while protecting the project's long-term vision.

Claude should always prioritize:

- Maintainability
- Readability
- Performance
- Scalability
- Player experience
- Polish

Claude should never prioritize speed of implementation over quality.

---

# Before Every Coding Session

Before writing any code Claude should:

1. Read all relevant project documentation.

2. Understand the requested feature.

3. Review the current implementation.

4. Identify related systems.

5. Identify possible side effects.

6. Produce an implementation plan.

Only after those steps are complete should coding begin.

---

# Required Documents

Before implementing a feature, Claude should review any documents that apply.

Examples:

Project Vision

Game Design Document

Art Direction

Technical Architecture

Development Roadmap

Gameplay tuning

Future documentation

Never assume previous chat context is sufficient.

The documentation is the source of truth.

---

# Feature Analysis Process

For every request Claude should answer:

What currently exists?

How does it work?

What files will change?

What systems are affected?

What risks exist?

How will success be measured?

Only then should implementation begin.

---

# Implementation Philosophy

Large changes should be broken into small milestones.

Example:

Bad:

"Rewrite graphics."

Good:

Improve terrain.

Review.

Improve lighting.

Review.

Improve trees.

Review.

Improve shadows.

Review.

Continue until complete.

Each milestone should leave the game in a playable state.

---

# Code Standards

Code should be:

Readable

Modular

Predictable

Self-documenting

Avoid clever solutions if a simpler one is easier to understand.

Favor composition over inheritance.

Favor reusable systems over one-off implementations.

---

# Refactoring Policy

Whenever a file is modified:

Remove dead code.

Improve naming.

Reduce duplication.

Simplify logic.

Improve comments where needed.

Maintain existing functionality.

Never leave a file in worse condition than it was found.

---

# Architecture Rules

Gameplay systems should remain independent.

Rendering should not contain gameplay logic.

UI should not contain physics.

Physics should not manage rendering.

Firebase should remain isolated.

Configuration should remain data-driven.

Hardcoded gameplay values should be avoided whenever practical.

---

# Performance Rules

Performance is a feature.

Every implementation should consider:

Frame rate

Memory usage

Bundle size

Garbage collection

Object creation

Rendering cost

Avoid unnecessary work every frame.

Object pooling should be preferred where appropriate.

---

# Graphics Workflow

When improving visuals:

Improve presentation first.

Then optimize.

Never sacrifice smooth performance for visual effects.

The visual goal is premium presentation rather than graphical complexity.

---

# Gameplay Workflow

When modifying gameplay:

Maintain fairness.

Reward skill.

Avoid hidden assistance.

Protect strategic depth.

Every gameplay change should improve player decision making.

---

# Firebase Workflow

When changing backend functionality:

Protect existing player data.

Maintain backward compatibility whenever possible.

Gracefully handle offline play.

Never require an account to play.

Guest mode must always function.

---

# UI Workflow

Every new interface should answer:

Can this require fewer taps?

Can this be clearer?

Can this be more readable?

Can it better fit a phone screen?

The simplest interface is usually the best one.

---

# Testing Requirements

Every completed feature should be tested for:

Correct functionality

Regression bugs

Mobile usability

Performance

Visual polish

Edge cases

Offline behavior (if applicable)

No implementation is complete without testing.

---

# Bug Fix Workflow

Before fixing a bug:

Understand the root cause.

Do not simply patch symptoms.

Explain the cause.

Explain the proposed fix.

Implement.

Verify.

Ensure no regressions were introduced.

---

# Documentation Updates

Whenever gameplay changes significantly:

Update the relevant documentation.

The documentation should always describe the current state of the project.

Never allow documentation to become outdated.

---

# Communication Style

Claude should communicate clearly and concisely.

When presenting work:

Summarize what changed.

Explain why it changed.

Identify risks.

Recommend next steps.

Avoid unnecessary technical jargon unless requested.

---

# When Multiple Solutions Exist

Claude should evaluate options using this priority order:

1. Player experience

2. Simplicity

3. Maintainability

4. Performance

5. Scalability

6. Development speed

If a faster solution creates long-term problems, choose the better architecture.

---

# When Requirements Are Unclear

Claude should not guess.

Instead:

Identify assumptions.

Present options.

Recommend one.

Explain why.

Proceed only after clarification when necessary.

---

# End-of-Session Checklist

Before ending any coding session:

□ Code compiles successfully.

□ Existing gameplay still works.

□ No obvious regressions exist.

□ New feature functions correctly.

□ Dead code removed.

□ Performance reviewed.

□ Documentation updated if needed.

□ Code formatted consistently.

□ Summary prepared.

□ Recommended next step identified.

---

# Commit Message Format

Commit messages should clearly describe intent.

Examples:

feat: add golfer spin control system

fix: correct Road Hole building collision

refactor: simplify swing meter architecture

perf: reduce terrain rendering overhead

docs: update gameplay tuning guide

Avoid vague messages like:

"updates"

"changes"

"fixed stuff"

---

# Definition of Complete

A task is complete only when:

The feature works.

The code is maintainable.

The game remains stable.

Documentation reflects reality.

Performance remains acceptable.

The implementation aligns with the Project Vision.

If any of these are not true, the task is not complete.

---

# Final Principle

Johnson's Golf should be developed as if it were a commercial product being built by a small, experienced game studio.

Every line of code should move the project closer to that goal.

Quality should always take precedence over speed.

When uncertain, choose the solution that results in a cleaner architecture, a better player experience, and a more polished final game.
