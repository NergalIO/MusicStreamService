import { nativeImage } from 'electron';

const MAX_SIDE = 1200;

/** Встроенная обложка (ID3/FLAC picture) → JPEG для PUT /tracks/:id/cover. */
export async function embeddedCoverToJpeg(data: Buffer): Promise<Buffer | null> {
  if (!data.length) return null;
  try {
    let img = nativeImage.createFromBuffer(data);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (width > MAX_SIDE || height > MAX_SIDE) {
      const scale = MAX_SIDE / Math.max(width, height);
      img = img.resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
      });
    }
    const jpeg = img.toJPEG(88);
    return jpeg.length ? Buffer.from(jpeg) : null;
  } catch {
    return null;
  }
}
