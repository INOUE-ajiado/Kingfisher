import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X, Maximize2, Minimize2, Film, FolderOpen, Folder, Play, Pause, ChevronLeft, ChevronRight, SkipBack, SkipForward, AlertTriangle, Link, Link2Off, Columns, Expand, Shrink } from 'lucide-react';
import { usePaintStore } from '../../store/usePaintStore';
import { FileBrowser } from './FileBrowser';
import { RetakeNotePanel } from './RetakeNotePanel';
import { RollId, ROLL_IDS } from '../../store/types';
import { logDebug } from '../../engine/debugLog';
import { useFloatingWindow } from '../../hooks/useFloatingWindow';
import { CornerResizeHandles } from '../common/CornerResizeHandles';
import { collectDroppedVideoFiles, commonRootName, steppedTime, frameIndexAt, estimateFps, COMMON_FPS } from '../../engine/videoSource';
import { resolveDropHandles } from '../../engine/fileSystemPath';
import { readDropItems, readMultipleDroppedFolders } from '../../engine/dropFolder';
import {
  registerRollVideo,
  getRollVideo,
  otherRollId,
  beginPairedPlayback,
  endPairedPlayback,
  getPairedPlaybackOffset,
} from './rollVideoRegistry';

/** 再生速度の選択肢 */
const SPEEDS = [0.25, 0.5, 1, 2];

/** fps 推定に使うコマ数。少なすぎると外れ値に弱く、多いと確定が遅い */
const FPS_SAMPLES = 24;

/**
 * 連動中に許すずれ (秒)。これを超えたら相手の時刻を直す。
 * 毎コマ書き戻すと相手のデコードを乱すので、明らかにずれた時だけ触る。
 * ⚠️ 24fps アニメーションで 1 コマ (約 0.0417s) 未満のズレ (20ms) を閾値にする。
 */
const SYNC_DRIFT_TOLERANCE = 0.02;

function formatTimecode(seconds: number, fps: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00+00';
  const total = Math.floor(seconds);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  const f = String(Math.max(0, frameIndexAt(seconds, fps) - Math.floor(total * fps))).padStart(2, '0');
  return `${h}:${m}:${s}+${f}`;
}

const TONE: Record<RollId, { label: string; header: string; border: string; accent: string; button: string }> = {
  rollA: {
    label: 'ロール A',
    header: 'from-indigo-600 to-indigo-500 dark:from-indigo-800 dark:to-indigo-700',
    border: 'border-indigo-600 dark:border-indigo-700',
    accent: 'text-indigo-200',
    button: 'bg-indigo-600 hover:bg-indigo-500',
  },
  rollB: {
    label: 'ロール B',
    header: 'from-violet-600 to-violet-500 dark:from-violet-800 dark:to-violet-700',
    border: 'border-violet-600 dark:border-violet-700',
    accent: 'text-violet-200',
    button: 'bg-violet-600 hover:bg-violet-500',
  },
};

interface RollViewerProps {
  rollId: RollId;
}

/**
 * 撮影上がりロールの再生ウィンドウ。
 *
 * ⚠️ デコードは一切自前でやらない。<video> にそのまま任せることで
 * ハードウェア再生になり、バンドルもメモリも増えない。
 * ⚠️ 再生中の時刻表示は React の state を通さず DOM へ直接書く。
 * state にすると毎コマ再描画が走り、塗り作業と同時に開いたときに効いてくる。
 * ⚠️ 連動 (修正前 / 修正後の見比べ) も DOM を直に触る。時刻をストアへ持たせると
 * 毎コマ再描画が走り、2 本同時再生に付いてこられない。
 */
export const RollViewer: React.FC<RollViewerProps> = React.memo(({ rollId }) => {
  const roll = usePaintStore((s) => s.roll);
  const view = roll.views[rollId];
  const {
    closeRollWindow,
    toggleRollFloating,
    setActiveRollId,
    loadRollFile,
    loadRollFiles,
    stepRoll,
    reportRollPlaybackFailure,
    setRollFps,
    updateRollSyncOffset,
    toggleSyncMode,
    syncMode,
    openRollWindow,
  } = usePaintStore();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const seekRef = useRef<HTMLInputElement | null>(null);
  const timeLabelRef = useRef<HTMLSpanElement | null>(null);
  const frameCallbackRef = useRef<number | null>(null);
  const fpsSamplesRef = useRef<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** ProRes リアルタイム再生用の参照 */
  const currentTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const speedRef = useRef<number>(1);
  const isPlayingRef = useRef<boolean>(false);
  const lastRenderedFrameRef = useRef<number>(-1);

  /** シークバーのドラッグをまとめるための控え (始点と時計) */
  const seekBurstRef = useRef<string | null>(null);
  const seekTimerRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const tone = TONE[rollId];
  const partnerOpen = roll.views[otherRollId(rollId)].isOpen;

  const {
    targetRef,
    windowStyle,
    handleHeaderPointerDown,
    getResizeHandler,
    isOverDockTarget,
    bringToFront,
  } = useFloatingWindow<HTMLDivElement>({
    id: rollId,
    isFloating: view.isFloating,
    getIsFloating: () => usePaintStore.getState().roll.views[rollId].isFloating,
    toggleFloating: () => usePaintStore.getState().toggleRollFloating(rollId),
    dockTargetId: `${rollId}-dock-target`,
    minWidth: 320,
    minHeight: 260,
  });

  const [showControls, setShowControls] = useState(true);
  const [isBottomBarHovered, setIsBottomBarHovered] = useState(false);
  const [isRightSidebarHovered, setIsRightSidebarHovered] = useState(false);
  const [isRightSidebarFocused, setIsRightSidebarFocused] = useState(false);
  const hideControlsTimerRef = useRef<number | null>(null);

  const RETAKE_PANEL_HEIGHT_KEY = 'kingfisher_retake_panel_height';
  const DEFAULT_RETAKE_HEIGHT = 320;
  const MIN_RETAKE_HEIGHT = 120;

  const [retakePanelHeight, setRetakePanelHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(RETAKE_PANEL_HEIGHT_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= MIN_RETAKE_HEIGHT) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to read retake panel height from localStorage', e);
    }
    return DEFAULT_RETAKE_HEIGHT;
  });

  const isResizingRef = useRef(false);

  const handleResizerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startHeight = retakePanelHeight;
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {}
    isResizingRef.current = true;

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!isResizingRef.current) return;
      const deltaY = startY - moveEvent.clientY;
      const maxHeight = Math.floor(window.innerHeight * 0.75);
      const newHeight = Math.max(MIN_RETAKE_HEIGHT, Math.min(maxHeight, startHeight + deltaY));
      setRetakePanelHeight(newHeight);
      try {
        localStorage.setItem(RETAKE_PANEL_HEIGHT_KEY, String(newHeight));
      } catch {}
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      isResizingRef.current = false;
      try {
        target.releasePointerCapture(upEvent.pointerId);
      } catch {}
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimerRef.current !== null) {
      window.clearTimeout(hideControlsTimerRef.current);
    }
    if (isFullscreen) {
      hideControlsTimerRef.current = window.setTimeout(() => {
        setShowControls(false);
      }, 1000);
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) {
      setShowControls(true);
      if (hideControlsTimerRef.current !== null) {
        window.clearTimeout(hideControlsTimerRef.current);
        hideControlsTimerRef.current = null;
      }
    } else {
      handleMouseMove();
    }
  }, [isFullscreen, isPlaying, handleMouseMove]);

  const toggleFullscreen = useCallback(() => {
    if (!targetRef.current) return;
    if (!document.fullscreenElement) {
      targetRef.current.requestFullscreen?.().catch((err) => {
        console.error('Failed to enter fullscreen:', err);
      });
    } else {
      document.exitFullscreen?.().catch((err) => {
        console.error('Failed to exit fullscreen:', err);
      });
    }
  }, [targetRef]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const el = targetRef.current;
      const active = document.fullscreenElement;
      setIsFullscreen(Boolean(active && (active === el || el?.contains(active))));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [targetRef]);

  /**
   * 2 面の再生位置を 1 行で。「ロール A c001.mov 1.250s / ロール B r001.mov 1.250s」
   *
   * ⚠️ 時刻はストアではなく <video> から読む。再生中の時刻は再描画を避けるため
   * ストアへ入れていない (毎コマ更新すると塗り作業に影響する)。
   */
  const describeRollTimes = useCallback((): string => {
    const roll = usePaintStore.getState().roll;
    return ROLL_IDS.map((rid) => {
      const view = roll.views[rid];
      if (!view.isOpen) return `${TONE[rid].label} 閉`;
      const video = getRollVideo(rid);
      const at = video ? `${video.currentTime.toFixed(3)}s` : '-';
      return `${TONE[rid].label} ${view.fileName || '未読み込み'} ${at}`;
    }).join(' / ');
  }, []);

  /** 連動の状態を添える (再生連動の有無と時刻差) */
  const describeRollSync = useCallback((): string => {
    const roll = usePaintStore.getState().roll;
    return roll.sync ? `再生連動 ON (時刻差 ${roll.syncOffset.toFixed(3)}s)` : '再生連動 OFF';
  }, []);

  /**
   * 足並みを揃える相手の映像。
   *
   * ⚠️ 再生連動 (🔗) が入っているときだけでなく、Space の同時再生中も返すこと。
   * 連動 OFF のまま 2 本を流すと、デコードの立ち上がりや尺の違いでずれていき、
   * 見比べにならない (実測で 1.6 秒ずれた / 2026-08-31 の報告)。
   */
  const partnerVideo = useCallback((): HTMLVideoElement | null => {
    if (!usePaintStore.getState().roll.sync && getPairedPlaybackOffset() === null) return null;
    return getRollVideo(otherRollId(rollId));
  }, [rollId]);

  /**
   * 自分の時刻に対する相手の時刻。
   * syncOffset は「B − A」なので、自分が A なら足し、B なら引く。
   */
  const partnerTimeFor = useCallback(
    (time: number): number => {
      const { sync, syncOffset } = usePaintStore.getState().roll;
      // 連動中は 🔗 を押した時点の差、そうでなければ同時再生を始めた時点の差
      const offset = sync ? syncOffset : getPairedPlaybackOffset() ?? 0;
      return rollId === 'rollA' ? time + offset : time - offset;
    },
    [rollId]
  );

  /** 相手の時刻を自分に合わせる */
  const syncPartnerTime = useCallback(
    (time: number, tolerance = 0) => {
      const partner = partnerVideo();
      if (!partner) return;
      const limit = Number.isFinite(partner.duration) ? Math.max(0, partner.duration - 1e-3) : Infinity;
      const target = Math.min(limit, Math.max(0, partnerTimeFor(time)));
      if (Math.abs(partner.currentTime - target) > tolerance) partner.currentTime = target;
    },
    [partnerVideo, partnerTimeFor]
  );

  /** 時刻表示とシークバーを DOM へ直接書く (再描画を挟まない) */
  const paintTime = useCallback(
    (time: number) => {
      const fps = usePaintStore.getState().roll.views[rollId].fps;
      if (timeLabelRef.current) timeLabelRef.current.textContent = formatTimecode(time, fps);
      if (seekRef.current && document.activeElement !== seekRef.current) {
        seekRef.current.value = String(time);
      }
    },
    [rollId]
  );

  /** 参照の同期 */
  speedRef.current = speed;
  isPlayingRef.current = isPlaying;

  /** ProRes デコーダからフレームを取得して canvas に描画 */
  const renderFrameAt = useCallback((time: number) => {
    const decoder = view.realtimeDecoder;
    const canvas = canvasRef.current;
    if (!decoder || !canvas) return;
    const fps = view.fps || decoder.fps || 24;
    const frameIdx = Math.floor(time * fps);
    if (frameIdx === lastRenderedFrameRef.current) return;
    lastRenderedFrameRef.current = frameIdx;

    decoder.getFrame(frameIdx).then((bitmap: ImageBitmap | null) => {
      if (!bitmap || !canvasRef.current) return;
      const c = canvasRef.current;
      if (c.width !== bitmap.width || c.height !== bitmap.height) {
        c.width = bitmap.width;
        c.height = bitmap.height;
      }
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0);
      }
    }).catch((err: any) => {
      console.error('Frame decode error:', err);
    });
  }, [view.realtimeDecoder, view.fps]);

  /** リアルタイム ProRes 再生用のプロキシオブジェクト生成 */
  const realtimeVideoProxy = useCallback(() => {
    return {
      get currentTime() { return currentTimeRef.current; },
      set currentTime(t: number) {
        currentTimeRef.current = Math.max(0, Math.min(durationRef.current, t));
        paintTime(currentTimeRef.current);
        renderFrameAt(currentTimeRef.current);
      },
      get duration() { return durationRef.current; },
      get paused() { return !isPlayingRef.current; },
      get ended() { return durationRef.current > 0 && currentTimeRef.current >= durationRef.current; },
      get playbackRate() { return speedRef.current; },
      set playbackRate(r: number) { setSpeed(r); },
      play: () => { setIsPlaying(true); return Promise.resolve(); },
      pause: () => { setIsPlaying(false); },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }, [paintTime, renderFrameAt]);

  /** リアルタイム ProRes モードの初期化とレジストリ登録 */
  useEffect(() => {
    if (view.isRealtimeProRes && view.realtimeDecoder) {
      const proxy = realtimeVideoProxy() as unknown as HTMLVideoElement;
      videoRef.current = proxy;
      registerRollVideo(rollId, proxy);
      setDuration(view.realtimeDecoder.duration);
      durationRef.current = view.realtimeDecoder.duration;
      currentTimeRef.current = 0;
      paintTime(0);
      renderFrameAt(0);
      return () => {
        if (videoRef.current === proxy) {
          videoRef.current = null;
          registerRollVideo(rollId, null);
        }
      };
    }
  }, [view.isRealtimeProRes, view.realtimeDecoder, realtimeVideoProxy, rollId, paintTime, renderFrameAt]);

  /** ProRes リアルタイム再生の requestAnimationFrame ループ */
  useEffect(() => {
    if (!isPlaying || !view.isRealtimeProRes || !view.realtimeDecoder) return;

    let animId: number | null = null;
    let lastTime = performance.now();

    const animFrame = (now: number) => {
      const deltaSec = ((now - lastTime) / 1000) * speedRef.current;
      lastTime = now;

      const dur = durationRef.current || view.realtimeDecoder?.duration || 0;
      const nextTime = currentTimeRef.current + deltaSec;

      if (dur > 0 && nextTime >= dur) {
        currentTimeRef.current = dur;
        paintTime(dur);
        renderFrameAt(dur);
        setIsPlaying(false);
        endPairedPlayback();
        return;
      }

      currentTimeRef.current = nextTime;
      paintTime(nextTime);

      if (usePaintStore.getState().roll.activeId === rollId) {
        syncPartnerTime(nextTime, SYNC_DRIFT_TOLERANCE);
      }

      renderFrameAt(nextTime);
      animId = requestAnimationFrame(animFrame);
    };

    animId = requestAnimationFrame(animFrame);

    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
    };
  }, [isPlaying, view.isRealtimeProRes, view.realtimeDecoder, rollId, paintTime, syncPartnerTime, renderFrameAt]);

  /**
   * 再生中だけ requestVideoFrameCallback を回す。
   *
   * ⚠️ timeupdate では足りない。発火が 4 回/秒ほどしかなくコマ単位の表示にならない。
   * rVFC は実際に表示されたコマごとに mediaTime をくれるので、fps の推定にも使える。
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isPlaying || view.isRealtimeProRes) return;

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
      // 連動中のずれ直しは、操作した側 (アクティブな面) だけが行う。
      // ⚠️ 両方が相手を直すと互いにシークをかけ合い、再生が始まらない。
      if (usePaintStore.getState().roll.activeId === rollId) {
        syncPartnerTime(meta.mediaTime, SYNC_DRIFT_TOLERANCE);
      }

      const samples = fpsSamplesRef.current;
      if (samples.length < FPS_SAMPLES) {
        samples.push(meta.mediaTime);
        if (samples.length === FPS_SAMPLES) {
          const estimated = estimateFps(samples);
          if (estimated) setRollFps(rollId, estimated, 'auto');
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
  }, [isPlaying, paintTime, setRollFps, rollId, syncPartnerTime]);

  // 素材が変わったら推定をやり直す
  useEffect(() => {
    fpsSamplesRef.current = [];
    setIsPlaying(false);
    setDuration(0);
    // ⚠️ 同時再生の時刻差も手放す。別の素材へ移ったら前の差に意味は無い
    endPairedPlayback();
  }, [view.objectUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = speed;
  }, [speed, view.objectUrl]);

  /**
   * 連動のために、この面の映像を登録しておく。
   *
   * ⚠️ ref のコールバックは毎レンダー作り直さないこと。
   * 識別子が変わるたび React が null → 要素 の順で呼び直すため、
   * その一瞬だけ登録が外れる。相手がそのタイミングで再生を始めようとすると
   * 「連動しているのに片方しか動かない」ことになる。
   */
  const attachVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      registerRollVideo(rollId, el);
    },
    [rollId]
  );

  const openViaPicker = async () => {
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: '撮影ロール (*.mov, *.mp4)', accept: { 'video/*': ['.mov', '.mp4', '.m4v', '.webm'] } }],
        });
        loadRollFile(rollId, await handle.getFile());
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

    const items = readDropItems(e.dataTransfer);
    const store = usePaintStore.getState();

    const multi = await readMultipleDroppedFolders(items, store);
    if (multi.handled) return;

    const { plainFiles, handlePromises, entries } = items;

    const handles = await resolveDropHandles(handlePromises);
    // フォルダの中に複数入っていることがあるので、まとめて受け取って一覧にする
    const videos = await collectDroppedVideoFiles(plainFiles, handles, entries);
    if (videos.length > 0) loadRollFiles(rollId, videos, commonRootName(videos));
  };

  /**
   * 再生 / 一時停止。
   *
   * both または roll.sync を立てると 2 面いっしょに動かす。
   * ⚠️ ロール映像の尺が異なる場合、同じ尺分連動し、尺が足りないロールは最後で留まり、
   * 尺が長い方のロールの再生・操作を優先する。
   */
  const togglePlay = (both = false) => {
    const video = videoRef.current;
    if (!video) return;
    setActiveRollId(rollId);
    const isSyncOn = usePaintStore.getState().roll.sync;
    const partner = (both || isSyncOn) ? getRollVideo(otherRollId(rollId)) : partnerVideo();

    if (!video.paused) {
      video.pause();
      partner?.pause();
      endPairedPlayback();
      logDebug(
        'roll',
        `一時停止 — ${tone.label} から${both ? ' (Space: 2 面同時)' : ''}`,
        `${describeRollTimes()} / ${describeRollSync()}`
      );
      return;
    }

    if (partner) {
      if (video.ended && partner.ended) {
        video.currentTime = 0;
        partner.currentTime = 0;
        if (both) beginPairedPlayback(0);
      } else if (both) {
        beginPairedPlayback(rollId === 'rollA' ? partner.currentTime - video.currentTime : video.currentTime - partner.currentTime);
      }
    }

    // 連動中は流し始める前に頭を揃える
    syncPartnerTime(video.currentTime);
    logDebug(
      'roll',
      `再生 — ${tone.label} から${both ? ' (Space)' : ''}${partner ? ' / 相手も動かす' : ''}`,
      `${describeRollTimes()} / ${describeRollSync()}` +
        `${getPairedPlaybackOffset() !== null ? ` / 同時再生の時刻差 ${getPairedPlaybackOffset()!.toFixed(3)}s を保つ` : ''}`
    );

    video.play().catch((err) => console.error('Failed to play roll:', err));
    if (partner) {
      // 相手が終端に達していても、長い方が動く場合は再生させて終端位置を維持する
      if (partner.ended) {
        const partnerDuration = Number.isFinite(partner.duration) ? partner.duration : 0;
        partner.currentTime = Math.max(0, partnerDuration - 0.05);
      }
      partner.play().catch((err) => console.error('Failed to play linked roll:', err));
    }
  };

  /**
   * もう一方の面も同じコマ数だけ送る。
   *
   * ⚠️ 再生の連動 (roll.sync) 中はここでは触らないこと。あちらは開始時の時刻差を
   * 保って絶対時刻で合わせる担当 (syncPartnerTime) で、両方から書くと差が崩れる。
   * ⚠️ コマ数は面ごとの fps で秒へ直すこと。24fps と 30fps を並べたときに
   * 相手の fps で計算しないと、送るたびに少しずつずれていく。
   */
  const stepPartner = (frames: number) => {
    const otherId = otherRollId(rollId);
    const state = usePaintStore.getState();
    if (state.roll.sync) return;
    if (!state.roll.views[otherId].isOpen) return;

    const partner = getRollVideo(otherId);
    if (!partner) return;
    const fps = state.roll.views[otherId].fps;
    partner.currentTime = steppedTime(partner.currentTime, frames, fps, partner.duration);
  };

  /**
   * コマ送り。再生中なら止めてから動かす。
   *
   * ⚠️ 2 面開いているときは、もう一方も同じだけ送ること (2026-08-29 のユーザー指定)。
   * 再生の連動が入っていれば時刻差を保ったまま、入っていなければ今の位置から
   * 同じコマ数だけ動く。片方だけ動かしたいときは、その面の ◀ ▶ ボタンを使う。
   */
  const step = (delta: number, partnerDelta: number = delta) => {
    const video = videoRef.current;
    if (!video) return;
    setActiveRollId(rollId);
    video.pause();
    getRollVideo(otherRollId(rollId))?.pause();

    const before = describeRollTimes();
    video.currentTime = steppedTime(video.currentTime, delta, view.fps, video.duration);
    // 連動中は時刻差を保って合わせ、そうでなければ相手も同じコマ数だけ送る
    syncPartnerTime(video.currentTime);
    stepPartner(partnerDelta);

    logDebug(
      'roll',
      `コマ送り ${delta > 0 ? '→ 進む' : '← 戻る'} ${Math.abs(delta)} コマ (${view.fps}fps) — ${tone.label} 主導 / ${describeRollSync()}`,
      `${before}  →  ${describeRollTimes()}`
    );
  };

  /** この面だけを送る (◀ ▶ ボタン)。左右のずれを作りたいときの逃げ道 */
  const stepSelf = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    setActiveRollId(rollId);
    video.pause();

    const before = describeRollTimes();
    video.currentTime = steppedTime(video.currentTime, delta, view.fps, video.duration);

    // ⚠️ 再生連動 (roll.sync) 中なら、相手を無理に同期させるのではなく
    // この面だけを動かしたあとの新しい時刻差を覚えて連動を維持する
    const state = usePaintStore.getState();
    if (state.roll.sync) {
      const a = getRollVideo('rollA');
      const b = getRollVideo('rollB');
      if (a && b) {
        updateRollSyncOffset(b.currentTime - a.currentTime);
      }
    }

    logDebug(
      'roll',
      `コマ送り ${delta > 0 ? '→ 進む' : '← 戻る'} 1 コマ — ${tone.label} だけ (ボタン) / ${describeRollSync()}`,
      `${before}  →  ${describeRollTimes()}`
    );
  };

  /**
   * 1 秒送り / 戻し。
   *
   * ⚠️ 秒数を直接足さないこと。コマの境界からずれてしまい、そのあとのコマ送りが
   * 半コマずれた位置を行き来する。fps ぶんのコマを進めれば境界に乗ったままになる。
   * ⚠️ 相手のコマ数は相手の fps で数えること。同じコマ数を渡すと、fps が違う
   * 2 本では「1 秒」がずれる。
   */
  const stepSecond = (direction: number) => {
    const partnerFps = usePaintStore.getState().roll.views[otherRollId(rollId)].fps;
    step(
      direction * Math.max(1, Math.round(view.fps)),
      direction * Math.max(1, Math.round(partnerFps))
    );
  };


  /**
   * キーボード操作。← → でコマ送り (2 面いっしょ)、↑ ↓ で前後のロール、
   * Space で 2 面同時再生。
   *
   * ⚠️ どのキーもセル側と取り合いになる (↑ ↓ = コマ送り、Space = 押しながらパン、
   * ← → = ツリーのフォルダ開閉)。どちらへ効かせるかは activeSurface
   * (最後に触った面) で決め、拾ったら stopPropagation してセル側
   * (useGlobalShortcuts / CellWindow / ファイルツリー) へ流さないこと。二重に動く。
   *   ⚠️ この登録は window の capture。document の capture (useGlobalShortcuts) より
   *   先に走るので、ここで止めればセルのコマ送りは動かない。
   * ⚠️ 入力欄にフォーカスがあるときは何もしないこと。シークバーや fps の選択は
   * 左右キーで操作するものなので、横取りするとつまみが動かせなくなる。
   * ⚠️ ボタンにフォーカスがあるときは Space を横取りしないこと。ブラウザが keyup で
   * クリックにするため、拾うと再生と停止が 1 回ずつ走って何も起きないように見える。
   * ⚠️ 2 面あるので、キーを拾うのは 1 面だけ。両方が拾うと二重に進む。
   */
  const stepRef = useRef({ step, stepSecond, togglePlay });
  stepRef.current = { step, stepSecond, togglePlay };

  useEffect(() => {
    // ⚠️ 「再生できる」ことを条件にしないこと。コーデック非対応で止まった面からでも
    // ↑ ↓ で次のロールへ移れないと、その 1 本から抜け出せなくなる。
    if (!view.isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const store = usePaintStore.getState();
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const isStep = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      const isRollStep = e.key === 'ArrowUp' || e.key === 'ArrowDown';
      const isPlay = e.key === ' ' || e.code === 'Space';
      if (!isStep && !isRollStep && !isPlay) return;

      // ⚠️ ← → も含めて、ロールを最後に触ったときだけ拾うこと。
      // ← → はセルのコマ送りには使われていないが、ファイルツリーでは
      // フォルダの開閉に使う。無条件に横取りすると、ロールを開いている間だけ
      // セルのツリーが開け閉めできなくなる (2026-08-29 の報告)。
      if (store.activeSurface !== 'roll') return;

      // キーを拾うのは 1 面だけ。アクティブな面が閉じていれば、開いている方が拾う
      if (store.roll.views[store.roll.activeId].isOpen && store.roll.activeId !== rollId) return;

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

      // ボタン等にフォーカスが残っていた場合はフォーカスを即座に外し、キーボードショートカットを優先
      if (target && (target.tagName === 'BUTTON' || target.tagName === 'A')) {
        target.blur();
      }

      e.preventDefault();
      e.stopPropagation();

      // ⚠️ 最新の関数を ref から呼ぶこと。依存に入れて登録し直すと、
      // 塗っている間の再描画のたびに window のリスナーを付け替えることになる。
      if (isPlay) {
        stepRef.current.togglePlay(true);
        return;
      }
      if (isRollStep) {
        // ツリーの並びに合わせる (↓ が次のロール)。選択連動中は相手の面も動く
        usePaintStore.getState().stepRoll(rollId, e.key === 'ArrowDown' ? 1 : -1, `キー ${e.key === 'ArrowDown' ? '↓' : '↑'}`);
        return;
      }
      const direction = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) stepRef.current.stepSecond(direction);
      else stepRef.current.step(direction);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [view.isOpen, rollId]);

  const unsupported = view.status === 'unsupported' || view.status === 'error';
  const disabled = !view.objectUrl || unsupported;
  const isActive = roll.activeId === rollId;

  return (
    <div
      ref={targetRef}
      style={isFullscreen ? undefined : windowStyle}
      onPointerDownCapture={() => {
        bringToFront();
        setActiveRollId(rollId);
      }}
      onMouseMove={handleMouseMove}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => void handleDrop(e)}
      className={
        isFullscreen
          ? `fixed inset-0 w-screen h-screen z-50 bg-black flex flex-col justify-between overflow-hidden relative select-none ${
              isPlaying && !showControls ? 'cursor-none [&_*]:!cursor-none' : ''
            }`
          : `flex flex-col bg-white dark:bg-slate-900 ${
              view.isFloating ? 'border-2 rounded shadow-2xl' : 'border flex-1'
            } ${
              isOverDockTarget
                ? 'border-blue-500 ring-4 ring-blue-500/50'
                : isDragOver
                ? 'border-amber-400 ring-4 ring-amber-400/50'
                : tone.border
            } ${isActive && partnerOpen ? 'ring-1 ring-inset ring-amber-400/70' : ''} relative`
      }
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
        className={
          isFullscreen
            ? `absolute top-0 left-0 right-0 z-30 h-10 bg-gradient-to-b from-black/80 via-black/40 to-transparent text-white flex items-center justify-between px-3 text-[11px] font-bold select-none transition-opacity duration-300 ${
                showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
              }`
            : `h-6 bg-gradient-to-r ${tone.header} text-white flex items-center justify-between px-2 text-[11px] font-bold select-none touch-none cursor-grab active:cursor-grabbing shadow-xs`
        }
      >
        <div className="flex items-center gap-1.5 truncate">
          <Film className={`w-3.5 h-3.5 ${tone.accent}`} />
          <span className="truncate">【{tone.label}】 {view.fileName || '(未読み込み)'}</span>
          {view.files.length > 1 && view.currentPath && (
            <span className="text-[9px] font-normal opacity-90 flex-shrink-0">
              {view.files.findIndex((v) => v.path === view.currentPath) + 1} / {view.files.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {partnerOpen && (roll.sync || roll.fileSync || isActive) && (
            <span
              title={
                roll.sync || roll.fileSync
                  ? '連動中: ファイル選択や操作が 2 画面で連携します'
                  : 'ツリーから映像を選ぶと、この面に開きます'
              }
              className={`text-[9px] font-bold px-1 rounded flex-shrink-0 ${
                roll.sync || roll.fileSync
                  ? 'bg-emerald-400 text-slate-900'
                  : 'bg-amber-400 text-slate-900'
              }`}
            >
              {roll.sync || roll.fileSync ? '選択先 (連動)' : '選択先'}
            </span>
          )}
          {!partnerOpen && (
            <button
              tabIndex={-1}
              onPointerDown={(e) => e.currentTarget.blur()}
              onClick={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).blur(); openRollWindow(otherRollId(rollId)); }}
              title={`${TONE[otherRollId(rollId)].label} を開いて 2 画面で見比べる`}
              className="p-0.5 hover:bg-white/25 rounded transition-colors"
            >
              <Columns className="w-3 h-3" />
            </button>
          )}
          {partnerOpen && (
            <button
              tabIndex={-1}
              onPointerDown={(e) => e.currentTarget.blur()}
              onClick={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).blur(); toggleSyncMode(); }}
              title={
                roll.sync || syncMode
                  ? '連携を解除する (セル・ロール全体の共通連携)'
                  : '連携を入れる (セル・ロール全体の共通連携)'
              }
              className={`p-0.5 rounded transition-colors ${
                roll.sync || syncMode ? 'bg-amber-400 text-slate-900' : 'hover:bg-white/25'
              }`}
            >
              {roll.sync || syncMode ? <Link className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />}
            </button>
          )}
          <button
            tabIndex={-1}
            onPointerDown={(e) => e.currentTarget.blur()}
            onClick={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).blur(); toggleRollFloating(rollId); }}
            title={view.isFloating ? 'ドッキングに戻す' : '切り離してフローティング表示'}
            className="p-0.5 hover:bg-white/25 rounded transition-colors"
          >
            {view.isFloating ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
          <button
            tabIndex={-1}
            onPointerDown={(e) => e.currentTarget.blur()}
            onClick={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).blur(); toggleFullscreen(); }}
            title={isFullscreen ? '全画面表示を解除 (Esc)' : '全画面フルスクリーン表示 (ダブルクリックでも可)'}
            className="p-0.5 hover:bg-white/25 rounded transition-colors"
          >
            {isFullscreen ? <Shrink className="w-3 h-3" /> : <Expand className="w-3 h-3" />}
          </button>
          <button
            tabIndex={-1}
            onPointerDown={(e) => e.currentTarget.blur()}
            onClick={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).blur(); closeRollWindow(rollId); }}
            title={`${tone.label} を閉じる`}
            className="p-0.5 hover:bg-red-600 rounded transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 映像 */}
      <div
        className={
          isFullscreen
            ? `absolute inset-0 z-10 w-full h-full bg-black flex items-center justify-center cursor-pointer ${
                isPlaying && !showControls ? 'cursor-none [&_*]:!cursor-none' : ''
              }`
            : 'flex-1 min-h-0 bg-black relative flex items-center justify-center cursor-pointer'
        }
        onDoubleClick={toggleFullscreen}
      >
        {view.objectUrl && !unsupported && !view.isRealtimeProRes && (
          <video
            ref={attachVideo}
            src={view.objectUrl}
            className={
              isFullscreen
                ? `w-full h-full object-contain ${isPlaying && !showControls ? 'cursor-none !cursor-none' : ''}`
                : 'max-w-full max-h-full'
            }
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
            onEnded={() => {
              const partner = partnerVideo() ?? (usePaintStore.getState().roll.sync ? getRollVideo(otherRollId(rollId)) : null);
              if (partner) {
                const partnerDuration = Number.isFinite(partner.duration) ? partner.duration : 0;
                // ⚠️ 相手の動画がまだ終わっていない（尺が長い）場合は、短かった側は最後で留まり、相手の再生を継続する
                if (!partner.ended && partner.currentTime < partnerDuration - 0.1) {
                  logDebug('roll', `${tone.label} が終端に到達。尺の長い相手の再生を継続します`);
                  return;
                }
                partner.pause();
              }
              setIsPlaying(false);
              endPairedPlayback();
            }}
            onError={(e) => {
              setIsPlaying(false);
              const mediaErr = e.currentTarget.error;
              const errInfo = mediaErr
                ? `MEDIA_ERR code=${mediaErr.code} message="${mediaErr.message || 'ブラウザ再生非対応'}"`
                : '再生失敗 (HTMLMediaElement Error)';
              logDebug('roll', `${tone.label} の <video> 要素で再生エラー検知: ${errInfo}`, view.fileName, 'warn');
              const currentStatus = usePaintStore.getState().roll.views[rollId].status;
              if (currentStatus !== 'converting' && currentStatus !== 'error' && currentStatus !== 'unsupported') {
                void reportRollPlaybackFailure(rollId);
              }
            }}
          />
        )}

        {view.isRealtimeProRes && view.realtimeDecoder && !unsupported && (
          <canvas
            ref={canvasRef}
            className={
              isFullscreen
                ? `w-full h-full object-contain ${isPlaying && !showControls ? 'cursor-none !cursor-none' : ''}`
                : 'max-w-full max-h-full'
            }
          />
        )}

        {!view.objectUrl && (
          <div className="text-center text-slate-400 text-[11px] p-4 select-none">
            <Film className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="mb-2">撮影上がりのロールを開いてください</p>
            <button
              onClick={openViaPicker}
              className={`px-3 py-1 ${tone.button} text-white rounded text-[11px] font-semibold transition-colors`}
            >
              ロールを開く (.mov / .mp4)
            </button>
            <p className="mt-2 text-[9px] opacity-70">ドラッグ＆ドロップでも開けます</p>
            <p className="mt-1 text-[9px] opacity-70">
              ファイルツリーで映像を選んでも、この面が「選択先」なら開きます
            </p>
          </div>
        )}

        {view.status === 'converting' && (
          <div className="absolute inset-0 bg-slate-900/95 text-slate-200 p-6 flex flex-col items-center justify-center text-[11px] select-none z-40">
            <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="font-bold text-amber-300 text-xs mb-1">
              Apple ProRes ({view.codec?.fourcc || 'apch'}) 映像を自動変換中...
            </p>
            <p className="text-[10px] text-slate-400 mb-4 text-center">
              ブラウザ内で自動デコード・変換を行っています。<br />完了すると自動的に再生が開始されます。
            </p>
            <div className="w-48 bg-slate-800 rounded-full h-2.5 overflow-hidden border border-slate-700">
              <div
                className="bg-amber-400 h-full transition-all duration-150"
                style={{ width: `${view.convertProgress || 0}%` }}
              />
            </div>
            <span className="mt-2 text-[10px] font-mono text-slate-300 font-bold">
              {view.convertProgress || 0}%
            </span>
          </div>
        )}

        {unsupported && view.status !== 'converting' && (
          <div className="absolute inset-0 bg-slate-900/95 text-slate-200 p-4 overflow-auto text-[11px] select-text">
            <div className="flex items-center gap-2 text-amber-400 font-bold mb-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>このロールは再生できません</span>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-slate-300">{view.message}</pre>
            <button
              onClick={openViaPicker}
              className={`mt-3 px-3 py-1 ${tone.button} text-white rounded text-[11px] font-semibold transition-colors`}
            >
              別のロールを開く
            </button>
          </div>
        )}
      </div>

      {/* フルスクリーン時、画面下部にマウスを近づけた時の検知センサーエリア */}
      {isFullscreen && (
        <div
          onMouseEnter={() => setIsBottomBarHovered(true)}
          className="absolute bottom-0 left-0 right-0 h-12 z-20 pointer-events-auto"
        />
      )}

      {/* 操作 */}
      <div
        onMouseEnter={() => setIsBottomBarHovered(true)}
        onMouseLeave={() => setIsBottomBarHovered(false)}
        className={
          isFullscreen
            ? `absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-4 py-3 space-y-2 text-white transition-all duration-300 transform ${
                isBottomBarHovered
                  ? 'translate-y-0 opacity-100 pointer-events-auto'
                  : 'translate-y-full opacity-0 pointer-events-none'
              }`
            : 'flex-shrink-0 border-t border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-2 py-1.5 space-y-1.5'
        }
      >
        <input
          ref={seekRef}
          type="range"
          min={0}
          max={duration || 0}
          step={0.001}
          defaultValue={0}
          disabled={disabled}
          onPointerDown={() => setActiveRollId(rollId)}
          onChange={(e) => {
            const v = videoRef.current;
            if (!v) return;
            setActiveRollId(rollId);
            const before = seekBurstRef.current ?? describeRollTimes();
            seekBurstRef.current = before;
            v.currentTime = Number(e.target.value);
            syncPartnerTime(v.currentTime);

            // ⚠️ つまみを動かすたびに書かないこと。1 回のドラッグで何十回も来る。
            // 手が止まったところで、始点と終点だけを 1 行にまとめる
            if (seekTimerRef.current !== null) window.clearTimeout(seekTimerRef.current);
            seekTimerRef.current = window.setTimeout(() => {
              const from = seekBurstRef.current;
              seekBurstRef.current = null;
              seekTimerRef.current = null;
              const state = usePaintStore.getState();
              if (state.roll.sync) {
                const a = getRollVideo('rollA');
                const b = getRollVideo('rollB');
                if (a && b) updateRollSyncOffset(b.currentTime - a.currentTime);
              }
              logDebug(
                'roll',
                `シークバーで移動 — ${tone.label} 主導 / ${describeRollSync()}`,
                `${from}  →  ${describeRollTimes()}`
              );
            }, 250);
          }}
          className="w-full accent-indigo-600 cursor-pointer disabled:opacity-40"
        />

        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-1">
            {view.files.length > 1 && (
              <button
                tabIndex={-1}
                onPointerDown={(e) => e.currentTarget.blur()}
                onClick={(e) => { (e.currentTarget as HTMLElement).blur(); stepRoll(rollId, -1, `${tone.label} の ◀◀ ボタン`); }}
                disabled={disabled}
                title="前のロールへ (↑)"
                className="p-1 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              tabIndex={-1}
              onPointerDown={(e) => e.currentTarget.blur()}
              onClick={(e) => { (e.currentTarget as HTMLElement).blur(); stepSelf(-1); }}
              disabled={disabled}
              title="前のコマ (この面だけ)。← は 2 面いっしょ / Shift + ← で 1 秒"
              className="p-1 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              tabIndex={-1}
              onPointerDown={(e) => e.currentTarget.blur()}
              onClick={(e) => { (e.currentTarget as HTMLElement).blur(); togglePlay(); }}
              disabled={disabled}
              title={isPlaying ? '一時停止 (Space)' : '再生 (Space で 2 面同時)'}
              className={`p-1 rounded ${tone.button} text-white disabled:opacity-40 transition-colors`}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button
              tabIndex={-1}
              onPointerDown={(e) => e.currentTarget.blur()}
              onClick={(e) => { (e.currentTarget as HTMLElement).blur(); stepSelf(1); }}
              disabled={disabled}
              title="次のコマ (この面だけ)。→ は 2 面いっしょ / Shift + → で 1 秒"
              className="p-1 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            {view.files.length > 1 && (
              <button
                tabIndex={-1}
                onPointerDown={(e) => e.currentTarget.blur()}
                onClick={(e) => { (e.currentTarget as HTMLElement).blur(); stepRoll(rollId, 1, `${tone.label} の ▶▶ ボタン`); }}
                disabled={disabled}
                title="次のロールへ (↓)"
                className="p-1 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <span ref={timeLabelRef} className="font-mono tabular-nums">
            {formatTimecode(0, view.fps)}
          </span>

          <div className="flex items-center gap-1">
            <select
              tabIndex={-1}
              value={speed}
              onChange={(e) => { setSpeed(Number(e.target.value)); e.target.blur(); }}
              title="再生速度"
              className="bg-slate-200 dark:bg-slate-800 rounded px-1 py-0.5 text-[10px]"
            >
              {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
            </select>
            <select
              tabIndex={-1}
              value={view.fps}
              onChange={(e) => { setRollFps(rollId, Number(e.target.value), 'manual'); e.target.blur(); }}
              title="コマ送りの基準 fps"
              className="bg-slate-200 dark:bg-slate-800 rounded px-1 py-0.5 text-[10px]"
            >
              {(COMMON_FPS.includes(view.fps) ? COMMON_FPS : [view.fps, ...COMMON_FPS]).map((f) => (
                <option key={f} value={f}>
                  {f}fps{view.fpsSource === 'auto' && f === view.fps ? ' (自動)' : ''}
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
          if (file) loadRollFile(rollId, file);
          e.target.value = '';
        }}
      />

      {/* フルスクリーン時、画面右端にマウスを近づけた時の検知センサーエリア */}
      {isFullscreen && (
        <div
          onMouseEnter={() => setIsRightSidebarHovered(true)}
          className="fixed top-0 bottom-0 right-0 w-10 z-40 pointer-events-auto"
        />
      )}

      {/* フルスクリーン時、画面右側にすっと出現するリキッドグラス風ファイルツリーサイドバー */}
      {isFullscreen && (
        <div
          onMouseEnter={() => setIsRightSidebarHovered(true)}
          onMouseLeave={() => {
            if (!isResizingRef.current && !isRightSidebarFocused) {
              setIsRightSidebarHovered(false);
            }
          }}
          onFocusCapture={() => setIsRightSidebarHovered(true)}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsRightSidebarFocused(false);
            }
          }}
          onFocus={() => setIsRightSidebarFocused(true)}
          className={`fixed top-0 bottom-0 right-0 z-50 w-96 max-w-[85vw] bg-slate-900/80 dark:bg-slate-950/85 backdrop-blur-xl border-l border-white/20 shadow-[0_0_50px_rgba(0,0,0,0.8)] transition-all duration-300 transform flex flex-col text-white ${
            isRightSidebarHovered || isResizingRef.current || isRightSidebarFocused
              ? 'translate-x-0 opacity-100 pointer-events-auto visible'
              : 'translate-x-full opacity-0 pointer-events-none invisible'
          }`}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/10 font-bold text-xs select-none">
            <div className="flex items-center gap-1.5 text-amber-400">
              <Folder className="w-4 h-4" />
              <span>ファイルツリー (フルスクリーン)</span>
            </div>
            <button
              tabIndex={-1}
              onPointerDown={(e) => e.currentTarget.blur()}
              onClick={() => setIsRightSidebarHovered(false)}
              className="p-1 hover:bg-white/20 rounded text-slate-300 hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-2 text-slate-200">
            <FileBrowser />
          </div>

          {/* 上下幅調整（リサイズ）スプリッターバー */}
          <div
            onPointerDown={handleResizerPointerDown}
            title="ドラッグしてツリーとリテイクメモの上下幅を調整"
            className="h-2 cursor-row-resize flex items-center justify-center bg-white/5 hover:bg-amber-400/30 active:bg-amber-400/60 select-none group border-t border-b border-white/10 transition-colors touch-none flex-shrink-0"
          >
            <div className="w-8 h-1 rounded-full bg-white/30 group-hover:bg-amber-300 transition-colors" />
          </div>

          <div
            style={{ height: `${retakePanelHeight}px` }}
            className="flex-shrink-0 min-h-[100px] overflow-hidden"
          >
            <RetakeNotePanel rollId={rollId} />
          </div>
        </div>
      )}

      {view.isFloating && <CornerResizeHandles getResizeHandler={getResizeHandler} topOffset={24} />}
    </div>
  );
});
