/**
 * Where the question window's conversations are kept: one JSON file per conversation, under
 * `%APPDATA%\lolPing\conversations`.
 *
 * This is the only place the feature writes anything the user said or saw. A conversation holds the turns, a small
 * JPEG preview of the screen it was about (never the full screenshot), and when it was last touched. The list is the
 * directory: a scan for the list, one read to open one, one unlink to forget it. Nothing here throws at the caller:
 * a conversation that cannot be written or read is dropped rather than breaking the window.
 */
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AskImage, AskTurn, ConversationSummary, StoredConversation } from '../shared/askAi';

/** How many conversations are kept. Past this, the ones not touched for longest go. */
export const MAX_CONVERSATIONS = 50;
/** The most turns one conversation keeps: the tail of a marathon chat, so its file cannot grow without end. */
export const MAX_TURNS = 40;
/** The most text one turn keeps. */
export const MAX_TURN_CHARS = 20_000;

export type { ConversationSummary, StoredConversation };

/** `time-random`: sortable, readable, and safe to use as a file name. */
export function newConversationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const ID = /^[a-z0-9]+-[a-z0-9]+$/;

/** True for an id this store could have written: the renderer sends ids back, so they never become a path. */
export const isConversationId = (id: unknown): id is string => typeof id === 'string' && ID.test(id);

const isTurn = (v: unknown): v is AskTurn => {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string';
};

const isImage = (v: unknown): v is AskImage => {
  if (typeof v !== 'object' || v === null) return false;
  const i = v as Record<string, unknown>;
  return typeof i.dataUrl === 'string' && i.dataUrl.startsWith('data:image/') && typeof i.width === 'number' && typeof i.height === 'number';
};

/** A turn as it is stored: what it said, and the screenshot it was asked about when it had one. */
const turnOf = (t: AskTurn): AskTurn => ({ role: t.role, text: t.text.slice(0, MAX_TURN_CHARS), image: isImage(t.image) ? t.image : null });

/** Caps a conversation to what is worth storing, so one long chat cannot fill the directory. */
export function trimConversation(c: StoredConversation): StoredConversation {
  return {
    ...c,
    title: c.title.replace(/\s+/g, ' ').trim().slice(0, 200),
    turns: c.turns.slice(-MAX_TURNS).map(turnOf),
  };
}

/** Reads a stored file back into a conversation, or null when it is not one (an interrupted write, a hand edit). */
export function parseConversation(raw: unknown): StoredConversation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (!isConversationId(c.id) || typeof c.at !== 'number' || !Array.isArray(c.turns)) return null;
  if (!c.turns.every(isTurn)) return null;
  return {
    id: c.id,
    at: c.at,
    title: typeof c.title === 'string' ? c.title.slice(0, 200) : '',
    image: isImage(c.image) ? c.image : null,
    turns: (c.turns as AskTurn[]).map(turnOf),
  };
}

const summaryOf = (c: StoredConversation): ConversationSummary => ({ ...c, turns: c.turns.length });

export class ConversationStore {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  /** Writes one conversation, then drops the oldest if the directory is now over the cap. */
  async save(conversation: StoredConversation): Promise<void> {
    if (!isConversationId(conversation.id)) return;
    const trimmed = trimConversation(conversation);
    try {
      await mkdir(this.dir, { recursive: true });
      const tmp = `${this.file(trimmed.id)}.tmp`;
      await writeFile(tmp, JSON.stringify(trimmed), 'utf8');
      await rename(tmp, this.file(trimmed.id));
    } catch (err) {
      // A conversation that cannot be written is not worth an error in the window, but it should not be silent either.
      console.warn('[ask] could not save the conversation', err);
      return;
    }
    const all = await this.list();
    for (const old of all.slice(MAX_CONVERSATIONS)) await this.remove(old.id);
  }

  /** Newest first. Files that are not conversations are skipped. */
  async list(): Promise<ConversationSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const found: ConversationSummary[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      if (!isConversationId(id)) continue;
      const conversation = await this.load(id);
      if (conversation) found.push(summaryOf(conversation));
    }
    return found.sort((a, b) => b.at - a.at);
  }

  async load(id: string): Promise<StoredConversation | null> {
    if (!isConversationId(id)) return null;
    try {
      return parseConversation(JSON.parse(await readFile(this.file(id), 'utf8')));
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<void> {
    if (!isConversationId(id)) return;
    await unlink(this.file(id)).catch(() => undefined);
  }

  /**
   * Gives one conversation a name of the user's own, and answers with the list as it now stands. Its place in the list
   * is when it was last talked about, which renaming does not change: the rows do not jump around while they are read.
   */
  async rename(id: string, title: string): Promise<ConversationSummary[]> {
    const found = await this.load(id);
    if (found) await this.save({ ...found, title });
    return this.list();
  }

  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
