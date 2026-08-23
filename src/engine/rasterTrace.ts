import { TGAImage } from './tga';

export type RasterTraceMode = 'unmultiply' | 'colorKey';

export interface RasterTraceOptions {
  mode: RasterTraceMode;
  keyColor: { r: number; g: number; b: number }; // Key Color (RGB)
  tolerance: number; // 0 〜 100
}

// 16進数 HEX -> {r, g, b} 変換
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map((c) => c + c).join('');
  }
  const num = parseInt(cleanHex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

// {r, g, b} -> 16進数 HEX 変換
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Smoothstep 補間関数 (0.0 〜 1.0)
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// 高度ラスター透過トレース処理 (Unmultiply / Color Key + Smoothstep)
export function processRasterTrace(image: TGAImage, options: RasterTraceOptions): Uint8ClampedArray {
  const { data } = image;
  const result = new Uint8ClampedArray(data.length);
  result.set(data);

  if (options.mode === 'unmultiply') {
    // 🌟 線画抽出モード (Unmultiply): 白マット除去 ＆ 白フリンジゼロアルファ復元
    for (let i = 0; i < result.length; i += 4) {
      const r = result[i];
      const g = result[i + 1];
      const b = result[i + 2];

      // 白背景に対する反転アルファ計算 (1.0 - max(R,G,B)/255)
      const maxVal = Math.max(r, g, b) / 255.0;
      const alpha = 1.0 - maxVal;

      if (alpha <= 0.02) {
        result[i + 3] = 0; // 完全透明
      } else {
        // 白フリンジの逆算補正
        const invAlpha = 1.0 / alpha;
        const newR = Math.max(0, Math.min(255, Math.round(r * invAlpha)));
        const newG = Math.max(0, Math.min(255, Math.round(g * invAlpha)));
        const newB = Math.max(0, Math.min(255, Math.round(b * invAlpha)));

        result[i] = newR;
        result[i + 1] = newG;
        result[i + 2] = newB;
        result[i + 3] = Math.round(alpha * 255);
      }
    }
  } else {
    // 🌟 カラーキーモード (Color Key): ユークリッド距離 ＋ Smoothstep 境界補間
    const { r: kr, g: kg, b: kb } = options.keyColor;
    const maxDist = Math.sqrt(255 * 255 * 3); // 約 441.67
    const thresholdDist = (options.tolerance / 100) * maxDist;

    const innerDist = thresholdDist * 0.7; // 完全透過領域
    const outerDist = thresholdDist;       // 境界領域

    for (let i = 0; i < result.length; i += 4) {
      const r = result[i];
      const g = result[i + 1];
      const b = result[i + 2];
      const a = result[i + 3];

      if (a === 0) continue;

      const dr = r - kr;
      const dg = g - kg;
      const db = b - kb;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);

      if (dist <= innerDist) {
        result[i + 3] = 0; // 完全透明
      } else if (dist < outerDist) {
        // Smoothstep 境界アルファ半透明補間
        const alphaFactor = smoothstep(innerDist, outerDist, dist);
        result[i + 3] = Math.round(a * alphaFactor);
      }
    }
  }

  return result;
}
