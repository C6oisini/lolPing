import type { AskChunk, AskContext, AskState } from '../../shared/askAi';
import { strings, type Strings } from '../../shared/i18n';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const title = el('title');
const model = el('model');
const closeBtn = el<HTMLButtonElement>('close');
const shotRow = el('shotRow');
const shot = el<HTMLImageElement>('shot');
const shotInfo = el('shotInfo');
const notice = el('notice');
const noticeTitle = el('noticeTitle');
const noticeBody = el('noticeBody');
const noticeAction = el<HTMLButtonElement>('noticeAction');
const question = el<HTMLTextAreaElement>('question');
const send = el<HTMLButtonElement>('send');
const wrap = el('answerWrap');
const thinking = el<HTMLDetailsElement>('thinking');
const thinkingLabel = el('thinkingLabel');
const reasoning = el('reasoning');
const answer = el('answer');
const hint = el('hint');
const note = el('note');
const copy = el<HTMLButtonElement>('copy');

let ctx: AskContext;
let t: Strings;
let streaming = false;
let text = '';
let thought = '';

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

/**
 * The model answers in Markdown. Everything is escaped first, so an answer can never inject markup into this window,
 * and only bold and inline code are then rendered.
 */
const format = (md: string): string => esc(md).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');

const atBottom = (): boolean => wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 40;

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

/** Everything that depends on which screenshot is being asked about. Runs again when a new one arrives. */
function applyContext(c: AskContext): void {
  ctx = c;
  t = strings(c.lang);
  document.documentElement.lang = t.lang;
  title.textContent = t.askTitle;
  model.textContent = t.askSubtitle(c.model);
  closeBtn.title = t.askClose;
  question.placeholder = t.askPlaceholder;
  hint.textContent = t.askHint;
  note.textContent = t.askPaused;
  copy.textContent = t.askCopy;
  thinkingLabel.textContent = t.askThinking;
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
  setStreaming(false);
}

function onState(s: AskState): void {
  if (s.status === 'streaming') {
    text = '';
    thought = '';
    reasoning.textContent = '';
    thinking.hidden = true;
    thinking.open = false;
    answer.classList.remove('error');
    answer.innerHTML = `<span class="wait">${esc(t.askWaiting)}</span>`;
    copy.hidden = true;
    setStreaming(true);
    return;
  }
  if (s.status === 'idle') {
    setStreaming(false);
    return;
  }
  setStreaming(false);
  if (s.status === 'error') {
    answer.classList.add('error');
    answer.textContent = s.error === 'timeout' ? t.askTimeout : s.error === 'nokey' ? t.askNoKey : t.askFailed(s.error ?? '');
    return;
  }
  if (text.length > 0) copy.hidden = false;
  wrap.scrollTop = wrap.scrollHeight;
  question.focus();
}

function onChunk(c: AskChunk): void {
  const stick = atBottom();
  if (c.kind === 'reasoning') {
    thought += c.text;
    reasoning.textContent = thought;
    thinking.hidden = false;
  } else {
    if (text.length === 0) answer.textContent = '';
    text += c.text;
    answer.innerHTML = format(text);
  }
  if (stick || c.kind === 'answer') wrap.scrollTop = wrap.scrollHeight;
}

function submit(): void {
  if (!ctx.hasKey) return;
  if (streaming) {
    void window.askApi.cancel();
    return;
  }
  const q = question.value.trim() || t.askDefaultQuestion;
  void window.askApi.submit(q);
}

send.addEventListener('click', submit);
closeBtn.addEventListener('click', () => void window.askApi.close());
copy.addEventListener('click', () => {
  void window.askApi.copy(text);
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
  answer.textContent = '';
  copy.hidden = true;
  question.focus();
});
