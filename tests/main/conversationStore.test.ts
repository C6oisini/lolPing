import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConversationStore,
  MAX_CONVERSATIONS,
  MAX_TURN_CHARS,
  MAX_TURNS,
  isConversationId,
  newConversationId,
  parseConversation,
  trimConversation,
  type StoredConversation,
} from '../../src/main/conversationStore';

const turn = (n: number) => ({ role: n % 2 === 0 ? ('assistant' as const) : ('user' as const), text: `turn ${n}` });
const conversation = (id: string, at: number, turns = 2): StoredConversation => ({
  id,
  at,
  title: `question ${id}`,
  image: { dataUrl: 'data:image/jpeg;base64,AAAA', width: 360, height: 200 },
  turns: Array.from({ length: turns }, (_, i) => turn(i)),
});

describe('conversation ids', () => {
  it('makes ids that are sortable, unique enough, and file-name safe', () => {
    const id = newConversationId();
    expect(isConversationId(id)).toBe(true);
    expect(newConversationId()).not.toBe(id);
  });

  it('refuses anything that could become a path', () => {
    for (const bad of ['../settings', 'a/b', 'x.json', '', 'A-B', null, 42]) expect(isConversationId(bad)).toBe(false);
  });
});

describe('trimConversation', () => {
  it('keeps the tail of a long conversation and caps one turn', () => {
    const trimmed = trimConversation({ ...conversation('k1-aaaaaa', 1, MAX_TURNS + 5), title: '  a\n b  ' });
    expect(trimmed.turns).toHaveLength(MAX_TURNS);
    expect(trimmed.turns[0].text).toBe('turn 5'); // the oldest five went
    expect(trimmed.title).toBe('a b');
    expect(trimConversation(conversation('k2-aaaaaa', 1)).turns[0].text).toHaveLength('turn 0'.length);
    const long = trimConversation({ ...conversation('k3-aaaaaa', 1), turns: [{ role: 'user', text: 'x'.repeat(MAX_TURN_CHARS + 500) }] });
    expect(long.turns[0].text).toHaveLength(MAX_TURN_CHARS);
  });
});

describe('parseConversation', () => {
  it('accepts what the store writes and rejects anything else', () => {
    expect(parseConversation(conversation('m1-aaaaaa', 5))).not.toBeNull();
    expect(parseConversation({ ...conversation('m2-aaaaaa', 5), image: null })?.image).toBeNull();
    expect(parseConversation({ id: 'm3-aaaaaa', at: 5, turns: [{ role: 'system', text: 'x' }] })).toBeNull();
    expect(parseConversation({ id: '../x', at: 5, turns: [] })).toBeNull();
    expect(parseConversation({ id: 'm4-aaaaaa', at: 'now', turns: [] })).toBeNull();
    expect(parseConversation('nope')).toBeNull();
  });
});

describe('ConversationStore', () => {
  let dir = '';
  let store: ConversationStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lolping-conv-'));
    store = new ConversationStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves, lists newest first, and loads one back', async () => {
    await store.save(conversation('a1-aaaaaa', 100));
    await store.save(conversation('a2-aaaaaa', 300));
    await store.save(conversation('a3-aaaaaa', 200));
    const list = await store.list();
    expect(list.map((c) => c.id)).toEqual(['a2-aaaaaa', 'a3-aaaaaa', 'a1-aaaaaa']);
    expect(list[0].turns).toBe(2); // the list carries a count, not the turns
    const loaded = await store.load('a3-aaaaaa');
    expect(loaded?.turns).toHaveLength(2);
    expect(loaded?.image?.width).toBe(360);
  });

  it('returns an empty list for a directory that does not exist yet', async () => {
    expect(await store.list()).toEqual([]);
    expect(await store.load('a1-aaaaaa')).toBeNull();
  });

  it('removes one, and clears them all', async () => {
    await store.save(conversation('b1-aaaaaa', 100));
    await store.save(conversation('b2-aaaaaa', 200));
    await store.remove('b1-aaaaaa');
    expect((await store.list()).map((c) => c.id)).toEqual(['b2-aaaaaa']);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it('drops the least recently touched once there are too many', async () => {
    for (let i = 0; i < MAX_CONVERSATIONS + 3; i++) await store.save(conversation(`c${i}-aaaaaa`, 1000 + i));
    const list = await store.list();
    expect(list).toHaveLength(MAX_CONVERSATIONS);
    expect(list[0].at).toBe(1000 + MAX_CONVERSATIONS + 2); // the newest is kept
    expect(list.some((c) => c.id === 'c0-aaaaaa')).toBe(false); // the oldest went
  });

  it('saves over an existing conversation instead of duplicating it', async () => {
    await store.save(conversation('d1-aaaaaa', 100, 2));
    await store.save({ ...conversation('d1-aaaaaa', 400, 4) });
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].turns).toBe(4);
    expect(list[0].at).toBe(400);
  });

  it('ignores files that are not conversations, and a half-written one', async () => {
    await writeFile(join(dir, 'notes.txt'), 'hello', 'utf8');
    await writeFile(join(dir, 'e1-aaaaaa.json'), '{"id":"e1-aaaaaa","at":1,"tu', 'utf8'); // interrupted
    await writeFile(join(dir, 'readme.md'), '# nope', 'utf8');
    expect(await store.list()).toEqual([]);
    expect(await readdir(dir)).toContain('e1-aaaaaa.json'); // left alone rather than deleted behind the user's back
  });

  it('never writes outside its directory, whatever id it is handed', async () => {
    await store.save({ ...conversation('f1-aaaaaa', 1), id: '../../escape' });
    await store.remove('../../escape');
    expect(await store.load('../../escape')).toBeNull();
    expect(await store.list()).toEqual([]);
  });
});
