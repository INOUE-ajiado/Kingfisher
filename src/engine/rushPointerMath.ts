/**
 * 配信中に共有するマウスポインターの位置の計算。
 *
 * ⚠️ 画面 (枠) ではなく「映像が実際に映っている四角」を基準に 0〜1 で表すこと。
 * 枠を基準にすると、窓の大きさや縦横比が人によって違うため、
 * オペレーターが指した場所と視聴者に見える場所がずれる。
 *
 * DOM に触れない純粋な関数だけを置く (テストから直接呼べるように)。
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PointerPosition {
  /** 映像の左端からの割合 (0〜1) */
  x: number;
  /** 映像の上端からの割合 (0〜1) */
  y: number;
}

/**
 * object-contain で表示している映像が、枠の中のどこに映っているか。
 * 余白 (レターボックス) を除いた四角を返す。
 */
export function videoContentRect(
  containerWidth: number,
  containerHeight: number,
  videoWidth: number,
  videoHeight: number
): Rect {
  if (!(containerWidth > 0) || !(containerHeight > 0)) return { x: 0, y: 0, width: 0, height: 0 };
  if (!(videoWidth > 0) || !(videoHeight > 0)) {
    // 映像の大きさが分からないうちは枠いっぱいとみなす
    return { x: 0, y: 0, width: containerWidth, height: containerHeight };
  }
  const scale = Math.min(containerWidth / videoWidth, containerHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return { x: (containerWidth - width) / 2, y: (containerHeight - height) / 2, width, height };
}

/** 枠の中の座標 → 映像内の割合。映像の外なら null (ポインターを出さない) */
export function toVideoPosition(offsetX: number, offsetY: number, content: Rect): PointerPosition | null {
  if (!(content.width > 0) || !(content.height > 0)) return null;
  const x = (offsetX - content.x) / content.width;
  const y = (offsetY - content.y) / content.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/** 映像内の割合 → 枠の中の座標 (視聴者の画面で描く位置) */
export function fromVideoPosition(position: PointerPosition, content: Rect): { left: number; top: number } {
  return {
    left: content.x + position.x * content.width,
    top: content.y + position.y * content.height,
  };
}

/** 位置を送る間隔 (ms)。滑らかさと通信量の折り合い */
export const POINTER_SEND_INTERVAL_MS = 60;

/** この時間だけ更新が無ければ、送り手が離れたとみなして消す */
export const POINTER_STALE_MS = 5000;

export function isPointerFresh(updatedAt: number, now: number): boolean {
  return now - updatedAt < POINTER_STALE_MS;
}
