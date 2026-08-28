/**
 * 撮影上がりロールの再生状態。
 *
 * ⚠️ ここではデコードも読み込みも行わない。ブラウザのネイティブデコーダに任せる
 * ことがこの機能の要で、そうすればハードウェア再生になりメモリも増えない。
 *
 * ⚠️ 映像の一覧 (files) は面ごとに持つ。ファイルツリーも面ごとに 1 本ずつ並べるため、
 * 共有すると「ロール A に落としたフォルダが B のツリーにも出る」ことになる。
 * ただし 2 面目を開くときだけは、一覧が空なら相手のものを引き継ぐ
 * (1 つのフォルダを 2 面で見比べる使い方が多く、そこで毎回落とし直させない)。
 *
 * ⚠️ 連動は 2 種類ある。sync は再生 (同じロールの中の時刻)、fileSync は
 * ツリーの選択 (一覧の何本目を開くか)。混ぜないこと。
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
    files: [],
    folderName: '',
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
  views: { rollA: emptyView(), rollB: emptyView() },
  activeId: 'rollA',
  sync: false,
  syncOffset: 0,
  fileSync: false,
  fileSyncOffset: 0,
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

function partnerOf(id: RollId): RollId {
  return id === 'rollA' ? 'rollB' : 'rollA';
}

/** 一覧の中の位置。まだ何も開いていなければ -1 */
function indexOfCurrent(view: RollViewState): number {
  return view.currentPath ? view.files.findIndex((v) => v.path === view.currentPath) : -1;
}

/**
 * ツリーの連動中に、相手の面を「一覧上のずれ」ぶんだけ動かした roll を返す。
 *
 * ⚠️ fileSyncOffset は「B − A」。自分が A なら足し、B なら引く (再生の連動と同じ向き)。
 * ⚠️ 端は切り詰めるだけで、ずれ自体は書き換えないこと。書き換えると、
 * 一覧の端で一度止まっただけで狙って付けたずれが失われる。
 * ⚠️ 相手が既にそのロールを開いているなら何もしないこと。openedView は blob URL を
 * 作り直すので、通すたびに相手の再生が頭へ戻る。
 */
function withSyncedPartner(roll: RollState, id: RollId, index: number): RollState {
  const otherId = partnerOf(id);
  const partner = roll.views[otherId];
  if (partner.files.length === 0) return roll;

  const wanted = id === 'rollA' ? index + roll.fileSyncOffset : index - roll.fileSyncOffset;
  const at = Math.max(0, Math.min(partner.files.length - 1, wanted));
  const target = partner.files[at];
  if (!target || target.path === partner.currentPath) return roll;

  return withView(roll, otherId, openedView(partner, target));
}

export const createRollSlice: StateCreator<PaintStore, [], [], RollSlice> = (set, get) => ({
  roll: initialRoll,

  /**
   * ⚠️ 一覧が空のまま開かないこと。「2 画面で見比べる」ボタンから開いた面に
   * 一覧が無いと、ツリーの 2 本目が空のまま並び、同じフォルダをもう一度
   * 落とさないと選べない。空のときだけ相手の一覧を引き継ぐ (開くのは選ばれてから)。
   */
  openRollWindow: (id) =>
    set((state) => {
      const view = state.roll.views[id];
      const partner = state.roll.views[id === 'rollA' ? 'rollB' : 'rollA'];
      const inherited =
        view.files.length === 0 && partner.files.length > 0
          ? { files: partner.files, folderName: partner.folderName }
          : null;

      return {
        roll: withView({ ...state.roll, activeId: id }, id, {
          ...view,
          ...(inherited ?? {}),
          isOpen: true,
        }),
      };
    }),

  /**
   * ⚠️ 閉じたらツリーの連動も解くこと。一覧ごと捨てるので、残したままにすると
   * 次に開いたときに前のずれで勝手に相手が動く。
   */
  closeRollWindow: (id) =>
    set((state) => {
      const view = state.roll.views[id];
      releaseUrl(view.objectUrl);
      // ウィンドウの切り離し状態は次に開いたときのために残し、素材だけ手放す
      return {
        roll: withView(
          { ...state.roll, fileSync: false, fileSyncOffset: 0 },
          id,
          { ...emptyView(), isFloating: view.isFloating }
        ),
      };
    }),

  toggleRollFloating: (id) =>
    set((state) => ({
      roll: withView(state.roll, id, {
        ...state.roll.views[id],
        isFloating: !state.roll.views[id].isFloating,
      }),
    })),

  setActiveRollId: (id) => set((state) => ({ roll: { ...state.roll, activeId: id } })),

  /**
   * ⚠️ 1 本だけ選んだときは一覧もその 1 本にする。前のフォルダの一覧を残すと、
   * ツリーには出ているのに開いている映像がそこに無い、という食い違いになる。
   */
  loadRollFile: (id, file) =>
    set((state) => {
      const video = { path: file.name, file };
      return {
        roll: withView({ ...state.roll, activeId: id }, id, {
          ...openedView(state.roll.views[id], video),
          files: [video],
          folderName: '',
        }),
      };
    }),

  loadRollFiles: (id, videos, folderName) =>
    set((state) => {
      if (videos.length === 0) return state;
      return {
        roll: withView({ ...state.roll, activeId: id }, id, {
          ...openedView(state.roll.views[id], videos[0]),
          files: videos,
          folderName,
        }),
      };
    }),

  setRollFolderFiles: (id, videos, folderName) =>
    set((state) => ({
      roll: withView(state.roll, id, { ...state.roll.views[id], files: videos, folderName }),
    })),

  /**
   * ⚠️ ツリーの連動中は相手の面も動かすこと。ここを通さずに面ごとに選ばせると、
   * 2 本のツリーで同じ位置を毎回 2 回選ぶことになる (連動の意味が無くなる)。
   */
  selectRollFile: (id, path) =>
    set((state) => {
      const view = state.roll.views[id];
      if (path === view.currentPath) return state;
      const at = view.files.findIndex((v) => v.path === path);
      if (at < 0) return state;

      const roll = withView({ ...state.roll, activeId: id }, id, openedView(view, view.files[at]));
      return { roll: roll.fileSync ? withSyncedPartner(roll, id, at) : roll };
    }),

  stepRoll: (id, delta) => {
    const view = get().roll.views[id];
    const files = view.files;
    if (files.length <= 1) return;

    const at = files.findIndex((v) => v.path === view.currentPath);
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

  /**
   * 2 面のツリーの選択を連動させる / やめる。
   *
   * ⚠️ 開始時のずれを保つこと。「A の 3 本目と B の 5 本目が同じカット」という
   * 並びは珍しくないので、押した瞬間に揃えると合わせた位置が失われる
   * (再生の連動・セルの左右連動と同じ考え方)。
   * ⚠️ 判定に isOpen を使わないこと。フォルダを落としただけでまだ開いていない面も
   * ツリーには並んでおり、そこから選べば開く。窓の有無で押せなくすると
   * 「ボタンはあるのに反応しない」ことになる。
   */
  toggleRollFileSync: () =>
    set((state) => {
      if (state.roll.fileSync) return { roll: { ...state.roll, fileSync: false } };

      const { rollA, rollB } = state.roll.views;
      // 片方に一覧が無ければ合わせようがない
      if (rollA.files.length === 0 || rollB.files.length === 0) return state;

      const atA = indexOfCurrent(rollA);
      const atB = indexOfCurrent(rollB);
      // どちらかがまだ開いていなければ、ずれの決めようが無いので 0 から始める
      const offset = atA >= 0 && atB >= 0 ? atB - atA : 0;
      return { roll: { ...state.roll, fileSync: true, fileSyncOffset: offset } };
    }),

  /** ずれを 0 に戻し、ロール B をロール A と同じ位置へ揃える */
  alignRollFiles: () =>
    set((state) => {
      const atA = indexOfCurrent(state.roll.views.rollA);
      if (atA < 0) return state;
      const roll = { ...state.roll, fileSyncOffset: 0 };
      return { roll: withSyncedPartner(roll, 'rollA', atA) };
    }),
});
