/**
 * Admin → Future Store Items (staging area). A staging-ONLY editor the owner
 * uses to DRAFT upcoming store items before they are ever wired into the live
 * catalog. It has NO purchasing, NO activation, and NEVER touches the live
 * store (src/data/storeCatalog.ts) or a player's inventory — it only reads and
 * writes the private draft node `/adminDrafts/futureStoreItems` via the shared
 * admin-draft helper (src/firebase/AdminDrafts.ts).
 *
 * Reached from the admin dashboard (src/admin/main.ts); the admin is already
 * signed in + allow-listed there. Library-select only for images (no upload).
 *
 * Everything visible is clearly marked "DRAFT / NOT LIVE": there is deliberately
 * no buy/equip/activate button anywhere in this screen. Saving reports success
 * ONLY when the write actually lands (never on denied/offline) — see
 * draftStatusMessage. Pure helpers (validate/new/duplicate/reorder/normalize)
 * are exported for tests; the DOM layer follows the house style in
 * src/admin/marketing.ts (single-root event delegation, a `draft` module
 * variable, a `paint()` re-render).
 */
import { loadAdminDraft, saveAdminDraft, draftStatusMessage } from '../firebase/AdminDrafts';
import { StoreKind } from '../data/storeCatalog';
import { IMAGE_LIBRARY, LibItem } from '../marketing/config';

// ---- Schema ----------------------------------------------------------------

export interface FutureStoreItem {
  id: string; // slug/id
  name: string;
  category: string; // reuse StoreKind values in the dropdown
  description: string;
  price: number;
  currency: 'coins' | 'usd';
  image: string; // committed-image library path
  rarity: 'common' | 'rare' | 'special';
  availableFrom: string; // ISO date
  availableTo: string; // ISO date
  featured: boolean;
  sortOrder: number;
}

export interface StoreStagingDraft {
  items: FutureStoreItem[];
  /** Epoch ms of the last save (stamped by publishableDraft); read by the admin
   *  landing to show a last-saved time. Optional so older drafts still load. */
  savedAt?: number;
}

/** The StoreKind values, reused for the category dropdown + validation. Kept as
 *  data (the type itself carries no runtime values). Typed so it tracks the
 *  live union — a new StoreKind is a compile error here until added. */
export const STORE_KINDS: readonly StoreKind[] = [
  'ball',
  'trail',
  'character',
  'clubUpgrade',
  'outfit',
  'clubskin',
  'pal'
];

export const CURRENCIES: ReadonlyArray<FutureStoreItem['currency']> = ['coins', 'usd'];
export const RARITIES: ReadonlyArray<FutureStoreItem['rarity']> = ['common', 'rare', 'special'];

const DRAFT_KEY = 'futureStoreItems';

// ---- Pure helpers (exported + tested) --------------------------------------

function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

/** A fresh item with the given sort order, seeded from the committed image
 *  library + the first store kind so it is valid on creation. */
export function newItem(sortOrder = 0): FutureStoreItem {
  return {
    id: `item-${sortOrder + 1}`,
    name: '',
    category: STORE_KINDS[0],
    description: '',
    price: 0,
    currency: 'coins',
    image: IMAGE_LIBRARY[0]?.value ?? '',
    rarity: 'common',
    availableFrom: '',
    availableTo: '',
    featured: false,
    sortOrder
  };
}

/** A brand-new draft with exactly one empty item. */
export function defaultDraft(): StoreStagingDraft {
  return { items: [newItem(0)] };
}

/** Deep-copy an item under a new, derived id (`${id}-copy`). The clone keeps
 *  every field; the caller assigns its final sortOrder. */
export function duplicateItem(item: FutureStoreItem): FutureStoreItem {
  const copy = clone(item);
  copy.id = `${item.id || 'item'}-copy`;
  return copy;
}

/** Swap an item with its neighbour (dir -1 = up, +1 = down) and keep sortOrder
 *  aligned with array position. No-op at the ends. Mutates + returns `items`. */
export function reorder(items: FutureStoreItem[], idx: number, dir: number): FutureStoreItem[] {
  const j = idx + dir;
  if (idx < 0 || idx >= items.length || j < 0 || j >= items.length) return items;
  const tmp = items[idx];
  items[idx] = items[j];
  items[j] = tmp;
  items.forEach((it, i) => (it.sortOrder = i));
  return items;
}

/** Coerce a loaded/edited draft into a safe, well-typed shape: an items array
 *  whose every field has the right type + a default, sorted by sortOrder with
 *  sortOrder re-based to array position (0..n-1) so it is always contiguous. */
export function normalize(draft: StoreStagingDraft | null | undefined): StoreStagingDraft {
  const items = Array.isArray(draft?.items) ? draft!.items : [];
  const out: FutureStoreItem[] = items.map((raw, i) => {
    const it = (raw ?? {}) as Partial<FutureStoreItem>;
    const price = Number(it.price);
    const sort = Number(it.sortOrder);
    return {
      id: typeof it.id === 'string' ? it.id : '',
      name: typeof it.name === 'string' ? it.name : '',
      category: STORE_KINDS.includes(it.category as StoreKind) ? (it.category as StoreKind) : STORE_KINDS[0],
      description: typeof it.description === 'string' ? it.description : '',
      price: Number.isFinite(price) ? price : 0,
      currency: it.currency === 'usd' ? 'usd' : 'coins',
      image: typeof it.image === 'string' ? it.image : '',
      rarity: it.rarity === 'rare' || it.rarity === 'special' ? it.rarity : 'common',
      availableFrom: typeof it.availableFrom === 'string' ? it.availableFrom : '',
      availableTo: typeof it.availableTo === 'string' ? it.availableTo : '',
      featured: !!it.featured,
      sortOrder: Number.isFinite(sort) ? sort : i
    };
  });
  out.sort((a, b) => a.sortOrder - b.sortOrder);
  out.forEach((it, i) => (it.sortOrder = i));
  return { items: out };
}

/**
 * Validate a staging draft, returning a human-readable error per problem (empty
 * array = clean). Rules: every id non-empty AND unique; name non-empty; price a
 * finite number ≥ 0; currency in {coins,usd}; category a valid StoreKind; rarity
 * valid; image non-empty; availableFrom ≤ availableTo when both set; sortOrder
 * finite. Messages lead with a 1-based row + the item name/id so the owner can
 * find the offending card.
 */
export function validateStoreDraft(d: StoreStagingDraft): string[] {
  const errors: string[] = [];
  const items = Array.isArray(d?.items) ? d.items : [];
  if (items.length === 0) errors.push('Add at least one item before saving.');

  const seen = new Map<string, number>();
  items.forEach((it, i) => {
    const where = `Item ${i + 1} (${(it?.name || it?.id || 'unnamed').toString().trim() || 'unnamed'})`;
    const id = (it?.id ?? '').toString().trim();
    if (!id) {
      errors.push(`${where}: id is required.`);
    } else {
      const prev = seen.get(id);
      if (prev !== undefined) errors.push(`${where}: duplicate id "${id}" (also item ${prev + 1}).`);
      else seen.set(id, i);
    }
    if (!(it?.name ?? '').toString().trim()) errors.push(`${where}: name is required.`);
    if (!Number.isFinite(it?.price)) errors.push(`${where}: price must be a number.`);
    else if ((it?.price as number) < 0) errors.push(`${where}: price cannot be negative.`);
    if (!CURRENCIES.includes(it?.currency)) errors.push(`${where}: currency must be coins or usd.`);
    if (!STORE_KINDS.includes(it?.category as StoreKind))
      errors.push(`${where}: category "${it?.category}" is not a valid store kind.`);
    if (!RARITIES.includes(it?.rarity)) errors.push(`${where}: rarity must be common, rare, or special.`);
    if (!(it?.image ?? '').toString().trim()) errors.push(`${where}: image is required.`);
    if (!Number.isFinite(it?.sortOrder)) errors.push(`${where}: sort order must be a number.`);
    const from = (it?.availableFrom ?? '').toString().trim();
    const to = (it?.availableTo ?? '').toString().trim();
    if (from && to && from > to) errors.push(`${where}: available-from (${from}) is after available-to (${to}).`);
  });
  return errors;
}

/** Hard errors block a save; everything else is a warning shown but non-blocking
 *  (per the brief: block only on empty/duplicate ids). */
export function hardErrors(d: StoreStagingDraft): string[] {
  return validateStoreDraft(d).filter((e) => /: id is required| duplicate id /.test(e));
}

// ---- DOM layer -------------------------------------------------------------

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}

let draft: StoreStagingDraft = defaultDraft();
let mountApp: HTMLElement;
let mountBack: () => void;
let statusMsg = '';

function ensureStyle(): void {
  if (document.getElementById('ssg-style')) return;
  const style = document.createElement('style');
  style.id = 'ssg-style';
  style.textContent = `
  .ssg-badge{display:inline-block;background:#b00020;color:#fff;font-weight:700;letter-spacing:.05em;
    padding:4px 10px;border-radius:6px;font-size:12px;margin-left:8px;vertical-align:middle}
  .ssg-item{border:1px solid rgba(128,128,128,.35);border-radius:10px;padding:12px;margin:12px 0}
  .ssg-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
  .ssg-ord{opacity:.7;font-weight:700}
  .ssg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}
  .ssg-lbl{display:flex;flex-direction:column;font-size:12px;gap:2px}
  .ssg-lbl>input,.ssg-lbl>select,.ssg-lbl>textarea{font:inherit;padding:4px}
  .ssg-check{display:inline-flex;align-items:center;gap:4px;font-size:12px}
  .ssg-errs{border:1px solid #b00020;background:rgba(176,0,32,.08);border-radius:8px;padding:8px 12px;margin:8px 0}
  .ssg-errs li{color:#b00020}
  .ssg-ok{color:#1a7f37}
  .ssg-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
  .ssg-card{border:1px solid rgba(128,128,128,.35);border-radius:12px;padding:10px;position:relative}
  .ssg-card img{width:100%;height:120px;object-fit:cover;border-radius:8px;background:rgba(128,128,128,.15)}
  .ssg-card h4{margin:8px 0 4px}
  .ssg-cat{display:inline-block;font-size:11px;padding:2px 6px;border-radius:6px;background:rgba(60,134,226,.18)}
  .ssg-rar{display:inline-block;font-size:11px;padding:2px 6px;border-radius:6px}
  .ssg-rar.common{background:rgba(128,128,128,.2)}
  .ssg-rar.rare{background:rgba(60,134,226,.2)}
  .ssg-rar.special{background:rgba(245,197,66,.28)}
  .ssg-price{font-weight:700;margin-top:4px}
  .ssg-star{position:absolute;top:8px;right:10px;font-size:18px}
  .ssg-avail{font-size:11px;opacity:.75;margin-top:4px}
  .ssg-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
  `;
  document.head.appendChild(style);
}

function optionsHtml(items: LibItem[], current: string): string {
  const known = items.some((i) => i.value === current);
  const extra =
    current && !known ? `<option value="${escAttr(current)}" selected>${esc(current)} (current)</option>` : '';
  return (
    extra +
    items
      .map(
        (i) =>
          `<option value="${escAttr(i.value)}"${i.value === current ? ' selected' : ''}>${esc(i.label)}</option>`
      )
      .join('')
  );
}

function selectHtml(values: readonly string[], current: string): string {
  return values
    .map((v) => `<option value="${escAttr(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`)
    .join('');
}

function itemRowHtml(idx: number, total: number): string {
  const it = draft.items[idx];
  return `<div class="ssg-item" data-idx="${idx}">
    <div class="ssg-head">
      <span class="ssg-ord">#${idx + 1}</span>
      <button class="btn" data-action="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn" data-action="down" data-idx="${idx}" ${idx === total - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn" data-action="duplicate" data-idx="${idx}">⧉ Duplicate</button>
      <button class="btn back" data-action="remove" data-idx="${idx}">✕ Remove</button>
    </div>
    <div class="ssg-grid">
      <label class="ssg-lbl">Id<input type="text" data-field="id" data-idx="${idx}" value="${escAttr(it.id)}"/></label>
      <label class="ssg-lbl">Name<input type="text" data-field="name" data-idx="${idx}" value="${escAttr(it.name)}"/></label>
      <label class="ssg-lbl">Category<select data-field="category" data-idx="${idx}">${selectHtml(STORE_KINDS, it.category)}</select></label>
      <label class="ssg-lbl">Rarity<select data-field="rarity" data-idx="${idx}">${selectHtml(RARITIES, it.rarity)}</select></label>
      <label class="ssg-lbl">Price<input type="number" min="0" step="1" data-field="price" data-idx="${idx}" value="${escAttr(String(it.price))}"/></label>
      <label class="ssg-lbl">Currency<select data-field="currency" data-idx="${idx}">${selectHtml(CURRENCIES, it.currency)}</select></label>
      <label class="ssg-lbl">Image<select data-field="image" data-idx="${idx}">${optionsHtml(IMAGE_LIBRARY, it.image)}</select></label>
      <label class="ssg-lbl">Sort order<input type="number" step="1" data-field="sortOrder" data-idx="${idx}" value="${escAttr(String(it.sortOrder))}"/></label>
      <label class="ssg-lbl">Available from<input type="date" data-field="availableFrom" data-idx="${idx}" value="${escAttr(it.availableFrom)}"/></label>
      <label class="ssg-lbl">Available to<input type="date" data-field="availableTo" data-idx="${idx}" value="${escAttr(it.availableTo)}"/></label>
      <label class="ssg-lbl">Description<textarea data-field="description" data-idx="${idx}" rows="2">${esc(it.description)}</textarea></label>
      <label class="ssg-check"><input type="checkbox" data-field="featured" data-idx="${idx}" ${it.featured ? 'checked' : ''}/> Featured</label>
    </div>
  </div>`;
}

function priceLabel(it: FutureStoreItem): string {
  if (it.currency === 'usd') return `$${(Number(it.price) || 0).toFixed(2)}`;
  return `${Number(it.price) || 0} coins`;
}

function availLabel(it: FutureStoreItem): string {
  if (it.availableFrom && it.availableTo) return `${esc(it.availableFrom)} → ${esc(it.availableTo)}`;
  if (it.availableFrom) return `from ${esc(it.availableFrom)}`;
  if (it.availableTo) return `until ${esc(it.availableTo)}`;
  return 'no window set';
}

function cardHtml(it: FutureStoreItem): string {
  const rar = RARITIES.includes(it.rarity) ? it.rarity : 'common';
  return `<div class="ssg-card">
    ${it.featured ? '<span class="ssg-star" title="Featured">★</span>' : ''}
    <img src="${escAttr(it.image)}" alt="${escAttr(it.name)}"/>
    <h4>${esc(it.name || '(unnamed)')}</h4>
    <div><span class="ssg-cat">${esc(it.category)}</span> <span class="ssg-rar ${rar}">${esc(rar)}</span></div>
    <div class="ssg-price">${esc(priceLabel(it))}</div>
    <div class="ssg-avail">${availLabel(it)}</div>
  </div>`;
}

function previewHtml(): string {
  const sorted = [...draft.items].sort((a, b) => a.sortOrder - b.sortOrder);
  return `<section><h2>Preview <span class="ssg-badge">DRAFT / NOT LIVE</span></h2>
    <p class="sub">Read-only mock of the store cards. There is no buy or activate action here.</p>
    <div class="ssg-cards">${sorted.map(cardHtml).join('')}</div>
  </section>`;
}

function errorsHtml(): string {
  const errs = validateStoreDraft(draft);
  if (errs.length === 0) return `<p class="sub ssg-ok">✓ No validation issues.</p>`;
  const hard = new Set(hardErrors(draft));
  return `<div class="ssg-errs"><b>${errs.length} issue(s):</b><ul>${errs
    .map((e) => `<li>${esc(e)}${hard.has(e) ? ' <b>(blocks save)</b>' : ''}</li>`)
    .join('')}</ul></div>`;
}

function paint(): void {
  ensureStyle();
  const total = draft.items.length;
  mountApp.innerHTML = `<div id="ssg">
    <button class="btn back" data-action="back">← Back</button>
    <h1>🛒 Future Store Items <span class="ssg-badge">DRAFT / NOT LIVE</span></h1>
    <p class="sub">Staging area for upcoming store items. Nothing here is purchasable, activatable, or wired
      to the live store — it only drafts <code>/adminDrafts/futureStoreItems</code>.</p>
    <p class="sub" id="ssg-load-status">${esc(statusMsg)}</p>
    <section>
      <div class="ssg-head">
        <button class="btn" data-action="add">＋ Add item</button>
        <button class="btn" data-action="validate">✔ Validate</button>
        <button class="btn" data-action="save">💾 Save draft</button>
      </div>
      <div id="ssg-errbox">${errorsHtml()}</div>
      <p class="sub" id="ssg-save-status"></p>
    </section>
    <section><h2>Items (${total})</h2>
      ${draft.items.map((_, i) => itemRowHtml(i, total)).join('')}
    </section>
    ${previewHtml()}
  </div>`;

  const root = document.getElementById('ssg')!;
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
}

function refreshValidation(): void {
  const box = document.getElementById('ssg-errbox');
  if (box) box.innerHTML = errorsHtml();
}

/** Apply an edit to draft.items[idx][field] from an input/select/textarea. */
function applyEdit(t: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
  const field = t.dataset.field;
  if (!field) return;
  const idx = Number(t.dataset.idx);
  const it = draft.items[idx];
  if (!it) return;
  const rec = it as unknown as Record<string, unknown>;
  if (field === 'featured') {
    rec[field] = (t as HTMLInputElement).checked;
  } else if (field === 'price' || field === 'sortOrder') {
    const n = Number(t.value);
    rec[field] = Number.isFinite(n) ? n : t.value === '' ? 0 : NaN;
  } else {
    rec[field] = t.value;
  }
}

function onInput(e: Event): void {
  const t = e.target as HTMLInputElement | HTMLTextAreaElement;
  if (!t.dataset || !t.dataset.field) return;
  applyEdit(t);
  refreshValidation();
}

function onChange(e: Event): void {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  if (!t.dataset || !t.dataset.field) return;
  applyEdit(t);
  // Selects/checkboxes/dates + preview all re-render on structural clarity.
  paint();
}

function onClick(e: Event): void {
  const el = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!el) return;
  const action = el.dataset.action;
  const idx = Number(el.dataset.idx);
  switch (action) {
    case 'back':
      mountBack();
      break;
    case 'add':
      draft.items.push(newItem(draft.items.length));
      paint();
      break;
    case 'remove':
      draft.items.splice(idx, 1);
      draft.items.forEach((it, i) => (it.sortOrder = i));
      if (draft.items.length === 0) draft.items.push(newItem(0));
      paint();
      break;
    case 'duplicate': {
      const copy = duplicateItem(draft.items[idx]);
      copy.sortOrder = draft.items.length;
      draft.items.splice(idx + 1, 0, copy);
      draft.items.forEach((it, i) => (it.sortOrder = i));
      paint();
      break;
    }
    case 'up':
      reorder(draft.items, idx, -1);
      paint();
      break;
    case 'down':
      reorder(draft.items, idx, 1);
      paint();
      break;
    case 'validate':
      refreshValidation();
      break;
    case 'save':
      void doSave();
      break;
    default:
      break;
  }
}

/** The draft as persisted: normalized (typed fields, contiguous sortOrder). */
function publishableDraft(): StoreStagingDraft {
  return { ...normalize(draft), savedAt: Date.now() };
}

async function doSave(): Promise<void> {
  const status = document.getElementById('ssg-save-status');
  refreshValidation();
  const blocking = hardErrors(draft);
  if (blocking.length > 0) {
    if (status) status.textContent = `⛔ Fix ${blocking.length} blocking issue(s) (empty/duplicate ids) before saving.`;
    return;
  }
  if (status) status.textContent = 'Saving…';
  const res = await saveAdminDraft(DRAFT_KEY, publishableDraft());
  if (res.status === 'saved') draft = normalize(draft); // re-base sortOrder to match what was stored
  if (status) status.textContent = draftStatusMessage(res, 'Save');
}

/**
 * Render entry — the admin landing calls this. Loads the existing draft (or a
 * fresh default), surfaces load status (including denied/offline, while still
 * allowing local editing), and paints the editor.
 */
export async function renderStoreStaging(app: HTMLElement, onBack: () => void): Promise<void> {
  mountApp = app;
  mountBack = onBack;
  app.innerHTML = `<p class="sub">Loading future store items draft…</p>`;

  const { value, status } = await loadAdminDraft<StoreStagingDraft>(DRAFT_KEY);
  if (status === 'saved') {
    if (value && Array.isArray(value.items) && value.items.length > 0) {
      draft = normalize(value);
      statusMsg = `Loaded a saved draft (${draft.items.length} item(s)).`;
    } else {
      draft = defaultDraft();
      statusMsg = 'No draft yet — starting a fresh one.';
    }
  } else {
    // denied / offline / skipped — surface it, but still allow local editing.
    draft = defaultDraft();
    statusMsg = `${draftStatusMessage({ status }, 'Load')} You can still edit locally; saving will report the same status.`;
  }
  paint();
}
