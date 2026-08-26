/**
 * 撮影上がりロールの再生状態。
 *
 * ⚠️ ここではデコードも読み込みも行わない。ブラウザのネイティブデコーダに任せる
 * ことがこの機能の要で、そうすればハードウェア再生になりメモリも増えない。
 *
 * ⚠️ 映像の一覧 (files) は 2 面で共有する。ツリーは 1 本しか出ないので、
 * 面ごとに持つとツリーの中身と開ける対象が食い違う。
 * 面ごとに持つのは再生状態 (views) だけ。
 */

import { StateCreator } from 'zustand';
import { PaintStore, RollSlice, RollState, RollViewState, RollId, ROLL_IDS } from '../types';
import { DroppedVideo, toPlayableBlob, probeVideoCodec } from '../../engine/videoSource';

/** 推定できるまでのコマ送りの既定値。日本のアニメは 24fps 基準 */
const DEFAULT_FPS = 24;

function emptyView(): RollViewState {
  return {
    isOpen: false,
    isFloating: false,
    fileName: '',
    file: null,
    objectUrl: null,
    currentPath: null,
    status: 'idle',
    message: '',
    codec: null,
    fps: DEFAULT_FPS,
    fpsSource: 'default',
  };
}

const initialRoll: RollState = {
  files: [],
  folderName: '',
  views: { rollA: emptyView(), rollB: emptyView() },
  activeId: 'rollA',
  sync: false,
  syncOffset: 0,
};

/**
 * blob URL を手放す。
 *
 * ⚠️ 差し替えと終了のたびに必ず通すこと。revoke し忘れると、開いたロールの
 * 実体がページを閉じるまで解放されない。数 GB のファイルを何本も開く使い方をするので
 * ここを漏らすと効いてくる。
 */
function releaseUrl(url: string | null): void {
  if (url) URL.revokeObjectURL(url);
}

function conversionHint(fileName: string): string {
  const out = fileName.replace(/\.[^.]+$/, '') + '_h264.mp4';
  return (
    `確認用に H.264 へ変換してから開いてください:\n` +
    `  ffmpeg -i "${fileName}" -c:v libx264 -crf 20 -preset fast -pix_fmt yuv420p "${out}"`
  );
}

/**
 * 1 本のロールを開いた状態を組み立てる。
 *
 * ⚠️ new Blob([file]) にしないこと。ファイル全体をメモリへ載せてしまう。
 * toPlayableBlob は範囲もデータもそのままに MIME だけ差し替える。
 */
function openedView(view: RollViewState, video: DroppedVideo): RollViewState {
  releaseUrl(view.objectUrl);

  return {
    ...view,
    isOpen: true,
    fileName: video.file.name,
    currentPath: video.path,
    file: video.file,
    objectUrl: URL.createObjectURL(toPlayableBlob(video.file)),
    // まず再生させてみる。コーデックの詮索は失敗してからで十分
    status: 'ready',
    message: '',
    codec: null,
    fps: DEFAULT_FPS,
    fpsSource: 'default',
  };
}

/** 1 面だけを差し替えた roll を返す */
function withView(roll: RollState, id: RollId, next: RollViewState): RollState {
  return { ...roll, views: { ...roll.views, [id]: next } };
}

export const createRollSlice: StateCreator<PaintStore, [], [], RollSlice> = (set, get) => ({
  roll: initialRoll,

  openRollWindow: (id) =>
    set((state) => ({
      roll: withView({ ...state.roll, activeId: id }, id, { ...state.roll.views[id], isOpen: true }),
    })),

  closeRollWindow: (id) =>
    set((state) => {
      const view = state.roll.views[id];
      releaseUrl(view.objectUrl);
      // ウィンドウの切り離し状態は次に開いたときのために残し、素材だけ手放す
      return { roll: withView(state.roll, id, { ...emptyView(), isFloating: view.isFloating }) };
    }),

  toggleRollFloating: (id) =>
    set((state) => ({
      roll: withView(state.roll, id, {
        ...state.roll.views[id],
        isFloating: !state.roll.views[id].isFloating,
      }),
    })),

  setActiveRollId: (id) => set((state) => ({ roll: { ...state.roll, activeId: id } })),

  loadRollFile: (id, file) =>
    set((state) => ({
      roll: withView(
        { ...state.roll, activeId: id },
        id,
        openedView(state.roll.views[id], { path: file.name, file })
      ),
    })),

  loadRollFiles: (id, videos, folderName) =>
    set((state) => {
      if (videos.length === 0) return state;
      const roll = { ...state.roll, files: videos, folderName, activeId: id };
      return { roll: withView(roll, id, openedView(state.roll.views[id], videos[0])) };
    }),

  setRollFolderFiles: (videos, folderName) =>
    set((state) => ({ roll: { ...state.roll, files: videos, folderName } })),

  selectRollFile: (id, path) =>
    set((state) => {
      if (path === state.roll.views[id].currentPath) return state;
      const target = state.roll.files.find((v) => v.path === path);
      if (!target) return state;
      const roll = { ...state.roll, activeId: id };
      return { roll: withView(roll, id, openedView(state.roll.views[id], target)) };
    }),

  stepRoll: (id, delta) => {
    const { files, views } = get().roll;
    if (files.length <= 1) return;

    const at = files.findIndex((v) => v.path === views[id].currentPath);
    const next = Math.max(0, Math.min(files.length - 1, (at < 0 ? 0 : at) + delta));
    if (next === at) return;
    get().selectRollFile(id, files[next].path);
  },

  /**
   * <video> が再生を拒否したときに呼ぶ。
   *
   * 「再生できません」だけでは打つ手が分からないので、実際のコーデック名と
   * 変換コマンドまで出す。判別に失敗しても、その旨を返して黙らないこと。
   */
  reportRollPlaybackFailure: async (id) => {
    const view = get().roll.views[id];
    if (!view.file) return;

    let codec = null;
    try {
      codec = await probeVideoCodec(view.file);
    } catch (e) {
      console.error('Failed to probe codec:', e);
    }

    const message = codec
      ? `このロールは ${codec.label} (${codec.fourcc}) で書き出されています。\n` +
        `ブラウザにこのコーデックのデコーダが無いため、そのままでは再生できません。\n\n` +
        conversionHint(view.fileName)
      : `このファイルを再生できませんでした。コーデックを判別できていません。\n` +
        `ProRes・DNxHD・非圧縮などはブラウザでは再生できません。\n\n` +
        conversionHint(view.fileName);

    set((state) => ({
      roll: withView(state.roll, id, {
        ...state.roll.views[id],
        status: codec ? 'unsupported' : 'error',
        message,
        codec,
      }),
    }));
  },

  setRollFps: (id, fps, source) =>
    set((state) => {
      const view = state.roll.views[id];
      // 手動で決めた値を自動推定で上書きしない
      if (source === 'auto' && view.fpsSource === 'manual') return state;
      if (!(fps > 0) || !Number.isFinite(fps)) return state;
      return { roll: withView(state.roll, id, { ...view, fps, fpsSource: source }) };
    }),

  /**
   * 2 面の再生を連動させる / やめる。
   *
   * ⚠️ 連動を始めた時点の時刻差を保つこと。片方を頭出ししてから連動させる使い方が
   * あるので、強制的に同じ時刻へ合わせると狙って選んだ位置がずれる
   * (セルの左右連動と同じ考え方)。時刻は再生中の実体から読むため、
   * 差の計算は呼び出し側 (RollViewer) が渡す。
   */
  toggleRollSync: (offset = 0) =>
    set((state) => {
      if (state.roll.sync) return { roll: { ...state.roll, sync: false } };
      const open = ROLL_IDS.filter((id) => state.roll.views[id].isOpen);
      // 片方しか開いていなければ連動しても意味がない
      if (open.length < 2) return state;
      return { roll: { ...state.roll, sync: true, syncOffset: offset } };
    }),
});
