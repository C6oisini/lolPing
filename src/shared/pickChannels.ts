/**
 * Channel names for the region picker. In their own module for the same reason askChannels is: each sandboxed preload
 * gets its own copy of the names instead of sharing a chunk with another preload.
 */
export const PICK_CH = {
  /** invoke → PickContext: the frozen screenshot and the language. */
  context: 'pick:context',
  /** invoke(rect | null) → void. */
  done: 'pick:done',
  /** invoke → void: no screenshot this time. */
  cancel: 'pick:cancel',
} as const;
