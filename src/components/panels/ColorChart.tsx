import React, { useRef, useState } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { Download, Upload, Plus, Trash2 } from 'lucide-react';

export const ColorChart: React.FC = () => {
  const {
    activePaletteTab,
    setActivePaletteTab,
    palettes,
    selectedColorIndex,
    setSelectedColorIndex,
    currentColor,
    exportPaletteJSON,
    importPaletteJSON,
    importACTPalette,
    addPaletteColor,
    deletePaletteColor,
  } = usePaintStore();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const currentPalette = palettes[activePaletteTab];

  const [newColorName, setNewColorName] = useState('');
  const [newColorHex, setNewColorHex] = useState('#FF0000');
  const [showAddForm, setShowAddForm] = useState(false);

  const handleExport = () => {
    const jsonStr = exportPaletteJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kingfisher_palette.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.act')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const buffer = event.target?.result as ArrayBuffer;
        if (buffer) {
          const success = importACTPalette(buffer);
          if (success) alert(`Adobe ACT パレット [${file.name}] を正常にインポートしました。`);
          else alert('ACT パレットの解析に失敗しました。');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) {
          const success = importPaletteJSON(content);
          if (success) alert('カラーパレット (JSON) を正常にインポートしました。');
          else alert('パレットJSONの形式が正しくありません。');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleAddColor = () => {
    if (newColorName.trim()) {
      addPaletteColor(newColorName.trim(), newColorHex);
      setNewColorName('');
      setShowAddForm(false);
    }
  };

  // セル上での右クリック（現在選択色を上書き登録）
  const handleCellContextMenu = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    const item = currentPalette[index];
    if (item) {
      item.color = { ...currentColor };
      usePaintStore.setState((state) => ({ ...state }));
    }
  };

  return (
    <div className="flex-[1.5] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded flex flex-col shadow-sm select-none p-2 min-h-[220px]">
      <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 pb-1.5 border-b border-slate-200 dark:border-slate-700 mb-2 flex items-center justify-between">
        <span title="キー[1]:ノーマル [2]:1影 [3]:ハイライト">Color Chart (1/2/3 Tab)</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            title="Add New Color"
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleExport}
            title="Export Palette JSON"
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <Download className="w-3 h-3" />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Import Palette (.json, .act)"
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <Upload className="w-3 h-3" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImport}
            accept=".json,.act"
            className="hidden"
          />
        </div>
      </div>

      {showAddForm && (
        <div className="flex items-center gap-1.5 mb-2 bg-slate-50 dark:bg-slate-800 p-1.5 rounded border border-slate-200 dark:border-slate-700">
          <input
            type="color"
            value={newColorHex}
            onChange={(e) => setNewColorHex(e.target.value)}
            className="w-6 h-6 rounded cursor-pointer border border-slate-300 dark:border-slate-600"
          />
          <input
            type="text"
            placeholder="Color Name"
            value={newColorName}
            onChange={(e) => setNewColorName(e.target.value)}
            className="flex-1 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 rounded px-1.5 py-0.5"
          />
          <button
            onClick={handleAddColor}
            className="bg-blue-600 text-white text-[10px] px-2 py-1 rounded font-bold"
          >
            Add
          </button>
        </div>
      )}

      {/* Tabs (1, 2, 3 キーショートカット連携) */}
      <div className="flex gap-1 mb-3">
        {(['normal', 'shadow', 'highlight'] as const).map((tab, i) => {
          const isActive = activePaletteTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActivePaletteTab(tab)}
              title={`キー [${i + 1}] で切り替え`}
              className={`text-[11px] px-2.5 py-0.5 rounded-full capitalize transition-colors ${
                isActive
                  ? 'bg-teal-600 text-white font-medium'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              [{i + 1}] {tab}
            </button>
          );
        })}
      </div>

      {/* Color Grid (右クリックで現在色をセル保存) */}
      <div className="grid grid-cols-6 gap-1.5 overflow-y-auto max-h-[120px] p-0.5">
        {currentPalette.map((item, index) => {
          const isSelected = selectedColorIndex === index;
          return (
            <div
              key={item.id}
              onClick={() => setSelectedColorIndex(index)}
              onContextMenu={(e) => handleCellContextMenu(e, index)}
              title={`${item.name} (右クリックで現在色を上書き登録)`}
              style={{ backgroundColor: item.color.hex }}
              className={`aspect-square rounded border border-slate-200 dark:border-slate-700 cursor-pointer relative transition-transform ${
                isSelected ? 'ring-2 ring-orange-500 scale-110 z-10 shadow-sm' : 'hover:scale-105'
              }`}
            />
          );
        })}
      </div>

      {/* Current Color Preview */}
      <div className="mt-auto pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 border border-slate-300 dark:border-slate-700 rounded shadow-inner"
            style={{ backgroundColor: currentColor.hex }}
          />
          <div className="text-xs">
            <div className="font-semibold text-slate-800 dark:text-slate-200">
              {selectedColorIndex !== null && currentPalette[selectedColorIndex]
                ? currentPalette[selectedColorIndex].name
                : 'Custom Color'}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
              {currentColor.hex}
            </div>
          </div>
        </div>

        {selectedColorIndex !== null && currentPalette.length > 1 && (
          <button
            onClick={() => deletePaletteColor(selectedColorIndex)}
            title="Delete Selected Color"
            className="text-slate-400 dark:text-slate-500 hover:text-red-500 transition-colors p-1 rounded"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
