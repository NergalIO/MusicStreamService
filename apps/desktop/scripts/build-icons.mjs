// Генерирует растровые иконки из SVG в resources/. Запуск: pnpm icons
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = (name) => path.join(root, 'resources', name);

// До 32 px детали мастер-иконки сливаются, поэтому мелкие размеры берутся из упрощённого SVG.
const SMALL_MAX = 32;

async function render(svgFile, size) {
  const svg = await readFile(res(svgFile));
  return sharp(svg)
    .resize(size, size, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
}

async function ico(outFile, sizes, pick) {
  const pngs = await Promise.all(sizes.map((s) => render(pick(s), s)));
  await writeFile(res(outFile), await pngToIco(pngs));
  console.log(`${outFile}: ${sizes.join(', ')}`);
}

await ico('icon.ico', [16, 20, 24, 32, 40, 48, 64, 256], (s) => (s <= SMALL_MAX ? 'icon-small.svg' : 'icon.svg'));
await ico('tray.ico', [16, 20, 24, 32], () => 'tray.svg');
await ico('tray-light.ico', [16, 20, 24, 32], () => 'tray-light.svg');

// Кнопки на миниатюре окна в панели задач: белые глифы 16 px и @2x для экранов с масштабом.
const THUMBAR = {
  prev: '<path d="M5 4h2v16H5zM20 4v16L8.5 12z"/>',
  next: '<path d="M17 4h2v16h-2zM4 4v16l11.5-8z"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  pause: '<path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/>',
};
await mkdir(res('thumbar'), { recursive: true });
for (const [name, body] of Object.entries(THUMBAR)) {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ffffff">${body}</svg>`);
  for (const [suffix, size] of [['', 16], ['@2x', 32]]) {
    await sharp(svg, { density: 72 * (size / 24) * 4 }).resize(size, size).png().toFile(res(`thumbar/${name}${suffix}.png`));
  }
}
console.log('thumbar/*.png');

const png512 = await render('icon.svg', 512);
await writeFile(res('icon.png'), png512);
await mkdir(path.join(root, 'public'), { recursive: true });
await writeFile(path.join(root, 'public', 'icon.png'), await render('icon.svg', 128));
console.log('icon.png, public/icon.png');

const discordDir = path.join(root, 'resources', 'discord');
await mkdir(discordDir, { recursive: true });

async function discordAsset(name, svgBody) {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${svgBody}</svg>`);
  await sharp(svg).png().toFile(path.join(discordDir, `${name}.png`));
}

await writeFile(path.join(discordDir, 'logo.png'), png512);

const playGlyph = '<path fill="#ffffff" d="M176 128v256l224-128z"/>';
const pauseGlyph =
  '<path fill="#ffffff" d="M176 128h96v256h-96zm160 0h96v256h-96z"/>';
for (const [name, glyph] of [
  ['play', playGlyph],
  ['pause', pauseGlyph],
]) {
  await discordAsset(
    name,
    `<circle cx="256" cy="256" r="256" fill="#5865F2"/>${glyph}`,
  );
}
console.log('discord/logo.png, discord/play.png, discord/pause.png');
