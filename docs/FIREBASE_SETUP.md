# Firebase Setup — Accounts & Cloud Saves (Phase 5)

The game ships with full Firebase auth + cloud saves implemented but
**dormant**: until the config below is pasted into `src/config.ts`, everything
runs local-only (guest profile in localStorage) and no Firebase code even
loads. Complete these console steps (~5 minutes), paste the config, and the
cloud layer lights up with no further code changes.

Project: the existing **golfgame-9c11e** Firebase project (already used by
the shared leaderboard) — or any project you prefer.

> **Account model note (updated):** progression is now **account-gated** — there
> is no anonymous auto-sign-in. Signed-out play is ephemeral; coins/records exist
> only for a Google-signed-in account (docs 08 §Account Philosophy). **Anonymous
> sign-in is no longer required** — only **Google** is. (Leaving Anonymous
> enabled is harmless.)

## Console checklist (you)

1. **Enable sign-in providers** — Firebase console → Build → Authentication →
   Sign-in method → enable **Google** (Anonymous optional / no longer used).
2. **Authorize the game's domains** — Authentication → Settings → Authorized
   domains → make sure these are present:
   - `mjohnsonwellabe.github.io` (GitHub Pages)
   - `localhost` (for local dev)
3. **Register a Web app** — Project settings (gear) → General → Your apps →
   "Add app" → Web (</>) → name it `johnsons-golf` → copy the config object.
4. **Paste the config** into `src/config.ts` → `FIREBASE`:
   ```ts
   export const FIREBASE = {
     apiKey: '<from console>',
     authDomain: '<project>.firebaseapp.com',
     projectId: '<project-id>',
     appId: '<from console>',
     databaseURL: LEADERBOARD_URL
   } as const;
   ```
   These are **public identifiers** — committing them is safe and standard;
   all security lives in the database rules below.
5. **Deploy database rules** — Build → Realtime Database → Rules → replace
   with:
   ```json
   {
     "rules": {
       "profiles": {
         "$uid": {
           ".read": "auth != null && auth.uid === $uid",
           ".write": "auth != null && auth.uid === $uid"
         }
       },
       "rounds": {
         ".read": true,
         "$id": {
           ".write": "newData.exists()",
           ".validate": "newData.hasChildren(['d','course','mode','names','total','toPar','holes'])"
         }
       },
       "tournaments": {
         ".read": true,
         "$code": {
           ".write": true,
           "entries": {
             "$player": { ".write": "!data.exists()" }
           }
         }
       },
       "aces": {
         ".read": true,
         "$player": { ".write": true }
       },
       "entitlements": {
         "$uid": {
           ".read": "auth != null && auth.uid === $uid",
           "$purchaseId": {
             ".write": false,
             "claimed": {
               ".write": "auth != null && auth.uid === $uid && newData.val() === true"
             }
           }
         }
       },
       "marketingConfig": {
         ".read": true,
         ".write": "auth != null && root.child('admins').child(auth.uid).val() === true"
       },
       "adminDrafts": {
         ".read": "auth != null && root.child('admins').child(auth.uid).val() === true",
         ".write": "auth != null && root.child('admins').child(auth.uid).val() === true"
       },
       "admins": {
         "$uid": {
           ".read": "auth != null && auth.uid === $uid"
         }
       },
       "events": {
         ".read": "auth != null && root.child('admins').child(auth.uid).val() === true",
         ".write": true
       },
       "liveOpsConfig": {
         ".read": true,
         ".write": "auth != null && root.child('admins').child(auth.uid).val() === true"
       },
       "weekly": {
         ".read": true,
         "$eventId": {
           "entries": {
             "$player": { ".write": "!data.exists()" }
           }
         }
       }
     }
   }
   ```
   (`rounds` keeps the existing open leaderboard behavior; `tournaments`
   supports Phase 8 — entries are write-once so posted scores can't be
   overwritten; `aces` is the all-time hole-in-one board. Profile data is
   strictly per-user. Without a rule, a path defaults to deny under locked
   mode — the `aces` block is required or the ace leaderboard can't post.
   `entitlements` records real-money purchases: written ONLY by the Stripe
   webhook Cloud Function (admin SDK bypasses rules — docs/16_PAYMENTS.md);
   a player can read their own and flip `claimed` to true, never back.
   `marketingConfig` is the public About-page content (Marketing Manager, below):
   world-readable so every player's page renders it, admin-write only.
   `adminDrafts` holds the admin **staging** areas (Next Season Pass, Future
   Store Items — see below): unlike `marketingConfig` it is **NOT** public — both
   read and write are restricted to allow-listed admins, so unreleased pricing,
   rewards and roadmap never leak to players. It contains only drafts and drives
   nothing live: the running Store and Season Pass read their own hardcoded
   config and are completely unaffected by anything under `adminDrafts`.
   `events` is the retention-analytics stream (batched, privacy-safe events —
   no emails/tokens/names, only opaque uids and random guest ids): clients can
   append (write) but ONLY allow-listed admins can read, so no player can data-
   mine other players' activity. `weekly` holds Weekly Featured Round
   leaderboards: world-readable, entries write-once per player per event —
   like tournament entries, a posted weekly score can't be overwritten.
   `liveOpsConfig` is the retention live-ops override layer (Daily Challenge
   date pins, Weekly Featured course overrides — Admin → Retention / Live
   Ops): world-readable like `marketingConfig` (players resolve it at menu
   time with a deterministic local fallback), admin-write only. Reward
   amounts, mastery conditions and achievement definitions stay code-defined
   and are NOT in this node.)

## Marketing Manager (`/marketingConfig`) — MANUAL console steps (you)

The admin dashboard (`admin.html` → 🎬 Marketing Manager) edits the public
About page (`marketing.html`) and publishes to the RTDB node `/marketingConfig`.
Read is public; write is restricted to allow-listed admin UIDs. Two one-time
console steps make **Publish** work — until they're done, Publish returns a clean
`permission denied` and the live About page simply keeps rendering its built-in
static fallback (nothing breaks, the change just doesn't go live):

1. **Add the rules** — the `"marketingConfig"` and `"admins"` blocks are already
   included in the Realtime Database → Rules JSON above. Deploy them (they do NOT
   weaken any existing rule — they only add two new nodes).

2. **Add yourself to `/admins`** — Realtime Database → Data → add a child so the
   write rule (`root.child('admins').child(auth.uid).val() === true`) passes:
   ```json
   { "admins": { "<your-firebase-uid>": true } }
   ```
   Find `<your-firebase-uid>` in Authentication → Users (the "User UID" column)
   for the owner Google account (mattjohnson912@gmail.com). Set the value to the
   boolean `true`.

After both steps, publishing from the Marketing Manager writes `/marketingConfig`
and the change goes live for all players with no source edits. The public page
reads it via a plain REST GET (`${LEADERBOARD_URL}/marketingConfig.json`) and
falls back to the static content on any absence/failure/offline.

## Admin staging areas (`/adminDrafts`) — MANUAL console steps (you)

The admin landing (`admin.html`) adds two **staging** workspaces — **Next Season
Pass Staging** and **Future Store Items Staging** — that let the owner draft
upcoming content without touching anything live. They save to
`/adminDrafts/nextSeasonPass` and `/adminDrafts/futureStoreItems` via the
signed-in admin's token.

Unlike `/marketingConfig`, these drafts are **private to admins** (unreleased
prices/rewards must not leak): the `"adminDrafts"` rule block above restricts
BOTH read and write to allow-listed admin UIDs. Two one-time console steps make
saving work — and they are the SAME allow-list the Marketing Manager already
uses, so if you completed that setup you only need step 1:

1. **Deploy the rules** — the `"adminDrafts"` block is already included in the
   Realtime Database → Rules JSON above. Deploy it (it only ADDS a new private
   node — it does not weaken any existing rule, and touches nothing the live
   game reads).

2. **Be on the `/admins` allow-list** — the same `{ "admins": { "<your-uid>":
   true } }` entry the Marketing Manager needs (above). No separate entry is
   required.

Until the rule is deployed, **Save draft** returns a clean `permission denied`
and the editor says so explicitly — a draft is **never** reported saved when the
write did not land (no silent success on offline/denied). Because these areas
only read/write `/adminDrafts`, the live Store and Season Pass are unaffected at
every step.

## What the game then does (already implemented)

- Signed out, the game is a **clean slate** — no cloud user, no coins/records,
  nothing saved (docs 08 §Account Philosophy).
- **"Sign in with Google"** (main menu + Profile) signs the player into their
  account. The cloud profile at `profiles/{uid}` becomes live and every change
  syncs. The **first** sign-in on a device merges any local progress up once
  (`mergeProfiles`, grow-only counters — nothing lost).
- **Log out** returns to the clean slate; the account stays safe under its uid
  and returns on the next sign-in, on any device.
- Cloud outages degrade silently to local (account-cached) play for a signed-in
  player; a permission-denied (rules not published) is logged to the console
  instead of failing silently.
