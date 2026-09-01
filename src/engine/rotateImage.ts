/**
 * 画像を 90 度ずつ回す。
 *
 * スキャンした作画用紙が横向きに取り込まれることがあるため、
 * ファイルツリーで選んだものをまとめて立て直せるようにする。
 */

export type RotateDirection = 'right' | 'left';

export interface RotatedImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * RGBA の並びを 90 度回す。回した結果は幅と高さが入れ替わる。
 *
 * ⚠️ 画素を並べ替えるだけにすること。色を混ぜたり丸めたりしないこと。
 * 純白 RGB(255,255,255) を透明として扱う決まりがあるので、
 * 補間を入れると縁の画素が「透明でも不透明でもない」値になり、塗りが漏れる。
 * ⚠️ 回転は元に戻せる操作にしておくこと (右 4 回で元通り)。
 */
export function rotateImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  direction: RotateDirection
): RotatedImage {
  const out = new Uint8ClampedArray(data.length);
  const outWidth = height;
  const outHeight = width;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 右回し: (x, y) → (高さ-1-y, x) / 左回し: (x, y) → (y, 幅-1-x)
      const nx = direction === 'right' ? height - 1 - y : y;
      const ny = direction === 'right' ? x : width - 1 - x;

      const from = (y * width + x) * 4;
      const to = (ny * outWidth + nx) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }

  return { data: out, width: outWidth, height: outHeight };
}

/**
 * 書き出すときの形式。
 *
 * ⚠️ JPEG は開くたびに圧縮し直すので、回すと少しずつ画質が落ちる。
 * 呼び出し側は、それを確認の文面に必ず書くこと。
 */
export function encodeTypeFor(path: string): { mime: string; quality?: number } {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (ext === 'png') return { mime: 'image/png' };
  if (ext === 'webp') return { mime: 'image/webp', quality: 0.95 };
  return { mime: 'image/jpeg', quality: 0.95 };
}

/** 回した向きの呼び名 (ログと確認の文面で揃える) */
export function rotateLabel(direction: RotateDirection): string {
  return direction === 'right' ? '右へ 90°' : '左へ 90°';
}
