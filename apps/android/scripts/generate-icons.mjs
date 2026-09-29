import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = path.resolve(root, '../../desktop/resources/icon.svg');
const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

for (const [name, size] of Object.entries(densities)) {
  const dir = path.join(root, 'app/src/main/res', `mipmap-${name}`);
  await mkdir(dir, { recursive: true });
  const png = await sharp(svg).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
  await sharp(png).toFile(path.join(dir, 'ic_launcher.png'));
  await sharp(png).toFile(path.join(dir, 'ic_launcher_round.png'));
  console.log(`mipmap-${name} ${size}px`);
}
