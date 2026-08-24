import React from 'react';
import { Minimize2, MoveUpRight } from 'lucide-react';

interface DockPlaceholderProps {
  /** ドッキング復帰のドロップ判定に使う id。useFloatingWindow の dockTargetId と揃える */
  id: string;
  /** 「Win A」など、どのウィンドウの跡地かを示す名前 */
  label: string;
  /** ドッキングへ戻す */
  onRestore: () => void;
  /** ドラッグ中のウィンドウがタブ位置の上にいるか */
  isActive?: boolean;
  /** full: 空いた領域全体を占める / strip-v・strip-h: 細い帯だけを残す */
  variant?: 'full' | 'strip-v' | 'strip-h';
}

/**
 * 独立ウィンドウとして切り離されたパネルの「跡地」。
 *
 * ドロップ先になるのは、元のタイトルバー (タブ) があった位置だけ。
 * 空いた領域全体を判定にすると、少し動かしただけで意図せず戻ってしまうため、
 * ブラウザのタブを元の場所へ差し戻すのと同じ操作感に寄せている。
 *
 * 跡地そのものは「ウィンドウを画面の外や他ウィンドウの裏で見失った時の復帰導線」も兼ねる。
 */
export const DockPlaceholder: React.FC<DockPlaceholderProps> = ({
  id,
  label,
  onRestore,
  isActive = false,
  variant = 'full',
}) => {
  const tabTone = isActive
    ? 'border-blue-500 bg-blue-500/20 text-blue-700 dark:text-blue-300 ring-2 ring-blue-500/50'
    : 'border-slate-400/70 dark:border-slate-600/70 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:bg-blue-500/10';

  if (variant === 'strip-v' || variant === 'strip-h') {
    const isVertical = variant === 'strip-v';
    return (
      <div
        className={`flex-shrink-0 flex gap-1 select-none ${
          isVertical ? 'w-32 flex-col' : 'h-16 flex-row'
        }`}
      >
        {/* 元のタブ位置。ここへタブを重ねて離すとドッキング表示に戻る */}
        <div
          id={id}
          onClick={onRestore}
          title={`${label} のタブ位置。タブをここへドロップすると戻ります`}
          className={`flex-shrink-0 flex items-center justify-center gap-1.5 rounded border-2 border-dashed cursor-pointer transition-colors ${
            isVertical ? 'h-6 w-full' : 'w-6 h-full flex-col'
          } ${tabTone}`}
        >
          <MoveUpRight className="w-3 h-3 flex-shrink-0" />
          <span className="text-[10px] font-bold truncate">{label} のタブ</span>
        </div>

        {/* 跡地。見失った時の復帰導線 */}
        <div className="flex-1 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300/70 dark:border-slate-700/70 rounded p-1.5">
          <span className="text-[9px] text-slate-500 dark:text-slate-400 text-center leading-tight">
            {label} は
            <br />
            独立表示中
          </span>
          <button
            onClick={onRestore}
            className="px-1.5 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors"
          >
            <Minimize2 className="w-2.5 h-2.5" />
            戻す
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-[120px] flex flex-col gap-1 select-none">
      {/* 元のタブ位置。ここへタブを重ねて離すとドッキング表示に戻る */}
      <div
        id={id}
        onClick={onRestore}
        title={`${label} のタブ位置。タブをここへドロップすると戻ります`}
        className={`h-6 flex-shrink-0 flex items-center gap-1.5 px-2 rounded-t border-2 border-dashed cursor-pointer transition-colors ${tabTone}`}
      >
        <MoveUpRight className="w-3 h-3 flex-shrink-0" />
        <span className="text-[11px] font-bold truncate">
          {label} のタブ位置 — ここへドロップして戻す
        </span>
      </div>

      {/* 跡地。見失った時の復帰導線 */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-slate-300/70 dark:border-slate-700/70 rounded-b p-4">
        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 text-center">
          {label} は独立ウィンドウで表示中
        </p>
        <button
          onClick={onRestore}
          className="px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors"
        >
          <Minimize2 className="w-3 h-3" />
          ここに戻す
        </button>
      </div>
    </div>
  );
};
