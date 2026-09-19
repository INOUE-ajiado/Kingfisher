import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { generateVideoThumbnails } from '../../engine/rushThumbnails';

interface RushThumbnailBarProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string | null;
  /** ルームに保存済みのサムネイル。空なら videoUrl から作ってみる */
  thumbnails?: string[];
  currentTime: number;
  duration: number;
  onSeek: (newTime: number) => void;
  onStepFrame: (frames: number) => void;
  togglePlay: () => void;
  isPlaying: boolean;
  formatTC: (sec: number) => string;
}

export const RushThumbnailBar: React.FC<RushThumbnailBarProps> = ({
  videoUrl,
  thumbnails: storedThumbnails,
  currentTime,
  duration,
  onSeek,
  onStepFrame,
  togglePlay,
  isPlaying,
  formatTC,
}) => {
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);

  const timelineRef = useRef<HTMLDivElement | null>(null);

  // サムネイル。ルームに保存されたもの (アップロード時に手元の動画から作ったもの) を優先し、
  // 無いときだけ再生中の動画から作ってみる (別オリジンの動画は CORS で作れないことがある)
  useEffect(() => {
    if (storedThumbnails && storedThumbnails.length > 0) {
      setThumbnails(storedThumbnails);
      setIsGenerating(false);
      return;
    }
    if (!videoUrl || !duration || duration <= 0) {
      setThumbnails([]);
      return;
    }

    let cancelled = false;
    setIsGenerating(true);
    void generateVideoThumbnails(videoUrl, 14, () => cancelled)
      .catch(() => [] as string[])
      .then((generated) => {
        if (cancelled) return;
        setThumbnails(generated);
        setIsGenerating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [videoUrl, duration, storedThumbnails]);

  // クリック・ドラッグによるシーク位置計算
  const handleSeekFromEvent = useCallback(
    (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
      if (!timelineRef.current || duration <= 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const ratio = clickX / rect.width;
      const targetTime = ratio * duration;
      onSeek(targetTime);
    },
    [duration, onSeek]
  );

  // マウスダウン（スクラビング開始）
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    handleSeekFromEvent(e);
  };

  // グローバルドラッグ＆マウスアップ検知
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleSeekFromEvent(e);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleSeekFromEvent]);

  // マウスホバー移動
  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || duration <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const ratio = x / rect.width;
    setHoverX(x);
    setHoverTime(ratio * duration);
  };

  const handleTimelineMouseLeave = () => {
    if (!isDragging) {
      setHoverTime(null);
    }
  };

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className="bg-slate-950 border-t border-amber-500/20 px-3 py-2 flex flex-col gap-1.5 select-none flex-shrink-0">
      {/* 1. コントロールボタンバー ＆ タイムコード表示 */}
      <div className="flex items-center justify-between text-xs">
        {/* ボタン群 (再生、1コマ送り、10コマ送り) */}
        <div className="flex items-center gap-1">
          {/* -10コマ */}
          <button
            onClick={() => onStepFrame(-10)}
            className="p-1.5 rounded hover:bg-white/10 text-slate-300 hover:text-amber-300 transition-colors flex items-center gap-0.5"
            title="10コマ戻る (Shift + ←)"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>

          {/* -1コマ */}
          <button
            onClick={() => onStepFrame(-1)}
            className="p-1.5 rounded hover:bg-white/10 text-slate-300 hover:text-amber-300 transition-colors"
            title="1コマ戻る (←)"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          {/* 再生 / 停止 */}
          <button
            onClick={togglePlay}
            className="px-3 py-1 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-all shadow-md shadow-amber-500/20 flex items-center gap-1 mx-1"
            title="再生 / 停止 (Space)"
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span className="text-[11px]">一時停止</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span className="text-[11px]">再生</span>
              </>
            )}
          </button>

          {/* +1コマ */}
          <button
            onClick={() => onStepFrame(1)}
            className="p-1.5 rounded hover:bg-white/10 text-slate-300 hover:text-amber-300 transition-colors"
            title="1コマ進む (→)"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          {/* +10コマ */}
          <button
            onClick={() => onStepFrame(10)}
            className="p-1.5 rounded hover:bg-white/10 text-slate-300 hover:text-amber-300 transition-colors flex items-center gap-0.5"
            title="10コマ進む (Shift + →)"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>

        {/* キーヒント */}
        <div className="hidden md:flex items-center gap-2 text-[10px] text-slate-400 font-mono">
          <span className="bg-slate-900 border border-white/10 px-1.5 py-0.5 rounded text-amber-300">Space</span> 再生/停止
          <span className="bg-slate-900 border border-white/10 px-1.5 py-0.5 rounded text-amber-300">← / →</span> 1コマ
          <span className="bg-slate-900 border border-white/10 px-1.5 py-0.5 rounded text-amber-300">Shift + ← / →</span> 10コマ送り
        </div>

        {/* タイムコードカウンタ */}
        <div className="font-mono text-xs font-bold text-amber-300 bg-slate-900/90 px-2.5 py-1 rounded border border-amber-500/30 shadow-inner flex items-center gap-1.5">
          <span>{formatTC(currentTime)}</span>
          <span className="text-slate-500">/</span>
          <span className="text-slate-400 font-normal">{formatTC(duration)}</span>
        </div>
      </div>

      {/* 2. iMovie風 サムネイル タイムラインコントロールバー */}
      <div
        ref={timelineRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleTimelineMouseMove}
        onMouseLeave={handleTimelineMouseLeave}
        className="relative h-14 w-full bg-slate-900 rounded-lg border border-white/15 overflow-hidden cursor-pointer shadow-2xl group flex flex-col justify-between select-none"
      >
        {/* フィルムの上部スプロケット（穴）デザイン */}
        <div className="h-1.5 bg-slate-950 flex justify-between px-1 items-center border-b border-white/10 z-10">
          {Array.from({ length: 24 }).map((_, idx) => (
            <div key={idx} className="w-1.5 h-1 bg-slate-700/60 rounded-xs" />
          ))}
        </div>

        {/* サムネイル画像シーケンス（フィルムストリップ） */}
        <div className="flex-1 relative flex overflow-hidden bg-slate-950">
          {thumbnails.length > 0 ? (
            <div className="w-full h-full flex divide-x divide-black/40">
              {thumbnails.map((src, i) => (
                <div key={i} className="flex-1 h-full relative overflow-hidden bg-slate-900">
                  <img
                    src={src}
                    alt={`frame-${i}`}
                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity pointer-events-none"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500 font-mono italic">
              {isGenerating ? 'サムネイル生成中...' : 'フィルムタイムライン'}
            </div>
          )}

          {/* プログレスオーバーレイ (再生済み部分をわずかにアンバー色で強調) */}
          <div
            className="absolute top-0 left-0 bottom-0 bg-amber-500/10 border-r border-amber-400/50 pointer-events-none"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* フィルムの下部スプロケット（穴）デザイン */}
        <div className="h-1.5 bg-slate-950 flex justify-between px-1 items-center border-t border-white/10 z-10">
          {Array.from({ length: 24 }).map((_, idx) => (
            <div key={idx} className="w-1.5 h-1 bg-slate-700/60 rounded-xs" />
          ))}
        </div>

        {/* ホバーカーソル ＆ タイムコードツールチップ */}
        {hoverTime !== null && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none z-20"
            style={{ left: `${hoverX}px` }}
          >
            <div className="w-0.5 h-full bg-white/70 shadow-sm" />
            <div className="absolute -top-6 -translate-x-1/2 bg-slate-900 text-white font-mono text-[10px] px-1.5 py-0.5 rounded border border-white/30 whitespace-nowrap shadow-lg">
              {formatTC(hoverTime)}
            </div>
          </div>
        )}

        {/* iMovie風 垂直プレイヘッド（再生ヘッドピン） */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none z-30 transition-none"
          style={{ left: `${progressPercent}%` }}
        >
          {/* 上部アンバーピンヘッド */}
          <div className="absolute -top-1 -translate-x-1/2 w-3 h-2.5 bg-amber-400 rounded-b-xs shadow-md border border-slate-950 flex items-center justify-center">
            <div className="w-1 h-1 bg-slate-950 rounded-full" />
          </div>

          {/* 垂直赤/アンバープレイヘッドライン */}
          <div className="w-0.5 h-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] -translate-x-1/2" />

          {/* 下部ピン */}
          <div className="absolute -bottom-1 -translate-x-1/2 w-3 h-2.5 bg-amber-400 rounded-t-xs shadow-md border border-slate-950" />
        </div>
      </div>
    </div>
  );
};
