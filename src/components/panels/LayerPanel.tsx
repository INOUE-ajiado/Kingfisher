import React, { useState } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { Layers, Eye, EyeOff, Plus, Trash2, Info } from 'lucide-react';

export const LayerPanel: React.FC = () => {
  const {
    layers,
    activeLayerId,
    setActiveLayerId,
    toggleLayerVisible,
    setLayerOpacity,
    addLayer,
    deleteLayer,
  } = usePaintStore();

  const [newLayerName, setNewLayerName] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);

  const handleAdd = () => {
    if (newLayerName.trim()) {
      addLayer(newLayerName.trim());
      setNewLayerName('');
      setShowAddInput(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded flex flex-col shadow-sm select-none p-2 min-h-[140px]">
      <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 pb-1 border-b border-slate-200 dark:border-slate-700 mb-1 flex items-center justify-between">
        <div
          className="flex items-center gap-1.5 cursor-help"
          title="※TGAは単一層フォーマットです。本パネルはGPUによる仮想表示フィルタ（線画・彩色・影の個別分離表示）を提供します。"
        >
          <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span>View Filters (GPU仮想レイヤー)</span>
          <Info className="w-3 h-3 text-slate-400" />
        </div>
        <button
          onClick={() => setShowAddInput(!showAddInput)}
          title="Add New Filter Layer"
          className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-blue-600 dark:text-blue-400 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {showAddInput && (
        <div className="flex gap-1 mb-2">
          <input
            type="text"
            placeholder="Layer Name"
            value={newLayerName}
            onChange={(e) => setNewLayerName(e.target.value)}
            className="flex-1 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded px-1.5 py-0.5"
          />
          <button
            onClick={handleAdd}
            className="bg-blue-600 text-white text-[10px] px-2 py-0.5 rounded font-bold"
          >
            Add
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-1">
        {layers.map((layer) => {
          const isActive = layer.id === activeLayerId;
          return (
            <div
              key={layer.id}
              onClick={() => setActiveLayerId(layer.id)}
              className={`p-1.5 rounded flex items-center justify-between text-xs cursor-pointer border transition-colors ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-900/40 border-blue-500 font-semibold text-blue-700 dark:text-blue-300'
                  : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayerVisible(layer.id);
                  }}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  {layer.visible ? (
                    <Eye className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5 text-slate-400 dark:text-slate-600" />
                  )}
                </button>
                <span className="truncate">{layer.name}</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={layer.opacity}
                  onChange={(e) => {
                    e.stopPropagation();
                    setLayerOpacity(layer.id, Number(e.target.value));
                  }}
                  className="w-12 accent-blue-600 cursor-pointer"
                  title={`Opacity: ${layer.opacity}%`}
                />
                {layers.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteLayer(layer.id);
                    }}
                    className="text-slate-400 dark:text-slate-500 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
