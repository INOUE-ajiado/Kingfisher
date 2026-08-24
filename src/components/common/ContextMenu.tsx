import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** 破壊的な操作は赤で示す */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: (ContextMenuItem | { type: 'divider' })[];
  onClose: () => void;
}

/**
 * 右クリックで開く小さなメニュー。
 *
 * document.body へポータル描画する。ファイルツリーは overflow-y-auto の
 * 内側にあるため、その中に置くとスクロール領域で切り取られてしまう。
 * 画面端では内側へ寄せ、はみ出したまま出ないようにする。
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x, y });

  // 描画後に実寸で測り、画面外へはみ出す分だけ戻す
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // capture で拾う。ツリー側の onClick より先に閉じたい
    const onPointer = () => onClose();

    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 100 }}
      // メニュー内の pointerdown で閉じてしまわないようにする
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="min-w-[180px] py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl select-none animate-in fade-in zoom-in-95 duration-100"
    >
      {items.map((item, i) =>
        'type' in item ? (
          <div key={`div-${i}`} className="my-1 border-t border-slate-100 dark:border-slate-800" />
        ) : (
          <button
            key={item.id}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
            className={`w-full px-3 py-1.5 text-left text-[11px] flex items-center gap-2 transition-colors ${
              item.disabled
                ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                : item.danger
                ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
          </button>
        )
      )}
    </div>,
    document.body
  );
};
