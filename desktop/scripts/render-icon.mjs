import sharp from 'sharp';

const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('Usage: render-icon.mjs <source.svg> <output.png>');

await sharp(source, { density: 192 }).resize(1024, 1024).png().toFile(output);
