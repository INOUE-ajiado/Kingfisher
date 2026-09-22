import React from 'react';
import { AlertTriangle, FolderOpen, Minimize2 } from 'lucide-react';
import { CornerResizeHandles } from '../common/CornerResizeHandles';
import { DockPlaceholder } from '../common/DockPlaceholder';
import { CanvasTransform } from '../../store/types';
import { TGAImage } from '../../engine/tga';

/**
 * セルを 1 面ぶん出す枠 (Win A / Win B)。
 *
 * ⚠️ 面ごとに書き分けないこと。以前は Win A と Win B の JSX が
 * 色とラベル以外ほぼ同じ 290 行として並んでおり、
 * 「Win B だけ直っていない」という食い違いがここから生まれていた。
 * 違うのは色・呼び名・案内文だけなので、それだけを受け取る。
 */

/** 面ごとに変わるのは色と呼び名だけ */
interface PaneTone {
  /** ドロップ中のふちの色 */
  dropBorder: string;
  /** ドロップ中の覆いの色 */
  dropOverlay: string;
  dropIcon: string;
  /** 見出しの文字色 */
  title: string;
  /** 素材が無いときの案内の色 */
  emptyIcon: string;
  emptyHint: string;
}

const TONE: Record<0 | 1, PaneTone> = {
  0: {
    dropBorder: 'border-blue-500 ring-4 ring-inset ring-blue-500/60',
    dropOverlay: 'bg-blue-950/90 border-blue-300 text-blue-200',
    dropIcon: 'text-blue-400',
    title: 'text-blue-600 dark:text-blue-400',
    emptyIcon:
      'bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400',
    emptyHint:
      'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800',
  },
  1: {
    dropBorder: 'border-emerald-500 ring-4 ring-inset ring-emerald-500/60',
    dropOverlay: 'bg-emerald-950/90 border-emerald-300 text-emerald-200',
    dropIcon: 'text-emerald-400',
    title: 'text-slate-700 dark:text-slate-300',
    emptyIcon:
      'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400',
    emptyHint:
      'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800',
  },
};

/** 面ごとの呼び名と案内文 */
const TEXT: Record<0 | 1, { label: string; defaultFolder: string; roll: string; emptyTitle: string; emptyBody: string; emptyHint: string; readOnly: string }> = {
  0: {
    label: 'Win A',
    defaultFolder: 'Orig',
    roll: 'ロール A',
    emptyTitle: 'NO CELL DATA',
    emptyBody: 'エクスプローラーやFinderから TGAファイルが入ったフォルダを開いてセル画像を選択してください',
    emptyHint: 'ファイル > フォルダを開く (Ctrl+Shift+O) または 右パネル Open A',
    readOnly: '🔒 閲覧専用 (描画不可)',
  },
  1: {
    label: 'Win B',
    defaultFolder: 'Retake',
    roll: 'ロール B',
    emptyTitle: 'NO RETAKE DATA',
    emptyBody: 'リテイク用（Dir B）フォルダを開いて比較セル画像を表示してください',
    emptyHint: '右パネル Open B からリテイクフォルダを選択',
    readOnly: '🔒 閲覧専用 (Sheet View)',
  },
};

export interface CellCanvasPaneProps {
  viewIdx: 0 | 1;
  /** 引きはがし・移動・リサイズをまとめた口 (useFloatingWindow の戻り値) */
  floating: {
    targetRef: React.RefObject<HTMLDivElement>;
    windowStyle: React.CSSProperties | undefined;
    handleHeaderPointerDown: (e: React.PointerEvent) => void;
    getResizeHandler: any;
    isOverDockTarget: boolean;
    bringToFront: () => void;
  };
  isFloating: boolean;
  toggleFloating: () => void;
  /** アクティブ表示の枠線 (面ごとの規則は呼び出し側が持つ) */
  borderClass: string;
  isDragOver: boolean;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onActivate: () => void;

  folderName: string;
  fileName: string;
  isDirty: boolean;
  image: TGAImage | null;
  /** 閲覧専用の鍵を出すか (認証済みなら出さない) */
  showReadOnlyBadge: boolean;
  /** 「描けません」の吹き出しを出すか */
  showReadOnlyNotice: boolean;

  showRuler: boolean;
  transform: CanvasTransform;
  /** 追従を切る (掴んでいる間) */
  isDragging: boolean;
  cursorClass: string;

  canvasRef: (el: HTMLCanvasElement | null) => void;
  onWheel: (e: React.WheelEvent) => void;
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp: () => void;
}

export const CellCanvasPane: React.FC<CellCanvasPaneProps> = ({
  viewIdx,
  floating,
  isFloating,
  toggleFloating,
  borderClass,
  isDragOver,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onActivate,
  folderName,
  fileName,
  isDirty,
  image,
  showReadOnlyBadge,
  showReadOnlyNotice,
  showRuler,
  transform,
  isDragging,
  cursorClass,
  canvasRef,
  onWheel,
  onMouseDown,
  onMouseMove,
  onMouseUp,
}) => {
  const tone = TONE[viewIdx];
  const text = TEXT[viewIdx];

  return (
    <>
      <div
        ref={floating.targetRef}
        style={floating.windowStyle}
        onPointerDownCapture={floating.bringToFront}
        onClick={onActivate}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        /*
          ⚠️ ハイライト用のクラスはレイアウト用のクラスと必ず併記する。
          以前は D&D 中に flex-1 が外れて要素が縮み、カーソルの下から
          逃げてしまうため判定が点滅していた。
          ⚠️ ドッキング中は 1px の枠・角丸なし。太い枠と角丸は、面を並べたときに
          その分だけ絵が小さくなる。浮かせたときだけ従来の見た目に戻す。
        */
        className={`flex flex-col ${
          isFloating
            ? `border-2 bg-slate-100 dark:bg-slate-900 shadow-2xl rounded relative ${borderClass}`
            : `border flex-1 relative overflow-hidden ${borderClass}`
        } ${isDragOver ? tone.dropBorder : ''}`}
      >
        {/* 📁 エクスプローラーダイレクト D&D 案内オーバーレイ */}
        {isDragOver && (
          <div
            className={`absolute inset-0 backdrop-blur-xs border-2 border-dashed rounded flex flex-col items-center justify-center z-50 pointer-events-none p-4 animate-in fade-in duration-100 select-none ${tone.dropOverlay}`}
          >
            <FolderOpen className={`w-10 h-10 mb-2 animate-bounce ${tone.dropIcon}`} />
            <span className="font-bold text-sm text-white">
              ここにフォルダをドロップして {text.label} で開く
            </span>
            {/* 映像を落としたときの行き先を先に伝える (ロールへ入れる導線が分かりにくかった) */}
            <span className="text-[10px] opacity-80 mt-1">
              撮影ロール (.mov / .mp4) なら {text.roll} で開きます
            </span>
            <span className="text-[10px] opacity-80 mt-1">
              エクスプローラーからダイレクトにフォルダを開けます
            </span>
          </div>
        )}

        {/*
          見出しは切り離しているときだけ。
          ⚠️ ドッキング中は上のタブ列が見出しを兼ねる。両方出すと × も ⤢ も
          2 つ並び、面を 3 つ出すだけで 60px を見出しだけで失う。
        */}
        {isFloating && (
        <div
          onPointerDown={floating.handleHeaderPointerDown}
          className="h-6 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-2 text-[11px] justify-between select-none touch-none cursor-grab active:cursor-grabbing"
        >
          <span className={`font-semibold flex items-center gap-1.5 min-w-0 ${tone.title}`}>
            <span className="truncate">
              {text.label} ({folderName || text.defaultFolder}): {fileName || '---'}
              {isDirty ? ' *' : ''}
            </span>
            {showReadOnlyBadge && (
              <span className="flex-shrink-0 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-xs whitespace-nowrap">
                {text.readOnly}
              </span>
            )}
          </span>

          {/* ⚠️ ここに NO DATA を出さないこと。素材が無いときは真ん中に大きな案内が出る */}
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFloating();
              }}
              title="ドッキングに戻す"
              className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors text-slate-600 dark:text-slate-300"
            >
              <Minimize2 className="w-3 h-3" />
            </button>
          </div>
        </div>
        )}

        {/* ドッキング中は見出しを出さないので、閲覧専用の印だけ絵の上に小さく出す */}
        {!isFloating && showReadOnlyBadge && (
          <div className="absolute top-1 right-1 z-40 pointer-events-none">
            <span className="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow whitespace-nowrap">
              {text.readOnly}
            </span>
          </div>
        )}

        {/*
          ⚠️ 目盛りの無い「0px / 半分 / 全幅」だけを出さないこと。
          倍率にもスクロールにも連動せず、測れないのに測れるように見えていた。
          今の倍率と画像の実寸を出す。
        */}
        {showRuler && image && (
          <div className="h-3.5 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-2 text-[8px] font-mono text-slate-500 dark:text-slate-400 justify-between select-none">
            <span>
              {image.width} x {image.height} px
            </span>
            <span>
              表示 {Math.round(transform.scale * 100)}%
              {transform.rotation ? ` / ${Math.round(transform.rotation)}°` : ''}
            </span>
            <span>1px = {(transform.scale).toFixed(2)}px</span>
          </div>
        )}

        <div
          className={`flex-1 bg-slate-300 dark:bg-slate-950 relative flex items-center justify-center overflow-hidden transition-colors ${cursorClass}`}
          onWheel={onWheel}
        >
          <div
            style={{
              transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale}) rotate(${transform.rotation ?? 0}deg)`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.05s ease-out',
            }}
            className="shadow-2xl border border-slate-400 dark:border-slate-700 bg-white relative"
          >
            <canvas
              ref={canvasRef}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onContextMenu={(e) => e.preventDefault()}
              className="block"
            />

            {showReadOnlyNotice && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none px-3 py-2 rounded-lg bg-amber-500 text-white text-[11px] font-bold shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>
                  この画像は閲覧専用（TGA 以外）のため描画できません。
                  <br />
                  .tga のセルが入ったフォルダを選択してください。
                </span>
              </div>
            )}

            {!image && (
              <div className="absolute inset-0 flex items-center justify-center p-4 bg-slate-900/10 dark:bg-slate-950/20 backdrop-blur-[1px] pointer-events-none">
                <div className="flex flex-col items-center justify-center p-5 text-center bg-white/95 dark:bg-slate-900/95 border border-slate-300 dark:border-slate-800 rounded-xl shadow-2xl max-w-sm select-none animate-in fade-in duration-150">
                  <div
                    className={`w-10 h-10 rounded-full border flex items-center justify-center mb-2.5 ${tone.emptyIcon}`}
                  >
                    <FolderOpen className="w-5 h-5" />
                  </div>
                  <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 mb-1">
                    {text.emptyTitle}
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-2.5 leading-relaxed">
                    {text.emptyBody}
                  </p>
                  <span
                    className={`text-[9px] font-semibold px-2 py-0.5 rounded border ${tone.emptyHint}`}
                  >
                    {text.emptyHint}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ⚡ 独立ウィンドウ用の四隅リサイズグリップ */}
        {isFloating && <CornerResizeHandles getResizeHandler={floating.getResizeHandler} topOffset={24} />}
      </div>

      {/* 切り離した跡地: ドッキング復帰のドロップ先 ＆ 復帰ボタン */}
      {isFloating && (
        <DockPlaceholder
          id={`${viewIdx === 0 ? 'winA' : 'winB'}-dock-target`}
          label={text.label}
          onRestore={toggleFloating}
          isActive={floating.isOverDockTarget}
        />
      )}
    </>
  );
};
