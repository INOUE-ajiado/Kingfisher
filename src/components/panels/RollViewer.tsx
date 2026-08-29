import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X, Maximize2, Minimize2, Film, FolderOpen, Play, Pause, ChevronLeft, ChevronRight, SkipBack, SkipForward, AlertTriangle, Link, Link2Off, Columns } from 'lucide-react';
import { usePaintStore } from '../../store/usePaintStore';
import { RollId } from '../../store/types';
import { useFloatingWindow } from '../../hooks/useFloatingWindow';
import { CornerResizeHandles } from '../common/CornerResizeHandles';
import { collectDroppedVideoFiles, commonRootName, steppedTime, frameIndexAt, estimateFps, COMMON_FPS } from '../../engine/videoSource';
import { resolveDropHandles } from '../../engine/fileSystemPath';
import { registerRollVideo, getRollVideo, otherRollId } from './rollVideoRegistry';

/** 再生速度の選択肢 */
const SPEEDS = [0.25, 0.5, 1, 2];

/** fps 推定に使うコマ数。少なすぎると外れ値に弱く、多いと確定が遅い */
const FPS_SAMPLES = 24;

/**
 * 連動中に許すずれ (秒)。これを超えたら相手の時刻を直す。
 * 毎コマ書き戻すと相手のデコードを乱すので、明らかにずれた時だけ触る。
 */
const SYNC_DRIFT_TOLERANCE = 0.08;

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
    toggleRollSync,
    openRollWindow,
  } = usePaintStore();

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

  /** 連動している相手の映像。連動していなければ null */
  const partnerVideo = useCallback((): HTMLVideoElement | null => {
    if (!usePaintStore.getState().roll.sync) return null;
    return getRollVideo(otherRollId(rollId));
  }, [rollId]);

  /**
   * 自分の時刻に対する相手の時刻。
   * syncOffset は「B − A」なので、自分が A なら足し、B なら引く。
   */
  const partnerTimeFor = useCallback(
    (time: number): number => {
      const { syncOffset } = usePaintStore.getState().roll;
      return rollId === 'rollA' ? time + syncOffset : time - syncOffset;
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
    if (videos.length > 0) loadRollFiles(rollId, videos, commonRootName(videos));
  };

  /**
   * 再生 / 一時停止。
   *
   * both を立てると、再生の連動を入れていなくても 2 面いっしょに動かす
   * (Space の「同時再生」)。時刻を揃えるかどうかは従来どおり連動の有無で決まる。
   */
  const togglePlay = (both = false) => {
    const video = videoRef.current;
    if (!video) return;
    // 連動中はこちらが主導する。押した側をアクティブにしておく
    setActiveRollId(rollId);
    const partner = both ? getRollVideo(otherRollId(rollId)) : partnerVideo();

    if (!video.paused) {
      video.pause();
      partner?.pause();
      return;
    }

    // 連動中は流し始める前に頭を揃える
    syncPartnerTime(video.currentTime);
    // ⚠️ 握り潰さないこと。ボタンからの再生はユーザー操作なので普通は通るが、
    // 自動再生ポリシーで弾かれると「押しても何も起きない」だけになり原因が追えない。
    video.play().catch((err) => console.error('Failed to play roll:', err));
    partner?.play().catch((err) => console.error('Failed to play linked roll:', err));
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
    video.currentTime = steppedTime(video.currentTime, delta, view.fps, video.duration);
    // 連動中は時刻差を保って合わせ、そうでなければ相手も同じコマ数だけ送る
    syncPartnerTime(video.currentTime);
    stepPartner(partnerDelta);
  };

  /** この面だけを送る (◀ ▶ ボタン)。左右のずれを作りたいときの逃げ道 */
  const stepSelf = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    setActiveRollId(rollId);
    video.pause();
    video.currentTime = steppedTime(video.currentTime, delta, view.fps, video.duration);
    syncPartnerTime(video.currentTime);
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
   * 連動の開始 / 終了。
   *
   * ⚠️ 開始時の時刻差を保つこと。片方を頭出ししてから連動させる使い方があるので、
   * 強制的に同じ時刻へ合わせると狙って選んだ位置がずれる (セルの左右連動と同じ考え方)。
   */
  const handleToggleSync = () => {
    if (roll.sync) {
      toggleRollSync();
      return;
    }
    const a = getRollVideo('rollA');
    const b = getRollVideo('rollB');
    const offset = a && b ? b.currentTime - a.currentTime : 0;
    toggleRollSync(offset);
  };

  /**
   * キーボード操作。← → でコマ送り (2 面いっしょ)、↑ ↓ で前後のロール、
   * Space で 2 面同時再生。
   *
   * ⚠️ ↑ ↓ と Space はセルでも使う (コマ送り / パン)。どちらへ効かせるかは
   * activeSurface (最後に触った面) で決める。ここで拾ったら stopPropagation して
   * セル側 (useGlobalShortcuts / CellWindow) へ流さないこと。二重に動く。
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

      // ← → はロールの中のコマ送りなので従来どおり常に拾う。
      // ↑ ↓ と Space はセルと取り合いになるため、ロールを最後に触ったときだけ。
      if ((isRollStep || isPlay) && store.activeSurface !== 'roll') return;

      // キーを拾うのは 1 面だけ。アクティブな面が閉じていれば、開いている方が拾う
      if (store.roll.views[store.roll.activeId].isOpen && store.roll.activeId !== rollId) return;

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          (isPlay && (target.tagName === 'BUTTON' || target.tagName === 'A')))
      ) {
        return;
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
        usePaintStore.getState().stepRoll(rollId, e.key === 'ArrowDown' ? 1 : -1);
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
      style={windowStyle}
      onPointerDownCapture={() => {
        bringToFront();
        setActiveRollId(rollId);
      }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => void handleDrop(e)}
      className={`flex flex-col bg-white dark:bg-slate-900 border-2 ${
        isOverDockTarget
          ? 'border-blue-500 ring-4 ring-blue-500/50'
          : isDragOver
          ? 'border-amber-400 ring-4 ring-amber-400/50'
          : tone.border
      } ${isActive && partnerOpen ? 'ring-2 ring-amber-400/70' : ''} rounded shadow-2xl relative ${
        view.isFloating ? '' : 'flex-1'
      }`}
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
        className={`h-6 bg-gradient-to-r ${tone.header} text-white flex items-center justify-between px-2 text-[11px] font-bold select-none touch-none cursor-grab active:cursor-grabbing shadow-xs`}
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
          {isActive && partnerOpen && (
            <span
              title="ツリーから映像を選ぶと、この面に開きます"
              className="text-[9px] font-bold bg-amber-400 text-slate-900 px-1 rounded flex-shrink-0"
            >
              選択先
            </span>
          )}
          {!partnerOpen && (
            <button
              onClick={(e) => { e.stopPropagation(); openRollWindow(otherRollId(rollId)); }}
              title={`${TONE[otherRollId(rollId)].label} を開いて 2 画面で見比べる`}
              className="p-0.5 hover:bg-white/25 rounded transition-colors"
            >
              <Columns className="w-3 h-3" />
            </button>
          )}
          {partnerOpen && (
            <button
              onClick={(e) => { e.stopPropagation(); handleToggleSync(); }}
              title={
                roll.sync
                  ? '再生の連動を解除する'
                  : 'もう一方のロールと再生を連動させる (今の時刻差を保ちます)。ツリーで選ぶロールの連動はファイルツリー側の「選択連動」'
              }
              className={`p-0.5 rounded transition-colors ${
                roll.sync ? 'bg-amber-400 text-slate-900' : 'hover:bg-white/25'
              }`}
            >
              {roll.sync ? <Link className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); toggleRollFloating(rollId); }}
            title={view.isFloating ? 'ドッキングに戻す' : '切り離してフローティング表示'}
            className="p-0.5 hover:bg-white/25 rounded transition-colors"
          >
            {view.isFloating ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); closeRollWindow(rollId); }}
            title={`${tone.label} を閉じる`}
            className="p-0.5 hover:bg-red-600 rounded transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 映像 */}
      <div className="flex-1 min-h-0 bg-black relative flex items-center justify-center">
        {view.objectUrl && !unsupported && (
          <video
            ref={attachVideo}
            src={view.objectUrl}
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
            onError={() => { setIsPlaying(false); void reportRollPlaybackFailure(rollId); }}
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

        {unsupported && (
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
            if (!v) return;
            v.currentTime = Number(e.target.value);
            syncPartnerTime(v.currentTime);
          }}
          className="w-full accent-indigo-600 cursor-pointer disabled:opacity-40"
        />

        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-1">
            {view.files.length > 1 && (
              <button
                onClick={() => stepRoll(rollId, -1)}
                disabled={disabled}
                title="前のロールへ (↑)"
                className="p-1 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => stepSelf(-1)}
              disabled={disabled}
              title="前のコマ (この面だけ)。← は 2 面いっしょ / Shift + ← で 1 秒"
              className="p-1 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => togglePlay()}
              disabled={disabled}
              title={isPlaying ? '一時停止 (Space)' : '再生 (Space で 2 面同時)'}
              className={`p-1 rounded ${tone.button} text-white disabled:opacity-40 transition-colors`}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => stepSelf(1)}
              disabled={disabled}
              title="次のコマ (この面だけ)。→ は 2 面いっしょ / Shift + → で 1 秒"
              className="p-1 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            {view.files.length > 1 && (
              <button
                onClick={() => stepRoll(rollId, 1)}
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
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              title="再生速度"
              className="bg-slate-200 dark:bg-slate-800 rounded px-1 py-0.5 text-[10px]"
            >
              {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
            </select>
            <select
              value={view.fps}
              onChange={(e) => setRollFps(rollId, Number(e.target.value), 'manual')}
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

      {view.isFloating && <CornerResizeHandles getResizeHandler={getResizeHandler} topOffset={24} />}
    </div>
  );
});
