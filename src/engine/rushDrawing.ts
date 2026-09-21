import { ref, push, set, update, remove, onChildAdded, onChildChanged, onChildRemoved, onDisconnect } from 'firebase/database';
import { rushDb as db, serverNow } from './rushRealtime';
import {
  clampStrokeSize,
  decodeStrokePoints,
  encodeStrokePoints,
  isPointerColor,
  MAX_STROKE_POINTS,
  PointerPosition,
  STROKE_LIFETIME_MS,
} from './rushPointerMath';

/**
 * 配信中の描き込み (ラッシュで「ここを直す」と線で囲うための機能)。
 *
 *   rushStrokes/{再生ID}/{線ID}  … { by, name, color, size, points, updatedAt }
 *
 * ⚠️ 1 本の線を長くしすぎないこと。送るたびに線ぜんぶを書き直すので、
 * 長いと通信量が跳ね上がる。上限を超えたら線を分ける (MAX_STROKE_POINTS)。
 * ⚠️ 描いた線は放っておくと画面に溜まる。3 秒で消えるようにし、
 * 回線が切れたときも onDisconnect で消す。
 */

export interface RushStroke {
  id: string;
  by: string;
  name: string;
  color: string;
  size: number;
  points: PointerPosition[];
  updatedAt: number;
}

export interface RushStrokeProfile {
  name: string;
  color: string;
  size: number;
}

/** 送るのはこの間隔まで (描き心地と通信量の折り合い) */
const STROKE_SEND_INTERVAL_MS = 100;
/** これより動いていない点は捨てる (映像に対する割合) */
const MIN_POINT_DISTANCE = 0.002;

export function createRushStrokeSender(playbackId: string, authorId: string, profile: RushStrokeProfile) {
  const base = ref(db, `rushStrokes/${playbackId}`);
  let current: RushStrokeProfile = normalize(profile);
  const mine = new Map<string, ReturnType<typeof setTimeout>>();

  let strokeId: string | null = null;
  let points: PointerPosition[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSentAt = -Infinity;
  let disposed = false;

  /** 寿命を過ぎたら自分で片づける (見ている側も同じ時間で消す) */
  const scheduleRemoval = (id: string) => {
    const existing = mine.get(id);
    if (existing) clearTimeout(existing);
    mine.set(
      id,
      setTimeout(() => {
        void remove(ref(db, `rushStrokes/${playbackId}/${id}`)).catch(() => undefined);
        mine.delete(id);
      }, STROKE_LIFETIME_MS)
    );
  };

  const flush = () => {
    timer = null;
    if (disposed || !strokeId || points.length === 0) return;
    lastSentAt = Date.now();
    void update(ref(db, `rushStrokes/${playbackId}/${strokeId}`), {
      points: encodeStrokePoints(points),
      updatedAt: serverNow(),
    }).catch((err) => console.warn('Failed to send rush stroke:', err));
    scheduleRemoval(strokeId);
  };

  const startStroke = (at: PointerPosition) => {
    const node = push(base);
    strokeId = node.key as string;
    points = [at];
    void set(node, {
      by: authorId,
      name: current.name,
      color: current.color,
      size: current.size,
      points: encodeStrokePoints(points),
      updatedAt: serverNow(),
    }).catch((err) => console.warn('Failed to start rush stroke:', err));
    // 回線が切れても線が残らないように
    void onDisconnect(node).remove();
    scheduleRemoval(strokeId);
  };

  return {
    begin: (at: PointerPosition) => {
      if (disposed) return;
      startStroke(at);
    },
    extend: (at: PointerPosition) => {
      if (disposed || !strokeId) return;
      const last = points[points.length - 1];
      if (last && Math.hypot(at.x - last.x, at.y - last.y) < MIN_POINT_DISTANCE) return;
      points.push(at);

      // 長くなりすぎたら、いまの線を閉じて次の線へ継ぐ
      if (points.length >= MAX_STROKE_POINTS) {
        flush();
        const tail = points[points.length - 1];
        startStroke(tail);
        return;
      }
      const wait = STROKE_SEND_INTERVAL_MS - (Date.now() - lastSentAt);
      if (wait <= 0) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    },
    end: () => {
      if (disposed) return;
      flush();
      strokeId = null;
      points = [];
    },
    /** 自分が描いた線を今すぐ消す */
    clearMine: () => {
      for (const [id, t] of mine) {
        clearTimeout(t);
        void remove(ref(db, `rushStrokes/${playbackId}/${id}`)).catch(() => undefined);
      }
      mine.clear();
      strokeId = null;
      points = [];
    },
    setProfile: (next: RushStrokeProfile) => {
      current = normalize(next);
    },
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      for (const [id, t] of mine) {
        clearTimeout(t);
        void remove(ref(db, `rushStrokes/${playbackId}/${id}`)).catch(() => undefined);
      }
      mine.clear();
    },
  };
}

function normalize(profile: RushStrokeProfile): RushStrokeProfile {
  return {
    name: (profile.name || '').slice(0, 40),
    color: isPointerColor(profile.color) ? profile.color.toLowerCase() : '#ff2d2d',
    size: clampStrokeSize(profile.size),
  };
}

/**
 * 描き込みを購読する。
 * ⚠️ 線ごとの出来事 (追加・変更・削除) で受けること。まとめて受けると、
 * 1 本書き足すたびに全部の線を受け取り直すことになる。
 */
export function subscribeRushStrokes(playbackId: string, onChange: (strokes: RushStroke[]) => void): () => void {
  const base = ref(db, `rushStrokes/${playbackId}`);
  const strokes = new Map<string, RushStroke>();
  const emit = () => onChange(Array.from(strokes.values()));

  const read = (id: string, value: Record<string, unknown> | null): RushStroke | null => {
    if (!value) return null;
    return {
      id,
      by: String(value.by ?? ''),
      name: String(value.name ?? ''),
      color: String(value.color ?? '#ff2d2d'),
      size: Number(value.size ?? 6),
      points: decodeStrokePoints(String(value.points ?? '')),
      updatedAt: Number(value.updatedAt ?? 0),
    };
  };

  const onUpsert = (snapshot: { key: string | null; val: () => unknown }) => {
    const stroke = read(snapshot.key ?? '', snapshot.val() as Record<string, unknown> | null);
    if (stroke) strokes.set(stroke.id, stroke);
    emit();
  };

  const offAdded = onChildAdded(base, onUpsert, (err) => console.warn('Failed to watch rush strokes:', err));
  const offChanged = onChildChanged(base, onUpsert);
  const offRemoved = onChildRemoved(base, (snapshot) => {
    strokes.delete(snapshot.key ?? '');
    emit();
  });

  return () => {
    offAdded();
    offChanged();
    offRemoved();
  };
}
