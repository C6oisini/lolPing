import { desktopCapturer, screen, type Display, type NativeImage } from 'electron';
import { selectionToPixels, type AskImage, type PickRect } from '../shared/askAi';

/** Long edge of the image that is sent. The API scales it down to about 1300 px anyway, so more only costs upload time. */
const MAX_EDGE = 1600;
/** Long edge of the frozen picture the picker shows: the display's own pixels, capped, because it travels over IPC. */
const PREVIEW_EDGE = 2560;
const JPEG_QUALITY = 88;
/** A drag shorter than this in both directions is a click: the whole display is wanted. Matches MIN_PX in the picker. */
export const MIN_SELECTION_PX = 12;

/** One display, captured before anything is asked about it. */
export interface Capture {
  /** The display at its own pixel size: what a selection is cropped from, so cropping loses nothing. */
  image: NativeImage;
  /** The display's CSS size. The picker works in these pixels, not in the image's. */
  css: { width: number; height: number };
}

/** The display to capture: the one the gesture happened on, or the primary one when it is gone. */
function displayFor(displayId: number): Display {
  return screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
}

/** Scales the image down so its long edge is at most `max`, then encodes it as the JPEG the API is sent. */
export function askImageOf(image: NativeImage, max = MAX_EDGE): AskImage {
  const { width, height } = image.getSize();
  const long = Math.max(width, height);
  const shot = long <= max || long === 0
    ? image
    : image.resize({ width: Math.round((width * max) / long), height: Math.round((height * max) / long), quality: 'better' });
  if (shot.isEmpty()) throw new Error('empty capture');
  const size = shot.getSize();
  return { dataUrl: `data:image/jpeg;base64,${shot.toJPEG(JPEG_QUALITY).toString('base64')}`, width: size.width, height: size.height };
}

/** The frozen picture for the picker: the display as it is, capped so the IPC payload stays reasonable. */
export const previewOf = (capture: Capture): AskImage => askImageOf(capture.image, PREVIEW_EDGE);

/**
 * The screenshot to send: `rect` is the picker's selection in the display's CSS pixels, or null (or a click-sized box)
 * for the whole display.
 */
export function cropAskImage(capture: Capture, rect: PickRect | null): AskImage {
  const picked = rect !== null && (rect.width >= MIN_SELECTION_PX || rect.height >= MIN_SELECTION_PX);
  if (!picked || !rect) return askImageOf(capture.image);
  const pixels = selectionToPixels(rect, capture.css, capture.image.getSize());
  return askImageOf(capture.image.crop(pixels));
}

/**
 * Captures one display at its own resolution. Throws when nothing could be captured: the caller carries on without a
 * screenshot rather than failing the whole gesture.
 */
export async function captureDisplay(displayId: number): Promise<Capture> {
  const display = displayFor(displayId);
  const displays = screen.getAllDisplays();
  // The thumbnail comes back in physical pixels, so ask for them: a 150% display would otherwise capture at 2/3 size.
  const size = {
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  if (sources.length === 0) throw new Error('no screen to capture');
  // Windows and macOS both report the display id on the source; the index is the fallback for anything that doesn't.
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[displays.findIndex((d) => d.id === display.id)] ?? sources[0];
  // A locked screen, a sleeping display or a lost desktop session comes back as an empty thumbnail: say so instead of
  // handing an empty picture to the crop, which would fail later and silently.
  if (source.thumbnail.isEmpty()) throw new Error('empty capture');
  return { image: source.thumbnail, css: { width: display.bounds.width, height: display.bounds.height } };
}
