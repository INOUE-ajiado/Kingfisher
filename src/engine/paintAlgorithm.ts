// PaintMan 互換の超高速・高精度ペイントアルゴリズムエンジン

export interface ToolOptions {
  gapCloseLevel: number;
  enableIncludeTrace: boolean;
  retainTraceLine?: boolean;
  traceColors: { red: boolean; blue: boolean; green: boolean };
  tolerance: number;
  brushSize: number;
  expandContract: number;
  contiguous: boolean;
  sampleSize: '1x1' | '3x3' | '5x5';
  referenceLayer: 'current' | 'all' | 'reference';
}

export type FillOptions = ToolOptions;

export interface RGBAColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

// 特定のピクセルが「色トレス線」かどうかを判定するヘルパー
function isTraceLine(r: number, g: number, b: number, traceColors: { red: boolean; blue: boolean; green: boolean }): boolean {
  if (traceColors.red && r > 180 && g < 100 && b < 100) return true;
  if (traceColors.blue && b > 180 && r < 100 && g < 100) return true;
  if (traceColors.green && g > 180 && r < 100 && b < 100) return true;
  return false;
}

// ピクセルが塗りつぶし境界（壁）であるかを判定
function isBoundary(
  data: Uint8ClampedArray,
  idx: number,
  targetR: number,
  targetG: number,
  targetB: number,
  options: ToolOptions
): boolean {
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  const a = data[idx + 3];

  if (a === 0) return false;

  if (options.enableIncludeTrace && isTraceLine(r, g, b, options.traceColors)) {
    return true; // 色トレス線は壁として扱う
  }

  const diff = Math.abs(r - targetR) + Math.abs(g - targetG) + Math.abs(b - targetB);
  return diff > options.tolerance * 3;
}

// 1. バケツ塗り (Flood Fill)
export function floodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  fillColor: RGBAColor,
  options: ToolOptions
): void {
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;

  const startIdx = (startY * width + startX) * 4;
  const targetR = data[startIdx];
  const targetG = data[startIdx + 1];
  const targetB = data[startIdx + 2];
  const targetA = data[startIdx + 3];

  if (
    targetR === fillColor.r &&
    targetG === fillColor.g &&
    targetB === fillColor.b &&
    targetA === fillColor.a
  ) {
    return;
  }

  const visited = new Uint8Array(width * height);
  const queue: number[] = [startX, startY];
  visited[startY * width + startX] = 1;

  const filledIndices: number[] = [];

  while (queue.length > 0) {
    const y = queue.pop()!;
    const x = queue.pop()!;
    const idx = (y * width + x) * 4;

    if (isBoundary(data, idx, targetR, targetG, targetB, options)) continue;

    // トレス線を残すフラグが有効な場合、トレス線自体は塗らない
    if (options.retainTraceLine && isTraceLine(data[idx], data[idx + 1], data[idx + 2], options.traceColors)) {
      continue;
    }

    filledIndices.push(idx);

    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nPos = ny * width + nx;
        if (!visited[nPos]) {
          visited[nPos] = 1;
          queue.push(nx, ny);
        }
      }
    }
  }

  for (const idx of filledIndices) {
    data[idx] = fillColor.r;
    data[idx + 1] = fillColor.g;
    data[idx + 2] = fillColor.b;
    data[idx + 3] = fillColor.a;
  }

  if (options.expandContract !== 0) {
    applyExpandContract(data, width, height, filledIndices, fillColor, options.expandContract);
  }
}

// 2. グラデーション塗り (Gradient Fill)
export function gradientFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  colorA: RGBAColor,
  colorB: RGBAColor,
  options: ToolOptions
): void {
  const startIdx = (startY * width + startX) * 4;
  const targetR = data[startIdx];
  const targetG = data[startIdx + 1];
  const targetB = data[startIdx + 2];

  const visited = new Uint8Array(width * height);
  const queue: number[] = [startX, startY];
  visited[startY * width + startX] = 1;

  const filledIndices: { x: number; y: number; idx: number }[] = [];

  while (queue.length > 0) {
    const y = queue.pop()!;
    const x = queue.pop()!;
    const idx = (y * width + x) * 4;

    if (isBoundary(data, idx, targetR, targetG, targetB, options)) continue;

    filledIndices.push({ x, y, idx });

    const neighbors = [
      [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nPos = ny * width + nx;
        if (!visited[nPos]) {
          visited[nPos] = 1;
          queue.push(nx, ny);
        }
      }
    }
  }

  for (const item of filledIndices) {
    const factor = item.y / height; // 上から下へのグラデーション
    data[item.idx] = Math.round(colorA.r * (1 - factor) + colorB.r * factor);
    data[item.idx + 1] = Math.round(colorA.g * (1 - factor) + colorB.g * factor);
    data[item.idx + 2] = Math.round(colorA.b * (1 - factor) + colorB.b * factor);
    data[item.idx + 3] = 255;
  }
}

// 3. 領域拡張 / 縮小
function applyExpandContract(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  filledIndices: number[],
  fillColor: RGBAColor,
  amount: number
): void {
  if (amount > 0) {
    const borderIndices = new Set<number>();
    for (const idx of filledIndices) {
      const pixelIdx = idx / 4;
      const x = pixelIdx % width;
      const y = Math.floor(pixelIdx / width);

      for (let dy = -amount; dy <= amount; dy++) {
        for (let dx = -amount; dx <= amount; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = (ny * width + nx) * 4;
            borderIndices.add(nIdx);
          }
        }
      }
    }
    for (const idx of borderIndices) {
      data[idx] = fillColor.r;
      data[idx + 1] = fillColor.g;
      data[idx + 2] = fillColor.b;
      data[idx + 3] = fillColor.a;
    }
  }
}

// 4. 閉領域フィル (Lasso / Closed Area Fill)
export function closedAreaFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  polygon: { x: number; y: number }[],
  fillColor: RGBAColor,
  _options: ToolOptions
): void {
  if (polygon.length < 3) return;

  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (const p of polygon) {
    minX = Math.max(0, Math.min(minX, Math.floor(p.x)));
    maxX = Math.min(width - 1, Math.max(maxX, Math.ceil(p.x)));
    minY = Math.max(0, Math.min(minY, Math.floor(p.y)));
    maxY = Math.min(height - 1, Math.max(maxY, Math.ceil(p.y)));
  }

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (pointInPolygon(x, y, polygon)) {
        const idx = (y * width + x) * 4;
        data[idx] = fillColor.r;
        data[idx + 1] = fillColor.g;
        data[idx + 2] = fillColor.b;
        data[idx + 3] = fillColor.a;
      }
    }
  }
}

function pointInPolygon(x: number, y: number, polygon: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// 5. ブラシ / 消しゴム描画
export function drawBrushLine(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number, y0: number, x1: number, y1: number,
  radius: number,
  color: RGBAColor,
  isEraser: boolean = false
): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let x = x0;
  let y = y0;

  while (true) {
    drawCircle(data, width, height, x, y, radius, color, isEraser);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

function drawCircle(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number, cy: number,
  radius: number,
  color: RGBAColor,
  isEraser: boolean
): void {
  const r2 = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dist2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (dist2 <= r2) {
        const idx = (y * width + x) * 4;
        if (isEraser) {
          data[idx + 3] = 0;
        } else {
          data[idx] = color.r;
          data[idx + 1] = color.g;
          data[idx + 2] = color.b;
          data[idx + 3] = color.a;
        }
      }
    }
  }
}

// 6. 二値化処理
export function binarizeImage(data: Uint8ClampedArray, threshold: number = 128): void {
  for (let i = 0; i < data.length; i += 4) {
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const val = avg < threshold ? 0 : 255;
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
    data[i + 3] = val === 0 ? 255 : 0;
  }
}

// 7. 自動ゴミ取り
export function removeNoise(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxSize: number = 5
): void {
  const visited = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = y * width + x;
      const idx = pos * 4;

      if (data[idx + 3] > 0 && !visited[pos]) {
        const cluster: number[] = [];
        const queue: number[] = [x, y];
        visited[pos] = 1;

        while (queue.length > 0) {
          const cy = queue.pop()!;
          const cx = queue.pop()!;
          const cIdx = (cy * width + cx) * 4;
          cluster.push(cIdx);

          const neighbors = [
            [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]
          ];
          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nPos = ny * width + nx;
              const nIdx = nPos * 4;
              if (data[nIdx + 3] > 0 && !visited[nPos]) {
                visited[nPos] = 1;
                queue.push(nx, ny);
              }
            }
          }
        }

        if (cluster.length <= maxSize) {
          for (const cIdx of cluster) {
            data[cIdx + 3] = 0;
          }
        }
      }
    }
  }
}

// 8. 手動ワンクリックゴミ取り
export function removeSingleNoiseAt(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  maxClusterSize: number = 50
): boolean {
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return false;

  const startIdx = (startY * width + startX) * 4;
  if (data[startIdx + 3] === 0) return false;

  const visited = new Uint8Array(width * height);
  const cluster: number[] = [];
  const queue: number[] = [startX, startY];
  visited[startY * width + startX] = 1;

  while (queue.length > 0) {
    const y = queue.pop()!;
    const x = queue.pop()!;
    const idx = (y * width + x) * 4;
    cluster.push(idx);

    if (cluster.length > maxClusterSize) return false;

    const neighbors = [
      [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
    ];
    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nPos = ny * width + nx;
        const nIdx = nPos * 4;
        if (data[nIdx + 3] > 0 && !visited[nPos]) {
          visited[nPos] = 1;
          queue.push(nx, ny);
        }
      }
    }
  }

  for (const idx of cluster) {
    data[idx + 3] = 0;
  }
  return true;
}

// 9. マッティング理論に基づく線画透過・アルファ抽出 (Unmultiply Alpha Matting)
export function convertWhiteToAlphaMatting(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255.0;
    const g = data[i + 1] / 255.0;
    const b = data[i + 2] / 255.0;

    // アニメ業界の純白判定ルール: RGB(255, 255, 255) は完全透明
    if (r === 1.0 && g === 1.0 && b === 1.0) {
      data[i + 3] = 0;
      continue;
    }

    // 最小チャンネルからのAlpha推定: alpha = 1.0 - min(R, G, B)
    const minC = Math.min(r, Math.min(g, b));
    const alpha = 1.0 - minC;

    if (alpha <= 0.0) {
      data[i + 3] = 0;
      continue;
    }

    // Unmultiply 逆算: 白背景成分の除去
    const whiteBg = 1.0 - alpha;
    const origR = Math.max(0, Math.min(1.0, (r - whiteBg) / alpha));
    const origG = Math.max(0, Math.min(1.0, (g - whiteBg) / alpha));
    const origB = Math.max(0, Math.min(1.0, (b - whiteBg) / alpha));

    data[i] = Math.round(origR * 255.0);
    data[i + 1] = Math.round(origG * 255.0);
    data[i + 2] = Math.round(origB * 255.0);
    data[i + 3] = Math.round(alpha * 255.0);
  }
}
