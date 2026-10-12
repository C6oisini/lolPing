import { session, type Session } from 'electron';
import { askMessages, ASK_IDLE_TIMEOUT_MS, ASK_MAX_TOKENS, ASK_TOTAL_TIMEOUT_MS, type AskChunk, type AskTurn } from '../shared/askAi';

export interface AskCall {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** The system prompt: the settings' own, or the built-in one for the interface language. */
  system: string;
  /** The exchanges already made in this conversation, oldest first. */
  history: readonly AskTurn[];
  question: string;
  /** The screenshot as a data URL, or null when there is none. */
  image: string | null;
  /** Called for every piece of the answer as it arrives. */
  onChunk: (c: AskChunk) => void;
  /** Aborted when the user cancels or closes the window. */
  signal: AbortSignal;
}

/** The user stopped the answer themselves: not a failure, so nothing is reported as one. */
export class AskCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'AskCancelled';
  }
}

/** An answer that timed out. */
export class AskTimeout extends Error {
  constructor() {
    super('timeout');
    this.name = 'AskTimeout';
  }
}

let directSession: Session | null = null;
let directProxy: Promise<unknown> | null = null;

/**
 * A session that ignores the system proxy. api.deepseek.com is reachable directly from mainland China, and the proxy a
 * user has configured for other things (a VPN at 127.0.0.1:7897, say) is often not running while they play: going
 * direct keeps the first attempt working in the common case. The caller retries through the default session if it isn't.
 */
function direct(): Promise<Session> {
  if (!directSession) {
    directSession = session.fromPartition('lolping-ask', { cache: false });
    directProxy = directSession.setProxy({ mode: 'direct' }).catch(() => undefined);
  }
  const ready = directProxy ?? Promise.resolve();
  return ready.then(() => directSession as Session);
}

interface Delta {
  content?: unknown;
  reasoning_content?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The streamed delta of one SSE payload, or null when the payload carries nothing to show. */
function deltaOf(payload: string): AskChunk[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  const choice = (parsed as { choices?: unknown }).choices;
  const first = Array.isArray(choice) ? (choice[0] as { delta?: Delta } | undefined) : undefined;
  const delta = first?.delta;
  if (!delta) return [];
  const out: AskChunk[] = [];
  // With thinking on, the model reasons first: showing it is what makes the wait legible.
  const reasoning = str(delta.reasoning_content);
  const content = str(delta.content);
  if (reasoning) out.push({ kind: 'reasoning', text: reasoning });
  if (content) out.push({ kind: 'answer', text: content });
  return out;
}

/** Reads the SSE body, handing every delta to `onChunk` and calling `progress` whenever something arrived. */
async function readStream(body: ReadableStream<Uint8Array>, onChunk: (c: AskChunk) => void, progress: () => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue; // comments and blank separators
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      const chunks = deltaOf(payload);
      for (const c of chunks) onChunk(c);
      if (chunks.length > 0) progress();
    }
  }
}

/** The status and the API's own message, so a rejected key or an unknown model says what it is. */
async function detailOf(res: Response): Promise<string> {
  try {
    return (await res.text()).replace(/\s+/g, ' ').slice(0, 300);
  } catch {
    return ''; // the body is gone: the status alone has to do
  }
}

const httpError = (status: number, detail: string): Error => new Error(`HTTP ${status}${detail ? `: ${detail}` : ''}`);

function post(url: string, body: unknown, call: AskCall, sess: Session, signal: AbortSignal): Promise<Response> {
  // ses.fetch, not net.fetch: the request has to go through this session's proxy setting.
  return sess.fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${call.apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Asks the model about the screenshot and reports the answer as it streams. Resolves when the answer is complete.
 * Throws AskCancelled when the user stopped it, AskTimeout when it stalled, and an Error with the API's message for
 * anything else (a bad key, no network, an unknown model).
 */
export async function streamAsk(call: AskCall): Promise<void> {
  const url = `${call.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body: Record<string, unknown> = {
    model: call.model,
    messages: askMessages(call.system, call.history, call.question, call.image),
    stream: true,
    max_tokens: ASK_MAX_TOKENS,
    // A game answer is wanted now, not after a chain of thought: the non-thinking mode is both faster and cheaper.
    thinking: { type: 'disabled' },
  };

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  call.signal.addEventListener('abort', onAbort, { once: true });
  let timer: NodeJS.Timeout | null = null;
  const arm = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(), ms);
  };
  arm(ASK_TOTAL_TIMEOUT_MS);
  const progress = () => arm(ASK_IDLE_TIMEOUT_MS);

  /** One attempt: straight out first, then through the system proxy if nothing could be reached at all. */
  const send = async (payload: Record<string, unknown>): Promise<Response> => {
    try {
      return await post(url, payload, call, await direct(), ctrl.signal);
    } catch (err) {
      if (ctrl.signal.aborted) throw err;
      // No connection at all: this machine may need its system proxy (a VPN, a company network).
      return post(url, payload, call, session.defaultSession, ctrl.signal);
    }
  };

  try {
    let res = await send(body);
    if (!res.ok) {
      const detail = await detailOf(res);
      // An endpoint that doesn't know `thinking` (an older DeepSeek version, a relay) gets the same request without it.
      if (res.status === 400 && /thinking|reasoning/i.test(detail)) {
        const { thinking: _thinking, ...without } = body;
        res = await send(without);
        if (!res.ok) throw httpError(res.status, await detailOf(res));
      } else {
        throw httpError(res.status, detail);
      }
    }
    if (!res.body) throw new Error('empty response body');
    await readStream(res.body, call.onChunk, progress);
  } catch (err) {
    if (call.signal.aborted) throw new AskCancelled();
    if (ctrl.signal.aborted) throw new AskTimeout();
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    call.signal.removeEventListener('abort', onAbort);
  }
}
