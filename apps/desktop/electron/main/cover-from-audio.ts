import sharp from 'sharp';

const MAX_SIDE = 1200;

/** Встроенная обложка (ID3/FLAC picture) → JPEG для PUT /tracks/:id/cover. */
export async function embeddedCoverToJpeg(data: Buffer): Promise<Buffer | null> {
  if (!data.length) return null;
  try {
    return await sharp(data)
      .rotate()
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}
