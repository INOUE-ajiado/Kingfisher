import React, { useMemo, useState } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { X, Type, ListOrdered, AlertTriangle } from 'lucide-react';
import {
  buildSequentialRenamePlan,
  buildSingleRenamePlan,
  findInvalidNames,
  findRenameConflicts,
  omitUnchanged,
  baseName,
} from '../../engine/renamePlan';

interface RenameModalProps {
  /** 対象のウィンドウ */
  view: 0 | 1;
  /** 対象ファイルの相対パス。並び順がそのまま連番の順序になる */
  paths: string[];
  onClose: () => void;
  onRenamed: () => void;
}

/**
 * ファイル名の変更ダイアログ。
 *
 * 制作データを直接書き換えるので、実行前に「何がどう変わるか」を
 * 必ず一覧で見せる。衝突・不正な名前がある間は実行できない。
 */
export const RenameModal: React.FC<RenameModalProps> = ({ view, paths, onClose, onRenamed }) => {
  const { renameFiles, fileListA, fileListB } = usePaintStore();

  const isBatch = paths.length > 1;
  const [mode, setMode] = useState<'single' | 'sequential'>(isBatch ? 'sequential' : 'single');

  const [singleName, setSingleName] = useState(() => baseName(paths[0] ?? ''));
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [startNumber, setStartNumber] = useState(1);
  const [digits, setDigits] = useState(4);
  const [busy, setBusy] = useState(false);

  const existing = view === 1 ? fileListB : fileListA;

  const plan = useMemo(() => {
    if (mode === 'single' && paths[0]) {
      return [buildSingleRenamePlan(paths[0], singleName)];
    }
    return buildSequentialRenamePlan(paths, { prefix, suffix, startNumber, digits });
  }, [mode, paths, singleName, prefix, suffix, startNumber, digits]);

  const changing = omitUnchanged(plan);
  const invalid = findInvalidNames(plan);
  const conflicts = findRenameConflicts(changing, existing);
  const blocked = invalid.length > 0 || conflicts.length > 0 || changing.length === 0;

  const handleExecute = async () => {
    if (blocked || busy) return;
    setBusy(true);
    const result = await renameFiles(view, plan);
    setBusy(false);
    alert(result.message);
    if (result.ok) {
      onRenamed();
      onClose();
    }
  };

  const label = view === 1 ? 'Win B' : 'Win A';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl w-[520px] max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
        <div className="flex justify-between items-center p-4 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 font-semibold text-sm text-slate-800 dark:text-slate-200">
            <Type className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>
              名前を変更 — {label} / {paths.length} 項目
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs overflow-y-auto">
          {/* モード切り替え (1 件のときだけ単体リネームを選べる) */}
          {!isBatch && (
            <div className="flex gap-1">
              {(
                [
                  { id: 'single', label: '名前を指定', icon: <Type className="w-3 h-3" /> },
                  { id: 'sequential', label: '連番にする', icon: <ListOrdered className="w-3 h-3" /> },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setMode(tab.id)}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1 transition-colors ${
                    mode === tab.id
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {mode === 'single' ? (
            <label className="block">
              <span className="text-slate-700 dark:text-slate-300 font-medium">新しい名前</span>
              <input
                type="text"
                value={singleName}
                autoFocus
                onChange={(e) => setSingleName(e.target.value)}
                className="mt-1 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
              />
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                拡張子を省略すると元のものを引き継ぎます。
              </span>
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="block col-span-2">
                <span className="text-slate-700 dark:text-slate-300 font-medium">先頭に付けるテキスト</span>
                <input
                  type="text"
                  value={prefix}
                  autoFocus
                  onChange={(e) => setPrefix(e.target.value)}
                  placeholder="例: C001_"
                  className="mt-1 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
                />
              </label>

              <label className="block">
                <span className="text-slate-700 dark:text-slate-300 font-medium">開始番号</span>
                <input
                  type="number"
                  value={startNumber}
                  onChange={(e) => setStartNumber(Number(e.target.value) || 0)}
                  className="mt-1 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
                />
              </label>

              <label className="block">
                <span className="text-slate-700 dark:text-slate-300 font-medium">桁数</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={digits}
                  onChange={(e) => setDigits(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
                  className="mt-1 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
                />
              </label>

              <label className="block col-span-2">
                <span className="text-slate-700 dark:text-slate-300 font-medium">
                  末尾に付けるテキスト (拡張子の手前)
                </span>
                <input
                  type="text"
                  value={suffix}
                  onChange={(e) => setSuffix(e.target.value)}
                  placeholder="例: _go"
                  className="mt-1 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
                />
              </label>
            </div>
          )}

          {/* 実行前のプレビュー。ここを見て判断できることが最重要 */}
          <div>
            <div className="text-slate-700 dark:text-slate-300 font-medium pb-1">
              プレビュー ({changing.length} 件が変更されます)
            </div>
            <div className="max-h-40 overflow-y-auto rounded border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/60">
              {plan.length === 0 ? (
                <div className="px-2 py-2 text-[10px] text-slate-400">対象がありません</div>
              ) : (
                plan.map((item) => {
                  const unchanged = item.from === item.to;
                  return (
                    <div
                      key={item.path}
                      className="px-2 py-1 flex items-center gap-2 text-[10px] font-mono"
                    >
                      <span className="truncate flex-1 text-slate-500 dark:text-slate-400">{item.from}</span>
                      <span className="text-slate-400">→</span>
                      <span
                        className={`truncate flex-1 ${
                          unchanged
                            ? 'text-slate-400 dark:text-slate-600'
                            : 'text-blue-600 dark:text-blue-400 font-bold'
                        }`}
                      >
                        {item.to}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {(invalid.length > 0 || conflicts.length > 0) && (
            <div className="rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-2 text-[10px] text-amber-800 dark:text-amber-300 space-y-1">
              <div className="flex items-center gap-1 font-bold">
                <AlertTriangle className="w-3 h-3" />
                このままでは実行できません
              </div>
              {invalid.length > 0 && (
                <div>ファイル名に使えない文字、または空の名前が {invalid.length} 件あります。</div>
              )}
              {conflicts.some((c) => c.reason === 'duplicate') && (
                <div>同じ名前になるファイルがあります。</div>
              )}
              {conflicts.some((c) => c.reason === 'exists') && (
                <div>既にあるファイルと同じ名前になります。</div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1 rounded text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            キャンセル
          </button>
          <button
            onClick={handleExecute}
            disabled={blocked || busy}
            className={`px-3 py-1 rounded text-[11px] font-bold text-white transition-colors ${
              blocked || busy
                ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 shadow-xs'
            }`}
          >
            {busy ? '変更中...' : `${changing.length} 件を変更`}
          </button>
        </div>
      </div>
    </div>
  );
};
