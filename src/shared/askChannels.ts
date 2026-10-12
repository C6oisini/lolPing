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
  /** invoke → void. */
  close: 'ask:close',
  /** invoke → void: puts the text on the clipboard from the main process. */
  copy: 'ask:copy',
  /** invoke → void: opens Settings on the Ask AI section. */
  openSettings: 'ask:openSettings',
  /** main → renderer: one piece of the answer (or of the model's thinking). */
  delta: 'ask:delta',
  /** main → renderer: idle, streaming, done or error. */
  state: 'ask:state',
} as const;
