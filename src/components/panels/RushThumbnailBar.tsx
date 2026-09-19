import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronsLeft,
  ChevronsRight,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { VideoFrameSampler } from '../../engine/rushThumbnails';
import {
  clampZoom,
  framesPerTile,
  maxZoom,
  nearestFrame,
  positionAtTime,
  scrollLeftAfterZoom,
  scrollToRevealPlayhead,
  sliderFromZoom,
  tileAt,
  tileCount,
  timeAtPosition,
  timelineWidth,
  totalFrames,
  visibleTileRange,
  zoomFromSlider,
  TimelineTile,
} from '../../engine/rushTimeline';

/** サムネイル 1 枚の大きさ (px)。16:9 */
const TILE_WIDTH = 80;
const TILE_HEIGHT = 45;
/** ＋ / − ボタン 1 回の倍率 */
const ZOOM_STEP = 1.6;
/** 時刻の目盛りを何 px おきに振るか (タイル何枚ごとか) */
const RULER_EVERY_TILES = 2;

interface RushThumbnailBarProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string | null;
  /** ルームに保存済みのサムネイル (アップロード時に作った 14 枚)。切り出しが追いつくまでの仮の絵に使う */
  thumbnails?: string[];
  currentTime: number;
  duration: number;
  fps: number;
  onSeek: (newTime: number) => void;
  onStepFrame: (frames: number) => void;
  togglePlay: () => void;
  isPlaying: boolean;
  formatTC: (sec: number) => string;
}

/**
 * オペレーター画面の下に出す、iMovie 風のサムネイル・タイムライン。
 *
 * - 細かさ (拡大率) をスライダー・＋ / −・Ctrl (⌘) + ホイールで変えられる。最大で 1 枚 = 1 コマ
 * - 全体より広くなったら横にスクロールする。ホイールの縦回転も横スクロールに回す
 * - 再生やコマ送りで再生ヘッドが外へ出たら、ページをめくるように追いかける
 * - サムネイルは見えている範囲のコマだけを動画から切り出す (VideoFrameSampler)
 */
export const RushThumbnailBar: React.FC<RushThumbnailBarProps> = ({
  videoUrl,
  thumbnails: storedThumbnails,
  currentTime,
  duration,
  fps,
  onSeek,
  onStepFrame,
  togglePlay,
  isPlaying,
  formatTC,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [samplerVersion, setSamplerVersion] = useState(0);
  const samplerRef = useRef<VideoFrameSampler | null>(null);
  /** 拡大・縮小の直後に合わせたいスクロール位置 (幅が変わってから当てる) */
  const pendingScrollRef = useRef<number | null>(null);

  const hasVideo = !!videoUrl && duration > 0;
  const frames = totalFrames(duration, fps);
  const zoomMax = maxZoom(duration, fps, viewportWidth, TILE_WIDTH);
  const effectiveZoom = clampZoom(zoom, zoomMax);
  const width = timelineWidth(viewportWidth, effectiveZoom);
  const count = hasVideo ? tileCount(width, TILE_WIDTH) : 0;
  const perTile = framesPerTile(width, TILE_WIDTH, duration, fps);
  const playheadX = positionAtTime(currentTime, width, duration);

  // イベントの中から最新の値を読むため (ホイールは native で受けるので再登録を避ける)
  const latest = useRef({ effectiveZoom, zoomMax, viewportWidth, width, playheadX, isDragging });
  latest.current = { effectiveZoom, zoomMax, viewportWidth, width, playheadX, isDragging };

  // 見えている幅を追う
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 拡大・縮小で幅が変わったら、予約したスクロール位置を当てる
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || pendingScrollRef.current === null) return;
    el.scrollLeft = pendingScrollRef.current;
    pendingScrollRef.current = null;
    setScrollLeft(el.scrollLeft);
  }, [width]);

  // 動画が変わったら切り出し役を作り直す
  useEffect(() => {
    if (!videoUrl) return;
    const sampler = new VideoFrameSampler(videoUrl, fps, () => setSamplerVersion((v) => v + 1));
    samplerRef.current = sampler;
    return () => {
      sampler.dispose();
      if (samplerRef.current === sampler) samplerRef.current = null;
    };
  }, [videoUrl, fps]);

  // 見えているタイル
  const tiles = useMemo<TimelineTile[]>(() => {
    const range = visibleTileRange(scrollLeft, viewportWidth, TILE_WIDTH, count, 3);
    if (!range) return [];
    const list: TimelineTile[] = [];
    for (let i = range.first; i <= range.last; i++) list.push(tileAt(i, width, TILE_WIDTH, duration, fps));
    return list;
  }, [scrollLeft, viewportWidth, count, width, duration, fps]);

  // 見えているコマの切り出しを頼む (画面の中央に近い順)
  const wantedKey = tiles.map((t) => t.frame).join(',');
  useEffect(() => {
    const sampler = samplerRef.current;
    if (!sampler || tiles.length === 0) return;
    const center = scrollLeft + viewportWidth / 2;
    const ordered = [...tiles]
      .sort((a, b) => Math.abs(a.left - center) - Math.abs(b.left - center))
      .map((t) => t.frame);
    sampler.want(Array.from(new Set(ordered)));
    // wantedKey が変わったときだけ頼み直す (tiles は毎回新しい配列なので依存に入れない)
  }, [wantedKey, videoUrl]);

  // 手元にある絵: 切り出し済みのコマ + ルームに保存済みの 14 枚
  const storedByFrame = useMemo(() => {
    const map = new Map<number, string>();
    const list = storedThumbnails || [];
    list.forEach((src, i) => {
      // アップロード時は (i + 0.5) / 枚数 の時刻から切り出している
      map.set(Math.min(frames - 1, Math.floor(((i + 0.5) / list.length) * frames)), src);
    });
    return map;
  }, [storedThumbnails, frames]);

  const knownFrames = useMemo(() => {
    const sampled = samplerRef.current?.cachedFrames() ?? [];
    return Array.from(new Set([...sampled, ...storedByFrame.keys()])).sort((a, b) => a - b);
    // samplerVersion は切り出しが進んだ合図 (中身は samplerRef から読む)
  }, [samplerVersion, storedByFrame, videoUrl]);

  const imageFor = (frame: number): { src: string; exact: boolean } | null => {
    const sampled = samplerRef.current?.get(frame);
    if (sampled) return { src: sampled, exact: true };
    const stored = storedByFrame.get(frame);
    if (stored) return { src: stored, exact: true };
    const near = nearestFrame(knownFrames, frame);
    if (near === null) return null;
    const src = samplerRef.current?.get(near) ?? storedByFrame.get(near);
    return src ? { src, exact: false } : null;
  };

  /** 倍率を変える。anchorX (見えている範囲の左端からの px) の時刻を動かさない */
  const applyZoom = useCallback((nextZoom: number, anchorX?: number) => {
    const el = scrollRef.current;
    const { effectiveZoom: current, zoomMax: max, viewportWidth: vw, playheadX: px } = latest.current;
    if (!el || vw <= 0) return;
    const clamped = clampZoom(nextZoom, max);
    if (Math.abs(clamped - current) < 1e-6) return;

    // 指定が無ければ再生ヘッドを軸にする (見えていなければ中央)
    let anchor = anchorX;
    if (anchor === undefined) {
      const rel = px - el.scrollLeft;
      anchor = rel >= 0 && rel <= vw ? rel : vw / 2;
    }
    pendingScrollRef.current = scrollLeftAfterZoom(el.scrollLeft, anchor, vw, current, clamped);
    setZoom(clamped);
  }, []);

  // ホイール: Ctrl / ⌘ (トラックパッドのピンチも含む) で拡大・縮小、それ以外は横スクロール。
  // React の onWheel は passive で preventDefault できないので、native で受ける
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const factor = Math.exp(-e.deltaY * unit * 0.002);
        applyZoom(latest.current.effectiveZoom * factor, e.clientX - rect.left);
        return;
      }
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
        e.preventDefault();
        el.scrollLeft += e.deltaY * unit;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  // 再生・コマ送り・リテイクへの移動で再生ヘッドが外へ出たら追いかける
  useEffect(() => {
    const el = scrollRef.current;
    const { viewportWidth: vw, width: w, playheadX: px, isDragging: dragging } = latest.current;
    if (!el || dragging) return;
    const next = scrollToRevealPlayhead(px, el.scrollLeft, vw, w);
    if (next !== null) el.scrollLeft = next;
  }, [currentTime]);

  // クリック・ドラッグの位置 → シーク
  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el || !hasVideo) return;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left + el.scrollLeft;
      onSeek(timeAtPosition(x, latest.current.width, duration, fps));
    },
    [hasVideo, duration, fps, onSeek]
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    seekFromClientX(e.clientX);
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const el = scrollRef.current;
      if (el) {
        // 端まで引っぱったら、その先へスクロールしながら送る
        const rect = el.getBoundingClientRect();
        const edge = 24;
        if (e.clientX > rect.right - edge) el.scrollLeft += (e.clientX - (rect.right - edge)) * 0.5;
        else if (e.clientX < rect.left + edge) el.scrollLeft -= (rect.left + edge - e.clientX) * 0.5;
      }
      seekFromClientX(e.clientX);
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, seekFromClientX]);

  const handleContentMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setHoverX(e.clientX - rect.left + el.scrollLeft);
  };

  const zoomLabel = !hasVideo
    ? '—'
    : perTile <= 1.01
      ? '1 枚 = 1 コマ'
      : `1 枚 ≈ ${perTile < 10 ? perTile.toFixed(1) : Math.round(perTile)} コマ`;

  const sampler = samplerRef.current;
  const samplingFailed = !!sampler?.isFailed;

  return (
    <div className="bg-slate-950 border-t border-amber-500/20 px-3 py-2 flex flex-col gap-1.5 select-none flex-shrink-0">
      {/* 1. コントロールボタンバー ＆ 細かさ ＆ タイムコード表示 */}
      <div className="flex items-center justify-between gap-3 text-xs">
        {/* ボタン群 (再生、1コマ送り、10コマ送り) */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onStepFrame(-10)}
            className="p-1.5 rounded hover:bg-white/10 text-slate-300 hover:text-amber-300 transition-colors flex items-center gap-0.5"
            title="10コマ戻る (Shift + ←)"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => onStepFrame(-1)}
            className="p-1.5 rounded hover:bg-white/10 text-slate-300 hover:text-amber-300 transition-colors"
            title="1コマ戻る (←)"
          >
            <SkipBack className="w-4 h-4" />
          </button>
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
          <button
            onClick={() => onStepFrame(1)}
            className="p-1.5 rounded hover:bg-white/10 text-slate-300 hover:text-amber-300 transition-colors"
            title="1コマ進む (→)"
          >
            <SkipForward className="w-4 h-4" />
          </button>
          <button
            onClick={() => onStepFrame(10)}
            className="p-1.5 rounded hover:bg-white/10 text-slate-300 hover:text-amber-300 transition-colors flex items-center gap-0.5"
            title="10コマ進む (Shift + →)"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>

        {/* 細かさ (拡大率) */}
        <div
          className="flex items-center gap-1.5 min-w-0"
          title="タイムラインの細かさ (Ctrl / ⌘ + ホイールでも変えられます。ホイールだけなら横スクロール)"
        >
          <button
            onClick={() => applyZoom(1)}
            disabled={!hasVideo || effectiveZoom <= 1}
            className="px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap text-slate-300 hover:text-amber-300 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
            title="全体を表示"
          >
            全体
          </button>
          <button
            onClick={() => applyZoom(effectiveZoom / ZOOM_STEP)}
            disabled={!hasVideo || effectiveZoom <= 1}
            className="p-1 rounded text-slate-300 hover:text-amber-300 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
            title="粗くする"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            step={1}
            value={Math.round(sliderFromZoom(effectiveZoom, zoomMax) * 1000)}
            onChange={(e) => applyZoom(zoomFromSlider(Number(e.target.value) / 1000, zoomMax))}
            // 掴んだままだと ← → がスライダーに取られ、コマ送りにならない
            onPointerUp={(e) => e.currentTarget.blur()}
            disabled={!hasVideo || zoomMax <= 1}
            className="w-28 lg:w-40 accent-amber-400 disabled:opacity-30"
            aria-label="タイムラインの細かさ"
          />
          <button
            onClick={() => applyZoom(effectiveZoom * ZOOM_STEP)}
            disabled={!hasVideo || effectiveZoom >= zoomMax}
            className="p-1 rounded text-slate-300 hover:text-amber-300 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
            title="細かくする"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => applyZoom(zoomMax)}
            disabled={!hasVideo || effectiveZoom >= zoomMax}
            className="px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap text-slate-300 hover:text-amber-300 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
            title="1 枚 = 1 コマまで細かくする"
          >
            1コマ
          </button>
          <span className="font-mono text-[10px] text-slate-400 whitespace-nowrap w-24">{zoomLabel}</span>
        </div>

        {/* タイムコードカウンタ */}
        <div className="font-mono text-xs font-bold text-amber-300 bg-slate-900/90 px-2.5 py-1 rounded border border-amber-500/30 shadow-inner flex items-center gap-1.5 flex-shrink-0">
          <span>{formatTC(currentTime)}</span>
          <span className="text-slate-500">/</span>
          <span className="text-slate-400 font-normal">{formatTC(duration)}</span>
        </div>
      </div>

      {/* 2. iMovie風 サムネイル タイムライン (横スクロール) */}
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        className="relative w-full overflow-x-scroll overflow-y-hidden bg-slate-900 rounded-lg border border-white/15 shadow-2xl"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(251,191,36,0.5) transparent' }}
      >
        {hasVideo ? (
          <div
            onMouseDown={handleMouseDown}
            onMouseMove={handleContentMouseMove}
            onMouseLeave={() => !isDragging && setHoverX(null)}
            className="relative cursor-pointer"
            style={{ width: `${width}px`, height: `${TILE_HEIGHT + 14 + 12}px` }}
          >
            {/* 時刻の目盛り */}
            <div className="absolute top-0 left-0 right-0 h-3.5 bg-slate-950 border-b border-white/10">
              {tiles
                .filter((t) => t.index % RULER_EVERY_TILES === 0)
                .map((t) => (
                  <div
                    key={`r${t.index}`}
                    className="absolute top-0 h-full border-l border-white/20 pl-0.5 font-mono text-[9px] leading-[14px] text-slate-400 whitespace-nowrap"
                    style={{ left: `${t.left}px` }}
                  >
                    {formatTC((t.frame + 0.5) / fps)}
                  </div>
                ))}
            </div>

            {/* フィルムの上部スプロケット */}
            <div
              className="absolute left-0 right-0 h-1.5 bg-slate-950"
              style={{
                top: '14px',
                backgroundImage: 'repeating-linear-gradient(90deg, rgba(71,85,105,0.6) 0 6px, transparent 6px 14px)',
                backgroundSize: '14px 4px',
                backgroundRepeat: 'repeat-x',
                backgroundPosition: '4px 1px',
              }}
            />

            {/* サムネイル (見えている範囲だけ描く) */}
            {tiles.map((t) => {
              const image = imageFor(t.frame);
              return (
                <div
                  key={t.index}
                  className="absolute overflow-hidden bg-slate-900 border-r border-black/50"
                  style={{ left: `${t.left}px`, width: `${t.width}px`, top: '20px', height: `${TILE_HEIGHT}px` }}
                >
                  {image && (
                    <img
                      src={image.src}
                      alt=""
                      draggable={false}
                      className={`w-full h-full object-cover pointer-events-none ${image.exact ? 'opacity-90' : 'opacity-40'}`}
                    />
                  )}
                </div>
              );
            })}

            {/* フィルムの下部スプロケット */}
            <div
              className="absolute left-0 right-0 bottom-0 h-1.5 bg-slate-950"
              style={{
                backgroundImage: 'repeating-linear-gradient(90deg, rgba(71,85,105,0.6) 0 6px, transparent 6px 14px)',
                backgroundSize: '14px 4px',
                backgroundRepeat: 'repeat-x',
                backgroundPosition: '4px 1px',
              }}
            />

            {/* 再生済み部分 */}
            <div
              className="absolute left-0 bg-amber-500/10 pointer-events-none"
              style={{ top: '14px', bottom: 0, width: `${playheadX}px` }}
            />

            {/* ホバーカーソル ＆ タイムコード */}
            {hoverX !== null && (
              <div className="absolute bottom-0 pointer-events-none z-20" style={{ left: `${hoverX}px`, top: '14px' }}>
                <div className="w-0.5 h-full bg-white/70 shadow-sm" />
                <div className="absolute top-1 left-1 bg-slate-900/90 text-white font-mono text-[10px] px-1.5 py-0.5 rounded border border-white/30 whitespace-nowrap shadow-lg">
                  {formatTC(timeAtPosition(hoverX, width, duration, fps))}
                </div>
              </div>
            )}

            {/* 再生ヘッド */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none z-30"
              style={{ left: `${playheadX}px` }}
            >
              <div className="absolute top-0 -translate-x-1/2 w-3 h-2.5 bg-amber-400 rounded-b-sm shadow-md border border-slate-950" />
              <div className="w-0.5 h-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] -translate-x-1/2" />
            </div>
          </div>
        ) : (
          <div
            className="flex items-center justify-center text-[11px] text-slate-500 font-mono italic"
            style={{ height: `${TILE_HEIGHT + 14 + 12}px` }}
          >
            フィルムタイムライン
          </div>
        )}
      </div>

      {samplingFailed && (
        <p className="text-[10px] text-slate-500">
          この動画からはコマを切り出せないため、保存済みのサムネイルだけで表示しています。
        </p>
      )}
    </div>
  );
};
