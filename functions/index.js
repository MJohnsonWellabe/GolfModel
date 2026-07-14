/**
 * Stripe fulfillment webhook — the ONLY server code in the project.
 *
 * Stripe calls this on checkout.session.completed (configured per
 * docs/16_PAYMENTS.md). After verifying the webhook signature, it writes an
 * entitlement to RTDB at entitlements/{uid}/{sessionId}; the game client
 * (src/firebase/Purchases.ts) applies unclaimed entitlements to the player's
 * profile and flips their `claimed` flag. The entitlements node is
 * function-write-only (admin SDK bypasses rules), so real-money grants are
 * authoritative and auditable.
 *
 * Which product was bought is inferred from the amount paid
 * (`amount_total`: $10 → coins, $5 → pass), with the Payment Link's
 * `product` metadata used as an override when present. Amount-based mapping
 * means the two Payment Links need NO dashboard configuration. The uid
 * arrives as client_reference_id (the game appends it to the link URL).
 */
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Stripe = require('stripe');

admin.initializeApp();

const STRIPE_SECRET = defineSecret('STRIPE_SECRET');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');

/** What each product delivers. Coin grants carry the amount so the client
 *  never decides what a purchase is worth. */
const GRANTS = {
  coins1000: { product: 'coins1000', coins: 1000 },
  seasonpass_s1: { product: 'seasonpass_s1' }
};

/** Price paid (in cents) → product. $10.00 = 1000 coins; $5.00 = Season Pass. */
const AMOUNT_TO_PRODUCT = {
  1000: 'coins1000',
  500: 'seasonpass_s1'
};

/** Resolve what a completed session bought: explicit metadata wins, else the
 *  amount paid decides. Returns null for anything we don't recognize. */
function grantForSession(session) {
  const meta = session.metadata && session.metadata.product;
  if (GRANTS[meta]) return GRANTS[meta];
  const byAmount = AMOUNT_TO_PRODUCT[session.amount_total];
  return byAmount ? GRANTS[byAmount] : null;
}

exports.stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET, STRIPE_WEBHOOK_SECRET], region: 'us-central1' },
  async (req, res) => {
    const stripe = new Stripe(STRIPE_SECRET.value());
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.headers['stripe-signature'],
        STRIPE_WEBHOOK_SECRET.value()
      );
    } catch (e) {
      console.warn('webhook signature verification failed:', e.message);
      res.status(400).send('bad signature');
      return;
    }

    if (event.type !== 'checkout.session.completed') {
      res.json({ received: true });
      return;
    }
    const session = event.data.object;
    if (session.payment_status !== 'paid') {
      res.json({ received: true, pending: true });
      return;
    }
    const uid = session.client_reference_id;
    const grant = grantForSession(session);
    if (!uid || !grant) {
      // A paid session we can't attribute — surface it in the logs so the
      // owner can fulfil by hand from the Stripe dashboard email.
      console.error('unattributable purchase — fulfil manually:', {
        session: session.id,
        uid: uid || null,
        amount_total: session.amount_total,
        metadata: session.metadata || null
      });
      res.json({ received: true, unattributed: true });
      return;
    }
    // Keyed by session id + written via transaction: Stripe's webhook retries
    // can never double-grant.
    await admin
      .database()
      .ref(`entitlements/${uid}/${session.id}`)
      .transaction((cur) => cur || { ...grant, created: Date.now() });
    console.log(`granted ${grant.product} to ${uid} (${session.id})`);
    res.json({ received: true });
  }
);

/**
 * Admin-only: gift Season XP / True Vision charges to another account by
 * email, for QA/testing. Client rules (docs/FIREBASE_SETUP.md) bind
 * profiles/{uid} writes to auth.uid === uid, so no signed-in client can ever
 * write another user's profile — this callable is the one deliberate,
 * server-verified exception, following the same admin-SDK-bypasses-rules
 * pattern as the entitlements write above.
 *
 * Mirrors src/admin/adminEmails.ts — functions/ is a separate, unbundled
 * Node package (no TS build step here), so this is a deliberate small
 * duplicate. Keep both lists in sync if the allowlist ever changes.
 */
const ADMIN_EMAILS = ['mattjohnson912@gmail.com'];
/** src/data/consumables.ts TRUE_VISION.id */
const TRUE_VISION_ID = 'true_vision';

exports.giftSeasonReward = onCall({ region: 'us-central1' }, async (request) => {
  const auth = request.auth;
  if (!auth || !auth.token || !auth.token.email) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  if (!ADMIN_EMAILS.includes(auth.token.email.toLowerCase())) {
    throw new HttpsError('permission-denied', 'Admin only.');
  }
  const { targetEmail, seasonXp, trueVisionCharges } = request.data || {};
  if (typeof targetEmail !== 'string' || !targetEmail.includes('@')) {
    throw new HttpsError('invalid-argument', 'targetEmail is required.');
  }
  const xp = Math.max(0, Math.floor(Number(seasonXp) || 0));
  const tv = Math.max(0, Math.floor(Number(trueVisionCharges) || 0));
  if (xp === 0 && tv === 0) throw new HttpsError('invalid-argument', 'Nothing to grant.');

  let targetUser;
  try {
    targetUser = await admin.auth().getUserByEmail(targetEmail.toLowerCase());
  } catch (e) {
    throw new HttpsError('not-found', `No account for ${targetEmail}.`);
  }
  const uid = targetUser.uid;
  const result = await admin
    .database()
    .ref(`profiles/${uid}`)
    .transaction((profile) => {
      if (!profile) return profile; // no cloud profile yet — abort (target must have signed in once)
      if (xp > 0) {
        profile.season = profile.season || { id: 's1', xp: 0, claimed: [], owned: false };
        profile.season.xp = (profile.season.xp || 0) + xp;
      }
      if (tv > 0) {
        profile.consumables = profile.consumables || [];
        const existing = profile.consumables.find((c) => c.id === TRUE_VISION_ID);
        if (existing) existing.granted = (existing.granted || 0) + tv;
        else profile.consumables.push({ id: TRUE_VISION_ID, granted: tv, used: 0 });
      }
      profile.updatedAt = Date.now();
      return profile;
    });
  if (!result.committed || !result.snapshot.exists()) {
    throw new HttpsError(
      'failed-precondition',
      `${targetEmail} has no cloud profile yet (they must sign in once first).`
    );
  }
  console.log(`gift: ${auth.token.email} granted ${xp} season XP + ${tv} True Vision to ${targetEmail} (${uid})`);
  return { ok: true, uid, grantedXp: xp, grantedTrueVision: tv };
});
