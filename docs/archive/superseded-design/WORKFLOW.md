> **HISTORICAL:** This document is retained for context and does not override the current documentation library. See `docs/README.md` for authoritative guidance.
>
> Process-origin history; fully absorbed by docs/README.md, the Design Constitution, and the Claude phase sequence.

# Workflow

The **master prompt is your constitution**. It establishes the game's identity, priorities, and design philosophy. The phase prompts are then individual work orders that reference that vision.

Here's the workflow I'd use:

### Step 1: Start a fresh Claude project

Upload your codebase (or connect the GitHub repo if you're using Claude Code).

### Step 2: Give Claude the master vision document

This is the long prompt we created (I'd even save it as `GAME_VISION.md` in your repository).

That tells Claude:

* What the game should become.
* What games to emulate.
* What to avoid.
* Your gameplay philosophy.
* Long-term features.
* Development priorities.

Don't ask it to code anything yet. Let this become the project's guiding document.

---

### Step 3: Ask Claude to analyze before coding

Your next prompt should be something like:

> Read the entire codebase and the Game Vision document. Do not make any code changes yet. Produce a comprehensive architecture review covering the current strengths, technical debt, scalability issues, graphics limitations, gameplay limitations, and backend architecture. Then create a detailed implementation roadmap for Phase 1 with milestones, risks, and the files that will need to change. Wait for my approval before writing any code.

This is a step many people skip, and it often leads to better results because Claude spends time understanding the project before modifying it.

---

### Step 4: Begin Phase 1

Then use the Phase 1 prompt.

Claude focuses only on that work.

---

### Step 5: Review

Play the build.

Make notes.

Ask for tweaks.

Repeat until you're genuinely happy.

---

### Step 6: Move to Phase 2

Only then.

---

## One thing I'd add

I would also create a file called something like:

```
DESIGN_RULES.md
```

This is much shorter than the master prompt—just the core principles Claude should never violate. For example:

* Mobile-first.
* One-handed gameplay.
* Easy to learn, difficult to master.
* Reward skill, never hidden assistance.
* Every golfer should feel unique.
* Every course should require strategy.
* Keep frame rate smooth on mid-range phones.
* New features should not increase UI complexity unnecessarily.
* Guest play must always remain available.

Having those rules in the repository gives Claude a persistent reference instead of relying only on conversation context.

### One change I'd make to the phases

I'd actually split the first phase into two:

**Phase 1A – Architecture & Foundation**

* Review the codebase.
* Refactor where needed.
* Improve project structure.
* Prepare for future features without changing gameplay.

**Phase 1B – Graphics & Presentation**

* Upgrade visuals.
* Improve cameras.
* Polish UI.
* Enhance animations and effects.

The reason is that improving architecture first makes every later phase easier and reduces the chance that you'll need to undo work.

## My overall recommendation

Treat Claude like a senior game developer rather than a code generator. Every phase should follow this pattern:

1. Analyze the current code.
2. Present a plan.
3. Get your approval.
4. Implement.
5. Test.
6. Refactor.
7. Summarize what changed.
8. Wait for the next phase.

That iterative process is much more likely to produce a polished game than asking for huge batches of changes at once. Given what you've described and the current state of the project, I think it's a very achievable path.
