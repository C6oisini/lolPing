/** Wheel geometry in CSS pixels (matches prototype/wheel-demo.html). */
export const WHEEL = { innerR: 86, outerR: 188, extR: 288, iconR: 137, iconSize: 48 } as const;

/** How many slices the League-style wheel has. The ping wheel adds the Ask AI slice on top of these. */
export const WHEEL_SLOTS = 8;

/** The middle angle of `slot`, in degrees, where 0 is east and y points down: slot 0 is straight up. */
export const sliceAngle = (slot: number, slots: number = WHEEL_SLOTS): number => -90 + (slot * 360) / slots;

/** Half the angular width of a slice, in degrees. */
export const sliceHalf = (slots: number = WHEEL_SLOTS): number => 180 / slots;

/**
 * Slice under an offset from the wheel centre. Screen coordinates (y down).
 * Returns -1 inside the dead zone, else 0..slots-1 where 0 = N and indices go clockwise.
 * The slices are 360/slots degrees wide and centred on the compass directions.
 */
export function pickSlice(dx: number, dy: number, deadZone: number = WHEEL.innerR, slots: number = WHEEL_SLOTS): number {
  if (Math.hypot(dx, dy) < deadZone) return -1;
  const width = 360 / slots;
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + width / 2 + 360) % 360;
  return Math.floor(deg / width) % slots;
}
