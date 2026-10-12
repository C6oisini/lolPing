import { BrowserWindow, ipcMain, screen } from 'electron';
import type { PickContext, PickRect, PickResult } from '../shared/askAi';
import type { Lang } from '../shared/i18n';
import { PICK_CH } from '../shared/pickChannels';
import { loadPage, preloadPath } from './paths';
import { previewOf, type Capture } from './screenshot';

let win: BrowserWindow | null = null;
let context: PickContext | null = null;
let settle: ((result: PickResult) => void) | null = null;
/** Resolves when the renderer says the picture it was just handed is on screen. */
let painted: (() => void) | null = null;
/** The page is loaded once and kept, hidden, for the rest of the session: showing the picker has to be immediate,
 *  because any click that lands before it is up is simply lost. */
let loaded: Promise<void> | null = null;

/** How long to wait for the renderer's ready before showing anyway. Missing it must not leave a hidden window. */
const READY_TIMEOUT_MS = 400;

function createWindow(): BrowserWindow {
  const bounds = screen.getPrimaryDisplay().bounds;
  const w = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    enableLargerThanScreen: true, // mixed-DPI setups can size the first frame wrong without it
    show: false,
    title: 'lolPing · select',
    webPreferences: { preload: preloadPath('pick'), spellcheck: false, backgroundThrottling: false },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.on('closed', () => {
    win = null;
    loaded = null;
    settle?.({ kind: 'cancelled' });
  });
  return w;
}

/** The picker window, created and loading on first use and reused (hidden) afterwards. */
function ensureWindow(): { window: BrowserWindow; page: Promise<void> } {
  if (!win || win.isDestroyed()) win = createWindow();
  const w = win;
  if (!loaded) {
    loaded = new Promise<void>((resolve) => {
      if (!w.webContents.isLoading()) resolve();
      else w.webContents.once('did-finish-load', () => resolve());
    });
    void loadPage(w, 'pick');
  }
  return { window: w, page: loaded };
}

/**
 * Shows the frozen-screen picker over `displayId` and resolves with the dragged box, `rect: null` for the whole display
 * (a plain click or Enter), or `cancelled` when the user backs out (Esc, a closed window).
 */
export async function pickRegion(displayId: number, capture: Capture, lang: Lang): Promise<PickResult> {
  // Only one picker at a time: a gesture that somehow arrives while one is up drops the older one rather than leaving
  // its caller waiting forever.
  settle?.({ kind: 'cancelled' });
  const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
  context = { lang, image: previewOf(capture) };
  const { window: w, page } = ensureWindow();
  await page;
  // Hand the picture over first, show the window only once the renderer has painted it: a reused window would otherwise
  // flash the previous screenshot, and a fresh one an empty frame.
  const isPainted = new Promise<void>((resolve) => {
    painted = resolve;
  });
  w.webContents.send(PICK_CH.context, context);
  await Promise.race([isPainted, new Promise<void>((resolve) => setTimeout(resolve, READY_TIMEOUT_MS))]);
  painted = null;
  if (w.isDestroyed()) return { kind: 'cancelled' };
  w.setBounds(display.bounds); // the display this gesture happened on, in its CSS pixels
  w.show();
  w.focus();
  return new Promise<PickResult>((resolve) => {
    let done = false;
    settle = (result) => {
      if (done) return;
      done = true;
      settle = null;
      context = null;
      if (!w.isDestroyed()) w.hide(); // kept alive: the next pick has to open instantly
      resolve(result);
    };
  });
}

/** Closes the picker for good (the app is going away). */
export function destroyPickWindow(): void {
  const w = win;
  win = null;
  loaded = null;
  context = null;
  settle = null;
  painted = null;
  if (w && !w.isDestroyed()) w.destroy();
}

/**
 * Starts creating and loading the picker page, hidden, while something else happens (the capture). The window is kept
 * afterwards, so only the first pick of a session pays for it — and even that one overlaps with the screenshot.
 */
export function warmPickWindow(): void {
  if (win && !win.isDestroyed()) return;
  ensureWindow();
}

export function installPickIpc(): void {
  ipcMain.on(PICK_CH.ready, () => painted?.());
  ipcMain.handle(PICK_CH.done, (_e, raw: unknown) => {
    const rect = raw as PickRect | null;
    const isRect = rect !== null && typeof rect === 'object'
      && [rect.x, rect.y, rect.width, rect.height].every((v) => typeof v === 'number' && Number.isFinite(v));
    settle?.({ kind: 'area', rect: isRect ? (rect as PickRect) : null });
  });
  ipcMain.handle(PICK_CH.cancel, () => settle?.({ kind: 'cancelled' }));
}
