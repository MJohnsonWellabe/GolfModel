/**
 * Development environment badge. An unmistakable corner tag shown ONLY when the
 * app is not running as production, so an admin/tester can never confuse the dev
 * game with the live one (spec: "Environment identity is unmistakable").
 *
 * Self-contained: it injects its own fixed-position element and styles, so it
 * needs no markup in index.html and works identically on the game, admin, and
 * marketing pages. In production `mountEnvBadge()` is a no-op — nothing renders
 * and nothing is injected.
 */

import { ENV } from '../config/env';
import { buildLabel } from './buildInfo';

let mounted = false;

/** Inject the DEV badge if this is not production. Idempotent. */
export function mountEnvBadge(): void {
  if (mounted || ENV.isProd) return;
  if (typeof document === 'undefined') return;
  // Never render under automation (Playwright sets navigator.webdriver), so the
  // screenshot contact sheets stay clean; a real human dev still sees the badge.
  if (typeof navigator !== 'undefined' && navigator.webdriver) return;
  mounted = true;

  const badge = document.createElement('div');
  badge.id = 'envBadge';
  badge.textContent = `DEV · ${buildLabel()}`;
  badge.setAttribute('aria-hidden', 'true');
  badge.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'z-index:2147483647',
    'padding:3px 8px',
    'font:600 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace',
    'letter-spacing:0.04em',
    'color:#1b1000',
    'background:#ffcf33',
    'border-bottom-right-radius:6px',
    'box-shadow:0 1px 4px rgba(0,0,0,0.35)',
    'pointer-events:none',
    'user-select:none'
  ].join(';');

  const attach = (): void => {
    if (document.body) document.body.appendChild(badge);
  };
  if (document.body) attach();
  else document.addEventListener('DOMContentLoaded', attach, { once: true });
}
