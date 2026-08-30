import React, { useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { PaneId, PaneSlot, PANE_LABELS } from '../../engine/paneLayout';

/**
 * タブのドラッグに使う独自の種類。
 *
 * ⚠️ これを必ず付けること。作業領域はエクスプローラーからのフォルダ D&D も
 * 受けており、種類を見分けないとタブを運んだだけで
 * 「画像ファイルが見つかりませんでした」が出てしまう。
 */
export const PANE_DRAG_TYPE = 'application/x-kingfisher-pane';

/** その D&D がタブの移動かどうか */
export function isPaneDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes(PANE_DRAG_TYPE);
}

interface PaneTabBarProps {
  slot: PaneSlot;
  /** 一面表示中の面 */
  maximized: PaneId | null;
  onSelect: (pane: PaneId) => void;
  onClose: (pane: PaneId) => void;
  onToggleMaximize: (pane: PaneId) => void;
  /** この枠へタブが落とされた (重ねる) */
  onDropOnSlot: (pane: PaneId) => void;
  /** タブを掴んでいる / 離した。枠のあいだの落とし先を開くのに使う */
  onDragStateChange?: (dragging: boolean) => void;
}

const TONE: Record<PaneId, { active: string; idle: string }> = {
  winA: {
    active: 'bg-blue-600 text-white border-blue-700',
    idle: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900',
  },
  winB: {
    active: 'bg-emerald-600 text-white border-emerald-700',
    idle: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
  },
  reference: {
    active: 'bg-teal-600 text-white border-teal-700',
    idle: 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-900',
  },
  rollA: {
    active: 'bg-indigo-600 text-white border-indigo-700',
    idle: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900',
  },
  rollB: {
    active: 'bg-violet-600 text-white border-violet-700',
    idle: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-900',
  },
};

/**
 * 枠の上に出るタブの列。
 *
 * ここが「どの面をどこに置くか」の操作の入口になる。
 *  - クリック  … 重なっている面の切り替え
 *  - ドラッグ  … 別の枠へ重ねる / 枠の間へ落として位置を変える
 *  - ⤢        … 一面表示の切り替え
 *  - ×        … その面を閉じる
 */
export const PaneTabBar: React.FC<PaneTabBarProps> = ({
  slot,
  maximized,
  onSelect,
  onClose,
  onToggleMaximize,
  onDropOnSlot,
  onDragStateChange,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    if (!isPaneDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!isPaneDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    onDragStateChange?.(false);
    const pane = e.dataTransfer.getData(PANE_DRAG_TYPE) as PaneId;
    if (pane) onDropOnSlot(pane);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      title="タブをドラッグして位置を入れ替え / 別の枠へ重ねられます"
      /*
        ⚠️ タブ帯に余白を入れないこと。面と地続きに見せるためで、
        px-* / py-* / gap-* を足すと、面を 2 つ並べたときに縦横とも表示領域が削られる
        (2026-08-31 のユーザー指定)。タブ自身の内側の余白だけで間を取る。
      */
      className={`flex-shrink-0 flex items-stretch select-none transition-colors ${
        isDragOver ? 'bg-blue-500/25 ring-1 ring-inset ring-blue-500/60' : ''
      }`}
    >
      {slot.panes.map((pane) => {
        const isActive = pane === slot.activePane;
        const tone = TONE[pane];
        return (
          <div
            key={pane}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(PANE_DRAG_TYPE, pane);
              e.dataTransfer.effectAllowed = 'move';
              onDragStateChange?.(true);
            }}
            onDragEnd={() => onDragStateChange?.(false)}
            onClick={() => onSelect(pane)}
            className={`flex items-center gap-1 px-1.5 py-0.5 border-r border-t text-[10px] font-bold cursor-grab active:cursor-grabbing transition-colors ${
              isActive ? tone.active : tone.idle
            }`}
          >
            <span className="truncate max-w-[7rem]">{PANE_LABELS[pane]}</span>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleMaximize(pane);
              }}
              title={maximized === pane ? '一面表示をやめる' : 'この面だけを大きく表示'}
              className="p-0.5 rounded hover:bg-black/20"
            >
              {maximized === pane ? <Minimize2 className="w-2.5 h-2.5" /> : <Maximize2 className="w-2.5 h-2.5" />}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(pane);
              }}
              title={`${PANE_LABELS[pane]} を閉じる`}
              className="p-0.5 rounded hover:bg-red-600 hover:text-white"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

interface PaneDropGapProps {
  /** ここへ落とされたときに差し込む位置 */
  index: number;
  onDropPane: (pane: PaneId, index: number) => void;
  /** タブを運んでいる間だけ開く */
  active?: boolean;
}

/**
 * 枠と枠のあいだの落とし先。
 * ここへタブを落とすと、その位置に独立した枠として入る。
 */
export const PaneDropGap: React.FC<PaneDropGapProps> = ({ index, onDropPane, active = false }) => {
  const [isOver, setIsOver] = useState(false);

  /**
   * ⚠️ 何も運んでいないときは幅を持たせないこと。
   * 常時 6px を空けていると、面を 2 つ並べるだけで左右と中央で 18px を失う
   * (2026-08-31 のユーザー指定でエッジ・トゥ・エッジにした)。
   * タブを掴んでいる間だけ開いて、落とし先として掴めるようにする。
   */
  if (!active) return null;

  return (
    <div
      onDragOver={(e) => {
        if (!isPaneDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        if (!isPaneDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        setIsOver(false);
        const pane = e.dataTransfer.getData(PANE_DRAG_TYPE) as PaneId;
        if (pane) onDropPane(pane, index);
      }}
      className={`flex-shrink-0 self-stretch transition-all ${
        isOver ? 'w-6 bg-blue-500/40' : 'w-1.5 bg-blue-500/10'
      }`}
    />
  );
};
