import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/renderer/ask/markdown';

describe('renderMarkdown', () => {
  it('never lets an answer become markup of its own', () => {
    const html = renderMarkdown('hi <img src=x onerror="alert(1)"> <script>bad()</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img src=x onerror="alert(1)"&gt;');
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
  });

  it('renders the inline styles an answer actually uses', () => {
    expect(renderMarkdown('**now** and *later* and `gem` and ~~no~~')).toBe(
      '<p><b>now</b> and <i>later</i> and <code>gem</code> and <s>no</s></p>',
    );
  });

  it('keeps code spans literal, so a star inside one is not emphasis', () => {
    expect(renderMarkdown('use `a*b*c` here')).toBe('<p>use <code>a*b*c</code> here</p>');
  });

  it('renders a fenced block literally, with its language escaped', () => {
    const html = renderMarkdown('```js" onload="x\nif (a < b) **keep**\n```');
    expect(html).toContain('<pre class="code" data-lang="js&quot; onload=&quot;x">');
    expect(html).toContain('if (a &lt; b) **keep**'); // no emphasis inside code
  });

  it('renders headings, rules and quotes', () => {
    expect(renderMarkdown('## 出装\n\n---\n\n> 别交闪现')).toBe(
      '<h2>出装</h2><hr><blockquote><p>别交闪现</p></blockquote>',
    );
  });

  it('renders lists, including a wrapped line that belongs to the item above', () => {
    expect(renderMarkdown('- 先回城\n  买鞋\n- 再推线')).toBe('<ul><li>先回城<br>买鞋</li><li>再推线</li></ul>');
    expect(renderMarkdown('1. 补刀\n2. 换血')).toBe('<ol><li>补刀</li><li>换血</li></ol>');
  });

  it('renders a pipe table', () => {
    const html = renderMarkdown('| 装备 | 价格 |\n| --- | --- |\n| 破败 | 3300 |');
    expect(html).toBe('<table><thead><tr><th>装备</th><th>价格</th></tr></thead><tbody><tr><td>破败</td><td>3300</td></tr></tbody></table>');
  });

  it('keeps a single newline as a line break, and a blank line as a new paragraph', () => {
    expect(renderMarkdown('第一行\n第二行')).toBe('<p>第一行<br>第二行</p>');
    expect(renderMarkdown('第一段\n\n第二段')).toBe('<p>第一段</p><p>第二段</p>');
  });

  it('shows a link as text with its address, and never as something clickable', () => {
    expect(renderMarkdown('[文档](https://example.com/a)')).toBe('<p>文档<span class="url">https://example.com/a</span></p>');
    // A scheme that is not http(s) is left exactly as it arrived: nothing here may become a navigation.
    expect(renderMarkdown('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>');
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href');
  });

  it('survives being handed a half-arrived answer', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('正在想 **还没')).toContain('**还没'); // an unclosed bold stays literal
    expect(renderMarkdown('```\nnever closed')).toContain('<pre'); // an unterminated fence runs to the end
    expect(renderMarkdown('| 还没 | 写完 |')).toContain('<p>'); // one row is not a table yet
  });
});
