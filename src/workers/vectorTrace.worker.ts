// 🌟 Kingfisher Web Worker: 高精度ベクター変換 パス爆発防止・減色パイプライン (Color Quantization & Despeckle)
export interface WorkerTraceInput {
  requestId: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  tolerance: number;
  ignoreWhite: boolean;
  colorMerging: number; // 0 〜 100
  despeckle: number; // 0 〜 50 px
}

export type WorkerMessageOut =
  | { type: 'PROGRESS'; requestId: number; percent: number; message: string; log: string }
  | { type: 'SUCCESS'; requestId: number; svgString: string; log: string }
  | { type: 'ERROR'; requestId: number; error: string; log: string };

interface Point {
  x: number;
  y: number;
}

function dist(p1: Point, p2: Point): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentDistSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return (p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return (p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY);
}

// Ramer-Douglas-Peucker (RDP) 頂点削減
function ramerDouglasPeucker(points: Point[], sqTolerance: number): Point[] {
  if (points.length <= 2) return points;

  let maxSqDist = 0;
  let index = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const sqDist = pointToSegmentDistSq(points[i], points[0], points[points.length - 1]);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }

  if (maxSqDist > sqTolerance) {
    const left = ramerDouglasPeucker(points.slice(0, index + 1), sqTolerance);
    const right = ramerDouglasPeucker(points.slice(index), sqTolerance);
    return left.slice(0, left.length - 1).concat(right);
  } else {
    return [points[0], points[points.length - 1]];
  }
}

// 3次ベジェ曲線フィッティング
function fitCubicBezierPath(points: Point[], smoothness: number): string {
  const len = points.length;
  if (len < 2) return '';
  if (len === 2) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  for (let i = 0; i < len - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i < len - 2 ? points[i + 2] : p2;

    const d1 = dist(p0, p1);
    const d2 = dist(p1, p2);
    const d3 = dist(p2, p3);

    const tension = Math.min(0.4, 0.25 * smoothness);

    const cp1x = p1.x + (p2.x - p0.x) * tension * (d2 / (d1 + d2 || 1));
    const cp1y = p1.y + (p2.y - p0.y) * tension * (d2 / (d2 + d3 || 1));

    const cp2x = p2.x - (p3.x - p1.x) * tension * (d2 / (d2 + d3 || 1));
    const cp2y = p2.y - (p3.y - p1.y) * tension * (d2 / (d2 + d3 || 1));

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  d += ' Z';
  return d;
}

// ポリゴン面積計算 (Shoelace formula)
function polygonArea(points: Point[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

// ユークリッド色距離 (0〜441.67)
function colorDistanceSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

function notifyProgress(requestId: number, percent: number, message: string, detail?: string) {
  const timeStr = new Date().toLocaleTimeString('ja-JP');
  const log = detail ? `[DEBUG] ${timeStr}: ${detail}` : `[DEBUG] ${timeStr}: ${message}`;
  const out: WorkerMessageOut = {
    type: 'PROGRESS',
    requestId,
    percent: Math.min(100, Math.max(0, Math.round(percent))),
    message,
    log,
  };
  self.postMessage(out);
}

self.onmessage = (e: MessageEvent<WorkerTraceInput>) => {
  const { requestId, width, height, buffer, tolerance, ignoreWhite, colorMerging, despeckle } = e.data;

  try {
    notifyProgress(requestId, 5, '減色トレースパイプライン初期化...', 'Starting Color Quantization & Despeckle Pipeline.');

    const data = new Uint8ClampedArray(buffer);
    if (!data || width <= 0 || height <= 0) {
      self.postMessage({ type: 'SUCCESS', requestId, svgString: '', log: '[DEBUG]: Image data is empty.' });
      return;
    }

    const totalPixels = width * height;
    const pixelColors = new Int32Array(totalPixels);
    pixelColors.fill(-1);

    // 🌟 Step 1 & 2: ユークリッドカラー減色・クラスタリング (Color Quantization)
    notifyProgress(requestId, 15, 'ユークリッド減色・似た色マージ中...', `Color Merging Threshold: ${colorMerging}`);

    // ユークリッド距離の閾値 (0 〜 100 -> 距離 0 〜 250)
    const colorDistThresholdSq = Math.pow((colorMerging / 100) * 250, 2);

    const palette: { r: number; g: number; b: number; hex: string }[] = [];

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 10) continue;
      if (ignoreWhite && r >= 250 && g >= 250 && b >= 250) continue;

      let matchedId = -1;

      // 既存のパレットとのユークリッド距離を検索
      if (colorDistThresholdSq > 0) {
        for (let pid = 0; pid < palette.length; pid++) {
          const p = palette[pid];
          if (colorDistanceSq(r, g, b, p.r, p.g, p.b) <= colorDistThresholdSq) {
            matchedId = pid;
            break;
          }
        }
      }

      // 新しい色クラスターの追加
      if (matchedId === -1) {
        if (palette.length >= 256) {
          matchedId = 0; // マップ上限超過時は最も近い色へ
        } else {
          matchedId = palette.length;
          const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
          palette.push({ r, g, b, hex });
        }
      }

      pixelColors[i / 4] = matchedId;
    }

    notifyProgress(
      requestId,
      25,
      `減色完了 (${palette.length}色クラスター)`,
      `Compressed image colors into ${palette.length} distinct vector color regions.`
    );

    // 🌟 Step 3: 輪郭抽出 (Marching Squares) ＋ 面積フィルタ (Despeckle / Area Threshold)
    const visited = new Uint8Array(totalPixels);
    const svgPaths: string[] = [];
    const sqTolerance = Math.max(0.1, tolerance) * Math.max(0.1, tolerance) * 0.8;
    const minArea = Math.max(0, despeckle); // 破棄する最小ピクセル面積

    let ignoredSpeckleCount = 0;

    for (let y = 0; y < height; y++) {
      if (y % Math.max(1, Math.floor(height / 10)) === 0) {
        const progress = 25 + (y / height) * 45; // 25% to 70%
        notifyProgress(
          requestId,
          progress,
          `輪郭解析・Despeckle 処理中 (${Math.round((y / height) * 100)}%)...`,
          `Filtering speckle noise (Min Area: ${minArea} px). Row ${y}/${height}.`
        );
      }

      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const targetColorId = pixelColors[idx];

        if (targetColorId !== -1 && visited[idx] === 0) {
          const outlinePoints: Point[] = [];
          let currX = x;
          let currY = y;
          let dir = 0;

          const startX = currX;
          const startY = currY;
          let steps = 0;
          const maxSteps = width * 4 + height * 4;

          while (steps < maxSteps) {
            outlinePoints.push({ x: currX + 0.5, y: currY + 0.5 });
            visited[currY * width + currX] = 1;

            let found = false;
            for (let i = 0; i < 4; i++) {
              const checkDir = (dir + 3 + i) % 4;
              let nx = currX;
              let ny = currY;

              if (checkDir === 0) nx++;
              else if (checkDir === 1) ny++;
              else if (checkDir === 2) nx--;
              else if (checkDir === 3) ny--;

              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nIdx = ny * width + nx;
                if (pixelColors[nIdx] === targetColorId) {
                  currX = nx;
                  currY = ny;
                  dir = checkDir;
                  found = true;
                  break;
                }
              }
            }

            if (!found || (currX === startX && currY === startY)) break;
            steps++;
          }

          if (outlinePoints.length >= 3) {
            // 面積計算と Despeckle 破棄チェック
            const area = polygonArea(outlinePoints);
            if (area < minArea) {
              ignoredSpeckleCount++;
              continue; // 小さすぎるゴミポリゴンは完全に破棄
            }

            // 🌟 Step 4: RDP 頂点削減 ＆ 3次ベジェ曲線フィッティング
            const simplified = ramerDouglasPeucker(outlinePoints, sqTolerance);
            if (simplified.length >= 3) {
              const hexColor = palette[targetColorId]?.hex || '#000000';
              const bezierD = fitCubicBezierPath(simplified, tolerance);
              if (bezierD) {
                svgPaths.push(`<path d="${bezierD}" fill="${hexColor}" stroke="${hexColor}" stroke-width="0.3" stroke-linejoin="round" />`);
              }
            }
          }
        }
      }
    }

    notifyProgress(
      requestId,
      90,
      `ノイズ破棄完了 (${ignoredSpeckleCount}個のゴミ破棄)`,
      `Despeckled ${ignoredSpeckleCount} tiny noise polygons.`
    );

    // SVG パス描画
    notifyProgress(requestId, 95, '最適化 SVG 文字列の構築...', `Building final SVG with ${svgPaths.length} smooth bezier paths.`);

    const svgString = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <g shape-rendering="geometricPrecision">
    ${svgPaths.join('\n    ')}
  </g>
</svg>`;

    const timeStr = new Date().toLocaleTimeString('ja-JP');
    const successOutput: WorkerMessageOut = {
      type: 'SUCCESS',
      requestId,
      svgString,
      log: `[DEBUG] ${timeStr}: SVG trace complete! Created ${svgPaths.length} paths (Ignored ${ignoredSpeckleCount} noise dots).`,
    };
    self.postMessage(successOutput);
  } catch (err: any) {
    const timeStr = new Date().toLocaleTimeString('ja-JP');
    const errorOutput: WorkerMessageOut = {
      type: 'ERROR',
      requestId,
      error: err.message || 'Worker processing error',
      log: `[ERROR] ${timeStr}: ${err.message || 'Worker processing error'}`,
    };
    self.postMessage(errorOutput);
  }
};
