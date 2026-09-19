/**
 * ホストの再生に視聴者を追従させる計算。
 *
 * ホストは「再生中か・位置・その時点」を Firestore の 1 文書に書く。
 * 視聴者は受け取った時刻から経った分を足して、今いるべき位置を求める。
 * 端末どうしの時計はずれていることがあるので、ホストの時計の値は使わず、
 * 「受け取った瞬間の自分の時計」を基準にする (遅れは通信の分だけ、ふつう 1 秒未満)。
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

/** ホストが再生中に位置を書き直す間隔 (視聴者の揺れを抑える) */
export const HOST_HEARTBEAT_MS = 5000;
