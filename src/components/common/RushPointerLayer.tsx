import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRushPointerSender, RushPointerProfile, RushPointerState, subscribeRushPointers } from '../../engine/rushPointer';
import {
  fromVideoPosition,
  isPointerFresh,
  PointerPosition,
  toVideoPosition,
  videoContentRect,
  withAlpha,
} from '../../engine/rushPointerMath';

/**
 * 配信中に共有するポインター。
 *
 * オペレーターが映像の上にカーソルを乗せている間だけ、その位置が全員に出る。
 * 「このコマのここを直したい」を指で示す代わりの機能。
 *
 * ⚠️ 映像の実際の表示領域 (レターボックスを除いた四角) を基準に位置を合わせること。
 * 枠を基準にすると、見ている人の窓の形によって指した場所がずれる。
 * ⚠️ オペレーターが複数いても分かるよう、人ごとに色を変える (自分の色は自分で選べる)。
 */

interface RushPointerLayerProps {
  /** 位置の置き場所 (再生状態と同じ ID)。無ければ共有しない */
  playbackId: string | null;
  /** 映像を載せている枠 */
  containerRef: React.RefObject<HTMLElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** この画面のカーソルを配るか (オペレーター) */
  canBroadcast: boolean;
  /** 配るときの見た目と名前 */
  profile?: RushPointerProfile;
  /** 自分のポインターの識別子 (同じ人が 2 画面開いても混ざらないように) */
  pointerId?: string;
}

export const RushPointerLayer: React.FC<RushPointerLayerProps> = ({
  playbackId,
  containerRef,
  videoRef,
  canBroadcast,
  profile,
  pointerId,
}) => {
  const [remote, setRemote] = useState<RushPointerState[]>([]);
  const [local, setLocal] = useState<PointerPosition | null>(null);
  const [, setTick] = useState(0);
  const senderRef = useRef<ReturnType<typeof createRushPointerSender> | null>(null);

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
    if (!canBroadcast || !playbackId || !pointerId || !profile) return;
    const sender = createRushPointerSender(playbackId, pointerId, profile);
    senderRef.current = sender;
    const container = containerRef.current;
    if (!container) return;

    const onMove = (e: PointerEvent) => {
      const rect = contentRect();
      if (!rect) return;
      const position = toVideoPosition(e.clientX - rect.box.left, e.clientY - rect.box.top, rect.content);
      setLocal(position);
      if (position) sender.move(position);
      else sender.hide();
    };
    const onLeave = () => {
      setLocal(null);
      sender.hide();
    };

    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    return () => {
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      sender.dispose();
      senderRef.current = null;
      setLocal(null);
    };
    // profile の中身が変わっても送り手は作り直さない (setProfile で伝える)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBroadcast, playbackId, pointerId, containerRef, contentRect]);

  // 色や大きさを変えたら、出ている最中でもすぐ反映する
  useEffect(() => {
    if (profile) senderRef.current?.setProfile(profile);
  }, [profile?.color, profile?.size, profile?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // 受け取り手。オペレーターも、他の人のポインターは受け取る
  useEffect(() => {
    if (!playbackId) {
      setRemote([]);
      return;
    }
    return subscribeRushPointers(playbackId, setRemote);
  }, [playbackId]);

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
  const others = remote.filter((p) => p.id !== pointerId && isPointerFresh(p.updatedAt, now));
  const dots: { key: string; position: PointerPosition; color: string; size: number; name: string }[] = others.map(
    (p) => ({
      key: p.id,
      position: { x: p.x as number, y: p.y as number },
      color: p.color,
      size: p.size,
      name: p.name,
    })
  );
  // 自分の分は手元の動きをそのまま描く (通信を待たない)
  if (canBroadcast && local && profile) {
    dots.push({ key: 'self', position: local, color: profile.color, size: profile.size, name: profile.name });
  }
  if (dots.length === 0) return null;

  const showNames = dots.length > 1;

  return (
    <>
      {dots.map((dot) => {
        const { left, top } = fromVideoPosition(dot.position, rect.content);
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
                )} 55%, ${withAlpha(dot.color, 0.35)} 75%, ${withAlpha(dot.color, 0)} 100%)`,
                boxShadow: `0 0 ${Math.round(dot.size * 0.6)}px ${Math.round(dot.size * 0.25)}px ${withAlpha(
                  dot.color,
                  0.7
                )}, 0 0 ${Math.round(dot.size * 1.3)}px ${Math.round(dot.size * 0.6)}px ${withAlpha(dot.color, 0.3)}`,
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
