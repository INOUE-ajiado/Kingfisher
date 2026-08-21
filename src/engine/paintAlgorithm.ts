/**
 * Kingfisher Paint Engine Algorithms
 * Flood Fill, Gradient Fill, Gap Closing, Include Trace-line Fill, Retain Trace Line, Closed Area Fill, Brush, Pencil, Binarization, Noise Removal, and Single Click Noise Eraser.
 */

export interface RGBAColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FillOptions {
  gapCloseLevel: number;        // 0 to 20 pixels
  enableIncludeTrace: boolean;  // Include trace line in fill
  retainTraceLine?: boolean;    // トレス線を消さずに残す
  traceColors: { red: boolean; blue: boolean; green: boolean };
  expandContract?: number;      // -10 to 10 pixels
  contiguous?: boolean;         // 隣接ピクセルのみ
}

function isTraceColor(r: number, g: number, b: number, traceColors: { red: boolean; blue: boolean; green: boolean }): boolean {
  if (traceColors.red && r > 200 && g < 80 && b < 80) return true;
  if (traceColors.blue && b > 200 && r < 80 && g < 80) return true;
  if (traceColors.green && g > 200 && r < 80 && b < 80) return true;
  return false;
}

function isBoundaryPixel(
  data: Uint8ClampedArray,
  idx: number,
  enableIncludeTrace: boolean,
  traceColors: { red: boolean; blue: boolean; green: boolean }
): boolean {
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  const a = data[idx + 3];

  if (a === 0) return false;
  if (r < 50 && g < 50 && b < 50) return true;
  if (enableIncludeTrace && isTraceColor(r, g, b, traceColors)) return true;

  return false;
}

export function floodFill(
  pixelData: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  fillColor: RGBAColor,
  options: FillOptions
): void {
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;

  const startPos = (startY * width + startX) * 4;
  const startR = pixelData[startPos];
  const startG = pixelData[startPos + 1];
  const startB = pixelData[startPos + 2];
  const startA = pixelData[startPos + 3];

  if (options.contiguous === false) {
    for (let i = 0; i < pixelData.length; i += 4) {
      if (
        pixelData[i] === startR &&
        pixelData[i + 1] === startG &&
        pixelData[i + 2] === startB &&
        pixelData[i + 3] === startA
      ) {
        pixelData[i] = fillColor.r;
        pixelData[i + 1] = fillColor.g;
        pixelData[i + 2] = fillColor.b;
        pixelData[i + 3] = fillColor.a;
      }
    }
    return;
  }

  const gapLevel = options.gapCloseLevel;
  const boundaryMask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (isBoundaryPixel(pixelData, idx, options.enableIncludeTrace, options.traceColors)) {
        boundaryMask[y * width + x] = 1;
      }
    }
  }

  const dilatedMask = new Uint8Array(width * height);
  dilatedMask.set(boundaryMask);

  if (gapLevel > 0) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (boundaryMask[y * width + x] === 1) {
          for (let dy = -gapLevel; dy <= gapLevel; dy++) {
            for (let dx = -gapLevel; dx <= gapLevel; dx++) {
              if (dx * dx + dy * dy <= gapLevel * gapLevel) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                  dilatedMask[ny * width + nx] = 1;
                }
              }
            }
          }
        }
      }
    }
  }

  const queue: number[] = [startX, startY];
  const visited = new Uint8Array(width * height);
  const filledPixels: number[] = [];

  visited[startY * width + startX] = 1;

  while (queue.length > 0) {
    const cy = queue.pop()!;
    const cx = queue.pop()!;
    const cPos = cy * width + cx;
    const cIdx = cPos * 4;

    const r = pixelData[cIdx];
    const g = pixelData[cIdx + 1];
    const b = pixelData[cIdx + 2];

    if (options.enableIncludeTrace && isTraceColor(r, g, b, options.traceColors)) {
      if (!options.retainTraceLine) {
        pixelData[cIdx] = fillColor.r;
        pixelData[cIdx + 1] = fillColor.g;
        pixelData[cIdx + 2] = fillColor.b;
        pixelData[cIdx + 3] = fillColor.a;
        filledPixels.push(cPos);
      }
      continue;
    }

    pixelData[cIdx] = fillColor.r;
    pixelData[cIdx + 1] = fillColor.g;
    pixelData[cIdx + 2] = fillColor.b;
    pixelData[cIdx + 3] = fillColor.a;
    filledPixels.push(cPos);

    const neighbors = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];

    for (let i = 0; i < neighbors.length; i++) {
      const [nx, ny] = neighbors[i];
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nPos = ny * width + nx;
        if (visited[nPos] === 0) {
          visited[nPos] = 1;

          if (dilatedMask[nPos] === 1) {
            const nIdx = nPos * 4;
            const nr = pixelData[nIdx];
            const ng = pixelData[nIdx + 1];
            const nb = pixelData[nIdx + 2];
            if (options.enableIncludeTrace && isTraceColor(nr, ng, nb, options.traceColors)) {
              queue.push(nx, ny);
            }
          } else {
            queue.push(nx, ny);
          }
        }
      }
    }
  }

  const expand = options.expandContract || 0;
  if (expand > 0) {
    for (const pPos of filledPixels) {
      const px = pPos % width;
      const py = Math.floor(pPos / width);
      for (let dy = -expand; dy <= expand; dy++) {
        for (let dx = -expand; dx <= expand; dx++) {
          if (dx * dx + dy * dy <= expand * expand) {
            const nx = px + dx;
            const ny = py + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = (ny * width + nx) * 4;
              pixelData[nIdx] = fillColor.r;
              pixelData[nIdx + 1] = fillColor.g;
              pixelData[nIdx + 2] = fillColor.b;
              pixelData[nIdx + 3] = fillColor.a;
            }
          }
        }
      }
    }
  }
}

/**
 * Gradient Fill: Fills an area with a linear gradient between ColorA and ColorB.
 */
export function gradientFill(
  pixelData: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  colorA: RGBAColor,
  colorB: RGBAColor,
  options: FillOptions
): void {
  // First calculate flood fill region
  const regionPixels: number[] = [];
  const queue: number[] = [startX, startY];
  const visited = new Uint8Array(width * height);
  visited[startY * width + startX] = 1;

  let minY = height, maxY = 0;

  while (queue.length > 0) {
    const cy = queue.pop()!;
    const cx = queue.pop()!;
    const cPos = cy * width + cx;

    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
    regionPixels.push(cPos);

    const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nPos = ny * width + nx;
        const nIdx = nPos * 4;
        if (visited[nPos] === 0 && !isBoundaryPixel(pixelData, nIdx, options.enableIncludeTrace, options.traceColors)) {
          visited[nPos] = 1;
          queue.push(nx, ny);
        }
      }
    }
  }

  const rangeY = Math.max(1, maxY - minY);

  // Apply Gradient
  for (const pos of regionPixels) {
    const py = Math.floor(pos / width);
    const t = (py - minY) / rangeY;

    const r = Math.round(colorA.r + (colorB.r - colorA.r) * t);
    const g = Math.round(colorA.g + (colorB.g - colorA.g) * t);
    const b = Math.round(colorA.b + (colorB.b - colorA.b) * t);

    const idx = pos * 4;
    pixelData[idx] = r;
    pixelData[idx + 1] = g;
    pixelData[idx + 2] = b;
    pixelData[idx + 3] = 255;
  }
}

export function closedAreaFill(
  pixelData: Uint8ClampedArray,
  width: number,
  height: number,
  polygon: { x: number; y: number }[],
  fillColor: RGBAColor,
  options: FillOptions
): void {
  if (polygon.length < 3) return;

  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (const p of polygon) {
    if (p.x < minX) minX = Math.floor(p.x);
    if (p.x > maxX) maxX = Math.ceil(p.x);
    if (p.y < minY) minY = Math.floor(p.y);
    if (p.y > maxY) maxY = Math.ceil(p.y);
  }

  minX = Math.max(0, minX);
  maxX = Math.min(width - 1, maxX);
  minY = Math.max(0, minY);
  maxY = Math.min(height - 1, maxY);

  function pointInPolygon(px: number, py: number): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (pointInPolygon(x, y)) {
        const idx = (y * width + x) * 4;
        const a = pixelData[idx + 3];
        const r = pixelData[idx];
        const g = pixelData[idx + 1];
        const b = pixelData[idx + 2];

        if (a === 0 || (options.enableIncludeTrace && isTraceColor(r, g, b, options.traceColors))) {
          pixelData[idx] = fillColor.r;
          pixelData[idx + 1] = fillColor.g;
          pixelData[idx + 2] = fillColor.b;
          pixelData[idx + 3] = fillColor.a;
        }
      }
    }
  }
}

export function drawBrushLine(
  pixelData: Uint8ClampedArray,
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number,
  color: RGBAColor,
  isEraser: boolean = false
): void {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(dist));

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = Math.round(x1 + (x2 - x1) * t);
    const cy = Math.round(y1 + (y2 - y1) * t);

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          const px = cx + dx;
          const py = cy + dy;
          if (px >= 0 && px < width && py >= 0 && py < height) {
            const idx = (py * width + px) * 4;
            if (isEraser) {
              pixelData[idx] = 255;
              pixelData[idx + 1] = 255;
              pixelData[idx + 2] = 255;
              pixelData[idx + 3] = 0;
            } else {
              pixelData[idx] = color.r;
              pixelData[idx + 1] = color.g;
              pixelData[idx + 2] = color.b;
              pixelData[idx + 3] = color.a;
            }
          }
        }
      }
    }
  }
}

export function removeSingleNoiseAt(
  pixelData: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  maxSize: number = 20
): boolean {
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return false;

  const startPos = startY * width + startX;
  const startIdx = startPos * 4;

  if (pixelData[startIdx + 3] === 0) return false;

  const component: number[] = [startPos];
  const queue: number[] = [startX, startY];
  const visited = new Uint8Array(width * height);
  visited[startPos] = 1;

  while (queue.length > 0) {
    const cy = queue.pop()!;
    const cx = queue.pop()!;

    const neighbors = [
      [cx + 1, cy], [cx - 1, cy],
      [cx, cy + 1], [cx, cy - 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nPos = ny * width + nx;
        const nIdx = nPos * 4;
        if (visited[nPos] === 0 && pixelData[nIdx + 3] !== 0) {
          visited[nPos] = 1;
          component.push(nPos);
          queue.push(nx, ny);

          if (component.length > maxSize) {
            return false;
          }
        }
      }
    }
  }

  if (component.length <= maxSize) {
    for (const pPos of component) {
      const pIdx = pPos * 4;
      pixelData[pIdx] = 255;
      pixelData[pIdx + 1] = 255;
      pixelData[pIdx + 2] = 255;
      pixelData[pIdx + 3] = 0;
    }
    return true;
  }

  return false;
}

export function binarizeImage(
  pixelData: Uint8ClampedArray,
  threshold: number = 180
): void {
  for (let i = 0; i < pixelData.length; i += 4) {
    const r = pixelData[i];
    const g = pixelData[i + 1];
    const b = pixelData[i + 2];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    if (luminance < threshold) {
      pixelData[i] = 0;
      pixelData[i + 1] = 0;
      pixelData[i + 2] = 0;
      pixelData[i + 3] = 255;
    } else {
      pixelData[i] = 255;
      pixelData[i + 1] = 255;
      pixelData[i + 2] = 255;
      pixelData[i + 3] = 0;
    }
  }
}

export function removeNoise(
  pixelData: Uint8ClampedArray,
  width: number,
  height: number,
  maxNoiseSize: number = 3
): void {
  const visited = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = y * width + x;
      const idx = pos * 4;

      if (visited[pos] === 0 && pixelData[idx + 3] !== 0) {
        const component: number[] = [pos];
        const queue: number[] = [x, y];
        visited[pos] = 1;

        while (queue.length > 0) {
          const cy = queue.pop()!;
          const cx = queue.pop()!;

          const neighbors = [
            [cx + 1, cy], [cx - 1, cy],
            [cx, cy + 1], [cx, cy - 1]
          ];

          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nPos = ny * width + nx;
              const nIdx = nPos * 4;
              if (visited[nPos] === 0 && pixelData[nIdx + 3] !== 0) {
                visited[nPos] = 1;
                component.push(nPos);
                queue.push(nx, ny);
              }
            }
          }
        }

        if (component.length <= maxNoiseSize) {
          for (const pPos of component) {
            const pIdx = pPos * 4;
            pixelData[pIdx] = 255;
            pixelData[pIdx + 1] = 255;
            pixelData[pIdx + 2] = 255;
            pixelData[pIdx + 3] = 0;
          }
        }
      }
    }
  }
}
