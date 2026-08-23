import { TGAImage } from './tga';

export interface VectorExportOptions {
  tolerance: number; // 0.1 〜 5.0 (曲線フィッティングの平滑化度)
  ignoreWhite: boolean; // 白背景を透過にするか
}

interface Point {
  x: number;
  y: number;
}

// 2点間の距離の2乗
function distSq(p1: Point, p2: Point): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return dx * dx + dy * dy;
}

// 点Pと線分ABとの距離の2乗
function pointToSegmentDistSq(p: Point, a: Point, b: Point): number {
  const l2 = distSq(a, b);
  if (l2 === 0) return distSq(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  return distSq(p, proj);
}

// Douglas-Peucker アルゴリズムによる頂点削減
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

// メモリ効率 O(1) ・安全ガード付きラスター -> SVG ベクトルトレースエンジン
export function convertImageToSVG(image: TGAImage, options: VectorExportOptions): string {
  const { width, height, data } = image;
  if (!data || width <= 0 || height <= 0) return '';

  const tolerance = Math.max(0.1, options.tolerance);
  const sqTolerance = tolerance * tolerance * 2;
  const totalPixels = width * height;

  // メモリ割り当てエラーを防ぐ単一のインデックス配列 (約 width * height * 4 バイトのみ)
  const pixelColors = new Int32Array(totalPixels);
  pixelColors.fill(-1);

  // カラーパレット (RGB -> PaletteID)
  const palette: string[] = [];
  const colorToPaletteId = new Map<string, number>();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 10) continue; // 透明エリアスキップ
    if (options.ignoreWhite && r >= 248 && g >= 248 && b >= 248) continue; // 白背景スキップ

    // 色精度を量子化して色数を適切に収束 (メモリ爆発防止)
    const qr = Math.round(r / 4) * 4;
    const qg = Math.round(g / 4) * 4;
    const qb = Math.round(b / 4) * 4;
    const colorKey = `${qr},${qg},${qb}`;

    let paletteId = colorToPaletteId.get(colorKey);
    if (paletteId === undefined) {
      if (palette.length >= 512) {
        paletteId = 0; // 最大色数制限
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

  // 単一パスで輪郭抽出
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const targetColorId = pixelColors[idx];

      if (targetColorId !== -1 && visited[idx] === 0) {
        const outlinePoints: Point[] = [];
        let currX = x;
        let currY = y;
        let dir = 0; // 0: R, 1: D, 2: L, 3: U

        const startX = currX;
        const startY = currY;
        let steps = 0;
        const maxSteps = width * 4 + height * 4;

        while (steps < maxSteps) {
          outlinePoints.push({ x: currX, y: currY });
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
            let d = `M ${simplified[0].x} ${simplified[0].y}`;
            for (let i = 1; i < simplified.length; i++) {
              d += ` L ${simplified[i].x} ${simplified[i].y}`;
            }
            d += ' Z';
            svgPaths.push(`<path d="${d}" fill="${hexColor}" stroke="${hexColor}" stroke-width="0.5" stroke-linejoin="round" />`);
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
