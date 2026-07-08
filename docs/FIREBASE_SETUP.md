# Firebase Setup — Accounts & Cloud Saves (Phase 5)

The game ships with full Firebase auth + cloud saves implemented but
**dormant**: until the config below is pasted into `src/config.ts`, everything
runs local-only (guest profile in localStorage) and no Firebase code even
loads. Complete these console steps (~5 minutes), paste the config, and the
cloud layer lights up with no further code changes.

Project: the existing **golfgame-9c11e** Firebase project (already used by
the shared leaderboard) — or any project you prefer.

## Console checklist (you)

1. **Enable sign-in providers** — Firebase console → Build → Authentication →
   Sign-in method → enable **Anonymous** and **Google**.
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
       }
     }
   }
   ```
   (`rounds` keeps the existing open leaderboard behavior; `tournaments`
   supports Phase 8 — entries are write-once so posted scores can't be
   overwritten. Profile data is strictly per-user.)

## What the game then does (already implemented)

- First cloud touch signs the player in **anonymously** — zero friction,
  invisible (docs 08 §Account Philosophy).
- The local guest profile merges with the cloud copy (progress is never
  lost: coins/xp/collections take the max/union — `mergeProfiles`).
- A **"Link Google account"** action upgrades the anonymous user in place —
  same uid, all progress kept — enabling cross-device sync.
- Cloud outages degrade silently to local play.
