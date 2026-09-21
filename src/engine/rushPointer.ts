import { getDatabase, ref, onValue, onDisconnect, set, remove } from 'firebase/database';
import { app } from './firebase';
import { PointerPosition, POINTER_SEND_INTERVAL_MS } from './rushPointerMath';

/**
 * 配信中のマウスポインターの共有。
 *
 * ラッシュでは「画面のどこを直すのか」を指せることが要るので、オペレーターが
 * 映像の上へカーソルを乗せている間、その位置を全員へ配る。
 *
 * ⚠️ Firestore ではなく Realtime Database を使うこと。位置は毎秒十数回変わるので、
 * Firestore の 1 文書あたりの書き込み (毎秒 1 回が目安) にはまったく合わない。
 * ⚠️ 置き場所の名前は再生状態の ID (推測できない乱数) と同じものを使う。
 * 読み取りは誰でもできる作りなので、ID を知らない人には辿り着けないことが前提。
 */

export interface RushPointerState extends Partial<PointerPosition> {
  visible: boolean;
  updatedAt: number;
}

const db = getDatabase(app);

function pointerRef(playbackId: string) {
  return ref(db, `rushPointers/${playbackId}`);
}

/**
 * オペレーター側の送り手を作る。
 * 送る間隔は間引く (毎秒十数回)。画面を閉じたり回線が切れたら消える。
 */
export function createRushPointerSender(playbackId: string): {
  move: (position: PointerPosition) => void;
  hide: () => void;
  dispose: () => void;
} {
  const target = pointerRef(playbackId);
  // 回線が切れたときに、指したままの点が残らないようにする
  void onDisconnect(target).remove();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PointerPosition | null = null;
  let lastSentAt = -Infinity;
  let disposed = false;

  const write = (state: RushPointerState) => {
    void set(target, state).catch((err) => console.warn('Failed to send rush pointer:', err));
  };

  const flush = () => {
    timer = null;
    if (!pending || disposed) return;
    lastSentAt = Date.now();
    write({ ...pending, visible: true, updatedAt: Date.now() });
    pending = null;
  };

  return {
    move: (position) => {
      if (disposed) return;
      pending = position;
      const wait = POINTER_SEND_INTERVAL_MS - (Date.now() - lastSentAt);
      if (wait <= 0) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    },
    hide: () => {
      if (disposed) return;
      pending = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      lastSentAt = Date.now();
      write({ visible: false, updatedAt: Date.now() });
    },
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      void onDisconnect(target).cancel();
      void remove(target).catch(() => undefined);
    },
  };
}

/** 受け取り側。ポインターが消えたときは null を渡す */
export function subscribeRushPointer(
  playbackId: string,
  onUpdate: (pointer: RushPointerState | null) => void
): () => void {
  return onValue(
    pointerRef(playbackId),
    (snapshot) => {
      const value = snapshot.val() as RushPointerState | null;
      onUpdate(value && value.visible && typeof value.x === 'number' && typeof value.y === 'number' ? value : null);
    },
    (error) => console.warn('Failed to watch rush pointer:', error)
  );
}
