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
 * The built-in instruction, used when the settings' prompt is empty. It follows the interface language, and is written
 * for a screenshot of a game in progress: short, concrete and in the player's language.
 */
export function askDefaultPrompt(lang: Lang): string {
  return lang === 'zh-CN'
    ? [
      '你是一个英雄联盟实时助手。用户会给你一张游戏截图，可能附带一句提问。',
      '看清截图里的局势：双方阵容、血量蓝量、装备、兵线、视野、地图上的敌人位置和时间。',
      '用简体中文回答，直接给结论和下一步该做什么，最多 5 行，不要复述截图内容，不要客套话。',
      '信息看不清就直说看不清，不要编造。',
    ].join('\n')
    : [
      'You are a real-time League of Legends assistant. The user sends you a screenshot of a game in progress, usually with a question.',
      'Read the situation from the screenshot: both team compositions, health and mana, items, minion waves, vision, enemy positions and the game clock.',
      'Answer in at most 5 lines, in the language of the question: give the call and the next concrete action. Do not describe the screenshot back, and skip the pleasantries.',
      'If something is unreadable, say so instead of guessing.',
    ].join('\n');
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

/** window.askApi in the ask renderer. */
export interface AskApi {
  getContext(): Promise<AskContext>;
  /** Starts an answer. The question is what the user typed; an empty one asks for a read of the situation. */
  submit(question: string): Promise<void>;
  /** Stops the answer in flight. */
  cancel(): Promise<void>;
  close(): Promise<void>;
  copy(text: string): Promise<void>;
  /** Opens Settings on the Ask AI section, for the API key. */
  openSettings(): Promise<void>;
  onChunk(cb: (c: AskChunk) => void): () => void;
  onState(cb: (s: AskState) => void): () => void;
  /** A new screenshot arrived (the slice was chosen again while this window was open). */
  onContext(cb: (c: AskContext) => void): () => void;
}
