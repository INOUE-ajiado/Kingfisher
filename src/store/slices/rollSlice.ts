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
 * ⚠️ 「連動しているか」はここでは持たない。入り切りは syncMode の 1 つだけで、
 * ここが持つのは連動を入れた時点のずれ (syncOffset = 時刻差、fileSyncOffset = 本数差) だけ。
 * 連動が入ると、再生の時刻とツリーの選択の両方が相手へ追従する。
 */

import { StateCreator } from 'zustand';
import { PaintStore, RollSlice, RollState, RollViewState, RollId, ROLL_IDS } from '../types';
import { DroppedVideo, toPlayableBlob, probeVideoCodec } from '../../engine/videoSource';
import { convertProResToMp4, invalidateProResCache } from '../../engine/proresConverter';
import { parseProResMovMetadata, ProResRealtimeDecoder } from '../../engine/proresRealtimeDecoder';
import { logDebug } from '../../engine/debugLog';
import { getRollVideo } from '../../components/panels/rollVideoRegistry';

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
    realtimeDecoder: null,
    isRealtimeProRes: false,
  };
}

const initialRoll: RollState = {
  views: { rollA: emptyView(), rollB: emptyView() },
  activeId: 'rollA',
  syncOffset: 0,
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
  if (view.realtimeDecoder) {
    try {
      view.realtimeDecoder.dispose();
    } catch {}
  }

  return {
    ...view,
    isOpen: true,
    fileName: video.file.name,
    currentPath: video.path,
    file: video.file,
    objectUrl: URL.createObjectURL(toPlayableBlob(video.file)),
    // メタデータおよびデコーダー準備完了まで 'loading'
    status: 'loading',
    message: '動画読み込み中...',
    codec: null,
    fps: DEFAULT_FPS,
    fpsSource: 'default',
    realtimeDecoder: null,
    isRealtimeProRes: false,
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

  // ⚠️ ここではログを書かない。呼び出し元 (selectRollFile / alignRollFiles) が
  // 2 面の前後をまとめて 1 行に書く。二重に出すと前後関係が読みにくくなる
  return withView(roll, otherId, openedView(partner, target));
}

const rollLabel = (id: RollId) => (id === 'rollA' ? 'ロール A' : 'ロール B');

/** 一覧の中の位置 (1 始まり)。まだ開いていなければ 0 */
function positionOf(view: RollViewState): number {
  return view.currentPath ? view.files.findIndex((v) => v.path === view.currentPath) + 1 : 0;
}

/** 「ロール A 3/10 (c003.mov) / ロール B 3/10 (r003.mov)」 */
function describeRollPair(roll: RollState): string {
  return ROLL_IDS.map((id) => {
    const view = roll.views[id];
    if (!view.isOpen && view.files.length === 0) return `${rollLabel(id)} 未使用`;
    return `${rollLabel(id)} ${positionOf(view)}/${view.files.length} (${view.fileName || '未読み込み'})`;
  }).join(' / ');
}

/**
 * 選択連動のずれが記録どおりか。
 *
 * ⚠️ 端で切り詰められた並びは食い違いではない。どちらが主導でも辻褄が合えば正しい
 * (セルの isSyncPairConsistent と同じ考え方)。
 */
function logRollSyncMismatch(roll: RollState, synced: boolean): void {
  if (!synced) return;
  const a = roll.views.rollA;
  const b = roll.views.rollB;
  if (a.files.length === 0 || b.files.length === 0) return;

  const atA = a.files.findIndex((v) => v.path === a.currentPath);
  const atB = b.files.findIndex((v) => v.path === b.currentPath);
  if (atA < 0 || atB < 0) return;

  const clampA = (v: number) => Math.max(0, Math.min(a.files.length - 1, v));
  const clampB = (v: number) => Math.max(0, Math.min(b.files.length - 1, v));
  if (atB === clampB(atA + roll.fileSyncOffset) || atA === clampA(atB - roll.fileSyncOffset)) return;

  logDebug(
    'sync',
    `ロールの選択連動のずれが食い違っています (記録 ${roll.fileSyncOffset} / 実際 ${atB - atA})`,
    `${describeRollPair(roll)} — 「差を揃える」で直せます`,
    'warn'
  );
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

      logDebug(
        'window',
        `${rollLabel(id)} を開いた`,
        inherited ? `一覧が空だったので相手の一覧を引き継いだ (${inherited.files.length} 本 / ${inherited.folderName})` : `一覧 ${view.files.length} 本`
      );
      return {
        // 開いた直後は ↑ ↓ と Space をロールへ効かせる
        activeSurface: 'roll' as const,
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
      if (view.realtimeDecoder) {
        try {
          view.realtimeDecoder.dispose();
        } catch {}
      }
      // ウィンドウの切り離し状態は次に開いたときのために残し、素材だけ手放す
      // ⚠️ ここで連動そのものを切らないこと。連動はセルと共通の 1 つの旗で、
      // ロールを 1 面閉じただけでセルの左右連動まで切れてしまう。
      // 相手が居なくなるので、控えてあったずれだけ捨てる。
      const roll = withView({ ...state.roll, fileSyncOffset: 0 }, id, {
        ...emptyView(),
        isFloating: view.isFloating,
      });
      // ロールが 1 面も残らなければ、キーの効き先をセルへ戻す
      const stillOpen = ROLL_IDS.some((rid) => roll.views[rid].isOpen);
      logDebug('window', `${rollLabel(id)} を閉じた`, `一覧のずれは 0 に戻す。残っているロールの面: ${stillOpen ? 'あり' : 'なし'}`);
      return { roll, ...(stillOpen ? {} : { activeSurface: 'cell' as const }) };
    }),

  toggleRollFloating: (id) =>
    set((state) => ({
      roll: withView(state.roll, id, {
        ...state.roll.views[id],
        isFloating: !state.roll.views[id].isFloating,
      }),
    })),

  setActiveRollId: (id) =>
    set((state) => ({ activeSurface: 'roll' as const, roll: { ...state.roll, activeId: id } })),

  /**
   * ⚠️ 1 本だけ選んだときは一覧もその 1 本にする。前のフォルダの一覧を残すと、
   * ツリーには出ているのに開いている映像がそこに無い、という食い違いになる。
   */
  loadRollFile: (id, file) =>
    set((state) => {
      const video = { path: file.name, file };
      logDebug('roll', `${rollLabel(id)} にロールを 1 本開いた: ${file.name}`);
      return {
        activeSurface: 'roll' as const,
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
      logDebug(
        'roll',
        `${rollLabel(id)} にフォルダを開いた: ${folderName || '(名前なし)'} (${videos.length} 本)`,
        `先頭を開く: ${videos[0].path}`
      );
      return {
        activeSurface: 'roll' as const,
        roll: withView({ ...state.roll, activeId: id }, id, {
          ...openedView(state.roll.views[id], videos[0]),
          files: videos,
          folderName,
        }),
      };
    }),

  setRollFolderFiles: (id, videos, folderName) =>
    set((state) => {
      logDebug(
        'roll',
        `${rollLabel(id)} の一覧を登録: ${folderName || '(名前なし)'} (${videos.length} 本)`,
        'まだ開かない (ツリーで選ばれてから開く)'
      );
      return { roll: withView(state.roll, id, { ...state.roll.views[id], files: videos, folderName }) };
    }),

  /**
   * ⚠️ ツリーの連動中は相手の面も動かすこと。ここを通さずに面ごとに選ばせると、
   * 2 本のツリーで同じ位置を毎回 2 回選ぶことになる (連動の意味が無くなる)。
   */
  selectRollFile: (id, path, source) =>
    set((state) => {
      const view = state.roll.views[id];
      if (path === view.currentPath) return state;
      const at = view.files.findIndex((v) => v.path === path);
      if (at < 0) return state;

      const before = describeRollPair(state.roll);
      const opened = withView({ ...state.roll, activeId: id }, id, openedView(view, view.files[at]));
      const roll = state.syncMode ? withSyncedPartner(opened, id, at) : opened;

      logDebug(
        'roll',
        `${rollLabel(id)} で選択: ${at + 1}/${view.files.length} (${path})${source ? ` — ${source}` : ''}` +
          `${state.syncMode ? ` / 連動 ずれ ${roll.fileSyncOffset}` : ' / 連動なし'}`,
        `${before}  →  ${describeRollPair(roll)}`
      );
      logRollSyncMismatch(roll, state.syncMode);

      return {
        // ツリーでロールを選んだ時点で、↑ ↓ と Space はロールのものになる
        activeSurface: 'roll' as const,
        roll,
      };
    }),

  stepRoll: (id, delta, source) => {
    const view = get().roll.views[id];
    const files = view.files;
    if (files.length <= 1) return;

    const at = files.findIndex((v) => v.path === view.currentPath);
    const next = Math.max(0, Math.min(files.length - 1, (at < 0 ? 0 : at) + delta));
    if (next === at) {
      // ⚠️ 黙って返さないこと。「押しても動かない」ときに端なのか無反応なのか分からない
      logDebug(
        'roll',
        `${rollLabel(id)} を${delta > 0 ? '次のロールへ' : '前のロールへ'}${source ? ` (${source})` : ''} — 端なので動かさない`,
        describeRollPair(get().roll)
      );
      return;
    }
    get().selectRollFile(id, files[next].path, source ?? `${rollLabel(id)} の前後送り`);
  },

  /**
   * <video> が再生を拒否したときに呼ぶ。
   * ProRes の場合は高速 MOV 解析 ＆ オンデマンドリアルタイム再生を試みる。
   */
  reportRollPlaybackFailure: async (id) => {
    const view = get().roll.views[id];
    if (!view.file) return;

    // 既に変換中・エラー・非対応に遷移している場合は重複発火を防ぐ
    if (view.status === 'converting' || view.status === 'error' || view.status === 'unsupported') {
      return;
    }

    set((state) => ({
      roll: withView(state.roll, id, {
        ...state.roll.views[id],
        status: 'loading',
        message: '映像コーデック解析中...',
      }),
    }));

    // <video> 要素で失敗した場合、壊れたキャッシュをクリアして再試行
    invalidateProResCache(view.file);

    let codec = null;
    try {
      codec = await probeVideoCodec(view.file);
    } catch (e) {
      console.error('Failed to probe codec:', e);
    }

    if (codec && /^ap(ch|cn|cs|co|4h|4x)$/i.test(codec.fourcc)) {
      const c = codec;
      logDebug('roll', `${rollLabel(id)} の ${c.label} をその場で復号する準備中...`);

      // MOV の索引を作り、Worker で 1 コマ目を実際に復号できたらその場再生に切り替える
      const meta = await parseProResMovMetadata(view.file);
      if (meta) {
        const decoder = new ProResRealtimeDecoder(view.file, meta);
        const ok = await decoder.init();
        if (ok) {
          set((state) => ({
            roll: withView(state.roll, id, {
              ...state.roll.views[id],
              status: 'ready',
              isRealtimeProRes: true,
              realtimeDecoder: decoder,
              fps: meta.fps,
              fpsSource: 'auto',
              codec: c,
              message: '',
            }),
          }));
          logDebug('roll', `${rollLabel(id)} の ${c.label} を変換せずに再生します (${meta.totalFrames}コマ, ${meta.fps.toFixed(3)}fps)`);
          return;
        }
      }

      // その場で復号できない (索引が読めない・未対応の形式) ときだけ H.264 へ変換する
      set((state) => ({
        roll: withView(state.roll, id, {
          ...state.roll.views[id],
          status: 'converting',
          convertProgress: 0,
          codec: c,
          message: `${c.label} (${c.fourcc}) を自動変換中...`,
        }),
      }));

      try {
        const converted = await convertProResToMp4(
          view.file,
          (pct) => {
            set((state) => ({
              roll: withView(state.roll, id, {
                ...state.roll.views[id],
                convertProgress: pct,
              }),
            }));
          }
        );

        set((state) => ({
          roll: withView(state.roll, id, {
            ...state.roll.views[id],
            status: 'ready',
            objectUrl: converted.objectUrl,
            message: '',
            convertProgress: 100,
          }),
        }));
        return;
      } catch (err: any) {
        console.error('Auto conversion failed:', err);
      }
    }

    const message = codec
      ? `このロールは ${codec.label} (${codec.fourcc}) で書き出されています。\n` +
        `お使いのブラウザ / OS 環境で再生できない場合、確認用に H.264 へ変換してから開いてください:\n\n` +
        conversionHint(view.fileName)
      : `このファイルを再生できませんでした。コーデックを判別できていません。\n` +
        `お使いの環境で再生可能か確認するか、H.264 へ変換してからお試しください。\n\n` +
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
      if (view.fps !== fps) {
        logDebug(
          'roll',
          `${rollLabel(id)} のコマ送り基準を ${view.fps}fps → ${fps}fps (${source === 'auto' ? '自動推定' : '手動'})`
        );
      }
      return { roll: withView(state.roll, id, { ...view, fps, fpsSource: source }) };
    }),

  updateRollSyncOffset: (offset: number) =>
    set((state) => {
      if (!state.syncMode) return state;
      logDebug('sync', `連動の時刻差を更新 (時刻差 ${offset.toFixed(3)} 秒)`);
      return { roll: { ...state.roll, syncOffset: offset } };
    }),

  /**
   * 連動を入れ切りしたときの、ロール側の支度。
   *
   * ⚠️ ここで旗を持たないこと。入り切りは syncMode が唯一の source で、
   * ここは「入れた時点のずれを控える」「片方しか開いていなければ相手も開く」だけを行う。
   * ⚠️ 入れた時点のずれを保つこと。片方を頭出ししてから連動させる使い方があるので、
   * 強制的に同じ位置へ揃えると狙って選んだ位置がずれる (セルの左右連動と同じ考え方)。
   */
  setRollSyncAll: (enabled: boolean) =>
    set((state) => {
      if (!enabled) {
        logDebug('sync', 'ロール側の連動の控えを手放した');
        return state;
      }

      const a = getRollVideo('rollA');
      const b = getRollVideo('rollB');
      const timeOffset = a && b ? b.currentTime - a.currentTime : state.roll.syncOffset;

      const { rollA, rollB } = state.roll.views;
      let atA = indexOfCurrent(rollA);
      let atB = indexOfCurrent(rollB);

      let nextRoll: RollState = { ...state.roll, syncOffset: timeOffset };

      if (rollA.files.length > 0 && rollB.files.length > 0) {
        if (atA >= 0 && atB < 0) {
          const targetIdx = Math.min(rollB.files.length - 1, atA);
          nextRoll = withView(nextRoll, 'rollB', openedView(rollB, rollB.files[targetIdx]));
          atB = targetIdx;
        } else if (atB >= 0 && atA < 0) {
          const targetIdx = Math.min(rollA.files.length - 1, atB);
          nextRoll = withView(nextRoll, 'rollA', openedView(rollA, rollA.files[targetIdx]));
          atA = targetIdx;
        }
        nextRoll = { ...nextRoll, fileSyncOffset: atA >= 0 && atB >= 0 ? atB - atA : 0 };
      }

      logDebug(
        'sync',
        `ロールの連動の控えを取った (時刻差 ${timeOffset.toFixed(3)} 秒 / 一覧のずれ ${nextRoll.fileSyncOffset})`,
        describeRollPair(nextRoll)
      );
      return { roll: nextRoll };
    }),

  /** ずれを 0 に戻し、ロール B をロール A と同じ位置へ揃える */
  alignRollFiles: () =>
    set((state) => {
      const atA = indexOfCurrent(state.roll.views.rollA);
      if (atA < 0) return state;
      const roll = withSyncedPartner({ ...state.roll, fileSyncOffset: 0 }, 'rollA', atA);
      logDebug(
        'sync',
        `ロールのずれを 0 に揃えた (ずれ ${state.roll.fileSyncOffset} → 0)`,
        `${describeRollPair(state.roll)}  →  ${describeRollPair(roll)}`
      );
      return { roll };
    }),

  setRollReady: (id: RollId) =>
    set((state) => ({
      roll: withView(state.roll, id, {
        ...state.roll.views[id],
        status: 'ready',
        message: '',
      }),
    })),

  setRollLoading: (id: RollId, message = '動画読み込み中...') =>
    set((state) => ({
      roll: withView(state.roll, id, {
        ...state.roll.views[id],
        status: 'loading',
        message,
      }),
    })),
});
