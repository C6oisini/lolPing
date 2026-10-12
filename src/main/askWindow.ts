import { BrowserWindow, clipboard, ipcMain, screen, type Display } from 'electron';
import { ASK_CH } from '../shared/askChannels';
import { askDefaultPrompt, type AskChunk, type AskContext, type AskImage, type AskState } from '../shared/askAi';
import type { Lang } from '../shared/i18n';
import { AskCancelled, AskTimeout, streamAsk } from './askAi';
import { loadPage, pageUrl, preloadPath } from './paths';
import type { SettingsStore } from './settingsStore';

export interface AskDeps {
  store: SettingsStore;
  /** Opens Settings on the Ask AI section: what the window offers when no API key is set. */
  openSettings(): void;
  /**
   * Suspends the input helper while the question is open, so the wheel can't open over the game (or a ping land
   * somewhere) while the user is typing.
   */
  setAsking(on: boolean): void;
}

let deps: AskDeps | null = null;
let win: BrowserWindow | null = null;
let context: AskContext | null = null;
let state: AskState = { status: 'idle' };
/** The answer in flight, if any. */
let running: AbortController | null = null;

/** The ask window, if one is open and alive. */
export function askWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

const send = (channel: string, payload: unknown): void => {
  const w = askWindow();
  if (w && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
};

function setState(next: AskState): void {
  state = next;
  send(ASK_CH.state, next);
}

function stopAnswer(): void {
  if (!running) return;
  running.abort();
  running = null;
}

/** The window is only ever the ask page: it can copy through its preload, so nothing else may load into it. */
function isAskPage(url: string): boolean {
  try {
    const target = new URL(url);
    const own = new URL(pageUrl('ask'));
    return target.protocol === own.protocol && target.host === own.host && target.pathname === own.pathname;
  } catch {
    return false;
  }
}

/** Where to put the card: centred on the display the gesture happened on, a little above the middle. */
function placeOn(display: Display): { x: number; y: number; width: number; height: number } {
  const width = Math.max(420, Math.min(680, display.bounds.width - 80));
  const height = Math.max(320, Math.min(540, display.bounds.height - 80));
  return {
    width,
    height,
    x: Math.round(display.bounds.x + (display.bounds.width - width) / 2),
    y: Math.round(display.bounds.y + (display.bounds.height - height) / 3),
  };
}

/**
 * Opens the question window on `displayId` (centred there), showing `image` as the screenshot it is asking about.
 * A window that is already open just takes the new screenshot and comes to the front.
 */
export function openAskWindow(opts: { displayId: number; image: AskImage | null; imageFailed: boolean; lang: Lang }): void {
  if (!deps) return;
  const display = screen.getAllDisplays().find((d) => d.id === opts.displayId) ?? screen.getPrimaryDisplay();
  const s = deps.store.get();
  context = {
    lang: opts.lang,
    model: s.askAiModel,
    hasKey: s.askAiKey.length > 0,
    image: opts.image,
    imageFailed: opts.imageFailed,
  };
  const existing = askWindow();
  if (existing) {
    existing.setBounds(placeOn(display));
    stopAnswer();
    setState({ status: 'idle' });
    send(ASK_CH.context, context);
    existing.show();
    existing.focus();
    return;
  }
  const w = new BrowserWindow({
    ...placeOn(display),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: 'lolPing · Ask AI',
    webPreferences: {
      preload: preloadPath('ask'),
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.webContents.on('will-navigate', (event) => {
    if (!isAskPage(event.url)) event.preventDefault();
  });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.on('closed', () => {
    win = null;
    stopAnswer();
    state = { status: 'idle' };
    deps?.setAsking(false);
  });
  w.once('ready-to-show', () => {
    w.show();
    w.focus();
  });
  win = w;
  deps.setAsking(true);
  void loadPage(w, 'ask');
}

export function closeAskWindow(): void {
  const w = askWindow();
  if (w) w.close();
  else stopAnswer();
}

/** Closes the window without the close handler's work (the app is going away). */
export function destroyAskWindow(): void {
  stopAnswer();
  const w = askWindow();
  win = null;
  if (w) w.destroy();
}

/** Asks about the current screenshot. An empty question is filled in by the window before it gets here. */
async function submit(question: string): Promise<void> {
  if (!deps || !context || !askWindow()) return;
  const s = deps.store.get();
  if (!s.askAiKey) {
    setState({ status: 'error', error: 'nokey' });
    return;
  }
  stopAnswer();
  const ctrl = new AbortController();
  running = ctrl;
  setState({ status: 'streaming' });
  try {
    await streamAsk({
      apiKey: s.askAiKey,
      baseUrl: s.askAiBaseUrl,
      model: s.askAiModel,
      system: s.askAiPrompt || askDefaultPrompt(context.lang),
      question,
      image: context.image?.dataUrl ?? null,
      onChunk: (c: AskChunk) => {
        if (running === ctrl) send(ASK_CH.delta, c);
      },
      signal: ctrl.signal,
    });
    if (running === ctrl) setState({ status: 'done' });
  } catch (err) {
    if (running !== ctrl) return; // replaced or cancelled: its own state already won
    if (err instanceof AskCancelled) setState({ status: 'idle' });
    else if (err instanceof AskTimeout) setState({ status: 'error', error: 'timeout' });
    else setState({ status: 'error', error: (err as Error).message });
  } finally {
    if (running === ctrl) running = null;
  }
}

export function installAskIpc(d: AskDeps): void {
  deps = d;
  ipcMain.handle(ASK_CH.context, () => context);
  ipcMain.handle(ASK_CH.submit, (_e, raw: unknown) => submit(typeof raw === 'string' ? raw.slice(0, 4000) : ''));
  ipcMain.handle(ASK_CH.cancel, () => {
    stopAnswer();
    setState({ status: 'idle' });
  });
  ipcMain.handle(ASK_CH.close, () => closeAskWindow());
  ipcMain.handle(ASK_CH.copy, (_e, raw: unknown) => {
    if (typeof raw === 'string' && raw.length > 0) void clipboard.writeText(raw.slice(0, 100_000)).catch(() => undefined);
  });
  ipcMain.handle(ASK_CH.openSettings, () => deps?.openSettings());
}
