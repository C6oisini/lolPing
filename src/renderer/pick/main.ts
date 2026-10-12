import type { PickContext, PickRect } from '../../shared/askAi';
import { strings } from '../../shared/i18n';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const shot = el<HTMLImageElement>('shot');
const shotBright = el<HTMLImageElement>('shotBright');
const bright = el('bright');
const box = el('box');
const sizeLabel = el('size');
const hint = el('hint');

/** A drag shorter than this is a click: the whole display is what the user wants. Matches MIN_SELECTION_PX in main. */
const MIN_PX = 12;

let ctx: PickContext;
let from: { x: number; y: number } | null = null;
let rect: PickRect | null = null;
let sent = false;

/** The selection as a rectangle, normalised so a drag in any direction gives x/y as its top-left. */
function rectOf(a: { x: number; y: number }, b: { x: number; y: number }): PickRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

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

function point(e: MouseEvent): { x: number; y: number } {
  return { x: e.clientX, y: e.clientY };
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) {
    cancel(); // a right-click backs out, as it does in the rest of the app
    return;
  }
  from = point(e);
  rect = null;
  paint();
});
window.addEventListener('mousemove', (e) => {
  if (!from) return;
  rect = rectOf(from, point(e));
  paint();
});
window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !from) return;
  const box = rectOf(from, point(e));
  from = null;
  rect = box;
  paint();
  // A click, or a box too small to be meant, sends the whole display.
  finish(box.width < MIN_PX || box.height < MIN_PX ? null : box);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cancel();
  else if (e.key === 'Enter') finish(rect && rect.width >= MIN_PX && rect.height >= MIN_PX ? rect : null);
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

void window.pickApi.getContext().then((c) => {
  ctx = c;
  const t = strings(c.lang);
  document.documentElement.lang = t.lang;
  shot.src = c.image.dataUrl;
  shotBright.src = c.image.dataUrl;
  hint.textContent = t.askPickHint;
  paint();
});
