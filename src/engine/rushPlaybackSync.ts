/**
 * ラッシュの再生をひとつに揃えるための計算。
 *
 * 再生位置は「誰の <video> か」ではなく、Firestore の 1 文書 (rushPlayback) が持つ。
 * その文書には「再生中か・位置・書いた時点」が入り、見ている人は全員
 * (社外の視聴者も、社内の一般画面も、オペレーター自身も) そこに追従する。
 *
 * ⚠️ オペレーターだけ追従から外さないこと。外すと、オペレーターが 2 人いたときに
 * それぞれ別のところを再生してしまい、配信が揃わない。
 * オペレーターの操作は「自分の映像を動かす」のではなく「この文書を書き換える」。
 *
 * 端末どうしの時計はずれていることがあるので、書いた側の時計の値は使わず、
 * 「受け取った瞬間の自分の時計」を基準に経過分を足す (ずれは通信の分だけ、ふつう 1 秒未満)。
 */

export interface PlaybackState {
  playing: boolean;
  /** ホストが書いた時点の再生位置 (秒) */
  position: number;
  /** 配信中か (ルームの LIVE と同じ) */
  live: boolean;
}

/** 受け取ってから now までに進んだ分を足した、いるべき位置 */
export function expectedPosition(state: PlaybackState, receivedAt: number, now: number, duration: number): number {
  const elapsed = state.playing ? Math.max(0, now - receivedAt) / 1000 : 0;
  const pos = state.position + elapsed;
  return Number.isFinite(duration) && duration > 0 ? Math.min(Math.max(pos, 0), duration) : Math.max(pos, 0);
}

/**
 * 今の位置を直すべきか。
 * 再生中は多少の揺れを許す (シークし直すと映像が止まるため)。停止中はコマまで合わせる。
 */
export function shouldResync(actual: number, expected: number, playing: boolean, fps: number): boolean {
  const drift = Math.abs(actual - expected);
  if (playing) return drift > 0.5;
  return drift > 0.5 / fps;
}

// ─── 操作 → 次の再生状態 (オペレーターが書き込む値) ──────────────────────────

export function clampPosition(position: number, duration: number): number {
  const max = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(position, 0), max);
}

/** 再生 / 一時停止の切り替え。終わりに着いていたら頭から再生する */
export function commandToggle(state: PlaybackState, position: number, duration: number): PlaybackState {
  if (state.playing) return { ...state, playing: false, position: clampPosition(position, duration) };
  const atEnd = Number.isFinite(duration) && duration > 0 && position >= duration - 0.05;
  return { ...state, playing: true, position: atEnd ? 0 : clampPosition(position, duration) };
}

/** 位置を動かす (再生中かどうかは変えない) */
export function commandSeek(state: PlaybackState, position: number, duration: number): PlaybackState {
  return { ...state, position: clampPosition(position, duration) };
}

/** コマ送り。送ったら止める (1 コマずつ確かめるための操作なので) */
export function commandStep(
  state: PlaybackState,
  position: number,
  frames: number,
  fps: number,
  duration: number
): PlaybackState {
  return { ...state, playing: false, position: clampPosition(position + frames / fps, duration) };
}
