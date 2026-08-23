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

// ラスターセル画像を解析し、最適化されたSVGベクターコードを生成
export function convertImageToSVG(image: TGAImage, options: VectorExportOptions): string {
  const { width, height, data } = image;
  const tolerance = Math.max(0.1, options.tolerance);
  const sqTolerance = tolerance * tolerance * 2;

  // 1. カラー領域の分離・グループ化 (Key: "r,g,b")
  const colorBitmaps = new Map<string, Uint8Array>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      if (a < 10) continue; // アルファ透明領域はスキップ
      if (options.ignoreWhite && r >= 250 && g >= 250 && b >= 250) continue; // 白背景透過スキップ

      const colorKey = `${r},${g},${b}`;
      let bitmap = colorBitmaps.get(colorKey);
      if (!bitmap) {
        bitmap = new Uint8Array(width * height);
        colorBitmaps.set(colorKey, bitmap);
      }
      bitmap[y * width + x] = 1;
    }
  }

  const svgPaths: string[] = [];

  // 2. 各カラー領域ごとに輪郭ポリゴン抽出し、SVG <path> 化
  colorBitmaps.forEach((bitmap, colorKey) => {
    const [r, g, b] = colorKey.split(',').map(Number);
    const hexColor = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;

    const visited = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (bitmap[idx] === 1 && visited[idx] === 0) {
          // 水平・垂直方向の輪郭境界を追跡
          const outlinePoints: Point[] = [];
          let currX = x;
          let currY = y;
          let dir = 0; // 0: Right, 1: Down, 2: Left, 3: Up

          const startX = currX;
          const startY = currY;

          let stepCount = 0;
          const maxSteps = width * height * 4;

          while (stepCount < maxSteps) {
            outlinePoints.push({ x: currX, y: currY });
            visited[currY * width + currX] = 1;

            // 4方向輪郭トレーサー
            let foundNext = false;
            for (let i = 0; i < 4; i++) {
              const checkDir = (dir + 3 + i) % 4; // 左回りを優先チェック
              let nx = currX;
              let ny = currY;

              if (checkDir === 0) nx++;
              else if (checkDir === 1) ny++;
              else if (checkDir === 2) nx--;
              else if (checkDir === 3) ny--;

              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                if (bitmap[ny * width + nx] === 1) {
                  currX = nx;
                  currY = ny;
                  dir = checkDir;
                  foundNext = true;
                  break;
                }
              }
            }

            if (!foundNext || (currX === startX && currY === startY)) {
              break;
            }
            stepCount++;
          }

          if (outlinePoints.length >= 3) {
            // Douglas-Peucker で頂点を滑らかに削減
            const simplified = simplifyPath(outlinePoints, sqTolerance);

            if (simplified.length >= 3) {
              // SVG path d パラメータ作成
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
  });

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <g shape-rendering="geometricPrecision">
    ${svgPaths.join('\n    ')}
  </g>
</svg>`;
}
