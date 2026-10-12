import { describe, expect, it } from 'vitest';
import { askDefaultPrompt, ASK_SLICE_KEY, DEFAULT_ASK_BASE_URL, DEFAULT_ASK_MODEL } from '../../src/shared/askAi';
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
  it('answers in the interface language', () => {
    expect(askDefaultPrompt('zh-CN')).toContain('简体中文');
    expect(askDefaultPrompt('en')).toContain('League of Legends');
    expect(askDefaultPrompt('zh-CN')).not.toBe(askDefaultPrompt('en'));
  });
});
