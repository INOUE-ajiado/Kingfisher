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
