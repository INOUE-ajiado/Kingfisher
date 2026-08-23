// 🌟 Kingfisher Web Worker: 堅牢非同期ベクタートレース Worker (進捗 ＆ ターミナルログ対応)
export interface WorkerTraceInput {
  requestId: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  tolerance: number;
  ignoreWhite: boolean;
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
    const cp1y = p1.y + (p2.y - p0.y) * tension * (d2 / (d1 + d2 || 1));

    const cp2x = p2.x - (p3.x - p1.x) * tension * (d2 / (d2 + d3 || 1));
    const cp2y = p2.y - (p3.y - p1.y) * tension * (d2 / (d2 + d3 || 1));

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  d += ' Z';
  return d;
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
  const { requestId, width, height, buffer, tolerance, ignoreWhite } = e.data;

  try {
    notifyProgress(requestId, 5, '並列ベクター変換パイプライン初期化...', 'Worker initialized. Reading buffer data.');

    const data = new Uint8ClampedArray(buffer);
    if (!data || width <= 0 || height <= 0) {
      self.postMessage({ type: 'SUCCESS', requestId, svgString: '', log: '[DEBUG]: Image data is empty.' });
      return;
    }

    // フェーズ 1: カラークラスタリング (0% 〜 20%)
    notifyProgress(requestId, 10, 'カラークラスタリング実行中...', `Processing color clustering for ${width}x${height} px.`);

    const sqTolerance = Math.max(0.1, tolerance) * Math.max(0.1, tolerance) * 0.8;
    const totalPixels = width * height;

    const pixelColors = new Int32Array(totalPixels);
    pixelColors.fill(-1);

    const palette: string[] = [];
    const colorToPaletteId = new Map<string, number>();

    const qStep = tolerance > 2.0 ? 4 : tolerance > 1.0 ? 2 : 1;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 10) continue;
      if (ignoreWhite && r >= 250 && g >= 250 && b >= 250) continue;

      const qr = Math.round(r / qStep) * qStep;
      const qg = Math.round(g / qStep) * qStep;
      const qb = Math.round(b / qStep) * qStep;
      const colorKey = `${qr},${qg},${qb}`;

      let paletteId = colorToPaletteId.get(colorKey);
      if (paletteId === undefined) {
        if (palette.length >= 1024) {
          paletteId = 0;
        } else {
          paletteId = palette.length;
          const hex = `#${((1 << 24) + (qr << 16) + (qg << 8) + qb).toString(16).slice(1)}`;
          palette.push(hex);
          colorToPaletteId.set(colorKey, paletteId);
        }
      }
      pixelColors[i / 4] = paletteId;
    }

    notifyProgress(requestId, 20, 'カラー分離完了', `Extracted ${palette.length} unique color clusters.`);

    // フェーズ 2: 輪郭抽出 / Marching Squares (20% 〜 60%) ＆ フェーズ 3: 3次ベジェ変換 (60% 〜 95%)
    const visited = new Uint8Array(totalPixels);
    const svgPaths: string[] = [];

    const totalRows = height;

    for (let y = 0; y < height; y++) {
      if (y % Math.max(1, Math.floor(height / 10)) === 0) {
        const progress = 20 + (y / totalRows) * 45; // 20% to 65%
        notifyProgress(
          requestId,
          progress,
          `輪郭解析・Marching Squares 中 (${Math.round((y / totalRows) * 100)}%)...`,
          `Scanning row ${y}/${height} for boundary contours.`
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
            const simplified = ramerDouglasPeucker(outlinePoints, sqTolerance);
            if (simplified.length >= 3) {
              const hexColor = palette[targetColorId] || '#000000';
              const bezierD = fitCubicBezierPath(simplified, tolerance);
              if (bezierD) {
                svgPaths.push(`<path d="${bezierD}" fill="${hexColor}" stroke="${hexColor}" stroke-width="0.3" stroke-linejoin="round" />`);
              }
            }
          }
        }
      }
    }

    // フェーズ 4: SVG構築 (95% 〜 100%)
    notifyProgress(requestId, 95, 'SVG DOM パス構文構築中...', `Constructing ${svgPaths.length} vector path nodes.`);

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
      log: `[DEBUG] ${timeStr}: SVG vector trace completed successfully (${svgPaths.length} paths).`,
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
