import React from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { X, Keyboard, Wrench, Film, Palette, Edit3, Monitor } from 'lucide-react';

interface ShortcutCategory {
  title: string;
  icon: React.ReactNode;
  items: { key: string; desc: string }[];
}

export const ShortcutsModal: React.FC = () => {
  const { activeModal, setActiveModal } = usePaintStore();

  if (activeModal !== 'shortcuts') return null;

  const categories: ShortcutCategory[] = [
    {
      title: '🛠️ ツール選択 (Tools)',
      icon: <Wrench className="w-4 h-4 text-blue-500" />,
      items: [
        { key: 'P', desc: '鉛筆 (ドット2値線)' },
        { key: 'B', desc: 'ブラシ (アンチエイリアス線)' },
        { key: 'F', desc: '塗りつぶし (バケツ)' },
        { key: 'G', desc: 'グラデーション塗り' },
        { key: 'U', desc: '閉領域フィル' },
        { key: 'E', desc: '消しゴム' },
        { key: 'N', desc: '手動ワンクリックゴミ取り' },
        { key: 'I / Alt+クリック', desc: 'スポイト (描画色の取得)' },
        { key: 'M', desc: '矩形選択' },
        { key: 'L', desc: '投げ縄選択' },
        { key: 'W', desc: 'マジックワンド選択' },
        { key: 'H', desc: '手のひら (パン移動)' },
        { key: 'Z', desc: 'ズーム' },
      ],
    },
    {
      title: '🎬 コマ送り ＆ ファイル操作',
      icon: <Film className="w-4 h-4 text-emerald-500" />,
      items: [
        { key: 'PageDown / ↓ / テンキー3', desc: '次のセルへ移動 (Next Cell)' },
        { key: 'PageUp / ↑ / テンキー9', desc: '前のセルへ移動 (Prev Cell)' },
        { key: 'Ctrl + S', desc: '現在編集中のセルを保存' },
        { key: 'Ctrl + O', desc: '参照画像 (TGA/PNG/JPG) を開く' },
      ],
    },
    {
      title: '🎨 パレット ＆ 色操作',
      icon: <Palette className="w-4 h-4 text-amber-500" />,
      items: [
        { key: '1', desc: 'Normal (ノーマル描画色) パレット' },
        { key: '2', desc: '1-Shadow (1影) パレット' },
        { key: '3', desc: 'Highlight (ハイライト) パレット' },
        { key: '参照画像から左ドラッグ', desc: 'ColorChart へ一発ドロップ色登録' },
        { key: 'R', desc: '全セル一括色置換 (Color Replace)' },
      ],
    },
    {
      title: '✏️ 編集 ＆ オプション設定',
      icon: <Edit3 className="w-4 h-4 text-purple-500" />,
      items: [
        { key: 'Ctrl + Z', desc: '元に戻す (Undo)' },
        { key: 'Ctrl + Y / Ctrl+Shift+Z', desc: 'やり直し (Redo)' },
        { key: 'T', desc: '色トレス線を含む ON/OFF トグル' },
        { key: '[ / ]', desc: '隙間閉じ (Gap Close) レベル減増' },
      ],
    },
    {
      title: '🖥️ 画面 ＆ パネル表示操作',
      icon: <Monitor className="w-4 h-4 text-indigo-500" />,
      items: [
        { key: 'Ctrl + Alt (Win) / Ctrl + Cmd (Mac)', desc: '右サイドパネル一括開閉 (全幅切替)' },
        { key: 'Space + ドラッグ / 中・右ボタン', desc: 'キャンバスの自由パン移動' },
        { key: 'Ctrl + ホイール / ピンチ', desc: 'キャンバスの拡大・縮小' },
        { key: 'F1', desc: '仕様書・取扱説明書を別タブで開く' },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="bg-slate-800 dark:bg-slate-950 p-3.5 text-white flex justify-between items-center border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-blue-400" />
            <h2 className="font-bold text-sm tracking-wide">ショートカットキー一覧 (最新版)</h2>
          </div>
          <button
            onClick={() => setActiveModal(null)}
            className="p-1 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {categories.map((cat, idx) => (
            <div key={idx} className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200/80 dark:border-slate-700/80">
              <div className="flex items-center gap-2 font-bold text-xs text-slate-800 dark:text-slate-200 mb-2 border-b border-slate-200 dark:border-slate-700 pb-1.5">
                {cat.icon}
                <span>{cat.title}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                {cat.items.map((item, itemIdx) => (
                  <div
                    key={itemIdx}
                    className="flex items-center justify-between bg-white dark:bg-slate-900/80 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 shadow-2xs"
                  >
                    <span className="text-slate-600 dark:text-slate-400 font-medium pr-2 truncate">
                      {item.desc}
                    </span>
                    <kbd className="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/80 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800/80 flex-shrink-0">
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
            ※ [F1] キーを押すといつでも完全Web仕様書・取扱説明書を参照できます。
          </span>
          <button
            onClick={() => setActiveModal(null)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-5 py-1.5 rounded-lg font-bold shadow-xs transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
