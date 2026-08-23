import React from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { X } from 'lucide-react';

export const ShortcutsModal: React.FC = () => {
  const { activeModal, setActiveModal } = usePaintStore();

  if (activeModal !== 'shortcuts') return null;

  const shortcutsList = [
    { key: 'F1', desc: '仕様書・取扱説明書 (HTMLマニュアル) を新規タブで開く' },
    { key: 'PageDown / ↓', desc: '次のセルへ移動' },
    { key: 'PageUp / ↑', desc: '前のセルへ移動' },
    { key: 'Ctrl + S', desc: '現在編集中のセルを上書き保存' },
    { key: 'Ctrl + Z', desc: '元に戻す (Undo)' },
    { key: 'Ctrl + Y / Ctrl+Shift+Z', desc: 'やり直し (Redo)' },
    { key: 'Alt + クリック / I', desc: 'スポイト (描画色の取得)' },
    { key: 'F', desc: 'バケツ塗り (Flood Fill) ツール' },
    { key: 'B', desc: 'ブラシ (自由線) ツール' },
    { key: 'E', desc: '消しゴム ツール' },
    { key: 'T', desc: '含み塗り (Include Trace Lines) ON/OFF トグル' },
    { key: '[ / ]', desc: '隙間閉じ (Gap Close) ピクセルレベル減増' },
    { key: 'Ctrl + Alt (Win) / Ctrl + Cmd (Mac)', desc: '右サイドパネル一括開閉 (キャンバス全幅トグル)' },
    { key: 'Space + Drag', desc: 'キャンバスのパン (手のひら移動)' },
    { key: 'F5 〜 F9', desc: '各種パネルの表示/非表示トグル' },
  ];

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="bg-slate-800 p-3 text-white flex justify-between items-center">
          <h2 className="font-bold text-sm">ショートカットキー一覧</h2>
          <button
            onClick={() => setActiveModal(null)}
            className="p-1 rounded-full hover:bg-white/20 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 max-h-[70vh] overflow-y-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="p-2">キー</th>
                <th className="p-2">機能</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shortcutsList.map((item, index) => (
                <tr key={index} className="hover:bg-slate-50">
                  <td className="p-2 font-mono font-bold text-blue-600">{item.key}</td>
                  <td className="p-2 text-slate-600">{item.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={() => setActiveModal(null)}
            className="bg-slate-700 hover:bg-slate-800 text-white text-xs px-4 py-1.5 rounded transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
