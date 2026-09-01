/**
 * JPEG の解像度 (DPI) を引き継ぐ。
 *
 * ⚠️ キャンバスで書き出し直すと解像度の情報が消える (72dpi 相当になる)。
 * スキャン原稿は 300/600dpi で取り込まれ、後工程がその値を見る。
 * 本家 (OLMPegHoleStabilizer) も dotsPerMeterX/Y を読んで書き戻している。
 */

/** JFIF (APP0) の密度。units 0=単位なし / 1=dpi / 2=dpcm */
export interface JpegDensity {
  units: number;
  x: number;
  y: number;
}

/** APP0 "JFIF\0" セグメントの先頭位置を探す */
function findJfif(bytes: Uint8Array): number {
  // SOI (FFD8) の直後からマーカーを辿る
  let at = 2;
  while (at + 4 < bytes.length) {
    if (bytes[at] !== 0xff) return -1;
    const marker = bytes[at + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xda) return -1; // 画像本体に入った

    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker === 0xe0 && at + 9 < bytes.length) {
      const tag = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
      if (tag === 'JFIF' && bytes[at + 8] === 0) return at;
    }
    at += 2 + length;
  }
  return -1;
}

/** JFIF の密度を読む。無ければ null */
export function readJpegDensity(buffer: ArrayBuffer | Uint8Array): JpegDensity | null {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const at = findJfif(bytes);
  if (at < 0) return null;

  return {
    units: bytes[at + 11],
    x: (bytes[at + 12] << 8) | bytes[at + 13],
    y: (bytes[at + 14] << 8) | bytes[at + 15],
  };
}

/**
 * 書き出した JPEG に、元の解像度を書き戻す。
 *
 * ⚠️ 中身 (画素) には触れないこと。JFIF の密度 5 バイトだけを差し替える。
 * ⚠️ 元に密度が無い / 書き出し側に JFIF が無いときは、そのまま返すこと。
 * 無理に足すと壊れた JPEG になる。
 */
export function applyJpegDensity(
  output: ArrayBuffer | Uint8Array,
  density: JpegDensity | null
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(output instanceof Uint8Array ? output.slice() : output) as Uint8Array<ArrayBuffer>;
  if (!density || density.units === 0 || (density.x <= 1 && density.y <= 1)) return bytes;

  const at = findJfif(bytes);
  if (at < 0) return bytes;

  bytes[at + 11] = density.units;
  bytes[at + 12] = (density.x >> 8) & 0xff;
  bytes[at + 13] = density.x & 0xff;
  bytes[at + 14] = (density.y >> 8) & 0xff;
  bytes[at + 15] = density.y & 0xff;
  return bytes;
}
