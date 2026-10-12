import type { PickContext, PickRect } from '../../shared/askAi';
import { strings } from '../../shared/i18n';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const shot = el<HTMLImageElement>('shot');
const shotBright = el<HTMLImageElement>('shotBright');
const bright = el('bright');
const box = el('box');
const sizeLabel = el('size');
const hint = el('hint');

/** A drag shorter than this in both directions is a click: the whole display is what the user wants. */
const MIN_PX = 12;
/** How far the pointer has to move before this counts as a drag rather than a click. */
const DRAG_PX = 3;

let from: { x: number; y: number } | null = null;
let dragging = false;
let rect: PickRect | null = null;
let sent = false;

/** The selection as a rectangle, normalised so a drag in any direction gives x/y as its top-left. */
function rectOf(a: { x: number; y: number }, b: { x: number; y: number }): PickRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** A thin strip is a deliberate selection (a health bar, a tooltip): either direction is enough. */
const isSelection = (r: PickRect | null): r is PickRect => r !== null && (r.width >= MIN_PX || r.height >= MIN_PX);

function paint(): void {
  if (!rect || rect.width < 1 || rect.height < 1) {
    box.hidden = true;
    sizeLabel.hidden = true;
    bright.style.clipPath = 'inset(100% 0 0 0)';
    return;
  }
  const { x, y, width, height } = rect;
  box.hidden = false;
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
  // The clip is in this window's CSS pixels, which are the display's, not the (possibly downscaled) preview's.
  bright.style.clipPath = `inset(${y}px ${Math.max(0, window.innerWidth - x - width)}px ${Math.max(0, window.innerHeight - y - height)}px ${x}px)`;
  sizeLabel.hidden = false;
  sizeLabel.textContent = `${Math.round(width)} × ${Math.round(height)}`;
  // Keep the badge inside the display, and out of the way of the cursor.
  const below = y + height + 26 < window.innerHeight;
  sizeLabel.style.left = `${Math.min(window.innerWidth - 90, Math.max(4, x))}px`;
  sizeLabel.style.top = `${below ? y + height + 6 : Math.max(4, y - 26)}px`;
}

function finish(result: PickRect | null): void {
  if (sent) return;
  sent = true;
  void window.pickApi.done(result);
}

function cancel(): void {
  if (sent) return;
  sent = true;
  void window.pickApi.cancel();
}

const point = (e: MouseEvent): { x: number; y: number } => ({ x: e.clientX, y: e.clientY });

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) {
    cancel(); // a right-click backs out, as it does in the rest of the app
    return;
  }
  from = point(e);
  dragging = false; // the box drawn last time stays until this drag makes a new one
});
window.addEventListener('mousemove', (e) => {
  if (!from) return;
  const next = rectOf(from, point(e));
  if (!dragging && next.width < DRAG_PX && next.height < DRAG_PX) return;
  dragging = true;
  rect = next;
  paint();
});
window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !from) return;
  const box = rectOf(from, point(e));
  from = null;
  if (dragging && isSelection(box)) {
    rect = box;
    paint();
    finish(box);
    return;
  }
  // A click — often a second click to confirm what was just drawn — sends the box already selected, and only sends the
  // whole display when nothing has been selected at all.
  dragging = false;
  finish(isSelection(rect) ? rect : null);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cancel();
  else if (e.key === 'Enter') finish(isSelection(rect) ? rect : null);
});
// Nothing in this window is draggable: a native drag would take the mouse and the selection would never see its mouseup.
window.addEventListener('dragstart', (e) => e.preventDefault());
window.addEventListener('contextmenu', (e) => e.preventDefault());

window.pickApi.onContext(async (c: PickContext) => {
  const t = strings(c.lang);
  document.documentElement.lang = t.lang;
  hint.textContent = t.askPickHint;
  // A fresh picture for a fresh pick: no box, no "already answered" flag from the last one.
  from = null;
  dragging = false;
  rect = null;
  sent = false;
  paint();
  shot.src = c.image.dataUrl;
  shotBright.src = c.image.dataUrl;
  await Promise.all([shot.decode().catch(() => undefined), shotBright.decode().catch(() => undefined)]);
  window.pickApi.ready();
});
