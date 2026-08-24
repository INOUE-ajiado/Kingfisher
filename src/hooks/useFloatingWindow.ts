import React, { useCallback, useRef, useState } from 'react';
import { usePaintStore } from '../store/usePaintStore';
import { FloatingWindowId } from '../store/types';
import { useFastDraggable } from './useFastDraggable';
import { useResizableWindow } from './useResizableWindow';

/**
 * 独立ウィンドウ (フローティング) の共通処理。
 *
 * これまで Win A / Win B・参照ウィンドウ・カラーチャートで実装が三者三様に分かれ、
 * 「引きはがせるがドラッグでは戻せない」「戻すとズレる」といった差異を生んでいた。
 * 位置・サイズ・重なり順はストアが持ち、ここが唯一の操作窓口になる。
 *
 * ドッキング復帰の判定には「実際に画面に出ている領域」だけを使う。
 * 非表示要素は getBoundingClientRect() が 0 を返し、画面左上の隅が
 * ドロップ領域になってしまうため、大きさを持つことを必須条件にしている。
 */

/** 引きはがしと判定するドラッグ距離 (px) */
const TEAR_OFF_THRESHOLD = 6;

/** ドッキング領域の判定に持たせる余白 (px) */
const DOCK_HIT_PADDING = 32;

function getVisibleRect(elementId: string): DOMRect | null {
  const el = document.getElementById(elementId);
  if (!el || el.offsetParent === null) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return rect;
}

/**
 * ドラッグ中のドッキング領域の位置。
 *
 * getBoundingClientRect() はレイアウトの再計算を強制するため、
 * transform を書き換えた直後に毎フレーム呼ぶと描画が目に見えて重くなる
 * (特にサイドパネル内にドッキング領域があるカラーチャート)。
 * 跡地はドラッグ中に動かないので、一度測ったら使い回す。
 */
class DockRectCache {
  private rect: DOMRect | null = null;
  private measured = false;

  get(elementId: string): DOMRect | null {
    if (!this.measured) {
      const rect = getVisibleRect(elementId);
      // 引きはがし直後は跡地がまだ描画されていないので、次のフレームで測り直す
      if (rect) {
        this.rect = rect;
        this.measured = true;
      }
      return rect;
    }
    return this.rect;
  }

  invalidate() {
    this.rect = null;
    this.measured = false;
  }
}

function isPointerOverRect(rect: DOMRect, clientX: number, clientY: number): boolean {
  return (
    clientX >= rect.left - DOCK_HIT_PADDING &&
    clientX <= rect.right + DOCK_HIT_PADDING &&
    clientY >= rect.top - DOCK_HIT_PADDING &&
    clientY <= rect.bottom + DOCK_HIT_PADDING
  );
}

interface UseFloatingWindowOptions {
  id: FloatingWindowId;
  /** 現在フローティングかどうか (描画用) */
  isFloating: boolean;
  /** ドラッグ中に最新値を読むための関数。React のクロージャは古い値を掴むため必要 */
  getIsFloating: () => boolean;
  toggleFloating: () => void;
  /** ドッキング復帰のドロップ先となる要素の id */
  dockTargetId: string;
  minWidth?: number;
  minHeight?: number;
  /** 中身がはみ出す時の扱い。スクロールさせたいパネルは 'auto' */
  contentOverflow?: 'hidden' | 'auto';
}

export function useFloatingWindow<T extends HTMLElement = HTMLDivElement>({
  id,
  isFloating,
  getIsFloating,
  toggleFloating,
  dockTargetId,
  minWidth = 240,
  minHeight = 180,
  contentOverflow = 'hidden',
}: UseFloatingWindowOptions) {
  const layout = usePaintStore((s) => s.floatingWindows[id]);
  const order = usePaintStore((s) => s.floatingWindowOrder);
  const setFloatingWindowPosition = usePaintStore((s) => s.setFloatingWindowPosition);
  const setFloatingWindowSize = usePaintStore((s) => s.setFloatingWindowSize);
  const bringWindowToFront = usePaintStore((s) => s.bringWindowToFront);

  /** ドッキング領域の上にいるか (復帰ガイドの表示に使う) */
  const [isOverDockTarget, setIsOverDockTarget] = useState(false);

  const { targetRef, currentPos, setPosition } = useFastDraggable<T>({
    initialX: layout.x,
    initialY: layout.y,
    enabled: isFloating,
    onCommit: (x, y) => setFloatingWindowPosition(id, x, y),
  });

  const { getResizeHandler } = useResizableWindow(targetRef, currentPos, setPosition, {
    minWidth,
    minHeight,
    enabled: isFloating,
    onCommit: (w, h) => setFloatingWindowSize(id, w, h),
  });

  const isDraggingHeader = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  /** タイトルバーの掴み込み: ドッキング中なら引きはがし、独立中なら移動＋復帰判定 */
  const handleHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      bringWindowToFront(id);
      isDraggingHeader.current = true;

      const startX = e.clientX;
      const startY = e.clientY;

      // 掴んだ相対位置をそのまま保つ。
      // ドッキング中のパネルは独立時より横に広いことがあるので、
      // カーソルがウィンドウの外に出ないよう内側へ寄せる。
      const rect = targetRef.current?.getBoundingClientRect();
      const rawOffsetX = rect ? startX - rect.left : 0;
      const rawOffsetY = rect ? startY - rect.top : 0;
      dragOffset.current = {
        x: Math.min(Math.max(0, rawOffsetX), Math.max(40, layout.width - 60)),
        y: Math.min(Math.max(0, rawOffsetY), 40),
      };

      const moveTo = (clientX: number, clientY: number) => {
        setPosition(clientX - dragOffset.current.x, clientY - dragOffset.current.y);
      };

      // 1 フレームにつき 1 回だけ DOM を書き換える。
      // 高レポートレートのマウスで pointermove が連射されても描画が詰まらない。
      let pendingPointer: { x: number; y: number } | null = null;
      let rafId: number | null = null;

      const flushMove = () => {
        rafId = null;
        if (!pendingPointer) return;
        moveTo(pendingPointer.x, pendingPointer.y);
      };

      const scheduleMove = (clientX: number, clientY: number) => {
        pendingPointer = { x: clientX, y: clientY };
        if (rafId === null) rafId = requestAnimationFrame(flushMove);
      };

      const cancelScheduledMove = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      };

      const dockRectCache = new DockRectCache();
      const onViewportChange = () => dockRectCache.invalidate();

      // 引きはがした跡地がそのままドッキング領域になるため、
      // 一度もそこから出ていないうちは復帰させない。
      // (わずかに動かして離しただけで元へ戻ってしまうのを防ぐ)
      let hasLeftDockTarget = false;

      const onPointerMove = (ev: PointerEvent) => {
        if (!isDraggingHeader.current) return;

        if (!getIsFloating()) {
          // ドッキング中: 一定距離ドラッグしたら引きはがす
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > TEAR_OFF_THRESHOLD) {
            moveTo(ev.clientX, ev.clientY);
            toggleFloating();
          }
          return;
        }

        scheduleMove(ev.clientX, ev.clientY);

        const dockRect = dockRectCache.get(dockTargetId);
        const isOver = !!dockRect && isPointerOverRect(dockRect, ev.clientX, ev.clientY);
        if (!isOver) hasLeftDockTarget = true;
        setIsOverDockTarget(hasLeftDockTarget && isOver);
      };

      // pointerup だけでなく pointercancel も拾う。
      // これが無いとタッチ操作の中断などでドラッグ状態が解除されず、
      // ボタンを離してもウィンドウがカーソルに追従し続ける。
      const finishDrag = (ev: PointerEvent) => {
        if (!isDraggingHeader.current) return;
        isDraggingHeader.current = false;

        cancelScheduledMove();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', finishDrag);
        window.removeEventListener('pointercancel', finishDrag);
        window.removeEventListener('resize', onViewportChange);
        window.removeEventListener('scroll', onViewportChange, true);

        setIsOverDockTarget(false);
        if (!getIsFloating()) return;

        const dockRect = dockRectCache.get(dockTargetId);
        if (
          hasLeftDockTarget &&
          dockRect &&
          ev.type === 'pointerup' &&
          isPointerOverRect(dockRect, ev.clientX, ev.clientY)
        ) {
          toggleFloating();
          return;
        }

        moveTo(ev.clientX, ev.clientY);
        setFloatingWindowPosition(id, currentPos.current.x, currentPos.current.y);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', finishDrag);
      window.addEventListener('pointercancel', finishDrag);
      // 画面構成が変わったら測り直す
      window.addEventListener('resize', onViewportChange);
      window.addEventListener('scroll', onViewportChange, true);
    },
    [
      id,
      dockTargetId,
      layout.width,
      getIsFloating,
      toggleFloating,
      bringWindowToFront,
      setPosition,
      setFloatingWindowPosition,
      targetRef,
      currentPos,
    ]
  );

  /** ウィンドウ本体のスタイル。ドッキング中は何も付けない */
  const windowStyle: React.CSSProperties | undefined = isFloating
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 50 + Math.max(0, order.indexOf(id)),
        width: `${layout.width}px`,
        height: `${layout.height}px`,
        overflow: contentOverflow,
        // ウィンドウ内部のレイアウト・描画をページ全体から切り離し、
        // 移動中にドキュメント全体のレイアウトが再計算されるのを防ぐ
        contain: 'layout paint',
        minWidth: `${minWidth}px`,
        minHeight: `${minHeight}px`,
        maxWidth: '90vw',
        maxHeight: '90vh',
      }
    : undefined;

  /** ウィンドウのどこかを触ったら最前面へ持ち上げる */
  const bringToFront = useCallback(() => {
    if (isFloating) bringWindowToFront(id);
  }, [isFloating, bringWindowToFront, id]);

  return {
    targetRef,
    windowStyle,
    handleHeaderPointerDown,
    getResizeHandler,
    isOverDockTarget,
    bringToFront,
  };
}
