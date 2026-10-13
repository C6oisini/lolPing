/**
 * A small Markdown renderer for the answer pane.
 *
 * The model's text is untrusted input rendered with innerHTML, so everything is HTML-escaped *first* and the Markdown
 * is then turned into markup this file writes itself: raw HTML in an answer can never become elements, and no answer
 * text ever lands in an attribute. Links are deliberately not clickable — the window is a frameless overlay, and a
 * click that navigated it would take the question away — so a link shows its text with the address beside it.
 *
 * Math is the one exception to the escaping, because KaTeX needs the source: every formula is lifted out of the answer
 * *before* anything else runs (subscripts, `*` and backslashes all mean something else to Markdown) and left behind as
 * a placeholder, which is replaced at the end by the HTML KaTeX built. KaTeX runs with `trust: false`, so `\href` and
 * friends stay inert, and with `throwOnError: false`, so a half-typed formula shows itself in red instead of throwing.
 *
 * It is called again with every streaming chunk, so every construct has to survive being half-arrived: an unterminated
 * code fence simply runs to the end, an unclosed ** stays literal, and so does an unclosed `\(`.
 */
import katex from 'katex';

const escapeHtml = (s: string): string => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
const escapeAttr = (s: string): string => escapeHtml(s).replace(/"/g, '&quot;');

const FENCE = /^\s*(`{3,}|~{3,})\s*(.*)$/;
const HEADING = /^\s*(#{1,6})\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})$/;
const QUOTE = /^\s*>\s?/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const MATH_LANGS = new Set(['math', 'latex', 'tex', 'katex']);

/** A control character cannot be produced by Markdown, so a placeholder survives escaping and the inline rules. */
const HOLD = '\u0000';
const HOLD_AT = /\u0000([DI])(\d+)\u0000/g;

interface MathItem {
  html: string;
}

/**
 * Commands that papers use and KaTeX does not know: drawn as what they meant instead of as a red error. Each one is
 * wrapped in braces because KaTeX expands a macro before it parses, and a bare command cannot be the argument of a
 * subscript — `\nabla_\vtheta` has to become `\nabla_{\boldsymbol{\theta}}`, not `\nabla_\boldsymbol{\theta}`.
 */
const MATH_MACROS: Record<string, string> = {
  '\\bm': '{\\boldsymbol{#1}}',
  '\\RR': '{\\mathbb{R}}', '\\R': '{\\mathbb{R}}', '\\E': '{\\mathbb{E}}',
  '\\N': '{\\mathbb{N}}', '\\Z': '{\\mathbb{Z}}', '\\C': '{\\mathbb{C}}', '\\Q': '{\\mathbb{Q}}',
};

/** The greek letters, for the bold-vector rule below. `\vec`, `\vee`, `\vert`, `\vspace` and friends are untouched. */
const GREEK = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa',
  'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau', 'upsilon', 'phi', 'varphi',
  'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
]);

/** `\vtheta` and `\vx` are how papers write a bold vector; only a greek name or a single letter is read that way. */
function normalizeTex(tex: string): string {
  return tex.replace(/\\(v)([A-Za-z]+)/g, (whole, _v: string, name: string) => {
    if (GREEK.has(name)) return `{\\boldsymbol{\\${name}}}`; // the letter, not the word: \boldsymbol{\theta}
    if (name.length === 1) return `{\\boldsymbol{${name}}}`;
    return whole; // \vec, \vee, \vert, \vspace … are real commands and are left alone
  });
}

function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(normalizeTex(tex).trim(), {
      displayMode: display, throwOnError: false, strict: false, trust: false, macros: MATH_MACROS,
    });
  } catch {
    // throwOnError: false should keep this unreachable; if KaTeX does throw, show the source rather than lose the line.
    return `<code class="katex-error">${escapeHtml(tex)}</code>`;
  }
}

/** Lifts every formula out of the answer, leaving a placeholder where it was. */
function extractMath(source: string): { text: string; items: MathItem[] } {
  const items: MathItem[] = [];
  const code: string[] = [];
  const hold = (tex: string, display: boolean): string => {
    const index = items.push({ html: renderMath(tex, display) }) - 1;
    return `${HOLD}${display ? 'D' : 'I'}${index}${HOLD}`;
  };
  const stash = (m: string): string => `${HOLD}C${code.push(m) - 1}${HOLD}`;
  // Code goes aside first: a formula written inside a code span or a code block is the text it is, not a formula.
  // The last two patterns catch the half-arrived case, where the closing backticks have not streamed in yet.
  const stashed = source
    .replace(/```[\s\S]*?```/g, stash)
    .replace(/`[^`\n]*`/g, stash)
    .replace(/```[\s\S]*$/g, stash)
    .replace(/`[^`\n]*$/g, stash);
  const text = stashed
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => hold(tex, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex: string) => hold(tex, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex: string) => hold(tex, false))
    // `$x$` is math, `$5 and $10` is money: the opening needs a non-space after it and the closing a non-space before.
    .replace(/\$(?!\s)([^$\n]*?[^\s$])\$/g, (_m, tex: string) => hold(tex, false));
  return { text: text.replace(/\u0000C(\d+)\u0000/g, (_m, i: string) => code[Number(i)] ?? ''), items };
}

/** The blocks of one answer, in order. Anything it does not recognise is a paragraph. */
function renderBlocks(lines: string[], items: MathItem[]): string {
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker}{${fence[1].length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i++; // the closing fence
      const lang = fence[2].trim().toLowerCase();
      // A ```latex block is a formula the model put in a code block rather than code, so draw it.
      if (MATH_LANGS.has(lang)) out.push(`<div class="math-block">${renderMath(body.join('\n'), true)}</div>`);
      else out.push(`<pre class="code"${lang ? ` data-lang="${escapeAttr(lang)}"` : ''}><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // Display math alone on its line is a block of its own, so it can be centred and scrolled sideways.
    const alone = /^\s*\u0000D(\d+)\u0000\s*$/.exec(line);
    if (alone) {
      out.push(`<div class="math-block">${items[Number(alone[1])]?.html ?? ''}</div>`);
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2], items)}</h${level}>`);
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ''));
      out.push(`<blockquote>${renderBlocks(body, items)}</blockquote>`);
      continue;
    }

    // A pipe table: a row of cells, then the dashes that make it a header. Anything else is not a table.
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const cells = (row: string): string[] => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') rows.push(cells(lines[i++]));
      const headHtml = head.map((c) => `<th>${inline(c, items)}</th>`).join('');
      const bodyHtml = rows.map((r) => `<tr>${head.map((_, n) => `<td>${inline(r[n] ?? '', items)}</td>`).join('')}</tr>`).join('');
      out.push(`<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`);
      continue;
    }

    const item = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (item) {
      const ordered = NUMBERED.test(line);
      const listItems: string[] = [];
      while (i < lines.length) {
        const next = BULLET.exec(lines[i]) ?? NUMBERED.exec(lines[i]);
        if (next) {
          listItems.push(next[1]);
          i++;
        } else if (lines[i].trim() === '') {
          break;
        } else if (/^\s+\S/.test(lines[i])) {
          listItems[listItems.length - 1] += `\n${lines[i].trim()}`; // a wrapped line belongs to the item above
          i++;
        } else break;
      }
      const list = listItems.map((text) => `<li>${inline(text, items).replace(/\n/g, '<br>')}</li>`).join('');
      out.push(ordered ? `<ol>${list}</ol>` : `<ul>${list}</ul>`);
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    // A paragraph runs to the next blank line or block. A single newline is a line break, as it is in a comment:
    // these answers are short, and re-flowing them would lose the shape the model gave them.
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i], lines[i + 1])) paragraph.push(lines[i++]);
    out.push(`<p>${paragraph.map((l) => inline(l, items)).join('<br>')}</p>`);
  }

  return out.join('');
}

/**
 * Turns the inline styles of one line of text into markup. The text is escaped first: everything below works on
 * already-escaped text, so no answer can ever contribute a tag or an attribute of its own. The math placeholders are
 * swapped in last, so the HTML KaTeX wrote is never escaped and never read as Markdown.
 */
function inline(source: string, items: MathItem[]): string {
  const parts = escapeHtml(source).split(/(`+[^`]*`+)/g);
  return parts
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
        return `<code>${part.replace(/^`+|`+$/g, '')}</code>`;
      }
      const marked = part
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/__([^_]+)__/g, '<b>$1</b>')
        .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
        .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
        .replace(/~~([^~]+)~~/g, '<s>$1</s>')
        // Only an http(s) address is rendered as a link; anything else (javascript:, data:) is left as the text it
        // arrived as, since the renderer must never produce something that could be navigated to.
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text: string, url: string) =>
          /^https?:\/\//i.test(url) ? (url === text ? text : `${text}<span class="url">${url}</span>`) : whole);
      return marked.replace(HOLD_AT, (_m, _kind: string, index: string) => items[Number(index)]?.html ?? '');
    })
    .join('');
}

export function renderMarkdown(source: string): string {
  const { text, items } = extractMath(source);
  return renderBlocks(text.replace(/\r\n?/g, '\n').split('\n'), items);
}

function isBlockStart(line: string, next: string | undefined): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)
    || BULLET.test(line) || NUMBERED.test(line)
    || (line.includes('|') && next !== undefined && TABLE_DIVIDER.test(next));
}
