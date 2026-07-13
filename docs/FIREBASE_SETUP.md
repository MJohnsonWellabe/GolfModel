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
   a player can read their own and flip `claimed` to true, never back.)

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
