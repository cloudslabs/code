/**
 * Generate placeholder icon PNGs for app state indicators.
 * Pure Node.js - no external dependencies.
 * Creates simple colored-circle PNGs at various sizes.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'resources', 'icons');

// Colors per status: [r, g, b]
const STATUS_COLORS = {
  idle:       [128, 128, 128], // gray
  processing: [59, 130, 246],  // blue
  error:      [239, 68, 68],   // red
  completed:  [34, 197, 94],   // green
};

const BADGE_COLOR = [251, 191, 36]; // amber/yellow

function createPng(width, height, pixels) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk('IHDR', ihdrData);

  // IDAT chunk - raw pixel data with filter bytes
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (1 + width * 4) + 1 + x * 4;
      raw[dstIdx] = pixels[srcIdx];
      raw[dstIdx + 1] = pixels[srcIdx + 1];
      raw[dstIdx + 2] = pixels[srcIdx + 2];
      raw[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }
  const compressed = zlib.deflateSync(raw);
  const idat = makeChunk('IDAT', compressed);

  // IEND chunk
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuffer, data, crc]);
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeCircle(size, r, g, b) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= radius) {
        // Anti-aliased edge
        const alpha = Math.min(1, Math.max(0, radius - dist + 0.5));
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = Math.round(alpha * 255);
      }
    }
  }
  return pixels;
}

function makeCircleWithOverlay(size, baseR, baseG, baseB, overlayR, overlayG, overlayB) {
  const pixels = makeCircle(size, baseR, baseG, baseB);
  // Add a small status dot in the bottom-right
  const dotSize = Math.max(3, Math.round(size * 0.25));
  const dotCx = size - dotSize;
  const dotCy = size - dotSize;
  const dotRadius = dotSize / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - dotCx) ** 2 + (y - dotCy) ** 2);
      if (dist <= dotRadius + 1) {
        const idx = (y * size + x) * 4;
        if (dist <= dotRadius - 0.5) {
          pixels[idx] = overlayR;
          pixels[idx + 1] = overlayG;
          pixels[idx + 2] = overlayB;
          pixels[idx + 3] = 255;
        } else if (dist <= dotRadius + 0.5) {
          const alpha = Math.max(0, dotRadius + 0.5 - dist);
          pixels[idx] = overlayR;
          pixels[idx + 1] = overlayG;
          pixels[idx + 2] = overlayB;
          pixels[idx + 3] = Math.round(alpha * 255);
        }
      }
    }
  }
  return pixels;
}

function makeGrayscaleCircle(size, r, g, b) {
  // Template images for macOS: grayscale + alpha
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  return makeCircle(size, gray, gray, gray);
}

function makeBadge(size, number) {
  const pixels = makeCircle(size, ...BADGE_COLOR);
  // Simple number rendering using a tiny pixel font isn't practical without
  // a font renderer, so badges are just colored circles. The number is conveyed
  // by the overlay icon tooltip/context.
  // For a production app, you'd use pre-rendered badge images or canvas.
  return pixels;
}

// Ensure output directory exists
fs.mkdirSync(OUT_DIR, { recursive: true });

const icons = [];

// Dock icons (512x512)
for (const [status, [r, g, b]] of Object.entries(STATUS_COLORS)) {
  const name = `dock-${status}.png`;
  const pixels = makeCircle(512, r, g, b);
  icons.push({ name, size: 512, pixels });
}

// Tray icons (32x32)
for (const [status, [r, g, b]] of Object.entries(STATUS_COLORS)) {
  const name = `tray-${status}.png`;
  const pixels = makeCircle(32, r, g, b);
  icons.push({ name, size: 32, pixels });
}

// macOS Template tray icons (22x22, grayscale+alpha)
for (const [status, [r, g, b]] of Object.entries(STATUS_COLORS)) {
  const name = `tray-${status}Template.png`;
  const pixels = makeGrayscaleCircle(22, r, g, b);
  icons.push({ name, size: 22, pixels });
}

// Windows overlay icons (16x16)
for (const status of ['processing', 'error', 'completed']) {
  const [r, g, b] = STATUS_COLORS[status];
  const name = `overlay-${status}.png`;
  const pixels = makeCircle(16, r, g, b);
  icons.push({ name, size: 16, pixels });
}

// Badge icons (16x16)
for (let i = 1; i <= 9; i++) {
  const name = `badge-${i}.png`;
  const pixels = makeBadge(16, i);
  icons.push({ name, size: 16, pixels });
}
icons.push({ name: 'badge-9plus.png', size: 16, pixels: makeBadge(16, '+') });

// Write all icons
let count = 0;
for (const { name, size, pixels } of icons) {
  const png = createPng(size, size, pixels);
  fs.writeFileSync(path.join(OUT_DIR, name), png);
  count++;
}

console.log(`Generated ${count} icon files in ${OUT_DIR}`);
