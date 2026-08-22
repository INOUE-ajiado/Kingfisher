import { TGAImage } from './tga';

/**
 * Generates a sample TGA lineart image (512x512) for demonstration and testing.
 * Features a character face outline with red and blue trace lines.
 */
export function generateSampleTGA(cellNumber: number): TGAImage {
  const width = 512;
  const height = 512;
  const data = new Uint8ClampedArray(width * height * 4);

  // Fill default pure white (alpha 0 for Kingfisher)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 0; // Pure white = transparent alpha 0
  }

  // Draw circle lineart (head)
  const cx = 256;
  const cy = 256;
  const radius = 150 + (cellNumber * 10); // slightly change per frame for animation test

  for (let angle = 0; angle < 360; angle += 0.5) {
    const rad = (angle * Math.PI) / 180;
    const x = Math.round(cx + radius * Math.cos(rad));
    const y = Math.round(cy + radius * Math.sin(rad));

    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = (y * width + x) * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 255; // Solid black line
    }
  }

  // Draw Red Trace Line (Shadow Boundary) inside circle
  for (let x = cx - radius + 20; x <= cx + radius - 20; x++) {
    const y = Math.round(cy + Math.sin((x / 30) + cellNumber) * 30);
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = (y * width + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 255; // Red Trace Line
    }
  }

  // Draw Blue Trace Line (Highlight Boundary)
  for (let x = cx - 80; x <= cx + 80; x++) {
    const y = Math.round(cy - 60 + Math.cos(x / 20) * 15);
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = (y * width + x) * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 255;
      data[idx + 3] = 255; // Blue Trace Line
    }
  }

  return { width, height, pixelDepth: 32, data };
}

/**
 * Generates a colorful reference ColorSpec TGA image with multiple sample color patches (512x512).
 */
export function generateSampleColorSpecTGA(): TGAImage {
  const width = 512;
  const height = 512;
  const data = new Uint8ClampedArray(width * height * 4);

  // Background light gray
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 240;
    data[i + 1] = 240;
    data[i + 2] = 240;
    data[i + 3] = 255;
  }

  const patches = [
    { x: 40,  y: 40,  w: 120, h: 80, r: 255, g: 215, b: 0,   name: 'Hair Main' },
    { x: 180, y: 40,  w: 120, h: 80, r: 255, g: 165, b: 0,   name: 'Hair Shadow' },
    { x: 320, y: 40,  w: 120, h: 80, r: 255, g: 235, b: 150, name: 'Hair Highlight' },
    { x: 40,  y: 150, w: 120, h: 80, r: 255, g: 228, b: 181, name: 'Skin Main' },
    { x: 180, y: 150, w: 120, h: 80, r: 205, g: 133, b: 63,  name: 'Skin Shadow' },
    { x: 320, y: 150, w: 120, h: 80, r: 255, g: 192, b: 203, name: 'Cheek Pink' },
    { x: 40,  y: 260, w: 120, h: 80, r: 65,  g: 105, b: 225, name: 'Jacket Blue' },
    { x: 180, y: 260, w: 120, h: 80, r: 0,   g: 0,   b: 128, name: 'Jacket Shadow' },
    { x: 320, y: 260, w: 120, h: 80, r: 50,  g: 205, b: 50,  name: 'Accent Green' },
    { x: 40,  y: 370, w: 120, h: 80, r: 220, g: 20,  b: 60,  name: 'Ribbon Red' },
    { x: 180, y: 370, w: 120, h: 80, r: 139, g: 0,   b: 0,   name: 'Ribbon Shadow' },
    { x: 320, y: 370, w: 120, h: 80, r: 40,  g: 40,  b: 40,  name: 'Lineart Black' },
  ];

  for (const p of patches) {
    for (let y = p.y; y < p.y + p.h; y++) {
      for (let x = p.x; x < p.x + p.w; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          const idx = (y * width + x) * 4;
          // Border line
          if (x === p.x || x === p.x + p.w - 1 || y === p.y || y === p.y + p.h - 1) {
            data[idx] = 30; data[idx + 1] = 30; data[idx + 2] = 30; data[idx + 3] = 255;
          } else {
            data[idx] = p.r; data[idx + 1] = p.g; data[idx + 2] = p.b; data[idx + 3] = 255;
          }
        }
      }
    }
  }

  return { width, height, pixelDepth: 32, data };
}
