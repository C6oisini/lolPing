/**
 * Channel names for the region picker. In their own module for the same reason askChannels is: each sandboxed preload
 * gets its own copy of the names instead of sharing a chunk with another preload.
 */
export const PICK_CH = {
  /** main → renderer: the frozen screenshot and the language, pushed in each time the picker is shown. */
  context: 'pick:context',
  /** renderer → main: the picture is painted, so the window can be shown. */
  ready: 'pick:ready',
  /** renderer → main: invoke(rect | null). */
  done: 'pick:done',
  /** renderer → main: invoke, no screenshot this time. */
  cancel: 'pick:cancel',
} as const;
