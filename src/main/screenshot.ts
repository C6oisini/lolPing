import { desktopCapturer, screen, type Display, type NativeImage } from 'electron';
import type { AskImage } from '../shared/askAi';

/** Long edge of the image that is sent. The API scales it down to about 1300 px anyway, so more only costs upload time. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 88;

/** The display to capture: the one the gesture happened on, or the primary one when it is gone. */
function displayFor(displayId: number): Display {
  return screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
}

/** Scales the capture down so its long edge is at most MAX_EDGE. */
function shrink(image: NativeImage): NativeImage {
  const { width, height } = image.getSize();
  const long = Math.max(width, height);
  if (long <= MAX_EDGE || long === 0) return image;
  const scale = MAX_EDGE / long;
  return image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'better' });
}

/**
 * Captures one display as a JPEG data URL, ready to be sent to the model. Throws when nothing could be captured: the
 * caller shows the window without a screenshot rather than failing the whole gesture.
 */
export async function captureDisplay(displayId: number): Promise<AskImage> {
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
  const shot = shrink(source.thumbnail);
  if (shot.isEmpty()) throw new Error('empty capture');
  const { width, height } = shot.getSize();
  return { dataUrl: `data:image/jpeg;base64,${shot.toJPEG(JPEG_QUALITY).toString('base64')}`, width, height };
}
