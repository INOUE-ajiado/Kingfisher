// Kingfisher 彩色コアアルゴリズム (PaintMan 互換)

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

// 走査範囲を限定するための矩形 (x1 / y1 は含む)
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const DIST_INF = 1e9;

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
  targetA: number,
  options: ToolOptions
): boolean {
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  const a = data[idx + 3];

  // 透明画素 (＝純白) は、透明領域を塗るときだけ自由に通り抜けられる。
  // 線そのものをクリックした場合は透明部分を壁として扱い、
  // セル全面が塗り潰されるのを防ぐ。
  if (a === 0) return targetA !== 0;

  if (options.enableIncludeTrace && isTraceLine(r, g, b, options.traceColors)) {
    return true; // 色トレス線は壁として扱う
  }

  const diff = Math.abs(r - targetR) + Math.abs(g - targetG) + Math.abs(b - targetB);
  return diff > options.tolerance * 3;
}

/**
 * 「参照レイヤー (referenceLayer)」オプションの解決。
 * - 'reference' … 参照ウィンドウの画像を境界判定に使う（同一サイズのときのみ）
 * - 'current' / 'all' … 編集中の画像自身を使う
 * いずれの場合も実際に色を書き込む先は data のままで、判定用の配列だけを差し替える。
 */
function resolveSourceData(
  data: Uint8ClampedArray,
  referenceData: Uint8ClampedArray | null | undefined,
  referenceLayer: ToolOptions['referenceLayer']
): Uint8ClampedArray {
  if (referenceLayer === 'reference' && referenceData && referenceData.length === data.length) {
    return referenceData;
  }
  return data;
}

/**
 * 「サンプル範囲 (sampleSize)」オプションに従って基準色を採取する。
 * 3x3 / 5x5 ではアンチエイリアスのざらつきを平均化して拾う。
 */
export function sampleColorAt(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  sampleSize: ToolOptions['sampleSize']
): RGBAColor {
  const radius = sampleSize === '5x5' ? 2 : sampleSize === '3x3' ? 1 : 0;
  const centerIdx = (y * width + x) * 4;

  if (radius === 0) {
    return {
      r: data[centerIdx],
      g: data[centerIdx + 1],
      b: data[centerIdx + 2],
      a: data[centerIdx + 3],
    };
  }

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumA = 0;
  let count = 0;

  for (let dy = -radius; dy <= radius; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      if (nx < 0 || nx >= width) continue;
      const idx = (ny * width + nx) * 4;
      sumR += data[idx];
      sumG += data[idx + 1];
      sumB += data[idx + 2];
      sumA += data[idx + 3];
      count++;
    }
  }

  if (count === 0) {
    return {
      r: data[centerIdx],
      g: data[centerIdx + 1],
      b: data[centerIdx + 2],
      a: data[centerIdx + 3],
    };
  }

  return {
    r: Math.round(sumR / count),
    g: Math.round(sumG / count),
    b: Math.round(sumB / count),
    a: Math.round(sumA / count),
  };
}

/**
 * 2パス・チャンファー距離変換。mask が 1 のピクセルからの距離マップを box 内だけ計算する。
 * 全画素を舐める素朴な膨張 (O(N * r^2)) と違い O(N) で済むので、
 * 隙間閉じ 20px や領域拡張 10px でも実用速度を保てる。
 */
function distanceTransformInBox(mask: Uint8Array, width: number, box: Box): Float32Array {
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const dist = new Float32Array(bw * bh);

  const D1 = 1.0;
  const D2 = 1.4142135623730951;

  for (let by = 0; by < bh; by++) {
    const srcRow = (box.y0 + by) * width + box.x0;
    const dstRow = by * bw;
    for (let bx = 0; bx < bw; bx++) {
      dist[dstRow + bx] = mask[srcRow + bx] ? 0 : DIST_INF;
    }
  }

  // 前方走査 (左上 → 右下)
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const p = by * bw + bx;
      let d = dist[p];
      if (d === 0) continue;
      if (bx > 0) d = Math.min(d, dist[p - 1] + D1);
      if (by > 0) {
        d = Math.min(d, dist[p - bw] + D1);
        if (bx > 0) d = Math.min(d, dist[p - bw - 1] + D2);
        if (bx < bw - 1) d = Math.min(d, dist[p - bw + 1] + D2);
      }
      dist[p] = d;
    }
  }

  // 後方走査 (右下 → 左上)
  for (let by = bh - 1; by >= 0; by--) {
    for (let bx = bw - 1; bx >= 0; bx--) {
      const p = by * bw + bx;
      let d = dist[p];
      if (d === 0) continue;
      if (bx < bw - 1) d = Math.min(d, dist[p + 1] + D1);
      if (by < bh - 1) {
        d = Math.min(d, dist[p + bw] + D1);
        if (bx < bw - 1) d = Math.min(d, dist[p + bw + 1] + D2);
        if (bx > 0) d = Math.min(d, dist[p + bw - 1] + D2);
      }
      dist[p] = d;
    }
  }

  return dist;
}

// 境界（壁）マスクを画像全体に対して構築する
function buildWallMask(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  targetR: number,
  targetG: number,
  targetB: number,
  targetA: number,
  options: ToolOptions
): Uint8Array {
  const total = width * height;
  const wall = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    if (isBoundary(src, p * 4, targetR, targetG, targetB, targetA, options)) wall[p] = 1;
  }
  return wall;
}

// allowed が 1 のピクセルだけを通る 4 近傍 BFS
function floodRegion(
  allowed: Uint8Array,
  width: number,
  height: number,
  seeds: number[]
): { mask: Uint8Array; box: Box } {
  const total = width * height;
  const mask = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (const seed of seeds) {
    if (seed < 0 || seed >= total || !allowed[seed] || mask[seed]) continue;
    mask[seed] = 1;
    queue[tail++] = seed;
  }

  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const y = (p - x) / width;

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    if (x > 0 && allowed[p - 1] && !mask[p - 1]) { mask[p - 1] = 1; queue[tail++] = p - 1; }
    if (x < width - 1 && allowed[p + 1] && !mask[p + 1]) { mask[p + 1] = 1; queue[tail++] = p + 1; }
    if (y > 0 && allowed[p - width] && !mask[p - width]) { mask[p - width] = 1; queue[tail++] = p - width; }
    if (y < height - 1 && allowed[p + width] && !mask[p + width]) { mask[p + width] = 1; queue[tail++] = p + width; }
  }

  if (maxX < 0) return { mask, box: { x0: 0, y0: 0, x1: 0, y1: 0 } };
  return { mask, box: { x0: minX, y0: minY, x1: maxX, y1: maxY } };
}

// region の中を start から BFS し、最初に見つかる core ピクセルを返す (見つからなければ -1)
function findNearestCoreSeed(
  region: Uint8Array,
  core: Uint8Array,
  width: number,
  height: number,
  start: number,
  maxSteps: number
): number {
  if (core[start]) return start;

  const total = width * height;
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  let steps = 0;

  seen[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const p = queue[head++];
    if (++steps > maxSteps) return -1;

    const x = p % width;
    const y = (p - x) / width;

    const push = (np: number) => {
      if (!seen[np] && region[np]) {
        seen[np] = 1;
        queue[tail++] = np;
      }
    };

    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (y > 0) push(p - width);
    if (y < height - 1) push(p + width);

    if (core[p]) return p;
  }

  return -1;
}

function clampBox(box: Box, margin: number, width: number, height: number): Box {
  return {
    x0: Math.max(0, box.x0 - margin),
    y0: Math.max(0, box.y0 - margin),
    x1: Math.min(width - 1, box.x1 + margin),
    y1: Math.min(height - 1, box.y1 + margin),
  };
}

/**
 * 塗りつぶし対象の領域マスクを求める中核ロジック。
 * バケツ塗り・グラデーション塗りの両方から使う。
 *
 * 対応オプション:
 *  - sampleSize      : 基準色の採取範囲
 *  - referenceLayer  : 境界判定に使う画像
 *  - contiguous      : false なら連結を無視して画像全体の同色域を対象にする
 *  - gapCloseLevel   : 線画の途切れ (px) を塞いで液漏れを防ぐ
 *  - retainTraceLine : 色トレス線自体は塗り残す
 *  - expandContract  : 確定した領域を膨張 / 収縮させる
 */
function computeFillRegion(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  options: ToolOptions,
  referenceData?: Uint8ClampedArray | null
): { mask: Uint8Array; target: RGBAColor } | null {
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return null;

  const src = resolveSourceData(data, referenceData, options.referenceLayer);
  const target = sampleColorAt(src, width, height, startX, startY, options.sampleSize);
  const total = width * height;
  const startPos = startY * width + startX;

  const wall = buildWallMask(src, width, height, target.r, target.g, target.b, target.a, options);

  // --- 1. 基本領域の決定 -------------------------------------------------
  let region: Uint8Array;
  let box: Box;

  if (!options.contiguous) {
    // 非連続モード: 画像全体の「壁でない (＝基準色とみなせる)」ピクセルすべて
    region = new Uint8Array(total);
    for (let p = 0; p < total; p++) region[p] = wall[p] ? 0 : 1;
    box = { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
  } else {
    if (wall[startPos]) return null; // 壁そのものをクリックした場合は何もしない

    const allowed = new Uint8Array(total);
    for (let p = 0; p < total; p++) allowed[p] = wall[p] ? 0 : 1;

    const flooded = floodRegion(allowed, width, height, [startPos]);
    region = flooded.mask;
    box = flooded.box;

    // --- 2. 隙間閉じ (Gap Close) ---------------------------------------
    const gapLevel = Math.max(0, Math.min(20, options.gapCloseLevel || 0));
    if (gapLevel > 0) {
      // gapCloseLevel は「塞ぎたい隙間の幅(px)」。判定半径はその半分。
      const radius = Math.max(0.5, gapLevel / 2);
      const margin = Math.ceil(radius) + 2;
      const wallBox = clampBox(box, margin, width, height);
      const bw = wallBox.x1 - wallBox.x0 + 1;

      const distToWall = distanceTransformInBox(wall, width, wallBox);

      // 壁から radius より離れた「芯」の部分だけを残す (＝自由空間の収縮)
      const core = new Uint8Array(total);
      let coreCount = 0;
      for (let y = wallBox.y0; y <= wallBox.y1; y++) {
        const srcRow = y * width;
        const bRow = (y - wallBox.y0) * bw;
        for (let x = wallBox.x0; x <= wallBox.x1; x++) {
          const p = srcRow + x;
          if (region[p] && distToWall[bRow + (x - wallBox.x0)] > radius) {
            core[p] = 1;
            coreCount++;
          }
        }
      }

      if (coreCount > 0) {
        // クリック地点から領域内を辿って最初に到達する芯を種にする。
        // 遠すぎる場合 (＝クリックした側に芯が存在しない細い領域) は隙間閉じを諦める。
        const maxSteps = Math.max(64, Math.ceil(radius * radius * 64));
        const seed = findNearestCoreSeed(region, core, width, height, startPos, maxSteps);

        if (seed >= 0) {
          const coreComp = floodRegion(core, width, height, [seed]).mask;
          const coreBox = clampBox(box, margin, width, height);
          const cbw = coreBox.x1 - coreBox.x0 + 1;
          const distToCore = distanceTransformInBox(coreComp, width, coreBox);

          // 収縮させた分を膨張して戻す。元の region で AND を取るので線を越えることはない。
          const closed = new Uint8Array(total);
          for (let y = coreBox.y0; y <= coreBox.y1; y++) {
            const srcRow = y * width;
            const bRow = (y - coreBox.y0) * cbw;
            for (let x = coreBox.x0; x <= coreBox.x1; x++) {
              const p = srcRow + x;
              if (region[p] && distToCore[bRow + (x - coreBox.x0)] <= radius + 0.5) {
                closed[p] = 1;
              }
            }
          }
          region = closed;
        }
      }
    }
  }

  // --- 3. 領域の拡張 / 縮小 (expandContract) -----------------------------
  const amount = options.expandContract || 0;
  if (amount !== 0) {
    const absAmount = Math.abs(amount);
    const margin = absAmount + 2;
    const exBox = clampBox(box, margin, width, height);
    const ebw = exBox.x1 - exBox.x0 + 1;

    if (amount > 0) {
      // 膨張: アンチエイリアス線の下へ色を滑り込ませる (線を越えて広げる)
      const distToRegion = distanceTransformInBox(region, width, exBox);
      const expanded = new Uint8Array(total);
      for (let y = exBox.y0; y <= exBox.y1; y++) {
        const srcRow = y * width;
        const bRow = (y - exBox.y0) * ebw;
        for (let x = exBox.x0; x <= exBox.x1; x++) {
          if (distToRegion[bRow + (x - exBox.x0)] <= absAmount + 0.5) expanded[srcRow + x] = 1;
        }
      }
      region = expanded;
    } else {
      // 収縮: 領域の外側からの距離が amount 以下のふちを削る
      const inverted = new Uint8Array(total);
      for (let y = exBox.y0; y <= exBox.y1; y++) {
        const srcRow = y * width;
        for (let x = exBox.x0; x <= exBox.x1; x++) {
          inverted[srcRow + x] = region[srcRow + x] ? 0 : 1;
        }
      }
      const distToOutside = distanceTransformInBox(inverted, width, exBox);
      const contracted = new Uint8Array(total);
      for (let y = exBox.y0; y <= exBox.y1; y++) {
        const srcRow = y * width;
        const bRow = (y - exBox.y0) * ebw;
        for (let x = exBox.x0; x <= exBox.x1; x++) {
          const p = srcRow + x;
          if (region[p] && distToOutside[bRow + (x - exBox.x0)] > absAmount) contracted[p] = 1;
        }
      }
      region = contracted;
    }
  }

  // --- 4. 色トレス線を塗り残す ------------------------------------------
  if (options.retainTraceLine) {
    for (let p = 0; p < total; p++) {
      if (!region[p]) continue;
      const idx = p * 4;
      if (src[idx + 3] !== 0 && isTraceLine(src[idx], src[idx + 1], src[idx + 2], options.traceColors)) {
        region[p] = 0;
      }
    }
  }

  return { mask: region, target };
}

// 1. バケツ塗り (Flood Fill)
export function floodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  fillColor: RGBAColor,
  options: ToolOptions,
  referenceData?: Uint8ClampedArray | null
): void {
  const result = computeFillRegion(data, width, height, startX, startY, options, referenceData);
  if (!result) return;

  const { target } = result;

  // 既に同じ色で塗られている場合は何もしない
  if (
    target.r === fillColor.r &&
    target.g === fillColor.g &&
    target.b === fillColor.b &&
    target.a === fillColor.a
  ) {
    return;
  }

  const mask = result.mask;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const idx = p * 4;
    data[idx] = fillColor.r;
    data[idx + 1] = fillColor.g;
    data[idx + 2] = fillColor.b;
    data[idx + 3] = fillColor.a;
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
  options: ToolOptions,
  referenceData?: Uint8ClampedArray | null
): void {
  const result = computeFillRegion(data, width, height, startX, startY, options, referenceData);
  if (!result) return;

  const mask = result.mask;

  // 領域の上端・下端を求め、その範囲でグラデーションを張る
  let minY = height;
  let maxY = -1;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const y = Math.floor(p / width);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxY < 0) return;

  const span = Math.max(1, maxY - minY);

  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const idx = p * 4;
    const y = Math.floor(p / width);
    const factor = (y - minY) / span;
    data[idx] = Math.round(colorA.r * (1 - factor) + colorB.r * factor);
    data[idx + 1] = Math.round(colorA.g * (1 - factor) + colorB.g * factor);
    data[idx + 2] = Math.round(colorA.b * (1 - factor) + colorB.b * factor);
    data[idx + 3] = 255;
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
