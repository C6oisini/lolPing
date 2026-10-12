import type { AskChunk, AskContext, AskState } from '../../shared/askAi';
import { strings, type Strings } from '../../shared/i18n';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const title = el('title');
const model = el('model');
const newChat = el<HTMLButtonElement>('newChat');
const closeBtn = el<HTMLButtonElement>('close');
const shotRow = el('shotRow');
const shot = el<HTMLImageElement>('shot');
const shotInfo = el('shotInfo');
const notice = el('notice');
const noticeTitle = el('noticeTitle');
const noticeBody = el('noticeBody');
const noticeAction = el<HTMLButtonElement>('noticeAction');
const thread = el('thread');
const question = el<HTMLTextAreaElement>('question');
const send = el<HTMLButtonElement>('send');
const hint = el('hint');
const note = el('note');
const copy = el<HTMLButtonElement>('copy');

let ctx: AskContext;
let t: Strings;
let streaming = false;
let pending = '';
/** The answer being streamed, and where it is being written. */
let lastAnswer = '';
let answerEl: HTMLElement | null = null;
let reasoningEl: HTMLElement | null = null;
let thinkingEl: HTMLDetailsElement | null = null;
let answerText = '';
let reasoningText = '';

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

/**
 * The model answers in Markdown. Everything is escaped first, so an answer can never inject markup into this window,
 * and only bold and inline code are then rendered.
 */
const format = (md: string): string => esc(md).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');

const atBottom = (): boolean => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 48;
const toBottom = (): void => { thread.scrollTop = thread.scrollHeight; };

function setStreaming(on: boolean): void {
  streaming = on;
  send.textContent = on ? t.askStop : t.askSend;
  send.disabled = !ctx.hasKey;
}

function showNotice(kind: 'warn' | 'error', heading: string, body: string, action?: { label: string; run: () => void }): void {
  notice.hidden = false;
  noticeTitle.textContent = heading;
  noticeBody.textContent = body;
  notice.style.borderColor = kind === 'error' ? 'rgba(255,120,120,.45)' : 'rgba(255,190,90,.35)';
  if (action) {
    noticeAction.hidden = false;
    noticeAction.textContent = action.label;
    noticeAction.onclick = action.run;
  }
}

/** One exchange: the question as it was asked, the model's thinking folded away, and the answer. */
function addTurn(text: string): void {
  const turn = document.createElement('div');
  turn.className = 'turn';
  const q = document.createElement('div');
  q.className = 'q';
  q.textContent = text;
  const details = document.createElement('details');
  details.className = 'thinking';
  details.hidden = true;
  const summary = document.createElement('summary');
  summary.textContent = t.askThinking;
  const reasoning = document.createElement('div');
  reasoning.className = 'reasoning';
  details.append(summary, reasoning);
  const a = document.createElement('div');
  a.className = 'a';
  a.innerHTML = `<span class="wait">${esc(t.askWaiting)}</span>`;
  turn.append(q, details, a);
  thread.append(turn);
  answerEl = a;
  thinkingEl = details;
  reasoningEl = reasoning;
  answerText = '';
  reasoningText = '';
  toBottom();
}

/** Ends the exchange in the transcript: an error, a stop, or nothing when it finished cleanly. */
function endTurn(kind: 'done' | 'stopped' | 'error', error?: string): void {
  const a = answerEl;
  if (!a) return;
  if (a.querySelector('.wait')) a.textContent = '';
  if (kind === 'error') {
    a.classList.add('error');
    a.textContent = error === 'timeout' ? t.askTimeout : error === 'nokey' ? t.askNoKey : t.askFailed(error ?? '');
  } else if (kind === 'stopped' && !a.textContent?.trim()) {
    a.innerHTML = `<span class="stopped">${esc(t.askStopped)}</span>`;
  } else if (kind === 'stopped') {
    a.append(Object.assign(document.createElement('span'), { className: 'stopped', textContent: ` ${t.askStopped}` }));
  }
}

/** Clears the transcript: a new conversation, on this side and in the main process. */
function clearThread(): void {
  thread.textContent = '';
  answerEl = null;
  reasoningEl = null;
  thinkingEl = null;
  answerText = '';
  reasoningText = '';
  lastAnswer = '';
  copy.hidden = true;
  question.placeholder = t.askPlaceholder;
}

function applyContext(c: AskContext): void {
  const first = ctx === undefined;
  ctx = c;
  t = strings(c.lang);
  document.documentElement.lang = t.lang;
  title.textContent = t.askTitle;
  model.textContent = t.askSubtitle(c.model);
  closeBtn.title = t.askClose;
  newChat.textContent = t.askNewChat;
  question.placeholder = t.askPlaceholder;
  hint.textContent = t.askHint;
  note.textContent = t.askPaused;
  copy.textContent = t.askCopy;
  notice.hidden = true;
  noticeAction.hidden = true;
  shotRow.hidden = true;
  question.disabled = !c.hasKey;
  if (c.image) {
    shot.src = c.image.dataUrl;
    shotInfo.textContent = `${c.image.width} × ${c.image.height} · ${t.askShareNote}`;
    shotRow.hidden = false;
  } else if (c.imageFailed) {
    showNotice('warn', '', t.askNoImage);
  }
  if (!c.hasKey) {
    showNotice('warn', t.askNoKey, t.askNoKeyDesc, { label: t.askOpenSettings, run: () => void window.askApi.openSettings() });
  }
  // A new screenshot is a new conversation: the main process drops its history with it.
  if (!first) clearThread();
  setStreaming(false);
}

function onState(s: AskState): void {
  if (s.status === 'streaming') {
    addTurn(pending);
    question.placeholder = t.askFollowUp;
    setStreaming(true);
    return;
  }
  if (s.status === 'idle') {
    // Either a stop, or nothing was running: mark the exchange that was interrupted.
    if (streaming) endTurn('stopped');
    setStreaming(false);
    if (answerText.length > 0) copy.hidden = false;
    return;
  }
  setStreaming(false);
  endTurn(s.status === 'error' ? 'error' : 'done', s.error);
  if (s.status === 'done' && answerText.length > 0) {
    lastAnswer = answerText;
    copy.hidden = false;
  }
  toBottom();
  question.focus();
}

function onChunk(c: AskChunk): void {
  if (!answerEl) return;
  const stick = atBottom();
  if (c.kind === 'reasoning') {
    reasoningText += c.text;
    if (reasoningEl) reasoningEl.textContent = reasoningText;
    if (thinkingEl) thinkingEl.hidden = false;
  } else {
    if (answerText.length === 0) answerEl.textContent = '';
    answerText += c.text;
    answerEl.innerHTML = format(answerText);
  }
  if (stick || c.kind === 'answer') toBottom();
}

function submit(): void {
  if (!ctx.hasKey) return;
  if (streaming) {
    void window.askApi.cancel();
    return;
  }
  pending = question.value.trim() || (thread.childElementCount > 0 ? t.askFollowUp.trim() : t.askDefaultQuestion);
  question.value = '';
  void window.askApi.submit(pending);
}

send.addEventListener('click', submit);
closeBtn.addEventListener('click', () => void window.askApi.close());
newChat.addEventListener('click', () => {
  void window.askApi.clear();
  clearThread();
  question.focus();
});
copy.addEventListener('click', () => {
  void window.askApi.copy(lastAnswer || answerText);
  copy.textContent = t.askCopied;
  setTimeout(() => { copy.textContent = t.askCopy; }, 1200);
});
question.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') void window.askApi.close();
});
window.askApi.onChunk(onChunk);
window.askApi.onState(onState);
window.askApi.onContext(applyContext);
window.addEventListener('focus', () => { if (!streaming) question.focus(); });

void window.askApi.getContext().then((c) => {
  applyContext(c);
  question.focus();
});
