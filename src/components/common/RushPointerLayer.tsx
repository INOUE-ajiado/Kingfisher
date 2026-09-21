import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRushPointerSender, subscribeRushPointer } from '../../engine/rushPointer';
import {
  fromVideoPosition,
  isPointerFresh,
  PointerPosition,
  toVideoPosition,
  videoContentRect,
} from '../../engine/rushPointerMath';

/**
 * 配信中に共有する赤いポインター。
 *
 * オペレーターが映像の上にカーソルを乗せている間だけ、その位置が全員に出る。
 * 「このコマのここを直したい」を指で示す代わりの機能なので、
 * ⚠️ 映像の実際の表示領域 (レターボックスを除いた四角) を基準に位置を合わせること。
 * 枠を基準にすると、見ている人の窓の形によって指した場所がずれる。
 */

interface RushPointerLayerProps {
  /** 位置の置き場所 (再生状態と同じ ID)。無ければ共有しない */
  playbackId: string | null;
  /** 映像を載せている枠 */
  containerRef: React.RefObject<HTMLElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** true ならこの画面のカーソルを配る (オペレーター) */
  canBroadcast: boolean;
}

export const RushPointerLayer: React.FC<RushPointerLayerProps> = ({
  playbackId,
  containerRef,
  videoRef,
  canBroadcast,
}) => {
  const [remote, setRemote] = useState<PointerPosition | null>(null);
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
    if (!canBroadcast || !playbackId) return;
    const sender = createRushPointerSender(playbackId);
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
  }, [canBroadcast, playbackId, containerRef, contentRect]);

  // 受け取り手 (オペレーター自身も、他の人の位置は受け取らない)
  useEffect(() => {
    if (canBroadcast || !playbackId) {
      setRemote(null);
      return;
    }
    return subscribeRushPointer(playbackId, (pointer) => {
      setRemote(
        pointer && typeof pointer.x === 'number' && typeof pointer.y === 'number' && isPointerFresh(pointer.updatedAt, Date.now())
          ? { x: pointer.x, y: pointer.y }
          : null
      );
    });
  }, [canBroadcast, playbackId]);

  // 窓の大きさが変わったら描き直す
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setTick((t) => t + 1));
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  const position = canBroadcast ? local : remote;
  if (!position) return null;

  const rect = contentRect();
  if (!rect) return null;
  const { left, top } = fromVideoPosition(position, rect.content);

  return (
    <div
      className="absolute pointer-events-none z-30"
      style={{ left: `${left}px`, top: `${top}px`, transform: 'translate(-50%, -50%)' }}
      aria-hidden
    >
      <div
        className="rounded-full"
        style={{
          width: 18,
          height: 18,
          background: 'radial-gradient(circle at 50% 50%, #ff5a5a 0%, #ff1a1a 55%, rgba(255,0,0,0.35) 75%, rgba(255,0,0,0) 100%)',
          boxShadow: '0 0 10px 4px rgba(255,32,32,0.75), 0 0 22px 10px rgba(255,0,0,0.35)',
        }}
      />
    </div>
  );
};
