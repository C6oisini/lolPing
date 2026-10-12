import { BrowserWindow, ipcMain, screen } from 'electron';
import type { PickContext, PickRect, PickResult } from '../shared/askAi';
import type { Lang } from '../shared/i18n';
import { PICK_CH } from '../shared/pickChannels';
import { loadPage, preloadPath } from './paths';
import { previewOf, type Capture } from './screenshot';

let win: BrowserWindow | null = null;
let context: PickContext | null = null;
let settle: ((result: PickResult) => void) | null = null;

/**
 * Opens the frozen-screen picker over `displayId` and resolves with the dragged box, `rect: null` for the whole display
 * (a plain click or Enter), or `cancelled` when the user backs out (Esc, a closed window).
 */
export function pickRegion(displayId: number, capture: Capture, lang: Lang): Promise<PickResult> {
  const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
  context = { lang, image: previewOf(capture) };
  return new Promise((resolve) => {
    let done = false;
    settle = (result) => {
      if (done) return;
      done = true;
      settle = null;
      context = null;
      const w = win;
      win = null;
      if (w && !w.isDestroyed()) w.destroy();
      resolve(result);
    };
    const w = new BrowserWindow({
      ...display.bounds, // exactly that display, in its CSS pixels: the space the selection is reported in
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
    w.on('closed', () => settle?.({ kind: 'cancelled' }));
    w.once('ready-to-show', () => {
      w.show();
      w.focus();
      w.setBounds(display.bounds); // re-apply, as the overlay manager does
    });
    win = w;
    void loadPage(w, 'pick');
  });
}

/** Closes the picker without its close handler's work (the app is going away). */
export function destroyPickWindow(): void {
  const w = win;
  win = null;
  context = null;
  settle = null;
  if (w && !w.isDestroyed()) w.destroy();
}

export function installPickIpc(): void {
  ipcMain.handle(PICK_CH.context, (): PickContext | null => context);
  ipcMain.handle(PICK_CH.done, (_e, raw: unknown) => {
    const rect = raw as PickRect | null;
    const isRect = rect !== null && typeof rect === 'object'
      && [rect.x, rect.y, rect.width, rect.height].every((v) => typeof v === 'number' && Number.isFinite(v));
    settle?.({ kind: 'area', rect: isRect ? (rect as PickRect) : null });
  });
  ipcMain.handle(PICK_CH.cancel, () => settle?.({ kind: 'cancelled' }));
}
