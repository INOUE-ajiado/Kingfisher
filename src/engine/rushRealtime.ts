import { getDatabase, ref, onValue } from 'firebase/database';
import { app } from './firebase';

/**
 * Realtime Database と、サーバー基準の時刻。
 *
 * ⚠️ 端末どうしで見せ合うものに、その端末の時計をそのまま使わないこと。
 * 実際に数秒ずれている端末があり (2026-09-22 に開発機で約 7 秒のずれを確認)、
 * 「いつ書かれたか」の判断が狂う。ポインターが出ない、描いた線がすぐ消える、
 * 遅れの埋め合わせが効かない、といった形で表に出る。
 */

export const rushDb = getDatabase(app);

let serverTimeOffset = 0;
onValue(ref(rushDb, '.info/serverTimeOffset'), (snap) => {
  const value = Number(snap.val());
  if (Number.isFinite(value)) serverTimeOffset = value;
});

/** サーバー基準の今 (ミリ秒) */
export function serverNow(): number {
  return Date.now() + serverTimeOffset;
}
