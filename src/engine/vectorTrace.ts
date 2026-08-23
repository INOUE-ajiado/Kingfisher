import { TGAImage } from './tga';

export interface VectorExportOptions {
  tolerance: number; // 0.1 〜 5.0 (曲線フィッティングの平滑化度)
  ignoreWhite: boolean; // 白背景を透過にするか
  colorMerging: number; // 0 〜 100 (ユークリッド色マージ閾値)
  despeckle: number; // 0 〜 50 px (ゴミ除去最小面積)
}

interface Point {
  x: number;
  y: number;
}

// 2点間の距離
function dist(p1: Point, p2: Point): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// 点Pと線分ABとの距離の2乗
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

// Douglas-Peucker アルゴリズムによる高精度頂点削減
function simplifyPath(points: Point[], sqTolerance: number): Point[] {
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
    const left = simplifyPath(points.slice(0, index + 1), sqTolerance);
    const right = simplifyPath(points.slice(index), sqTolerance);
    return left.slice(0, left.length - 1).concat(right);
  } else {
    return [points[0], points[points.length - 1]];
  }
}

// 頂点群から3次ベジェ曲線 (Cubic Bezier Path: "M... C x1 y1, x2 y2, x3 y3...") を構築
function pointsToCubicBezierPath(points: Point[], smoothness: number): string {
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

    // Smooth control points computation (Catmull-Rom to Cubic Bezier)
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

// 高精度サブピクセル境界解析 ＆ 3次ベジエトレースエンジン
export function convertImageToSVG(image: TGAImage, options: VectorExportOptions): string {
  const { width, height, data } = image;
  if (!data || width <= 0 || height <= 0) return '';

  const tolerance = Math.max(0.1, options.tolerance);
  const sqTolerance = tolerance * tolerance * 0.8;
  const totalPixels = width * height;

  const pixelColors = new Int32Array(totalPixels);
  pixelColors.fill(-1);

  const palette: string[] = [];
  const colorToPaletteId = new Map<string, number>();

  // 1. カラー精度の維持 (量子化ステップを細かく設定して解像感・精度向上)
  const qStep = tolerance > 2.0 ? 4 : tolerance > 1.0 ? 2 : 1;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 10) continue;
    if (options.ignoreWhite && r >= 250 && g >= 250 && b >= 250) continue;

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

  const visited = new Uint8Array(totalPixels);
  const svgPaths: string[] = [];

  // 2. サブピクセル精度の境界追跡
  for (let y = 0; y < height; y++) {
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
          // グリッドセンターからサブピクセル座標へオフセット (+0.5)
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
          const simplified = simplifyPath(outlinePoints, sqTolerance);
          if (simplified.length >= 3) {
            const hexColor = palette[targetColorId] || '#000000';
            const bezierD = pointsToCubicBezierPath(simplified, tolerance);
            if (bezierD) {
              svgPaths.push(`<path d="${bezierD}" fill="${hexColor}" stroke="${hexColor}" stroke-width="0.3" stroke-linejoin="round" />`);
            }
          }
        }
      }
    }
  }

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <g shape-rendering="geometricPrecision">
    ${svgPaths.join('\n    ')}
  </g>
</svg>`;
}
