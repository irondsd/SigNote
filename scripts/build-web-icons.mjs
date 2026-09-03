// Renders every raster web icon from scripts/icons/signote-tile.svg.
// Run with `npm run icons:web` after changing the brand mark.
// sharp comes from the copy Next.js installs; nothing else is needed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'scripts/icons/signote-tile.svg');

const render = (size) =>
  sharp(source, { density: 384 }).resize(size, size).withMetadata({ density: 72 }).png().toBuffer();

const pngTargets = [
  ['src/app/icon1.png', 96],
  ['src/app/apple-icon.png', 180],
  ['public/web-app-manifest-192x192.png', 192],
  ['public/web-app-manifest-512x512.png', 512],
];

for (const [target, size] of pngTargets) {
  await fs.writeFile(path.join(root, target), await render(size));
}

// Transactional email can't use SVG — most mail clients won't render it — and it
// wants the bare mark rather than the tile, so it comes from the logo source at
// 2x the 26px it is displayed at.
await fs.writeFile(
  path.join(root, 'public/images/email/signote-mark-52.png'),
  await sharp(path.join(root, 'public/images/logo.svg'), { density: 384 })
    .resize(52, 52)
    .withMetadata({ density: 72 })
    .png()
    .toBuffer(),
);

// Browsers pick a slot per surface: 16px for the tab, 32px for the bookmark
// bar, 48px for the Windows taskbar shortcut.
const icoSizes = [16, 32, 48];
const images = [];
for (const size of icoSizes) {
  images.push({ size, png: await render(size) });
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

const directory = Buffer.alloc(16 * images.length);
let offset = header.length + directory.length;
images.forEach((image, index) => {
  const entry = index * 16;
  directory.writeUInt8(image.size, entry);
  directory.writeUInt8(image.size, entry + 1);
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(image.png.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += image.png.length;
});

await fs.writeFile(
  path.join(root, 'src/app/favicon.ico'),
  Buffer.concat([header, directory, ...images.map((image) => image.png)], offset),
);

console.log('web icons rebuilt from', path.relative(root, source));
