import fs from 'node:fs/promises';
import sharp from 'sharp';

const [source, output, icnsOutput] = process.argv.slice(2);
if (!source || !output) throw new Error('Usage: render-icon.mjs <source.svg> <output.png> [output.icns]');

await sharp(source, { density: 192 }).resize(1024, 1024).withMetadata({ density: 72 }).png().toFile(output);

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
    const png = await sharp(output).resize(size, size).withMetadata({ density: 72 }).png().toBuffer();
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
