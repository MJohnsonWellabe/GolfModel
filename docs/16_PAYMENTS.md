# Real-Money Purchases — Stripe Setup Runbook

How players buy **1000 J-Coins for $10** and the **Season Pass for $5**.

The two live Payment Links are wired into `src/firebase/Purchases.ts`, so the
buy buttons are live in the game. What remains is *fulfillment* — handing the
coins/pass to the buyer after payment. There are two ways:

- **Manual (works today, phone-only).** No deploy. After each sale you paste
  one line into the Firebase console. Start here — see
  **§Manual fulfillment (mobile)** below.
- **Automatic (needs a one-time deploy from a computer).** A tiny webhook
  delivers every purchase with no manual step — see **§Going automatic**.

Both require the `entitlements` security-rule block to be published once
(§Publish the rules).

## Which link is which

`PAYMENT_LINKS` in `src/firebase/Purchases.ts`:
- `coins1000` → `https://buy.stripe.com/aFa4grgPc1cK5ZjfuF2B201` ($10)
- `seasonpass_s1` → `https://buy.stripe.com/5kQcMX7eCdZw0EZfuF2B200` ($5)

## Publish the rules (once, phone OK)

Firebase console → Realtime Database → **Rules** → paste the full rule set
from `docs/FIREBASE_SETUP.md` (it includes the `entitlements` block) → Publish.
Without this, a granted purchase can't be read by the buyer's game.

## Manual fulfillment (mobile)

No webhook, no CLI — everything in the browser:

1. A payment comes in. Open it in Stripe and copy its **`client_reference_id`**
   — that is the buyer's account id (the game appends it to the checkout URL).
2. Firebase console → Realtime Database → **Data** → add a child under
   `entitlements`: key = the buyer's id, and under it a key like `manual1`:
   - Coins: `{ "product": "coins1000", "coins": 1000, "created": 0 }`
   - Pass:  `{ "product": "seasonpass_s1", "created": 0 }`
   (The console writes as project admin, so the function-write-only rule does
   not block *you* — only players.)
3. The buyer's game applies it automatically next time they open the Store or
   Season Pass (the claim loop polls those screens and sign-in).

Fine for launch volume; move to automatic when the manual step gets old.

## Going automatic

Deploy the webhook (`functions/index.js`) so purchases fulfil with no manual
step. **Product is inferred from the amount paid** ($10 → coins, $5 → pass),
so the Payment Links need no extra dashboard config. Two deploy options:

### Option A — GitHub Action (browser-only after setup)

`.github/workflows/deploy-functions.yml` deploys the function on push once
these repo secrets exist (GitHub → repo → Settings → Secrets and variables →
Actions):
- `FIREBASE_SERVICE_ACCOUNT` — a Firebase service-account key JSON (Firebase
  console → Project settings → Service accounts → Generate new private key).
- `STRIPE_SECRET` — your Stripe secret key (`sk_live_…`).
- `STRIPE_WEBHOOK_SECRET` — the webhook signing secret (`whsec_…`, from the
  webhook you create below; start with a placeholder, update after).

The service account needs the Cloud Functions Admin, Cloud Run Admin, Service
Account User, and Firebase Admin roles (grant in Google Cloud console → IAM if
the first deploy reports a permission error). Trigger a deploy by re-running
the workflow (Actions tab → Deploy Cloud Functions → Run workflow).

### Option B — one-time CLI (from a computer)

```
npm i -g firebase-tools
firebase login
firebase functions:secrets:set STRIPE_SECRET            # paste sk_live_…
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET     # placeholder "whsec_tmp" for now
cd functions && npm install && cd ..
firebase deploy --only functions                         # note the printed function URL
```

### Then, either option — connect Stripe → the deployed function

Stripe dashboard → Developers → **Webhooks** → Add endpoint:
- URL: the function URL printed by the deploy
  (`https://…cloudfunctions.net/stripeWebhook` or a `…run.app` URL).
- Events: `checkout.session.completed` only.
- Copy the endpoint's **signing secret** (`whsec_…`) into
  `STRIPE_WEBHOOK_SECRET` (repo secret for Option A, or
  `firebase functions:secrets:set` + redeploy for Option B).

Optionally set each Payment Link's after-payment redirect to
`https://bsgolf.fun/?purchase=success` for a nicer return (not required — the
claim loop delivers on the next visit regardless).

## One-time setup (superseded copy removed)

> A duplicated, superseded setup section was removed here on 2026-07-17 — the
> live setup instructions are in the sections above.
## How it works

```
player (signed in)                    Stripe                        Firebase
──────────────────                    ──────                        ────────
tap "Get the Season Pass · $5"
  → redirected to the Payment Link
    ?client_reference_id=<uid>  ──►  hosted checkout page
                                      payment succeeds
                                      checkout.session.completed ─► stripeWebhook
                                                                    (functions/)
                                                                    verifies signature,
                                                                    writes entitlements/
                                                                    {uid}/{sessionId}
  ◄─ success URL: bsgolf.fun/?purchase=success
game claims entitlements  ◄──────────────────────────────────────  reads own node,
(coins added / pass unlocked,                                       flips claimed:true
 synced to profiles/{uid})
```

- The **webhook Cloud Function** (`functions/index.js`) is the only server
  code in the project. It is idempotent (keyed by Stripe session id, written
  in a transaction) — webhook retries can never double-grant.
- The **entitlements node is function-write-only** (rules below). Players can
  read their own purchases and mark them claimed, nothing else. That makes
  real-money grants authoritative and auditable even though the rest of the
  profile is self-writable.
- The client claim loop (`src/firebase/Purchases.ts`) runs on sign-in, on the
  `?purchase=success` return, and whenever the Store or Season Pass overlays
  open — so a purchase lands within seconds even if the redirect is lost.

## One-time setup

### 1. Stripe (≈15 minutes)

1. Create an account at dashboard.stripe.com and complete business/bank
   verification (required before live payments pay out).
2. **Products** → add two products, each with a one-time price:
   - `1000 J-Coins` — $10.00
   - `Season Pass — Season One` — $5.00
3. **Payment Links** → create one link per product. On each link:
   - **Metadata** (under advanced options): add key `product` with value
     `coins1000` (coins link) or `seasonpass_s1` (pass link). ← the webhook
     reads this; without it a purchase logs as unattributable.
   - **After payment** → redirect to `https://bsgolf.fun/?purchase=success`.
4. Copy the two `https://buy.stripe.com/…` URLs into `PAYMENT_LINKS` in
   `src/firebase/Purchases.ts`, commit, and deploy the site. The Top-Up card
   and the pass purchase button appear on their own once the URLs are set.

### 2. Firebase (≈10 minutes)

1. **Upgrade to the Blaze plan** (console → golfgame-9c11e → Upgrade).
   Pay-as-you-go; a webhook at this game's volume rounds to $0/month.
2. Install the CLI and sign in: `npm i -g firebase-tools && firebase login`.
3. From the repo root, set the two secrets (values from Stripe → Developers):
   ```
   firebase functions:secrets:set STRIPE_SECRET          # sk_live_… (or sk_test_…)
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET  # whsec_…  (step 3 below)
   ```
4. Deploy: `cd functions && npm install && cd .. && firebase deploy --only functions`.
   Note the printed function URL
   (`https://us-central1-golfgame-9c11e.cloudfunctions.net/stripeWebhook`).

### 3. Connect Stripe → Firebase

Stripe dashboard → Developers → **Webhooks** → Add endpoint:
- URL: the function URL from the deploy.
- Events: `checkout.session.completed` only.
- Copy the endpoint's **signing secret** (`whsec_…`) into the
  `STRIPE_WEBHOOK_SECRET` secret (step 2.3) and redeploy the function.

### 4. Publish the updated database rules

Console → Realtime Database → Rules: add the `entitlements` block from
`docs/FIREBASE_SETUP.md` (kept there so all rules live in one document).

## Verify before going live

1. Put Stripe in **test mode**, make test-mode copies of the products/links
   (metadata included), point `PAYMENT_LINKS` at them on a local build.
2. Buy with card `4242 4242 4242 4242`.
3. Watch: Stripe webhook log shows 200 → RTDB `entitlements/<uid>/<session>`
   appears → the game shows "Purchase applied" and coins/pass land → the
   entitlement gains `claimed: true`.
4. Swap in the live links/secrets, make one real $10 purchase yourself, then
   announce.

## Fallback: no Blaze / manual fulfillment

The same Payment Links work with **no Cloud Function at all**: each Stripe
payment email includes the session id and (via the receipt page) the
client_reference_id. Write the entitlement by hand in the RTDB console —

```
entitlements/<uid>/<anything-unique>: { "product": "coins1000", "coins": 1000, "created": 0 }
```

— and the game's claim loop delivers it on the player's next visit. Tedious
past a few sales; deploying the function is the upgrade path, nothing else
changes.

## Refunds

Manual: refund in the Stripe dashboard, then delete the entitlement node
and, if already claimed, adjust the player's `profiles/{uid}` (coins /
`season.owned`) in the console. At $5–$10 price points, expect this to be
rare enough that tooling isn't worth building yet.

## Google Play caveat

If the game ships to the Play Store later (docs/14), Google **requires Play
Billing** for digital goods inside the Android app — Stripe is not allowed
there. The entitlements design is billing-agnostic: Play Billing would simply
become a second writer to the same node. Web purchases at bsgolf.fun stay on
Stripe either way.

## Protecting the source (owner question, answered)

- The repo is currently **public** — that, not the deployed site, is the real
  exposure. Recommended: GitHub → repo Settings → change visibility to
  **private**. GitHub Pages on a private repo needs the **GitHub Pro** plan
  (~$4/mo); everything else (Actions deploy, custom domain) keeps working
  unchanged. Alternative for $0: move hosting to Firebase Hosting — but that
  changes the bsgolf.fun DNS/deploy setup and isn't worth it today.
- The shipped site is a minified bundle; browsers can always download it, but
  it is not the readable source.
- Ideas can't be copyrighted; code is copyrighted automatically. The repo now
  carries a proprietary `LICENSE` ("all rights reserved") making that
  explicit.
