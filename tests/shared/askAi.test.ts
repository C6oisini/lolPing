import { describe, expect, it } from 'vitest';
import { askDefaultPrompt, askMessages, ASK_SLICE_KEY, DEFAULT_ASK_BASE_URL, DEFAULT_ASK_MODEL, selectionToPixels } from '../../src/shared/askAi';
import { pickSlice, sliceAngle, sliceHalf } from '../../src/shared/geometry';
import { normalizeSettings } from '../../src/shared/settings';
import { ASK_ICON_URL } from '../../src/shared/askAi';
import { isPingId } from '../../src/shared/pings';

/** A point at `deg` (0 = east, y down) and `r` from the wheel centre, which is where the wheel opens. */
const at = (deg: number, r = 200): [number, number] =>
  [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];

describe('the ping wheel with the Ask AI slice', () => {
  it('keeps League\'s eight slices where they were', () => {
    expect(pickSlice(...at(-90))).toBe(0); // straight up
    expect(pickSlice(...at(0))).toBe(2); // east
    expect(pickSlice(...at(-45))).toBe(1);
    expect(pickSlice(...at(-135))).toBe(7);
  });

  it('puts the ninth slice counter-clockwise of the top, 40° wide', () => {
    const slots = 9;
    expect(pickSlice(...at(sliceAngle(8, slots)), 86, slots)).toBe(8);
    expect(pickSlice(...at(-130), 86, slots)).toBe(8); // the middle of the ninth slice
    // The seam between the ninth slice and the top one sits at -110°.
    expect(pickSlice(...at(-110.4), 86, slots)).toBe(8);
    expect(pickSlice(...at(-109.6), 86, slots)).toBe(0);
    // Every slice is reachable, and the dead zone still cancels.
    expect(new Set(Array.from({ length: slots }, (_, i) => pickSlice(...at(sliceAngle(i, slots)), 86, slots))).size).toBe(slots);
    expect(pickSlice(0, -80, 86, slots)).toBe(-1);
    expect(sliceHalf(slots)).toBe(20);
  });

  it('never mistakes the slice for a ping, and ships an icon for it', () => {
    expect(isPingId(ASK_SLICE_KEY)).toBe(false);
    expect(ASK_ICON_URL.startsWith('data:image/svg+xml;utf8,')).toBe(true);
  });
});

describe('askMessages', () => {
  const image = 'data:image/jpeg;base64,AAAA';

  it('sends the first question with the screenshot', () => {
    const messages = askMessages('sys', [], '现在做什么？', image);
    expect(messages).toEqual([
      { role: 'system', content: 'sys' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '现在做什么？' },
          { type: 'image_url', image_url: { url: image, detail: 'high' } },
        ],
      },
    ]);
  });

  it('attaches the screenshot once, to the first question, and sends the rest as plain text', () => {
    const history = [
      { role: 'user' as const, text: '现在做什么？' },
      { role: 'assistant' as const, text: '退回塔下。' },
    ];
    const messages = askMessages('sys', history, '那出什么装备？', image);
    expect(messages).toHaveLength(4);
    expect(messages[0]).toEqual({ role: 'system', content: 'sys' });
    // The picture stays with the turn that started the conversation; repeating it would cost its tokens on every follow-up.
    expect(messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '现在做什么？' },
        { type: 'image_url', image_url: { url: image, detail: 'high' } },
      ],
    });
    expect(messages[2]).toEqual({ role: 'assistant', content: '退回塔下。' });
    expect(messages[3]).toEqual({ role: 'user', content: '那出什么装备？' });
  });

  it('sends plain text when there is no screenshot at all', () => {
    const history = [{ role: 'user' as const, text: '第一问' }, { role: 'assistant' as const, text: '答' }];
    expect(askMessages('sys', history, '第二问', null)).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '答' },
      { role: 'user', content: '第二问' },
    ]);
  });
});

describe('selectionToPixels', () => {
  const css = { width: 1280, height: 720 };
  const image = { width: 2560, height: 1440 }; // a 200% display

  it('scales a selection from the display\'s CSS pixels into the capture\'s pixels', () => {
    expect(selectionToPixels({ x: 100, y: 50, width: 200, height: 100 }, css, image)).toEqual({ x: 200, y: 100, width: 400, height: 200 });
  });

  it('is the identity on an unscaled display', () => {
    expect(selectionToPixels({ x: 3, y: 4, width: 5, height: 6 }, image, image)).toEqual({ x: 3, y: 4, width: 5, height: 6 });
  });

  it('never leaves the image, and never returns an empty rectangle', () => {
    const clipped = selectionToPixels({ x: 1200, y: 700, width: 400, height: 400 }, css, image);
    expect(clipped.x + clipped.width).toBeLessThanOrEqual(image.width);
    expect(clipped.y + clipped.height).toBeLessThanOrEqual(image.height);
    expect(selectionToPixels({ x: -50, y: -50, width: 0, height: 0 }, css, image)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe('Ask AI settings', () => {
  it('defaults to the DeepSeek model that takes images, with no key', () => {
    const s = normalizeSettings({});
    expect(s.askAiKey).toBe('');
    expect(s.askAiBaseUrl).toBe(DEFAULT_ASK_BASE_URL);
    expect(s.askAiModel).toBe(DEFAULT_ASK_MODEL);
    expect(s.askAiPrompt).toBe('');
  });

  it('trims and caps what the settings window sends', () => {
    expect(normalizeSettings({ askAiKey: '  sk-abc  ' }).askAiKey).toBe('sk-abc');
    expect(normalizeSettings({ askAiKey: 'x'.repeat(400) }).askAiKey).toHaveLength(200);
    expect(normalizeSettings({ askAiPrompt: 'p'.repeat(2500) }).askAiPrompt).toHaveLength(2000);
    expect(normalizeSettings({ askAiModel: '   ' }).askAiModel).toBe(DEFAULT_ASK_MODEL);
    expect(normalizeSettings({ askAiModel: 42 }).askAiModel).toBe(DEFAULT_ASK_MODEL);
  });

  it('only accepts an http(s) endpoint, and falls back to DeepSeek for anything else', () => {
    expect(normalizeSettings({ askAiBaseUrl: 'http://localhost:11434/v1' }).askAiBaseUrl).toBe('http://localhost:11434/v1');
    for (const bad of ['ftp://example.com', 'not a url', 'file:///etc/passwd', '', 7, null]) {
      expect(normalizeSettings({ askAiBaseUrl: bad }).askAiBaseUrl).toBe(DEFAULT_ASK_BASE_URL);
    }
  });
});

describe('askDefaultPrompt', () => {
  it('asks for a detailed answer from the picture, in the interface language', () => {
    expect(askDefaultPrompt('zh-CN')).toContain('根据图片');
    expect(askDefaultPrompt('en')).toContain('based on the image');
    expect(askDefaultPrompt('zh-CN')).not.toBe(askDefaultPrompt('en'));
  });
});
