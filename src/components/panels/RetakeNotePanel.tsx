import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Clock, Plus, Trash2, Download, Upload, Copy, Check, FileCode, Tag, Edit2 } from 'lucide-react';
import { usePaintStore } from '../../store/usePaintStore';
import { RollId } from '../../store/types';
import { getRollVideo } from './rollVideoRegistry';
import { frameIndexAt } from '../../engine/videoSource';
import {
  RetakeItem,
  getAutoSavedRetakes,
  saveAutoRetakes,
  buildKfFileContent,
  parseKfFileContent,
  buildExportText,
} from '../../engine/retakeStore';
import { logDebug } from '../../engine/debugLog';

export const RETAKE_CATEGORIES = [
  '撮影',
  '美術',
  '仕上げ',
  '動検',
  '監督',
  'キャラデ',
  '作監',
  '確認',
] as const;

function formatTimecode(seconds: number, fps: number): { timecode: string; frame: number } {
  if (!Number.isFinite(seconds) || seconds < 0) return { timecode: '00:00:00+00', frame: 0 };
  const total = Math.floor(seconds);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  const frame = frameIndexAt(seconds, fps);
  const f = String(Math.max(0, frame - Math.floor(total * fps))).padStart(2, '0');
  return { timecode: `${h}:${m}:${s}+${f}`, frame };
}

interface RetakeNotePanelProps {
  rollId: RollId;
}

interface ContextMenuState {
  mouseX: number;
  mouseY: number;
  itemId: string;
}

export const RetakeNotePanel: React.FC<RetakeNotePanelProps> = ({ rollId }) => {
  const roll = usePaintStore((s) => s.roll);
  const view = roll.views[rollId];

  const [items, setItems] = useState<RetakeItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('撮影');
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 編集モード状態
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingTag, setEditingTag] = useState('撮影');

  // 右クリックコンテキストメニュー状態
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const videoName = view.fileName || '名称未設定';

  // コンテキストメニュー外クリック時のクローズ処理
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  // 1. 自動保存からの復元
  useEffect(() => {
    if (view.fileName) {
      void getAutoSavedRetakes(view.fileName).then((saved) => {
        setItems(saved);
      });
    } else {
      setItems([]);
    }
  }, [view.fileName]);

  // 2. 変更時の自動バックアップ
  const updateItems = useCallback(
    (newItems: RetakeItem[]) => {
      setItems(newItems);
      if (view.fileName) {
        void saveAutoRetakes(view.fileName, newItems);
      }
    },
    [view.fileName]
  );

  /** 現在のタイムコードを取得 */
  const getCurrentTimecode = (): { timecode: string; frame: number; currentTime: number } => {
    const video = getRollVideo(rollId);
    const time = video ? video.currentTime : 0;
    const { timecode, frame } = formatTimecode(time, view.fps);
    return { timecode, frame, currentTime: time };
  };

  /** メモの追加 */
  const handleAddItem = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;

    const { timecode, frame } = getCurrentTimecode();
    const newItem: RetakeItem = {
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timecode,
      frame,
      tag: selectedTag,
      text: inputText.trim(),
    };

    updateItems([...items, newItem]);
    setInputText('');
    logDebug('roll', `リテイクメモ追加: [${timecode}] ${selectedTag}: ${newItem.text}`);
  };

  /** アイテムの編集開始 */
  const handleStartEdit = (item: RetakeItem) => {
    setEditingItemId(item.id);
    setEditingText(item.text);
    setEditingTag(item.tag || '撮影');
  };

  /** アイテムの編集保存 */
  const handleSaveEdit = (id: string) => {
    if (!editingText.trim()) return;
    const updated = items.map((it) => (it.id === id ? { ...it, text: editingText.trim(), tag: editingTag } : it));
    updateItems(updated);
    setEditingItemId(null);
    logDebug('roll', `リテイクメモ更新: ${editingTag}: ${editingText.trim()}`);
  };

  /** アイテムの削除 */
  const handleDeleteItem = (id: string) => {
    updateItems(items.filter((it) => it.id !== id));
  };

  /** 右クリックコンテキストメニュー発火 */
  const handleItemContextMenu = (e: React.MouseEvent, item: RetakeItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      mouseX: e.clientX,
      mouseY: e.clientY,
      itemId: item.id,
    });
  };

  /** 該当コマへのシーク */
  const handleSeekToItem = (item: RetakeItem) => {
    const video = getRollVideo(rollId);
    if (video && Number.isFinite(view.fps) && view.fps > 0) {
      video.currentTime = item.frame / view.fps;
    }
  };

  /** .kf ファイルとしてダウンロード保存 */
  const handleSaveKfFile = () => {
    const content = buildKfFileContent(videoName, view.fps, items);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const baseName = videoName.replace(/\.[^/.]+$/, '');
    a.href = url;
    a.download = `${baseName}.kf`;
    a.click();
    URL.revokeObjectURL(url);
    logDebug('roll', `.kf リテイクメモを保存しました: ${baseName}.kf`);
  };

  /** .kf ファイルの読み込み */
  const handleLoadKfFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (text) {
        const loadedItems = parseKfFileContent(text);
        if (loadedItems.length > 0) {
          updateItems(loadedItems);
          logDebug('roll', `.kf ファイルから ${loadedItems.length} 件のリテイクメモを復元しました`);
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  /** クリップボードへのテキストコピー */
  const handleCopyText = async () => {
    const text = buildExportText(videoName, items);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      logDebug('roll', `リテイクメモテキストをクリップボードにコピーしました`);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/60 backdrop-blur-md text-slate-100 text-[11px] p-2 select-none border-t border-white/10 relative">
      {/* パネルヘッダー */}
      <div className="flex items-center justify-between pb-2 border-b border-white/10">
        <div className="flex items-center gap-1.5 font-bold text-amber-300">
          <FileCode className="w-4 h-4" />
          <span>リテイクメモ (.kf)</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            tabIndex={-1}
            onPointerDown={(e) => e.currentTarget.blur()}
            onClick={handleCopyText}
            title="テキストとしてコピー (Slack/Notion用)"
            className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white flex items-center gap-1 transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span className="text-[9px]">コピー</span>
          </button>
          <button
            tabIndex={-1}
            onPointerDown={(e) => e.currentTarget.blur()}
            onClick={() => fileInputRef.current?.click()}
            title=".kf リテイクファイルを読み込む"
            className="p-1 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <button
            tabIndex={-1}
            onPointerDown={(e) => e.currentTarget.blur()}
            onClick={handleSaveKfFile}
            title=".kf ファイルとして保存"
            className="p-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 入力エリア */}
      <form onSubmit={handleAddItem} className="py-2 space-y-1.5 border-b border-white/10">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-amber-300 font-bold flex-shrink-0">修正先:</span>
          <select
            tabIndex={-1}
            value={selectedTag}
            onChange={(e) => {
              setSelectedTag(e.target.value);
              e.target.blur();
            }}
            className="bg-slate-950/80 border border-white/20 rounded px-1.5 py-0.5 text-amber-300 font-bold text-[10px] focus:outline-none focus:border-amber-400 cursor-pointer"
          >
            {RETAKE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat} className="bg-slate-900 text-slate-100">
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-stretch gap-1.5">
          <textarea
            rows={3}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                handleAddItem();
              }
            }}
            placeholder="リテイク指示・修正内容を入力... (Enterで改行 / Shift+Enterで追加)"
            className="flex-1 bg-slate-950/70 border border-white/15 rounded px-2 py-1 text-slate-100 text-[11px] focus:outline-none focus:border-amber-400 resize-none leading-normal"
          />
          <div className="flex flex-col justify-between gap-1 flex-shrink-0">
            <button
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => e.currentTarget.blur()}
              onClick={() => {
                const { timecode } = getCurrentTimecode();
                setInputText((prev) => (prev ? `[${timecode}] ${prev}` : `[${timecode}] `));
              }}
              title="現在のタイムコードを入力欄に挿入"
              className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center gap-1 transition-colors text-[10px] font-bold h-[28px]"
            >
              <Clock className="w-3 h-3" />
              <span>コマ刻印</span>
            </button>
            <button
              type="submit"
              tabIndex={-1}
              onPointerDown={(e) => e.currentTarget.blur()}
              title="リテイクメモを追加 (Shift+Enter)"
              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold transition-colors flex items-center justify-center gap-1 h-[28px]"
            >
              <Plus className="w-3 h-3" />
              <span>追加</span>
            </button>
          </div>
        </div>
      </form>

      {/* メモ一覧表示 */}
      <div className="flex-1 overflow-y-auto space-y-1 py-2 pr-1">
        {items.length === 0 ? (
          <div className="text-center text-slate-500 py-6 select-none">
            <Tag className="w-6 h-6 mx-auto mb-1 opacity-40" />
            <p>リテイクメモはありません</p>
            <p className="text-[9px] opacity-70 mt-0.5">指示を入力して「追加」で保存してください</p>
          </div>
        ) : (
          items.map((it) =>
            editingItemId === it.id ? (
              <div key={it.id} className="p-2 rounded bg-slate-950/90 border border-amber-400/70 space-y-1.5 my-1 shadow-lg">
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-amber-300 font-bold">修正先:</span>
                    <select
                      value={editingTag}
                      onChange={(e) => setEditingTag(e.target.value)}
                      className="bg-slate-900 border border-white/20 rounded px-1.5 py-0.5 text-amber-300 font-bold text-[9px]"
                    >
                      {RETAKE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="text-[9px] font-mono text-slate-400">{it.timecode}</span>
                </div>
                <textarea
                  rows={3}
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && e.shiftKey) {
                      e.preventDefault();
                      handleSaveEdit(it.id);
                    } else if (e.key === 'Escape') {
                      setEditingItemId(null);
                    }
                  }}
                  className="w-full bg-slate-900 border border-white/20 rounded px-2 py-1 text-slate-100 text-[11px] focus:outline-none focus:border-amber-400 resize-none leading-normal"
                  autoFocus
                />
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      handleDeleteItem(it.id);
                      setEditingItemId(null);
                    }}
                    className="px-2 py-0.5 rounded bg-red-600/80 hover:bg-red-600 text-white text-[10px] flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>削除</span>
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingItemId(null)}
                      className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-slate-300 text-[10px]"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(it.id)}
                      className="px-2.5 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[10px]"
                    >
                      保存 (Shift+Enter)
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                key={it.id}
                onContextMenu={(e) => handleItemContextMenu(e, it)}
                onDoubleClick={() => handleStartEdit(it)}
                onClick={() => handleSeekToItem(it)}
                title="ダブルクリックで編集 / 右クリックでメニュー表示"
                className="group flex items-start justify-between gap-1.5 p-1.5 rounded bg-white/5 hover:bg-white/10 border border-white/5 transition-colors cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 text-[9px] font-mono text-amber-300">
                    <Clock className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                    <span>{it.timecode}</span>
                    <span className="text-slate-400">(f:{it.frame})</span>
                    {it.tag && (
                      <span className="px-1 py-0.2 rounded bg-amber-400/20 text-amber-300 font-bold ml-1">
                        {it.tag}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-200 mt-0.5 whitespace-pre-wrap select-text leading-tight">
                    {it.text}
                  </p>
                </div>
              </div>
            )
          )
        )}
      </div>

      {/* 右クリックコンテキストメニュー */}
      {contextMenu && (
        <div
          style={{ top: contextMenu.mouseY, left: contextMenu.mouseX }}
          className="fixed z-[100] bg-slate-800/95 backdrop-blur-md border border-white/20 rounded shadow-2xl text-[11px] text-slate-100 py-1 min-w-[110px] select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const item = items.find((it) => it.id === contextMenu.itemId);
              if (item) handleStartEdit(item);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-amber-500 hover:text-slate-950 font-medium flex items-center gap-2 transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5 text-amber-400 hover:text-slate-950" />
            <span>編集</span>
          </button>
          <button
            onClick={() => {
              handleDeleteItem(contextMenu.itemId);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-red-600 text-red-300 hover:text-white font-medium flex items-center gap-2 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>削除</span>
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".kf,.json"
        className="hidden"
        onChange={handleLoadKfFile}
      />
    </div>
  );
};
