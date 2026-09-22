import { RollId } from '../../store/types';

/**
 * ロールの <video> 要素を面ごとに覚えておく。
 *
 * ⚠️ 連動再生のためだけの仕組み。片方の面から、もう片方の映像を直接操作したい。
 * ストアへ時刻を持たせて同期すると、毎コマ state が更新されて再描画が走り、
 * 2 本の映像を同時に流したときに付いてこられない。DOM を直に触る。
 */
/**
 * 連動のために触る相手。
 *
 * ⚠️ HTMLVideoElement とは限らない。ProRes をその場で復号しているときは
 * <video> が無く、同じ形をした代役 (canvas へ描く) が入る。
 * 以前は代役を `as unknown as HTMLVideoElement` で偽装していたため、
 * 実際には無い機能 (requestVideoFrameCallback など) も型の上では有るように見えていた。
 */
export interface RollPlayer {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  playbackRate: number;
  play: () => Promise<void> | void;
  pause: () => void;
}

const videos = new Map<RollId, RollPlayer>();

export function registerRollVideo(id: RollId, el: RollPlayer | null): void {
  if (el) videos.set(id, el);
  else videos.delete(id);
}

export function getRollVideo(id: RollId): RollPlayer | null {
  return videos.get(id) ?? null;
}

/** 連動の相手側 */
export function otherRollId(id: RollId): RollId {
  return id === 'rollA' ? 'rollB' : 'rollA';
}

/**
 * Space で 2 面いっしょに流し始めたときの時刻差 (B − A)。流していない間は null。
 *
 * ⚠️ 再生連動 (roll.sync) とは別物。あちらは「ユーザーが 🔗 で入れた連動」で、
 * 切っている間も足並みを揃えたいのが Space の同時再生。連動 OFF のまま
 * 2 本を流すと、デコードの立ち上がりや尺の違いでどんどんずれる
 * (実測で 1.6 秒ずれた / 2026-08-31 の報告)。流している間だけ差を覚えて直す。
 * ⚠️ ストアへ入れないこと。毎コマ参照するので、state にすると再描画が走る。
 */
let pairedPlaybackOffset: number | null = null;

/** 2 面同時再生を始める。offset は B − A (秒) */
export function beginPairedPlayback(offset: number): void {
  pairedPlaybackOffset = offset;
}

/** 2 面同時再生をやめる (一時停止・素材の差し替え) */
export function endPairedPlayback(): void {
  pairedPlaybackOffset = null;
}

export function getPairedPlaybackOffset(): number | null {
  return pairedPlaybackOffset;
}
