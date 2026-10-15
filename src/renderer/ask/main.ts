import 'katex/dist/katex.min.css';
import type { AskChunk, AskContext, AskImage, AskState, AskTurn, ConversationSummary } from '../../shared/askAi';
import { strings, type Strings } from '../../shared/i18n';
import { renderMarkdown } from './markdown';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const title = el('title');
const model = el('model');
const newChat = el<HTMLButtonElement>('newChat');
const historyBtn = el<HTMLButtonElement>('historyBtn');
const historyPanel = el('history');
const historyTitle = el('historyTitle');
const historyClear = el<HTMLButtonElement>('historyClear');
const historyClose = el<HTMLButtonElement>('historyClose');
const historyList = el('historyList');
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
const attach = el<HTMLButtonElement>('attach');
const send = el<HTMLButtonElement>('send');
const hint = el('hint');
const note = el('note');
const copy = el<HTMLButtonElement>('copy');

let ctx: AskContext;
let t: Strings;
let streaming = false;
let pending = '';
/** A screenshot taken for the next question, waiting to be sent with it. */
let staged: AskImage | null = null;
/** The history as it was last drawn, to put a row back the way it was when a rename is abandoned. */
let historyItems: ConversationSummary[] = [];
/** The answer being streamed, and where it is being written. */
let lastAnswer = '';
let answerEl: HTMLElement | null = null;
let reasoningEl: HTMLElement | null = null;
let thinkingEl: HTMLDetailsElement | null = null;
let answerText = '';
let reasoningText = '';

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

/** The answer is Markdown; see markdown.ts for what is rendered and why nothing can be injected. */
const format = (md: string): string => renderMarkdown(md);

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

/** The picture the window is asking about, with a line saying what becomes of it. */
function showShot(image: AskImage | null, note: string): void {
  if (!image) {
    shotRow.hidden = true;
    return;
  }
  shot.src = image.dataUrl;
  shotInfo.textContent = `${image.width} × ${image.height} · ${note}`;
  shotRow.hidden = false;
}

/** A note in the footer's hint line for a moment, the way the copy button borrows its own label. */
function flashHint(text: string): void {
  hint.textContent = text;
  setTimeout(() => {
    hint.textContent = t.askHint;
  }, 1600);
}

/**
 * Takes a new screenshot for the question being typed. The window hides itself for the capture, so it comes back
 * looking the same, with the new picture in the row above.
 */
async function attachShot(): Promise<void> {
  if (streaming || !ctx.hasKey) return;
  attach.disabled = true;
  attach.textContent = t.askShotBusy;
  try {
    const shot = await window.askApi.attachScreenshot();
    if (shot.image) {
      staged = shot.image;
      showShot(shot.image, t.askShotNote);
    } else if (shot.failed) {
      flashHint(t.askShotFailed);
    }
  } finally {
    attach.disabled = !ctx.hasKey;
    attach.textContent = t.askShot;
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

/** When a saved conversation was last touched, as its row shows it. */
function when(at: number): string {
  const date = new Date(at);
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const today = new Date();
  if (sameDay(date, today)) return `${t.askHistoryToday} ${clock}`;
  if (sameDay(date, new Date(today.getTime() - 86_400_000))) return `${t.askHistoryYesterday} ${clock}`;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The saved conversations: one row each — what was asked about, when, and how many turns it ran. */
function renderHistory(items: ConversationSummary[]): void {
  historyItems = items;
  historyList.textContent = '';
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'historyEmpty';
    empty.textContent = t.askHistoryEmpty;
    historyList.append(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'historyRow';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'historyOpen';
    if (item.image) {
      const thumb = document.createElement('img');
      thumb.className = 'historyShot';
      thumb.alt = '';
      thumb.src = item.image.dataUrl;
      open.append(thumb);
    }
    const text = document.createElement('span');
    text.className = 'historyText';
    const heading = document.createElement('b');
    heading.textContent = item.title || t.askDefaultQuestion;
    const meta = document.createElement('span');
    meta.className = 'historyWhen';
    meta.textContent = `${when(item.at)} · ${item.turns} ${t.askHistoryTurns}`;
    text.append(heading, meta);
    open.append(text);
    open.addEventListener('click', () => {
      historyPanel.hidden = true;
      void window.askApi.loadHistory(item.id);
    });
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'historyEdit';
    rename.title = t.askRename;
    rename.textContent = '✎';
    rename.addEventListener('click', () => startRename(row, item));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'historyDelete';
    remove.title = t.askHistoryDelete;
    remove.textContent = '✕';
    remove.addEventListener('click', () => void window.askApi.removeHistory(item.id).then(renderHistory));
    row.append(open, rename, remove);
    historyList.append(row);
  }
}

/** Renaming a row: its buttons give way to an input. Enter or leaving it saves, Escape puts the name back. */
function startRename(row: HTMLElement, item: ConversationSummary): void {
  const input = document.createElement('input');
  input.className = 'historyName';
  input.type = 'text';
  input.maxLength = 200;
  input.value = item.title;
  input.placeholder = t.askDefaultQuestion;
  row.textContent = '';
  row.append(input);
  input.focus();
  input.select();
  let settled = false;
  const keep = (): void => {
    if (settled) return;
    settled = true;
    renderHistory(historyItems);
  };
  const save = async (): Promise<void> => {
    if (settled) return;
    settled = true;
    const name = input.value.trim();
    renderHistory(name.length > 0 && name !== item.title ? await window.askApi.renameHistory(item.id, name) : historyItems);
  };
  input.addEventListener('keydown', (e) => {
    // The window's own Escape (close) must not fire while a name is being edited.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      keep();
    }
  });
  input.addEventListener('blur', () => void save());
}

function openHistory(): void {
  historyTitle.textContent = t.askHistoryTitle;
  historyClear.textContent = t.askHistoryClear;
  historyPanel.hidden = false;
  void window.askApi.history().then(renderHistory);
}

/** A conversation opened from the history: its questions and answers as they were. The model's thinking was never
 *  saved, so a restored answer has no folded reasoning above it. */
function drawRestored(turns: AskTurn[]): void {
  clearThread();
  let answer: HTMLElement | null = null;
  for (const turn of turns) {
    if (turn.role === 'user') {
      const wrap = document.createElement('div');
      wrap.className = 'turn';
      const q = document.createElement('div');
      q.className = 'q';
      q.textContent = turn.text;
      answer = document.createElement('div');
      answer.className = 'a';
      wrap.append(q, answer);
      thread.append(wrap);
    } else if (answer) {
      answer.innerHTML = format(turn.text);
      lastAnswer = turn.text;
      answer = null;
    }
  }
  copy.hidden = lastAnswer.length === 0;
  question.placeholder = t.askFollowUp;
  toBottom();
  question.focus();
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
  historyBtn.textContent = t.askHistory;
  historyBtn.title = t.askHistoryTitle;
  historyPanel.hidden = true;
  question.placeholder = t.askPlaceholder;
  hint.textContent = t.askHint;
  note.textContent = t.askPaused;
  copy.textContent = t.askCopy;
  notice.hidden = true;
  noticeAction.hidden = true;
  question.disabled = !c.hasKey;
  attach.disabled = !c.hasKey;
  attach.textContent = t.askShot;
  attach.title = t.askShot;
  // Whatever was attached before belongs to a question that is no longer on screen: the row shows the new screenshot.
  staged = null;
  showShot(c.image, t.askShareNote);
  if (!c.image && c.imageFailed) showNotice('warn', '', t.askNoImage);
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
  // The picture is now part of the conversation rather than waiting to be sent, and the row says so from here on.
  if (staged) {
    showShot(staged, t.askShareNote);
    staged = null;
  }
  void window.askApi.submit(pending);
}

send.addEventListener('click', submit);
closeBtn.addEventListener('click', () => void window.askApi.close());
attach.addEventListener('click', () => void attachShot());
newChat.addEventListener('click', () => {
  void window.askApi.clear();
  clearThread();
  question.focus();
});
historyBtn.addEventListener('click', openHistory);
historyClose.addEventListener('click', () => { historyPanel.hidden = true; });
historyClear.addEventListener('click', () => {
  void window.askApi.clearHistory().then(() => renderHistory([]));
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
  if (e.key !== 'Escape') return;
  // Escape backs out of the panel first, and closes the window only when there is nothing to back out of.
  if (!historyPanel.hidden) {
    historyPanel.hidden = true;
    return;
  }
  void window.askApi.close();
});
window.askApi.onChunk(onChunk);
window.askApi.onState(onState);
window.askApi.onContext(applyContext);
window.askApi.onRestore(drawRestored);
window.addEventListener('focus', () => { if (!streaming) question.focus(); });

void window.askApi.getContext().then((c) => {
  applyContext(c);
  question.focus();
});
