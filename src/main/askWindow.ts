import { BrowserWindow, clipboard, ipcMain, screen, type Display } from 'electron';
import { join } from 'node:path';
import { ASK_CH } from '../shared/askChannels';
import {
  askDefaultPrompt,
  type AskAttach,
  type AskChunk,
  type AskContext,
  type AskImage,
  type AskState,
  type AskTurn,
  type StoredConversation,
} from '../shared/askAi';
import type { Lang } from '../shared/i18n';
import { AskCancelled, AskTimeout, streamAsk } from './askAi';
import { ConversationStore, isConversationId, newConversationId } from './conversationStore';
import { loadPage, pageUrl, preloadPath, settingsDir } from './paths';
import { storedPreviewOf } from './screenshot';
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
  /**
   * A new screenshot for the question being typed, taken by the main process (which owns the capture and the region
   * picker) with this window taken off the screen first, so the picture is of what the user was looking at.
   */
  captureForAsk(): Promise<AskAttach>;
}

let deps: AskDeps | null = null;
let win: BrowserWindow | null = null;
let context: AskContext | null = null;
let state: AskState = { status: 'idle' };
/** What has been asked and answered about this screenshot: a new screenshot starts a new conversation. */
let history: AskTurn[] = [];
/** Which saved conversation this window is showing. A new screenshot or "New chat" starts another one. */
let conversationId: string | null = null;
/** A small copy of the screenshot, for the saved conversation only: the full picture is never written down. */
let preview: AskImage | null = null;
/** The screenshot the next question will be asked about, if the user has taken a new one. */
let staged: AskImage | null = null;
/** The answer in flight, if any. */
let running: AbortController | null = null;

/** The saved conversations, opened on first use. */
let store: ConversationStore | null = null;
const conversations = (): ConversationStore => (store ??= new ConversationStore(join(settingsDir(), 'conversations')));

/** The small copy kept with a saved conversation, made once per picture: the full screenshot is never written down. */
const smallCopies = new WeakMap<AskImage, AskImage>();
function smallCopy(image: AskImage): AskImage {
  let small = smallCopies.get(image);
  if (!small) {
    small = storedPreviewOf(image);
    smallCopies.set(image, small);
  }
  return small;
}

/** Saves what has been said so far, when the user keeps a history. Called after every turn, so the window closing
 *  (or the app being killed) cannot lose the conversation. */
function remember(): void {
  const s = deps?.store.get();
  if (!s?.askAiKeepHistory || !conversationId || !context || history.length === 0) return;
  const firstQuestion = history.find((t) => t.role === 'user');
  void conversations().save({
    id: conversationId,
    at: Date.now(),
    title: firstQuestion?.text ?? '',
    image: preview,
    turns: history.map((t) => ({ ...t, image: t.image ? smallCopy(t.image) : null })),
  });
}

/**
 * The turns of a saved conversation, with the conversation's own screenshot put back where it belongs. Conversations
 * saved before a question could carry its own picture held one image for the whole chat: that was the first
 * question's, so it goes back on the first question.
 */
function turnsOf(stored: StoredConversation): AskTurn[] {
  const turns = stored.turns;
  if (!stored.image || turns.some((t) => t.image)) return turns;
  const first = turns.findIndex((t) => t.role === 'user');
  return first < 0 ? turns : turns.map((t, i) => (i === first ? { ...t, image: stored.image } : t));
}

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

/** Where to put the card: centred on the display the gesture happened on, a little above the middle, at the size the
 *  question window was last dragged to (clamped to the display, so a size from a bigger screen still fits). */
function placeOn(display: Display): { x: number; y: number; width: number; height: number } {
  const s = deps?.store.get();
  const width = Math.min(s?.askAiWindowWidth ?? 680, display.bounds.width - 40);
  const height = Math.min(s?.askAiWindowHeight ?? 540, display.bounds.height - 40);
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
export function openAskWindow(opts: { displayId: number; image: AskImage | null; preview: AskImage | null; imageFailed: boolean; lang: Lang }): void {
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
  // A screenshot is a new question about a new moment, so it starts a new conversation — whether the window is being
  // created or reused. Without this, a conversation left over from a window the user closed would be sent again with
  // the new picture, which is both confusing for the model and a needless repeat of what was said before.
  history = [];
  preview = opts.preview;
  // The first question is asked about the screenshot the slice just took; a later one can bring its own.
  staged = opts.image;
  conversationId = newConversationId();
  const existing = askWindow();
  if (existing) {
    // Re-centre it on the display, but keep whatever size the user has dragged it to: the size is theirs, the place ours.
    const current = existing.getBounds();
    const placed = placeOn(display);
    existing.setBounds({
      ...placed,
      width: Math.min(current.width, display.bounds.width - 40),
      height: Math.min(current.height, display.bounds.height - 40),
    });
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
    // The card is resized by dragging its edges and corners. A frameless window still gets the frame's resize border
    // from Windows (`thickFrame` is on by default), which is what makes those drags land on the window frame at all.
    // The floors are the size at which the card's own layout still works; the settings clamp to the same numbers.
    resizable: true,
    minWidth: 360,
    minHeight: 300,
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
  // Remember the size the card was left at, so the next question opens at that size. Saved when the window closes
  // rather than on every resize event: a drag emits a stream of them, and each save rewrites the settings file.
  w.on('close', () => {
    const { width, height } = w.getBounds();
    const s = deps?.store.get();
    if (s && (s.askAiWindowWidth !== width || s.askAiWindowHeight !== height)) {
      void deps?.store.update({ askAiWindowWidth: width, askAiWindowHeight: height });
    }
  });
  w.on('closed', () => {
    win = null;
    stopAnswer();
    // The conversation lived in this window: closing it drops what was said rather than keeping it for the next one.
    history = [];
    staged = null;
    context = null;
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

/** Asks about the current screenshot, following on from the exchanges already made. An empty question is filled in by the window. */
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
  const asked = history;
  /** The picture this question comes with: the slice's own screenshot, or one taken into the conversation since. */
  const about = staged;
  let answer = '';
  setState({ status: 'streaming' });
  try {
    await streamAsk({
      apiKey: s.askAiKey,
      baseUrl: s.askAiBaseUrl,
      model: s.askAiModel,
      system: s.askAiPrompt || askDefaultPrompt(context.lang),
      history: asked,
      question,
      image: about?.dataUrl ?? null,
      onChunk: (c: AskChunk) => {
        if (c.kind === 'answer') answer += c.text;
        if (running === ctrl) send(ASK_CH.delta, c);
      },
      signal: ctrl.signal,
    });
    if (running === ctrl) {
      // What the model is told matches what the window shows, so a follow-up has the same context the user can read.
      // The picture stays on the turn that was asked about it: the next question is its own, unless one is taken.
      history = [...asked, { role: 'user', text: question, image: about }, { role: 'assistant', text: answer }];
      staged = null;
      setState({ status: 'done' });
      remember();
    }
  } catch (err) {
    if (running !== ctrl) return; // replaced or cancelled: its own state already won
    if (err instanceof AskCancelled) {
      // A stopped answer is kept in the transcript and in the context: the next question builds on what was said.
      if (answer.length > 0) {
        history = [...asked, { role: 'user', text: question, image: about }, { role: 'assistant', text: answer }];
        staged = null;
        remember();
      }
      setState({ status: 'idle' });
    } else if (err instanceof AskTimeout) {
      setState({ status: 'error', error: 'timeout' });
    } else {
      setState({ status: 'error', error: (err as Error).message });
    }
  } finally {
    if (running === ctrl) running = null;
  }
}

/**
 * Opens a saved conversation in this window. The turns come back, and with them the small copy of the screenshot it
 * was about, so a follow-up is asked about the same thing the first question was.
 */
async function openStored(rawId: unknown): Promise<void> {
  if (!isConversationId(rawId) || !context || !askWindow()) return;
  const stored = await conversations().load(rawId);
  if (!stored || !context || !askWindow()) return;
  stopAnswer();
  conversationId = stored.id;
  history = turnsOf(stored);
  preview = stored.image;
  // Nothing is attached to the next question yet: what the conversation was about is already on its turns.
  staged = null;
  context = { ...context, image: stored.image, imageFailed: false };
  setState({ status: 'idle' });
  send(ASK_CH.context, context);
  send(ASK_CH.restore, history);
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
  ipcMain.handle(ASK_CH.clear, () => {
    stopAnswer();
    history = [];
    // "New chat" keeps the screenshot and starts another conversation, so the one that just ended stays in the list.
    conversationId = newConversationId();
    setState({ status: 'idle' });
  });
  ipcMain.handle(ASK_CH.history, () => conversations().list());
  ipcMain.handle(ASK_CH.historyLoad, (_e, raw: unknown) => openStored(raw));
  ipcMain.handle(ASK_CH.historyRemove, async (_e, raw: unknown) => {
    if (isConversationId(raw)) await conversations().remove(raw);
    return conversations().list();
  });
  ipcMain.handle(ASK_CH.historyClear, () => conversations().clear());
  ipcMain.handle(ASK_CH.copy, (_e, raw: unknown) => {
    if (typeof raw === 'string' && raw.length > 0) void clipboard.writeText(raw.slice(0, 100_000)).catch(() => undefined);
  });
  ipcMain.handle(ASK_CH.openSettings, () => deps?.openSettings());
  ipcMain.handle(ASK_CH.attach, async () => {
    if (!deps || !askWindow()) return { image: null, failed: true };
    const shot = await deps.captureForAsk();
    // A cancelled or failed capture leaves whatever was already attached in place: the next question is no worse off.
    if (shot.image) staged = shot.image;
    return shot;
  });
  ipcMain.handle(ASK_CH.historyRename, (_e, raw: unknown, rawTitle: unknown) => {
    if (!isConversationId(raw)) return conversations().list();
    return conversations().rename(raw, typeof rawTitle === 'string' ? rawTitle.slice(0, 200) : '');
  });
}
