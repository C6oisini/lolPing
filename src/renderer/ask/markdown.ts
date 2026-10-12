/**
 * A small Markdown renderer for the answer pane.
 *
 * The model's text is untrusted input rendered with innerHTML, so everything is HTML-escaped *first* and the Markdown
 * is then turned into markup this file writes itself: raw HTML in an answer can never become elements, and no answer
 * text ever lands in an attribute. Links are deliberately not clickable — the window is a frameless overlay, and a
 * click that navigated it would take the question away — so a link shows its text with the address beside it.
 *
 * It is called again with every streaming chunk, so every construct has to survive being half-arrived: an unterminated
 * code fence simply runs to the end, an unclosed ** stays literal, and so on.
 */

const escapeHtml = (s: string): string => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
const escapeAttr = (s: string): string => escapeHtml(s).replace(/"/g, '&quot;');

/**
 * Turns the inline styles of one line of text into markup. The text is escaped first: everything below works on
 * already-escaped text, so no answer can ever contribute a tag or an attribute of its own.
 */
function inline(source: string): string {
  const parts = escapeHtml(source).split(/(`+[^`]*`+)/g);
  return parts
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
        return `<code>${part.replace(/^`+|`+$/g, '')}</code>`;
      }
      return part
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/__([^_]+)__/g, '<b>$1</b>')
        .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
        .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
        .replace(/~~([^~]+)~~/g, '<s>$1</s>')
        // Only an http(s) address is rendered as a link; anything else (javascript:, data:) is left as the text it
        // arrived as, since the renderer must never produce something that could be navigated to.
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text: string, url: string) =>
          /^https?:\/\//i.test(url) ? (url === text ? text : `${text}<span class="url">${url}</span>`) : whole);
    })
    .join('');
}

const FENCE = /^\s*(`{3,}|~{3,})\s*(.*)$/;
const HEADING = /^\s*(#{1,6})\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

/** The blocks of one answer, in order. Anything it does not recognise is a paragraph. */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
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
      const lang = fence[2];
      out.push(`<pre class="code"${lang ? ` data-lang="${escapeAttr(lang)}"` : ''}><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
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
      out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`);
      continue;
    }

    // A pipe table: a row of cells, then the dashes that make it a header. Anything else is not a table.
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const cells = (row: string): string[] => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') rows.push(cells(lines[i++]));
      const headHtml = head.map((c) => `<th>${inline(c)}</th>`).join('');
      const bodyHtml = rows.map((r) => `<tr>${head.map((_, n) => `<td>${inline(r[n] ?? '')}</td>`).join('')}</tr>`).join('');
      out.push(`<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`);
      continue;
    }

    const item = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (item) {
      const ordered = NUMBERED.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const next = BULLET.exec(lines[i]) ?? NUMBERED.exec(lines[i]);
        if (next) {
          items.push(next[1]);
          i++;
        } else if (lines[i].trim() === '') {
          break;
        } else if (/^\s+\S/.test(lines[i])) {
          items[items.length - 1] += `\n${lines[i].trim()}`; // a wrapped line belongs to the item above
          i++;
        } else break;
      }
      const list = items.map((text) => `<li>${inline(text).replace(/\n/g, '<br>')}</li>`).join('');
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
    out.push(`<p>${paragraph.map((l) => inline(l)).join('<br>')}</p>`);
  }

  return out.join('');
}

function isBlockStart(line: string, next: string | undefined): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)
    || BULLET.test(line) || NUMBERED.test(line)
    || (line.includes('|') && next !== undefined && TABLE_DIVIDER.test(next));
}
