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
    // Wrapped in a scroller, so a table wider than the card scrolls instead of stretching the window.
    expect(html).toBe('<div class="table-wrap"><table><thead><tr><th>装备</th><th>价格</th></tr></thead><tbody><tr><td>破败</td><td>3300</td></tr></tbody></table></div>');
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

describe('renderMarkdown maths', () => {
  it('draws an inline formula instead of showing its source', () => {
    const html = renderMarkdown('损失函数 \\(L_{self}(\\vtheta)\\) 的梯度');
    expect(html).toContain('class="katex"');
    expect(html).toContain('msupsub'); // the subscript is real markup, not `_{self}`
    expect(html).not.toContain('\\vtheta');
    expect(html).not.toContain('\\(');
  });

  it('draws display maths on a line of its own as its own block', () => {
    const html = renderMarkdown("参数更新：\n\n\\[\\vtheta' = \\vtheta - \\alpha \\nabla_\\vtheta L(\\vtheta)\\]\n\n之后继续。");
    expect(html).toContain('<div class="math-block">');
    expect(html).toContain('katex-display');
    expect(html).toContain('<p>参数更新：</p>');
    expect(html).toContain('<p>之后继续。</p>');
    // The source is in KaTeX's own annotation; what is drawn must not be the source.
    expect(html.slice(html.indexOf('katex-html'))).not.toContain('\\nabla');
  });

  it('accepts $$, $ and a latex code block', () => {
    expect(renderMarkdown('$$a^2 + b^2 = c^2$$')).toContain('katex-display');
    expect(renderMarkdown('质能方程 $E = mc^2$ 很简单')).toContain('class="katex"');
    const block = renderMarkdown('```latex\nP_{final}(y|x) = P(y|x; \\vtheta)\n```');
    expect(block).toContain('katex-display');
    expect(block).not.toContain('<pre');
  });

  it('leaves money alone', () => {
    expect(renderMarkdown('花了 $5 and $10 买了装备')).toBe('<p>花了 $5 and $10 买了装备</p>');
    expect(renderMarkdown('价格 $3300')).toBe('<p>价格 $3300</p>');
  });

  it('does not read maths out of code', () => {
    expect(renderMarkdown('用 `\\(x\\)` 表示行内公式')).toContain('<code>\\(x\\)</code>');
    const fenced = renderMarkdown('```\n$E = mc^2$\n```');
    expect(fenced).toContain('<pre class="code"');
    expect(fenced).not.toContain('katex');
    // A fence that has not finished streaming yet is still code, not a formula.
    expect(renderMarkdown('```\n$E = mc^2$')).not.toContain('katex');
  });

  it('keeps an answer unable to inject markup, maths or not', () => {
    const html = renderMarkdown('\\(x\\) <img src=x onerror="alert(1)">');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('leaves unsafe commands inert', () => {
    const html = renderMarkdown('\\(\\href{javascript:alert(1)}{点我}\\)');
    expect(html).not.toContain('href='); // no attribute is ever produced from the formula
    expect(html).not.toContain('<a ');
  });

  it('draws the notation papers actually use', () => {
    // \vtheta and \bm are not KaTeX commands; they mean a bold theta rather than a red error.
    const html = renderMarkdown('\\(\\vtheta = \\bm{\\theta} + \\vx\\)');
    expect(html).toContain('katex');
    expect(html).toContain('θ'); // the letter, not the word "theta" in bold
    expect(html).not.toContain('#cc0000'); // the colour KaTeX paints an unknown command with
    // And they still work where only one token is allowed, such as the argument of a subscript.
    const gradient = renderMarkdown('\\(\\nabla_\\vtheta L_\\bm{\\theta}\\)');
    expect(gradient).toContain('katex');
    expect(gradient).not.toContain('#cc0000');
    expect(renderMarkdown('定义域 \\(\\R^n\\) 上的期望 \\(\\E[X]\\)')).not.toContain('#cc0000');
  });

  it('shows a half-typed formula instead of throwing', () => {
    expect(() => renderMarkdown('\\(\\frac{1}{')).not.toThrow(); // still streaming: no closing delimiter yet
    expect(renderMarkdown('\\(\\frac{1}{')).toContain('\\(\\frac{1}{');
    expect(renderMarkdown('\\(\\frac{1}{2}\\)')).toContain('katex');
    expect(renderMarkdown('\\(\\notacommand{x}\\)')).toContain('katex'); // bad source: drawn as the text it is
  });
});
