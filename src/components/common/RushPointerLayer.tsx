import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRushPointerSender, RushPointerState, subscribeRushPointers } from '../../engine/rushPointer';
import { createRushStrokeSender, RushStroke, subscribeRushStrokes } from '../../engine/rushDrawing';
import {
  fromVideoPosition,
  isPointerFresh,
  PointerPosition,
  pointerGlow,
  strokeOpacity,
  strokeWidthPx,
  toVideoPosition,
  videoContentRect,
  withAlpha,
} from '../../engine/rushPointerMath';

/**
 * 配信中に共有するポインターと描き込み。
 *
 * オペレーターが映像の上にカーソルを乗せている間、その位置が全員に出る。
 * 描画を入にしているときは、ドラッグで線を引ける (10 秒で消える)。
 *
 * ⚠️ 映像の実際の表示領域 (レターボックスを除いた四角) を基準に位置を合わせること。
 * 枠を基準にすると、見ている人の窓の形によって指した場所がずれる。
 * ⚠️ オペレーターが複数いても分かるよう、人ごとに色を変える (自分の色は自分で選べる)。
 */

export interface RushPointerAppearance {
  name: string;
  color: string;
  size: number;
  /** 0 = くっきり、1 = ふんわり */
  blur: number;
  /** 描く線の太さ */
  strokeSize: number;
}

interface RushPointerLayerProps {
  /** 位置の置き場所 (再生状態と同じ ID)。無ければ共有しない */
  playbackId: string | null;
  /** 映像を載せている枠 */
  containerRef: React.RefObject<HTMLElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** この画面のカーソルを配るか (オペレーター) */
  canBroadcast: boolean;
  appearance?: RushPointerAppearance;
  /** 自分のポインターの識別子 (同じ人が 2 画面開いても混ざらないように) */
  pointerId?: string;
  /** 描画の入 / 切 */
  drawing?: boolean;
  /** 「自分の線を消す」を押されたときに呼ばれる関数を親へ渡す */
  onClearRef?: React.MutableRefObject<(() => void) | null>;
}

export const RushPointerLayer: React.FC<RushPointerLayerProps> = ({
  playbackId,
  containerRef,
  videoRef,
  canBroadcast,
  appearance,
  pointerId,
  drawing = false,
  onClearRef,
}) => {
  const [remote, setRemote] = useState<RushPointerState[]>([]);
  const [strokes, setStrokes] = useState<RushStroke[]>([]);
  const [local, setLocal] = useState<PointerPosition | null>(null);
  /**
   * 自分が引いた線。
   * ⚠️ 送って戻ってくるのを待たないこと。待つと、描いている最中に線が付いてこない。
   * 自分の分は手元で描き、届いた分からは自分のものを除く。
   */
  const [ownStrokes, setOwnStrokes] = useState<RushStroke[]>([]);
  const [, setTick] = useState(0);
  const pointerSenderRef = useRef<ReturnType<typeof createRushPointerSender> | null>(null);
  const strokeSenderRef = useRef<ReturnType<typeof createRushStrokeSender> | null>(null);
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const isDrawingNowRef = useRef(false);

  /** 映像が実際に映っている四角 (枠の中での位置) */
  const contentRect = useCallback(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container) return null;
    const box = container.getBoundingClientRect();
    return {
      box,
      content: videoContentRect(box.width, box.height, video?.videoWidth ?? 0, video?.videoHeight ?? 0),
    };
  }, [containerRef, videoRef]);

  // 送り手 (オペレーター)
  useEffect(() => {
    if (!canBroadcast || !playbackId || !pointerId || !appearance) return;
    const pointerSender = createRushPointerSender(playbackId, pointerId, appearance);
    const strokeSender = createRushStrokeSender(playbackId, pointerId, {
      name: appearance.name,
      color: appearance.color,
      size: appearance.strokeSize,
    });
    pointerSenderRef.current = pointerSender;
    strokeSenderRef.current = strokeSender;
    if (onClearRef)
      onClearRef.current = () => {
        strokeSender.clearMine();
        setOwnStrokes([]);
      };

    const container = containerRef.current;
    if (!container) return;

    const positionOf = (e: PointerEvent): PointerPosition | null => {
      const rect = contentRect();
      if (!rect) return null;
      return toVideoPosition(e.clientX - rect.box.left, e.clientY - rect.box.top, rect.content);
    };

    const onMove = (e: PointerEvent) => {
      const position = positionOf(e);
      setLocal(position);
      if (position) {
        pointerSender.move(position);
        if (isDrawingNowRef.current) {
          strokeSender.extend(position);
          setOwnStrokes((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            const tail = last.points[last.points.length - 1];
            if (tail && Math.hypot(position.x - tail.x, position.y - tail.y) < 0.002) return prev;
            return [
              ...prev.slice(0, -1),
              { ...last, points: [...last.points, position], updatedAt: Date.now() },
            ];
          });
        }
      } else {
        pointerSender.hide();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!drawingRef.current || e.button !== 0) return;
      const position = positionOf(e);
      if (!position) return;
      e.preventDefault();
      isDrawingNowRef.current = true;
      strokeSender.begin(position);
      const id = `own_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setOwnStrokes((prev) => [
        ...prev,
        {
          id,
          by: pointerId,
          name: appearance.name,
          color: appearance.color,
          size: appearance.strokeSize,
          points: [position],
          updatedAt: Date.now(),
        },
      ]);
    };
    const onUp = () => {
      if (!isDrawingNowRef.current) return;
      isDrawingNowRef.current = false;
      strokeSender.end();
    };
    const onLeave = () => {
      setLocal(null);
      pointerSender.hide();
      onUp();
    };

    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('blur', onLeave);
    return () => {
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('blur', onLeave);
      pointerSender.dispose();
      strokeSender.dispose();
      pointerSenderRef.current = null;
      strokeSenderRef.current = null;
      if (onClearRef) onClearRef.current = null;
      setLocal(null);
      setOwnStrokes([]);
    };
    // 見た目が変わっても送り手は作り直さない (setProfile で伝える)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBroadcast, playbackId, pointerId, containerRef, contentRect]);

  // 色・大きさ・ぼかしを変えたら、出ている最中でもすぐ反映する
  useEffect(() => {
    if (!appearance) return;
    pointerSenderRef.current?.setProfile(appearance);
    strokeSenderRef.current?.setProfile({
      name: appearance.name,
      color: appearance.color,
      size: appearance.strokeSize,
    });
  }, [appearance?.color, appearance?.size, appearance?.blur, appearance?.strokeSize, appearance?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // 受け取り手。オペレーターも、他の人のポインターと線は受け取る
  useEffect(() => {
    if (!playbackId) {
      setRemote([]);
      setStrokes([]);
      return;
    }
    const stopPointers = subscribeRushPointers(playbackId, setRemote);
    const stopStrokes = subscribeRushStrokes(playbackId, setStrokes);
    return () => {
      stopPointers();
      stopStrokes();
    };
  }, [playbackId]);

  // 消えかけの線を描き直すため、線があるあいだは定期的に更新する
  useEffect(() => {
    if (strokes.length === 0 && ownStrokes.length === 0) return;
    const timer = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(timer);
  }, [strokes.length, ownStrokes.length]);

  // 窓の大きさが変わったら描き直す
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setTick((t) => t + 1));
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  const rect = contentRect();
  if (!rect) return null;
  const now = Date.now();
  const content = rect.content;

  const dots = remote
    .filter((p) => p.id !== pointerId && isPointerFresh(p.updatedAt, now))
    .map((p) => ({
      key: p.id,
      position: { x: p.x as number, y: p.y as number },
      color: p.color,
      size: p.size,
      blur: typeof p.blur === 'number' ? p.blur : 0.5,
      name: p.name,
    }));
  // 自分の分は手元の動きをそのまま描く (通信を待たない)
  if (canBroadcast && local && appearance) {
    dots.push({
      key: 'self',
      position: local,
      color: appearance.color,
      size: appearance.size,
      blur: appearance.blur,
      name: appearance.name,
    });
  }

  // 自分の線は手元のものを使う (届いた分から自分のものは除く)
  const visibleStrokes = [...strokes.filter((stroke) => !pointerId || stroke.by !== pointerId), ...ownStrokes]
    .map((stroke) => ({ stroke, opacity: strokeOpacity(stroke.updatedAt, now) }))
    .filter(({ stroke, opacity }) => opacity > 0 && stroke.points.length > 0);

  const showNames = dots.length > 1;
  if (dots.length === 0 && visibleStrokes.length === 0) return null;

  return (
    <>
      {visibleStrokes.length > 0 && (
        <svg
          className="absolute pointer-events-none z-20"
          style={{ left: content.x, top: content.y, width: content.width, height: content.height }}
          viewBox={`0 0 ${content.width} ${content.height}`}
          aria-hidden
        >
          {visibleStrokes.map(({ stroke, opacity }) => (
            <polyline
              key={stroke.id}
              points={stroke.points.map((p) => `${p.x * content.width},${p.y * content.height}`).join(' ')}
              fill="none"
              stroke={stroke.color}
              strokeWidth={strokeWidthPx(stroke.size, content.width)}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={opacity}
            />
          ))}
        </svg>
      )}

      {dots.map((dot) => {
        const { left, top } = fromVideoPosition(dot.position, content);
        const glow = pointerGlow(dot.size, dot.blur);
        return (
          <div
            key={dot.key}
            className="absolute pointer-events-none z-30"
            style={{ left: `${left}px`, top: `${top}px`, transform: 'translate(-50%, -50%)' }}
            aria-hidden
          >
            <div
              className="rounded-full"
              style={{
                width: dot.size,
                height: dot.size,
                background: `radial-gradient(circle at 50% 50%, ${withAlpha(dot.color, 1)} 0%, ${withAlpha(
                  dot.color,
                  0.95
                )} ${glow.core}%, ${withAlpha(dot.color, 0.3)} ${Math.min(glow.core + 25, 95)}%, ${withAlpha(
                  dot.color,
                  0
                )} 100%)`,
                boxShadow: `0 0 ${glow.blurPx}px ${glow.spread}px ${withAlpha(dot.color, 0.55)}`,
              }}
            />
            {showNames && dot.name && (
              <span
                className="absolute left-1/2 -translate-x-1/2 mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap bg-black/60"
                style={{ top: '100%', color: dot.color }}
              >
                {dot.name}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
};
