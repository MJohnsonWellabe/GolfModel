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
 * Which product was bought comes from the Payment Link's metadata
 * (`product: coins1000 | seasonpass_s1`) — Stripe copies Payment Link
 * metadata onto every checkout session it creates, so no price-id mapping
 * needs to live here. The uid arrives as client_reference_id (the game
 * appends it to the Payment Link URL).
 */
const { onRequest } = require('firebase-functions/v2/https');
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
    const grant = GRANTS[(session.metadata && session.metadata.product) || ''];
    if (!uid || !grant) {
      // A paid session we can't attribute — surface it in the logs so the
      // owner can fulfil by hand from the Stripe dashboard email.
      console.error('unattributable purchase — fulfil manually:', {
        session: session.id,
        uid: uid || null,
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
