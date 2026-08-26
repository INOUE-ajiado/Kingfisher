import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X, Maximize2, Minimize2, Film, FolderOpen, Play, Pause, ChevronLeft, ChevronRight, SkipBack, SkipForward, AlertTriangle } from 'lucide-react';
import { usePaintStore } from '../../store/usePaintStore';
import { useFloatingWindow } from '../../hooks/useFloatingWindow';
import { CornerResizeHandles } from '../common/CornerResizeHandles';
import { collectDroppedVideoFiles, commonRootName, steppedTime, frameIndexAt, estimateFps, COMMON_FPS } from '../../engine/videoSource';
import { resolveDropHandles } from '../../engine/fileSystemPath';

/** 再生速度の選択肢 */
const SPEEDS = [0.25, 0.5, 1, 2];

/** fps 推定に使うコマ数。少なすぎると外れ値に弱く、多いと確定が遅い */
const FPS_SAMPLES = 24;

function formatTimecode(seconds: number, fps: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00+00';
  const total = Math.floor(seconds);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  const f = String(Math.max(0, frameIndexAt(seconds, fps) - Math.floor(total * fps))).padStart(2, '0');
  return `${h}:${m}:${s}+${f}`;
}

/**
 * 撮影上がりロールの再生ウィンドウ。
 *
 * ⚠️ デコードは一切自前でやらない。<video> にそのまま任せることで
 * ハードウェア再生になり、バンドルもメモリも増えない。
 * ⚠️ 再生中の時刻表示は React の state を通さず DOM へ直接書く。
 * state にすると毎コマ再描画が走り、塗り作業と同時に開いたときに効いてくる。
 */
export const RollViewer: React.FC = React.memo(() => {
  const roll = usePaintStore((s) => s.roll);
  const { closeRollWindow, toggleRollFloating, loadRollFile, loadRollFiles, stepRoll, reportRollPlaybackFailure, setRollFps } =
    usePaintStore();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seekRef = useRef<HTMLInputElement | null>(null);
  const timeLabelRef = useRef<HTMLSpanElement | null>(null);
  const frameCallbackRef = useRef<number | null>(null);
  const fpsSamplesRef = useRef<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isDragOver, setIsDragOver] = useState(false);

  const {
    targetRef,
    windowStyle,
    handleHeaderPointerDown,
    getResizeHandler,
    isOverDockTarget,
    bringToFront,
  } = useFloatingWindow<HTMLDivElement>({
    id: 'roll',
    isFloating: roll.isFloating,
    getIsFloating: () => usePaintStore.getState().roll.isFloating,
    toggleFloating: () => usePaintStore.getState().toggleRollFloating(),
    dockTargetId: 'roll-dock-target',
    minWidth: 320,
    minHeight: 260,
  });

  /** 時刻表示とシークバーを DOM へ直接書く (再描画を挟まない) */
  const paintTime = useCallback((time: number) => {
    const fps = usePaintStore.getState().roll.fps;
    if (timeLabelRef.current) timeLabelRef.current.textContent = formatTimecode(time, fps);
    if (seekRef.current && document.activeElement !== seekRef.current) {
      seekRef.current.value = String(time);
    }
  }, []);

  /**
   * 再生中だけ requestVideoFrameCallback を回す。
   *
   * ⚠️ timeupdate では足りない。発火が 4 回/秒ほどしかなくコマ単位の表示にならない。
   * rVFC は実際に表示されたコマごとに mediaTime をくれるので、fps の推定にも使える。
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isPlaying) return;

    const anyVideo = video as unknown as {
      requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };

    if (typeof anyVideo.requestVideoFrameCallback !== 'function') {
      // 非対応環境では粗いが timeupdate で代替する
      const onTimeUpdate = () => paintTime(video.currentTime);
      video.addEventListener('timeupdate', onTimeUpdate);
      return () => video.removeEventListener('timeupdate', onTimeUpdate);
    }

    const onFrame = (_now: number, meta: { mediaTime: number }) => {
      paintTime(meta.mediaTime);

      const samples = fpsSamplesRef.current;
      if (samples.length < FPS_SAMPLES) {
        samples.push(meta.mediaTime);
        if (samples.length === FPS_SAMPLES) {
          const estimated = estimateFps(samples);
          if (estimated) setRollFps(estimated, 'auto');
        }
      }

      frameCallbackRef.current = anyVideo.requestVideoFrameCallback!(onFrame);
    };

    frameCallbackRef.current = anyVideo.requestVideoFrameCallback(onFrame);
    return () => {
      if (frameCallbackRef.current !== null) {
        anyVideo.cancelVideoFrameCallback?.(frameCallbackRef.current);
        frameCallbackRef.current = null;
      }
    };
  }, [isPlaying, paintTime, setRollFps]);

  // 素材が変わったら推定をやり直す
  useEffect(() => {
    fpsSamplesRef.current = [];
    setIsPlaying(false);
    setDuration(0);
  }, [roll.objectUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = speed;
  }, [speed, roll.objectUrl]);


  const openViaPicker = async () => {
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: '撮影ロール (*.mov, *.mp4)', accept: { 'video/*': ['.mov', '.mp4', '.m4v', '.webm'] } }],
        });
        loadRollFile(await handle.getFile());
        return;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Failed to open roll:', err);
    }
    fileInputRef.current?.click();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    // ⚠️ dataTransfer.items は await を挟んだ時点で無効になるので、先に同期で読み取る。
    // ⚠️ files だけを見ないこと。フォルダを落とした場合そこにはフォルダ自体しか入らず、
    // 中の .mov / .mp4 が見えない。
    const plainFiles = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    const entries: any[] = [];
    const handlePromises: Promise<any>[] = [];
    const items = e.dataTransfer.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item: any = items[i];
        if (typeof item.getAsFileSystemHandle === 'function') {
          handlePromises.push(item.getAsFileSystemHandle().catch(() => null));
        }
        const entry = item.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
    }

    const handles = await resolveDropHandles(handlePromises);
    // フォルダの中に複数入っていることがあるので、まとめて受け取って一覧にする
    const videos = await collectDroppedVideoFiles(plainFiles, handles, entries);
    if (videos.length > 0) loadRollFiles(videos, commonRootName(videos));
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    // ⚠️ 握り潰さないこと。ボタンからの再生はユーザー操作なので普通は通るが、
    // 自動再生ポリシーで弾かれると「押しても何も起きない」だけになり原因が追えない。
    video.play().catch((err) => console.error('Failed to play roll:', err));
  };

  /** コマ送り。再生中なら止めてから動かす */
  const step = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = steppedTime(video.currentTime, delta, roll.fps, video.duration);
  };

  /**
   * 1 秒送り / 戻し。
   *
   * ⚠️ 秒数を直接足さないこと。コマの境界からずれてしまい、そのあとのコマ送りが
   * 半コマずれた位置を行き来する。fps ぶんのコマを進めれば境界に乗ったままになる。
   */
  const stepSecond = (direction: number) => {
    step(direction * Math.max(1, Math.round(roll.fps)));
  };

  /**
   * キーボードでのコマ送り。
   *
   * ⚠️ 上下キーはセルのコマ送りに割り当てられているので、ここでは左右だけを使う。
   * ⚠️ 入力欄にフォーカスがあるときは何もしないこと。シークバーや fps の選択は
   * 左右キーで操作するものなので、横取りするとつまみが動かせなくなる。
   * ⚠️ Shift 以外の修飾キーが付いていたら見送る。割り当てていない組み合わせを
   * 横取りしないため。
   */
  const stepRef = useRef({ step, stepSecond });
  stepRef.current = { step, stepSecond };

  useEffect(() => {
    if (!roll.objectUrl || roll.status !== 'ready') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const direction = e.key === 'ArrowRight' ? 1 : -1;
      // ⚠️ 最新の関数を ref から呼ぶこと。依存に入れて登録し直すと、
      // 塗っている間の再描画のたびに window のリスナーを付け替えることになる。
      if (e.shiftKey) stepRef.current.stepSecond(direction);
      else stepRef.current.step(direction);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [roll.objectUrl, roll.status]);

  const unsupported = roll.status === 'unsupported' || roll.status === 'error';
  const disabled = !roll.objectUrl || unsupported;

  return (
    <div
      ref={targetRef}
      style={windowStyle}
      onPointerDownCapture={bringToFront}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => void handleDrop(e)}
      className={`flex flex-col bg-white dark:bg-slate-900 border-2 ${
        isOverDockTarget
          ? 'border-blue-500 ring-4 ring-blue-500/50'
          : isDragOver
          ? 'border-amber-400 ring-4 ring-amber-400/50'
          : 'border-indigo-600 dark:border-indigo-700'
      } rounded shadow-2xl relative ${roll.isFloating ? '' : 'flex-1'}`}
    >
      {isDragOver && (
        <div className="absolute inset-0 bg-indigo-950/90 border-2 border-dashed border-amber-300 rounded flex flex-col items-center justify-center text-amber-300 z-50 pointer-events-none p-4 select-none">
          <FolderOpen className="w-8 h-8 mb-2 animate-bounce" />
          <span className="font-bold text-xs">ここにドロップしてロールを開く</span>
          <span className="text-[9px] opacity-80 mt-1">.mov / .mp4 に対応</span>
        </div>
      )}

      <div
        onPointerDown={handleHeaderPointerDown}
        className="h-6 bg-gradient-to-r from-indigo-600 to-indigo-500 dark:from-indigo-800 dark:to-indigo-700 text-white flex items-center justify-between px-2 text-[11px] font-bold select-none touch-none cursor-grab active:cursor-grabbing shadow-xs"
      >
        <div className="flex items-center gap-1.5 truncate">
          <Film className="w-3.5 h-3.5 text-indigo-200" />
          <span className="truncate">【ロール】 {roll.fileName || '(未読み込み)'}</span>
          {roll.files.length > 1 && (
            <span className="text-[9px] font-normal opacity-90 flex-shrink-0">
              {roll.files.findIndex((v) => v.path === roll.currentPath) + 1} / {roll.files.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); toggleRollFloating(); }}
            title={roll.isFloating ? 'ドッキングに戻す' : '切り離してフローティング表示'}
            className="p-0.5 hover:bg-indigo-700/80 rounded transition-colors"
          >
            {roll.isFloating ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); closeRollWindow(); }}
            title="ロールウィンドウを閉じる"
            className="p-0.5 hover:bg-red-600 rounded transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 映像 */}
      <div className="flex-1 min-h-0 bg-black relative flex items-center justify-center">
        {roll.objectUrl && !unsupported && (
          <video
            ref={videoRef}
            src={roll.objectUrl}
            className="max-w-full max-h-full"
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setDuration(Number.isFinite(v.duration) ? v.duration : 0);
              v.playbackRate = speed;
              paintTime(v.currentTime);
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onSeeked={(e) => paintTime(e.currentTarget.currentTime)}
            onError={() => { setIsPlaying(false); void reportRollPlaybackFailure(); }}
          />
        )}

        {!roll.objectUrl && (
          <div className="text-center text-slate-400 text-[11px] p-4 select-none">
            <Film className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="mb-2">撮影上がりのロールを開いてください</p>
            <button
              onClick={openViaPicker}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-semibold transition-colors"
            >
              ロールを開く (.mov / .mp4)
            </button>
            <p className="mt-2 text-[9px] opacity-70">ドラッグ＆ドロップでも開けます</p>
          </div>
        )}

        {unsupported && (
          <div className="absolute inset-0 bg-slate-900/95 text-slate-200 p-4 overflow-auto text-[11px] select-text">
            <div className="flex items-center gap-2 text-amber-400 font-bold mb-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>このロールは再生できません</span>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-slate-300">{roll.message}</pre>
            <button
              onClick={openViaPicker}
              className="mt-3 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-semibold transition-colors"
            >
              別のロールを開く
            </button>
          </div>
        )}
      </div>

      {/* 操作 */}
      <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-2 py-1.5 space-y-1.5">
        <input
          ref={seekRef}
          type="range"
          min={0}
          max={duration || 0}
          step={0.001}
          defaultValue={0}
          disabled={disabled}
          onChange={(e) => {
            const v = videoRef.current;
            if (v) v.currentTime = Number(e.target.value);
          }}
          className="w-full accent-indigo-600 cursor-pointer disabled:opacity-40"
        />

        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-1">
            {roll.files.length > 1 && (
              <button
                onClick={() => stepRoll(-1)}
                disabled={disabled}
                title="前のロールへ"
                className="p-1 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => step(-1)}
              disabled={disabled}
              title="前のコマ (←) / 1 秒戻す (Shift + ←)"
              className="p-1 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={togglePlay}
              disabled={disabled}
              title={isPlaying ? '一時停止' : '再生'}
              className="p-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 transition-colors"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => step(1)}
              disabled={disabled}
              title="次のコマ (→) / 1 秒送る (Shift + →)"
              className="p-1 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            {roll.files.length > 1 && (
              <button
                onClick={() => stepRoll(1)}
                disabled={disabled}
                title="次のロールへ"
                className="p-1 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <span ref={timeLabelRef} className="font-mono tabular-nums">
            {formatTimecode(0, roll.fps)}
          </span>

          <div className="flex items-center gap-1">
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              title="再生速度"
              className="bg-slate-200 dark:bg-slate-800 rounded px-1 py-0.5 text-[10px]"
            >
              {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
            </select>
            <select
              value={roll.fps}
              onChange={(e) => setRollFps(Number(e.target.value), 'manual')}
              title="コマ送りの基準 fps"
              className="bg-slate-200 dark:bg-slate-800 rounded px-1 py-0.5 text-[10px]"
            >
              {(COMMON_FPS.includes(roll.fps) ? COMMON_FPS : [roll.fps, ...COMMON_FPS]).map((f) => (
                <option key={f} value={f}>
                  {f}fps{roll.fpsSource === 'auto' && f === roll.fps ? ' (自動)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mov,.mp4,.m4v,.webm"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) loadRollFile(file);
          e.target.value = '';
        }}
      />

      {roll.isFloating && <CornerResizeHandles getResizeHandler={getResizeHandler} topOffset={24} />}
    </div>
  );
});
