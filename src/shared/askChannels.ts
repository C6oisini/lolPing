/**
 * Channel names for the ask window. They live in their own module for the same reason settingsChannels does: a
 * sandboxed preload can only require('electron'), so each preload gets its own copy of the names instead of sharing a
 * chunk with another preload.
 */
export const ASK_CH = {
  /** invoke → AskContext: what the window is asking about. */
  context: 'ask:context',
  /** invoke(question) → void, with the answer arriving through `delta` and `state`. */
  submit: 'ask:submit',
  /** invoke → void: stops the answer in flight, if any. */
  cancel: 'ask:cancel',
  /** invoke → void: forgets the conversation so far and starts over. */
  clear: 'ask:clear',
  /** invoke → void. */
  close: 'ask:close',
  /** invoke → void: puts the text on the clipboard from the main process. */
  copy: 'ask:copy',
  /** invoke → void: opens Settings on the Ask AI section. */
  openSettings: 'ask:openSettings',
  /** invoke → ConversationSummary[]: the saved conversations, newest first. */
  history: 'ask:history',
  /** invoke(id) → void: opens a saved conversation in the window. */
  historyLoad: 'ask:historyLoad',
  /** invoke(id) → ConversationSummary[]: forgets one saved conversation, and answers with the new list. */
  historyRemove: 'ask:historyRemove',
  /** invoke → void: forgets every saved conversation. */
  historyClear: 'ask:historyClear',
  /** main → renderer: one piece of the answer (or of the model's thinking). */
  delta: 'ask:delta',
  /** main → renderer: idle, streaming, done or error. */
  state: 'ask:state',
  /** main → renderer: the turns of a conversation that was just opened, to be drawn again. */
  restore: 'ask:restore',
} as const;
