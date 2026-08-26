import { RollId } from '../../store/types';

/**
 * ロールの <video> 要素を面ごとに覚えておく。
 *
 * ⚠️ 連動再生のためだけの仕組み。片方の面から、もう片方の映像を直接操作したい。
 * ストアへ時刻を持たせて同期すると、毎コマ state が更新されて再描画が走り、
 * 2 本の映像を同時に流したときに付いてこられない。DOM を直に触る。
 */
const videos = new Map<RollId, HTMLVideoElement>();

export function registerRollVideo(id: RollId, el: HTMLVideoElement | null): void {
  if (el) videos.set(id, el);
  else videos.delete(id);
}

export function getRollVideo(id: RollId): HTMLVideoElement | null {
  return videos.get(id) ?? null;
}

/** 連動の相手側 */
export function otherRollId(id: RollId): RollId {
  return id === 'rollA' ? 'rollB' : 'rollA';
}
