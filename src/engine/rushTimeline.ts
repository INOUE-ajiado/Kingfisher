/**
 * ラッシュのサムネイル・タイムライン (iMovie 風) の寸法計算。
 *
 * 拡大率 zoom は「タイムライン全体の幅 ÷ 見えている幅」。
 *   zoom = 1        … 全体がちょうど収まる
 *   zoom = maxZoom  … サムネイル 1 枚が 1 コマ
 * タイムラインは横に並べたタイルで、各タイルには「そのタイルの左端の時刻のコマ」を描く。
 *
 * DOM に触れない純粋な関数だけを置く (テストから直接呼べるように)。
 */

export interface TimelineTile {
  index: number;
  /** タイムライン上の左端 (px) */
  left: number;
  width: number;
  /** このタイルに描くコマ (0 始まり) */
  frame: number;
}

/** 動画の総コマ数 (最低 1) */
export function totalFrames(duration: number, fps: number): number {
  if (!(duration > 0) || !(fps > 0)) return 1;
  return Math.max(1, Math.ceil(duration * fps - 1e-6));
}

/** これ以上拡大しても意味がない倍率 (タイル 1 枚 = 1 コマ)。最低 1 */
export function maxZoom(duration: number, fps: number, viewportWidth: number, tileWidth: number): number {
  if (!(viewportWidth > 0)) return 1;
  return Math.max(1, (totalFrames(duration, fps) * tileWidth) / viewportWidth);
}

export function clampZoom(zoom: number, max: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(Math.max(zoom, 1), Math.max(1, max));
}

/** スライダー (0〜1) と倍率の対応。倍率は桁が大きく動くので対数で割り付ける */
export function zoomFromSlider(value: number, max: number): number {
  const v = Math.min(Math.max(value, 0), 1);
  return clampZoom(Math.pow(Math.max(1, max), v), max);
}

export function sliderFromZoom(zoom: number, max: number): number {
  if (max <= 1) return 0;
  return Math.min(Math.max(Math.log(clampZoom(zoom, max)) / Math.log(max), 0), 1);
}

export function timelineWidth(viewportWidth: number, zoom: number): number {
  return Math.max(0, viewportWidth * Math.max(1, zoom));
}

/** タイムライン全体のタイル数 */
export function tileCount(width: number, tileWidth: number): number {
  if (!(width > 0) || !(tileWidth > 0)) return 0;
  return Math.ceil(width / tileWidth);
}

/** index 番目のタイル。左端の時刻のコマを描く */
export function tileAt(
  index: number,
  width: number,
  tileWidth: number,
  duration: number,
  fps: number
): TimelineTile {
  const left = index * tileWidth;
  const frames = totalFrames(duration, fps);
  // 境目ちょうどのタイルが浮動小数の誤差で 1 つ前のコマにならないよう、わずかに足してから切り捨てる
  const frame = width > 0 ? Math.min(frames - 1, Math.floor((left / width) * frames + 1e-6)) : 0;
  return { index, left, width: Math.min(tileWidth, Math.max(0, width - left)), frame };
}

/**
 * 見えている範囲のタイル番号 [first, last]。前後に overscan 枚ずつ余分に含める。
 * タイルが無ければ null。
 */
export function visibleTileRange(
  scrollLeft: number,
  viewportWidth: number,
  tileWidth: number,
  count: number,
  overscan = 2
): { first: number; last: number } | null {
  if (count <= 0 || !(tileWidth > 0)) return null;
  const first = Math.max(0, Math.floor(scrollLeft / tileWidth) - overscan);
  const last = Math.min(count - 1, Math.ceil((scrollLeft + viewportWidth) / tileWidth) - 1 + overscan);
  return first <= last ? { first, last } : null;
}

/** 1 枚のタイルが何コマ分を代表しているか (1 未満なら 1 コマを複数枚で描いている) */
export function framesPerTile(width: number, tileWidth: number, duration: number, fps: number): number {
  if (!(width > 0)) return totalFrames(duration, fps);
  return (totalFrames(duration, fps) * tileWidth) / width;
}

/**
 * タイムライン上の位置 x (px) を、そのコマの頭の時刻へ直す。
 *
 * ⚠️ コマの頭ちょうどにシークしないこと。ブラウザは時刻の丸めで 1 つ前のコマを
 * 出すことがあるので、コマの真ん中 (頭 + 0.5 コマ) を指す。
 * タイムコード表示 (floor) で読むと、ちゃんとそのコマになる。
 */
export function timeAtPosition(x: number, width: number, duration: number, fps: number): number {
  if (!(width > 0) || !(duration > 0)) return 0;
  const frames = totalFrames(duration, fps);
  const ratio = Math.min(Math.max(x / width, 0), 1);
  const frame = Math.min(frames - 1, Math.floor(ratio * frames + 1e-6));
  return Math.min(duration, (frame + 0.5) / fps);
}

/** 時刻 → タイムライン上の位置 (px) */
export function positionAtTime(time: number, width: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return (Math.min(Math.max(time, 0), duration) / duration) * width;
}

/**
 * 拡大・縮小したあとのスクロール位置。
 * anchorX (見えている範囲の左端からの px) の下にあった時刻が、拡大後も同じ場所に残るようにする。
 */
export function scrollLeftAfterZoom(
  scrollLeft: number,
  anchorX: number,
  viewportWidth: number,
  oldZoom: number,
  newZoom: number
): number {
  const oldWidth = timelineWidth(viewportWidth, oldZoom);
  const newWidth = timelineWidth(viewportWidth, newZoom);
  if (!(oldWidth > 0)) return 0;
  const ratio = (scrollLeft + anchorX) / oldWidth;
  const next = ratio * newWidth - anchorX;
  return Math.min(Math.max(next, 0), Math.max(0, newWidth - viewportWidth));
}

/**
 * 再生ヘッドが見えている範囲から外れたときの新しいスクロール位置。外れていなければ null。
 * iMovie と同じく、ページをめくるように再生ヘッドを左寄りへ置き直す。
 */
export function scrollToRevealPlayhead(
  playheadX: number,
  scrollLeft: number,
  viewportWidth: number,
  width: number,
  margin = 24
): number | null {
  if (!(viewportWidth > 0) || width <= viewportWidth) return null;
  const inView = playheadX >= scrollLeft + margin && playheadX <= scrollLeft + viewportWidth - margin;
  if (inView) return null;
  const next = playheadX - viewportWidth * 0.15;
  return Math.min(Math.max(next, 0), width - viewportWidth);
}

/**
 * 手元にあるサムネイルの中から、frame に一番近いものを選ぶ (切り出しが追いつくまでの仮の絵)。
 * sortedFrames は昇順。無ければ null。
 */
export function nearestFrame(sortedFrames: number[], frame: number): number | null {
  if (sortedFrames.length === 0) return null;
  let lo = 0;
  let hi = sortedFrames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedFrames[mid] < frame) lo = mid + 1;
    else hi = mid;
  }
  const after = sortedFrames[lo];
  const before = lo > 0 ? sortedFrames[lo - 1] : after;
  return Math.abs(before - frame) <= Math.abs(after - frame) ? before : after;
}
