import fs from 'node:fs/promises';
import sharp from 'sharp';

const [source, output, icnsOutput, icoOutput] = process.argv.slice(2);
if (!source || !output) throw new Error('Usage: render-icon.mjs <source.svg> <output.png> [output.icns] [output.ico]');

await sharp(source, { density: 192 }).resize(1024, 1024).withMetadata({ density: 72 }).png().toFile(output);

async function renderVariant(size) {
  return sharp(output).resize(size, size).withMetadata({ density: 72 }).png().toBuffer();
}

if (icnsOutput) {
  const variants = [
    // Some macOS launchers decode PNG-backed legacy 16/32px ICNS slots as
    // uncompressed pixels. Supplying only modern slots makes AppKit scale the
    // clean vector-derived artwork instead of displaying compressed bytes.
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
  ];

  const chunks = [];
  for (const [type, size] of variants) {
    const png = await renderVariant(size);
    const chunk = Buffer.alloc(8 + png.length);
    chunk.write(type, 0, 4, 'ascii');
    chunk.writeUInt32BE(chunk.length, 4);
    png.copy(chunk, 8);
    chunks.push(chunk);
  }

  const totalLength = 8 + chunks.reduce((length, chunk) => length + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(totalLength, 4);
  await fs.writeFile(icnsOutput, Buffer.concat([header, ...chunks], totalLength));
}

if (icoOutput) {
  // Windows shells pick a slot per surface: 16px for the title bar, 32px for
  // the taskbar, 48px for Explorer, and 256px for the installer and large
  // icon views. electron-builder rejects an .ico without a 256px entry.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) {
    images.push({ size, png: await renderVariant(size) });
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  images.forEach((image, index) => {
    const entry = index * 16;
    // A 256px slot is encoded as 0 because the dimension fields are one byte.
    const dimension = image.size === 256 ? 0 : image.size;
    directory.writeUInt8(dimension, entry);
    directory.writeUInt8(dimension, entry + 1);
    directory.writeUInt8(0, entry + 2);
    directory.writeUInt8(0, entry + 3);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.png.length;
  });

  await fs.writeFile(icoOutput, Buffer.concat([header, directory, ...images.map((image) => image.png)], offset));
}
