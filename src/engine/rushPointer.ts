import { getDatabase, ref, onValue, onDisconnect, set, update, remove } from 'firebase/database';
import { app } from './firebase';
import { clampPointerSize, isPointerColor, PointerPosition, POINTER_SEND_INTERVAL_MS } from './rushPointerMath';

/**
 * 配信中のマウスポインターの共有。
 *
 * ラッシュでは「画面のどこを直すのか」を指せることが要るので、オペレーターが
 * 映像の上へカーソルを乗せている間、その位置を全員へ配る。
 * オペレーターが複数いても分かるよう、人ごとに別の場所へ書き、色で見分ける。
 *
 *   rushPointers/{再生ID}/{ポインターID}  … { name, color, size, visible, x, y, updatedAt }
 *
 * ⚠️ Firestore ではなく Realtime Database を使うこと。位置は毎秒十数回変わるので、
 * Firestore の 1 文書あたりの書き込み (毎秒 1 回が目安) にはまったく合わない。
 * ⚠️ 置き場所の名前は再生状態の ID (推測できない乱数) と同じものを使う。
 * 読み取りは誰でもできる作りなので、ID を知らない人には辿り着けないことが前提。
 */

export interface RushPointerProfile {
  /** 誰のポインターか (視聴者側に小さく出す) */
  name: string;
  /** #rrggbb */
  color: string;
  /** 丸の直径 (px) */
  size: number;
}

export interface RushPointerState extends RushPointerProfile, Partial<PointerPosition> {
  id: string;
  visible: boolean;
  updatedAt: number;
}

const db = getDatabase(app);

function pointerRef(playbackId: string, pointerId: string) {
  return ref(db, `rushPointers/${playbackId}/${pointerId}`);
}

/**
 * オペレーター側の送り手を作る。
 * 送る間隔は間引く (毎秒十数回)。画面を閉じたり回線が切れたら消える。
 */
export function createRushPointerSender(
  playbackId: string,
  pointerId: string,
  profile: RushPointerProfile
): {
  move: (position: PointerPosition) => void;
  hide: () => void;
  setProfile: (next: RushPointerProfile) => void;
  dispose: () => void;
} {
  const target = pointerRef(playbackId, pointerId);
  // 回線が切れたときに、指したままの点が残らないようにする
  void onDisconnect(target).remove();

  let current: RushPointerProfile = normalizeProfile(profile);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PointerPosition | null = null;
  let lastSentAt = -Infinity;
  let disposed = false;

  const write = (extra: Record<string, unknown>) => {
    void set(target, { ...current, updatedAt: Date.now(), ...extra }).catch((err) =>
      console.warn('Failed to send rush pointer:', err)
    );
  };

  const flush = () => {
    timer = null;
    if (!pending || disposed) return;
    lastSentAt = Date.now();
    write({ ...pending, visible: true });
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
      write({ visible: false });
    },
    setProfile: (next) => {
      current = normalizeProfile(next);
      if (disposed) return;
      // 出ている最中に色や大きさを変えたら、その場で見た目を更新する
      void update(target, { ...current, updatedAt: Date.now() }).catch(() => undefined);
    },
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      void onDisconnect(target).cancel();
      void remove(target).catch(() => undefined);
    },
  };
}

function normalizeProfile(profile: RushPointerProfile): RushPointerProfile {
  return {
    name: (profile.name || '').slice(0, 40),
    color: isPointerColor(profile.color) ? profile.color.toLowerCase() : '#ff2d2d',
    size: clampPointerSize(profile.size),
  };
}

/** 受け取り側。今出ているポインターを全部渡す (出ていなければ空) */
export function subscribeRushPointers(
  playbackId: string,
  onUpdate: (pointers: RushPointerState[]) => void
): () => void {
  return onValue(
    ref(db, `rushPointers/${playbackId}`),
    (snapshot) => {
      const value = (snapshot.val() as Record<string, Omit<RushPointerState, 'id'>> | null) || {};
      const list = Object.entries(value)
        .map(([id, data]) => ({ id, ...data }))
        .filter((p) => p.visible && typeof p.x === 'number' && typeof p.y === 'number');
      onUpdate(list);
    },
    (error) => console.warn('Failed to watch rush pointers:', error)
  );
}
