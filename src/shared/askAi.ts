import type { Lang } from './i18n';

/**
 * The wheel's extra slice: hold the trigger, drag onto it and let go. It is never a ping id, so it can't collide with
 * anything the ping wheel stores, and every wheel that has it draws it as its last slice.
 */
export const ASK_SLICE_KEY = '__ask__';

/** The slice's icon, drawn with the ping icons. Inline so the feature needs no new file in assets/. */
const ASK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#9fe8ff"/><stop offset="1" stop-color="#2e8bff"/></linearGradient></defs>
<path d="M32 6l5.2 12.8L50 24l-12.8 5.2L32 42l-5.2-12.8L14 24l12.8-5.2z" fill="url(#g)"/>
<circle cx="32" cy="32" r="30" fill="none" stroke="#c8aa6e" stroke-width="3" opacity=".9"/>
<text x="32" y="56" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="20" font-weight="700" fill="#eaf6ff">AI</text>
</svg>`;

export const ASK_ICON_URL = `data:image/svg+xml;utf8,${encodeURIComponent(ASK_ICON_SVG)}`;

/** DeepSeek's OpenAI-compatible endpoint. api.deepseek.com is reachable from mainland China without a proxy. */
export const DEFAULT_ASK_BASE_URL = 'https://api.deepseek.com';
/** The model with image input (V4.1 Flash). Older names such as deepseek-v4-flash-vision-exp still route here. */
export const DEFAULT_ASK_MODEL = 'deepseek-flash';

/** How long an answer may take before it is given up on, and how long a silent stream may stall. */
export const ASK_TOTAL_TIMEOUT_MS = 120_000;
export const ASK_IDLE_TIMEOUT_MS = 30_000;

/** The answer length cap: a game answer wants to be short, and this bounds the cost of a stuck conversation. */
export const ASK_MAX_TOKENS = 900;

/**
 * The built-in instruction, used when the settings' prompt is empty. It depends only on the interface language: the
 * screenshot is whatever the user was looking at, so the default asks for a detailed answer from the picture rather
 * than assuming a game.
 */
export function askDefaultPrompt(lang: Lang): string {
  return lang === 'zh-CN'
    ? '你是一个问答助手，根据图片，详细回答问题'
    : 'You are a Q&A assistant. Answer the question in detail based on the image.';
}

/** A capture of one display, ready to be sent: a JPEG data URL and its pixel size. */
export interface AskImage {
  dataUrl: string;
  width: number;
  height: number;
}

/** What the ask window is asking about: filled in by the main process before the window opens. */
export interface AskContext {
  lang: Lang;
  model: string;
  /** False when no API key is set: the window then offers to open Settings instead of asking. */
  hasKey: boolean;
  /** The screenshot, or null when the capture failed. */
  image: AskImage | null;
  /** True when a capture was attempted and failed, so the window can say why the image is missing. */
  imageFailed: boolean;
}

/** One piece of a streaming answer: the model's thinking, or the answer itself. */
export interface AskChunk {
  kind: 'reasoning' | 'answer';
  text: string;
}

export type AskStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface AskState {
  status: AskStatus;
  /** The failure to show, when `status` is 'error'. */
  error?: string;
}

/**
 * One finished exchange. The window keeps the same list the model is sent, so a follow-up has the context.
 *
 * A question carries the screenshot it was asked about, if it had one: a conversation can be shown a new picture in
 * the middle of it ("look, now this"), and a later question has to mention that picture again for the model — which
 * remembers nothing between requests — to still be answering about it.
 */
export interface AskTurn {
  role: 'user' | 'assistant';
  text: string;
  /** The screenshot this question was asked about, on user turns only. */
  image?: AskImage | null;
}

/** A conversation as it is saved: the turns, what was sent, and when it was last touched. */
export interface StoredConversation {
  id: string;
  /** When it was last touched, in ms since the epoch: the history list is ordered by this. */
  at: number;
  /** The first question, for the list. */
  title: string;
  /** A small copy of the screenshot the conversation was about, or null when the capture failed. */
  image: AskImage | null;
  turns: AskTurn[];
}

/** A saved conversation without its turns: what the history list needs. */
export type ConversationSummary = Omit<StoredConversation, 'turns'> & { turns: number };

/** A message in the request body: the plain-text turns, and the one that carries the screenshot. */
export interface AskMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}

const imagePart = (url: string): Record<string, unknown> => ({ type: 'image_url', image_url: { url, detail: 'high' } });

/**
 * The request messages for a question: the system prompt, every finished turn, then this question. Every question that
 * was asked about a picture carries its own, so a conversation that was shown a second screenshot further down keeps
 * both — the model is stateless, and a picture left out of the request is a picture it cannot see.
 */
export function askMessages(system: string, history: readonly AskTurn[], question: string, image: string | null): AskMessage[] {
  const messages: AskMessage[] = [{ role: 'system', content: system }];
  for (const turn of history) {
    const url = turn.role === 'user' ? turn.image?.dataUrl ?? null : null;
    messages.push(
      url
        ? { role: 'user', content: [{ type: 'text', text: turn.text }, imagePart(url)] }
        : { role: turn.role, content: turn.text },
    );
  }
  messages.push(
    image
      ? { role: 'user', content: [{ type: 'text', text: question }, imagePart(image)] }
      : { role: 'user', content: question },
  );
  return messages;
}

/** A rectangle in the display's own CSS pixels: what the picker reports and the crop is measured from. */
export interface PickRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The selection in the capture's pixels, which are not the display's CSS pixels on a scaled display. */
export function selectionToPixels(
  rect: PickRect,
  css: { width: number; height: number },
  image: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const sx = css.width > 0 ? image.width / css.width : 1;
  const sy = css.height > 0 ? image.height / css.height : 1;
  const x = Math.max(0, Math.min(image.width - 1, Math.round(rect.x * sx)));
  const y = Math.max(0, Math.min(image.height - 1, Math.round(rect.y * sy)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(image.width - x, Math.round(rect.width * sx))),
    height: Math.max(1, Math.min(image.height - y, Math.round(rect.height * sy))),
  };
}

/** What the picker came back with: a box (null = the whole display), or nothing when the gesture was cancelled. */
export type PickResult = { kind: 'area'; rect: PickRect | null } | { kind: 'cancelled' };

/** What the region picker needs: the frozen screenshot of one display, and the language for its hint. */
export interface PickContext {
  lang: Lang;
  image: AskImage;
}

/** window.pickApi in the picker renderer. */
export interface PickApi {
  /** The main process pushes the frozen picture in; the window answers with ready() once it is on screen. */
  onContext(cb: (c: PickContext) => void): () => void;
  /** The new picture is decoded and painted: the window may be shown. */
  ready(): void;
  /** `rect` is the selection in the display's CSS pixels; null asks for the whole display. */
  done(rect: PickRect | null): Promise<void>;
  cancel(): Promise<void>;
}

/** What a new screenshot for the conversation came back as: the picture, or why there is none. */
export interface AskAttach {
  /** The screenshot to ask the next question about, or null when there is none. */
  image: AskImage | null;
  /** True when a capture was attempted and failed: cancelled is not a failure. */
  failed: boolean;
}

/** window.askApi in the ask renderer. */
export interface AskApi {
  getContext(): Promise<AskContext>;
  /** Starts an answer. The question is what the user typed; an empty one asks for a read of the situation. */
  submit(question: string): Promise<void>;
  /** Stops the answer in flight. */
  cancel(): Promise<void>;
  /** Forgets the conversation so far, on both sides. */
  clear(): Promise<void>;
  close(): Promise<void>;
  copy(text: string): Promise<void>;
  /** Opens Settings on the Ask AI section, for the API key. */
  openSettings(): Promise<void>;
  /**
   * Takes a new screenshot for the question being typed: the same capture and region pick the wheel's slice does, with
   * this window taken off the screen first. The picture goes with the next question.
   */
  attachScreenshot(): Promise<AskAttach>;
  /** The saved conversations, newest first. Empty when the history is off or nothing was said yet. */
  history(): Promise<ConversationSummary[]>;
  /** Opens a saved conversation in this window, replacing what is on screen. */
  loadHistory(id: string): Promise<void>;
  /** Forgets one saved conversation; the new list comes back. */
  removeHistory(id: string): Promise<ConversationSummary[]>;
  /** Gives one saved conversation a name of the user's own; the new list comes back. */
  renameHistory(id: string, title: string): Promise<ConversationSummary[]>;
  /** Forgets every saved conversation. */
  clearHistory(): Promise<void>;
  onChunk(cb: (c: AskChunk) => void): () => void;
  onState(cb: (s: AskState) => void): () => void;
  /** A new screenshot arrived (the slice was chosen again while this window was open). */
  onContext(cb: (c: AskContext) => void): () => void;
  /** A saved conversation was opened: draw these turns (the screenshot has already come through onContext). */
  onRestore(cb: (turns: AskTurn[]) => void): () => void;
}
