/**
 * 撮影上がりロール (.mov / .mp4) の再生状態。
 *
 * ⚠️ ここではデコードも読み込みも行わない。ブラウザのネイティブデコーダに任せる
 * ことがこの機能の要で、そうすればハードウェア再生になりメモリも増えない。
 * 状態として持つのは「どのファイルか」「再生できるか」「コマ送りの基準 fps」だけ。
 */

import { StateCreator } from 'zustand';
import { PaintStore, RollSlice, RollState } from '../types';
import { toPlayableBlob, probeVideoCodec } from '../../engine/videoSource';

/** 推定できるまでのコマ送りの既定値。日本のアニメは 24fps 基準 */
const DEFAULT_FPS = 24;

const initialRoll: RollState = {
  isOpen: false,
  isFloating: false,
  fileName: '',
  file: null,
  objectUrl: null,
  status: 'idle',
  message: '',
  codec: null,
  fps: DEFAULT_FPS,
  fpsSource: 'default',
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

export const createRollSlice: StateCreator<PaintStore, [], [], RollSlice> = (set, get) => ({
  roll: initialRoll,

  openRollWindow: () => set((state) => ({ roll: { ...state.roll, isOpen: true } })),

  closeRollWindow: () =>
    set((state) => {
      releaseUrl(state.roll.objectUrl);
      // ウィンドウの位置・切り離し状態は残し、素材だけ手放す
      return { roll: { ...initialRoll, isFloating: state.roll.isFloating } };
    }),

  toggleRollFloating: () =>
    set((state) => ({ roll: { ...state.roll, isFloating: !state.roll.isFloating } })),

  loadRollFile: (file) =>
    set((state) => {
      releaseUrl(state.roll.objectUrl);

      // ⚠️ new Blob([file]) にしないこと。ファイル全体をメモリへ載せてしまう。
      // toPlayableBlob は範囲もデータもそのままに MIME だけ差し替える。
      const objectUrl = URL.createObjectURL(toPlayableBlob(file));

      return {
        roll: {
          ...state.roll,
          isOpen: true,
          fileName: file.name,
          file,
          objectUrl,
          // まず再生させてみる。コーデックの詮索は失敗してからで十分
          status: 'ready',
          message: '',
          codec: null,
          fps: DEFAULT_FPS,
          fpsSource: 'default',
        },
      };
    }),

  /**
   * <video> が再生を拒否したときに呼ぶ。
   *
   * 「再生できません」だけでは打つ手が分からないので、実際のコーデック名と
   * 変換コマンドまで出す。判別に失敗しても、その旨を返して黙らないこと。
   */
  reportRollPlaybackFailure: async () => {
    const { file, fileName } = get().roll;
    if (!file) return;

    let codec = null;
    try {
      codec = await probeVideoCodec(file);
    } catch (e) {
      console.error('Failed to probe codec:', e);
    }

    const message = codec
      ? `このロールは ${codec.label} (${codec.fourcc}) で書き出されています。\n` +
        `ブラウザにこのコーデックのデコーダが無いため、そのままでは再生できません。\n\n` +
        conversionHint(fileName)
      : `このファイルを再生できませんでした。コーデックを判別できていません。\n` +
        `ProRes・DNxHD・非圧縮などはブラウザでは再生できません。\n\n` +
        conversionHint(fileName);

    set((state) => ({
      roll: { ...state.roll, status: codec ? 'unsupported' : 'error', message, codec },
    }));
  },

  setRollFps: (fps, source) =>
    set((state) => {
      // 手動で決めた値を自動推定で上書きしない
      if (source === 'auto' && state.roll.fpsSource === 'manual') return state;
      if (!(fps > 0) || !Number.isFinite(fps)) return state;
      return { roll: { ...state.roll, fps, fpsSource: source } };
    }),
});
