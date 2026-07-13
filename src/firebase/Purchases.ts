import { PlayerProfile } from '../profile/Profile';
import { firebaseHandles } from './FirebaseClient';

/**
 * Real-money purchases (Stripe Payment Links + Cloud Function fulfillment).
 *
 * Flow (docs/16_PAYMENTS.md):
 *  1. startPurchase() sends the SIGNED-IN player to the product's Stripe
 *     Payment Link with their uid as client_reference_id.
 *  2. Stripe fires checkout.session.completed → the stripeWebhook Cloud
 *     Function (functions/) writes entitlements/{uid}/{sessionId} in RTDB.
 *     That node is function-write-only; the player can only flip `claimed`.
 *  3. claimEntitlements() (called on sign-in, on the ?purchase=success
 *     return, and when the store/pass overlays open) applies each unclaimed
 *     entitlement to the profile and marks it claimed.
 *
 * Until the Payment Link URLs below are pasted in from the Stripe dashboard
 * the purchase buttons stay hidden — same dormant pattern as
 * FirebaseClient.authConfigured().
 */

export type ProductId = 'coins1000' | 'seasonpass_s1';

export const PRODUCTS: Record<ProductId, { name: string; usd: number; coins?: number }> = {
  coins1000: { name: '1000 J-Coins', usd: 10, coins: 1000 },
  seasonpass_s1: { name: 'Season Pass — Season One', usd: 5 }
};

/** Stripe Payment Link URLs (https://buy.stripe.com/…) — set per
 *  docs/16_PAYMENTS.md. Empty string = that product isn't purchasable yet. */
export const PAYMENT_LINKS: Record<ProductId, string> = {
  coins1000: '',
  seasonpass_s1: ''
};

export function purchaseConfigured(product: ProductId): boolean {
  return Boolean(PAYMENT_LINKS[product]);
}

/** Send the player to Stripe checkout. Requires a signed-in uid — the
 *  webhook needs it to know which account to credit. Full-page redirect
 *  (mobile-safe; purchases only start from the menu overlays). */
export function startPurchase(product: ProductId, uid: string): void {
  const link = PAYMENT_LINKS[product];
  if (!link || !uid) return;
  const sep = link.includes('?') ? '&' : '?';
  window.location.href = `${link}${sep}client_reference_id=${encodeURIComponent(uid)}`;
}

/** One purchase written by the Cloud Function (or by hand in the console —
 *  the manual-fulfillment fallback uses the exact same shape). */
export interface Entitlement {
  product?: string;
  /** Coin grants carry the amount so the function stays the single source
   *  of truth for what a product delivers. */
  coins?: number;
  created?: number;
  claimed?: boolean;
}

/**
 * Apply one entitlement to the profile (pure — no I/O). Returns true when the
 * entitlement was recognized and consumed (caller then marks it claimed);
 * false leaves it unclaimed for a newer client version to handle.
 * Already-satisfied grants (pass bought twice) still return true so the
 * server-side claimed flag ends the retry loop.
 */
export function applyEntitlement(profile: PlayerProfile, ent: Entitlement): boolean {
  if (!ent || ent.claimed) return false;
  if (ent.product === 'coins1000' || (ent.coins ?? 0) > 0) {
    const coins = ent.coins ?? PRODUCTS.coins1000.coins!;
    profile.coins += coins;
    profile.coinsEarned += coins; // grow-only lifetime tally (drives cloud merge)
    return true;
  }
  if (ent.product === 'seasonpass_s1') {
    if (!profile.season.owned) {
      profile.season.owned = true;
      if (ent.created != null) profile.season.purchasedAt = ent.created;
    }
    return true;
  }
  return false;
}

/**
 * Pull the signed-in player's entitlements, apply the unclaimed ones and mark
 * them claimed. Returns the display names of what was applied (for a toast);
 * empty when signed out, unconfigured, offline, or nothing new. The caller
 * persists + cloud-syncs the profile when anything was applied.
 */
export async function claimEntitlements(profile: PlayerProfile): Promise<string[]> {
  const handles = await firebaseHandles();
  const user = handles?.auth.currentUser;
  if (!handles || !user || user.isAnonymous) return [];
  try {
    const { get, ref, set } = await import('firebase/database');
    const snap = await get(ref(handles.db, `entitlements/${user.uid}`));
    if (!snap.exists()) return [];
    const applied: string[] = [];
    for (const [key, ent] of Object.entries(snap.val() as Record<string, Entitlement>)) {
      if (!applyEntitlement(profile, ent)) continue;
      await set(ref(handles.db, `entitlements/${user.uid}/${key}/claimed`), true);
      applied.push(PRODUCTS[ent.product as ProductId]?.name ?? ent.product ?? 'Purchase');
    }
    return applied;
  } catch (e) {
    console.warn('[purchases] entitlement check failed; will retry later:', e);
    return [];
  }
}
