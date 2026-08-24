import React, { useRef, useState } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { Play, Pause, Palette, Clapperboard, Plus, Trash2, Eye, EyeOff, Layers, Settings2 } from 'lucide-react';
import { decodeTGA } from '../../engine/tga';

export const LightTable: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const {
    lightTable,
    setOnionSkinOpacityConfig,
    addLightTableSubItem,
    removeLightTableSubItem,
    updateLightTableSubItemTransform,
    toggleLightTableSubItemVisible,
    isPlaying,
    setIsPlaying,
    fps,
    setFps,
    toolOptions,
    setFrameHold,
  } = usePaintStore();

  const handleAddSubItemFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const buffer = await file.arrayBuffer();
        const decoded = decodeTGA(buffer);
        addLightTableSubItem(file.name, file, decoded);
      } catch (err) {
        console.error('Failed to load sublayer TGA:', err);
      }
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border-t border-slate-300 dark:border-slate-800 flex flex-col px-2 py-0.5 text-xs select-none gap-0.5 whitespace-nowrap flex-shrink-0">
      {/* メインコントロールバー (改行完全無効・横スクロール維持) */}
      <div className="h-6.5 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar flex-nowrap min-w-0">
        {/* オニオンスキンの設定は右パネルのツールオプションへ集約した。
            ここには現在の状態表示だけを残す。 */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div
            title="オニオンスキンの設定は右側のツールオプションで行います"
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${
              lightTable.enabled
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-700'
            }`}
          >
            <Palette className="w-3 h-3" />
            <span>
              オニオンスキン{' '}
              {lightTable.enabled
                ? lightTable.showAllFrames
                  ? '(カット全体)'
                  : `(前${lightTable.pastFrames} / 後${lightTable.futureFrames})`
                : 'OFF'}
            </span>
          </div>

          {/* 詳細展開ボタン */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`p-1 rounded border transition-colors flex-shrink-0 ${
              showAdvanced || lightTable.items.length > 0
                ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-300 border-blue-300'
                : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'
            }`}
            title="ライトテーブル個別のタップ移動・詳細設定"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* アニメーション再生 コントロール */}
        <div className="flex items-center gap-2 pl-3 border-l border-slate-200 dark:border-slate-700 flex-shrink-0 whitespace-nowrap">
          <div className="flex items-center gap-1 text-[10px]">
            <Clapperboard className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={toolOptions.frameHold}
              onChange={(e) => setFrameHold(Number(e.target.value) as any)}
              className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded px-1 py-0.5 text-[10px]"
            >
              <option value={1}>1コマ (24fps)</option>
              <option value={2}>2コマ (12fps)</option>
              <option value={3}>3コマ (8fps)</option>
            </select>
          </div>

          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded font-semibold text-[10px] transition-colors ${
              isPlaying ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span>{isPlaying ? '一時停止' : '再生'}</span>
          </button>

          <div className="flex items-center gap-1 text-[10px] text-slate-600 dark:text-slate-400">
            <span>{fps}FPS</span>
            <input
              type="range"
              min="1"
              max="24"
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className="w-12 accent-emerald-600 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* 高度な設定 ＆ 個別ライトテーブル (タップ移動・サブレイヤー) */}
      {(showAdvanced || lightTable.items.length > 0) && (
        <div className="pt-1.5 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-1.5 animate-in fade-in duration-100">
          <div className="flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <Layers className="w-3 h-3 text-blue-500" /> 個別ライトテーブル (位置・回転調整)
              </span>

              {/* 減衰ステップ設定 */}
              <div className="flex items-center gap-1 ml-2">
                <span className="text-slate-500">不透明度ステップ減衰:</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={lightTable.opacityStep}
                  onChange={(e) => setOnionSkinOpacityConfig(lightTable.startOpacity, Number(e.target.value))}
                  className="w-8 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-center"
                />
                <span>%</span>
              </div>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-2 py-0.5 rounded flex items-center gap-1 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>参照TGAサブレイヤー追加</span>
            </button>
          </div>

          {/* サブレイヤーリスト */}
          {lightTable.items.length > 0 ? (
            <div className="max-h-24 overflow-y-auto space-y-1">
              {lightTable.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between bg-slate-50 dark:bg-slate-950 p-1 rounded border border-slate-200 dark:border-slate-800 text-[10px]"
                >
                  <div className="flex items-center gap-1.5 truncate w-36">
                    <button onClick={() => toggleLightTableSubItemVisible(item.id)}>
                      {item.visible ? (
                        <Eye className="w-3 h-3 text-blue-500" />
                      ) : (
                        <EyeOff className="w-3 h-3 text-slate-400" />
                      )}
                    </button>
                    <span className="font-semibold truncate text-slate-800 dark:text-slate-200">{item.name}</span>
                  </div>

                  {/* 位置 X, Y, Rot, Opacity */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5">
                      <span className="text-slate-400">X:</span>
                      <input
                        type="number"
                        value={item.offsetX}
                        onChange={(e) =>
                          updateLightTableSubItemTransform(item.id, { offsetX: Number(e.target.value) })
                        }
                        className="w-9 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded text-center"
                      />
                    </div>

                    <div className="flex items-center gap-0.5">
                      <span className="text-slate-400">Y:</span>
                      <input
                        type="number"
                        value={item.offsetY}
                        onChange={(e) =>
                          updateLightTableSubItemTransform(item.id, { offsetY: Number(e.target.value) })
                        }
                        className="w-9 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded text-center"
                      />
                    </div>

                    <div className="flex items-center gap-0.5">
                      <span className="text-slate-400">Rot:</span>
                      <input
                        type="number"
                        step="0.5"
                        value={item.rotation}
                        onChange={(e) =>
                          updateLightTableSubItemTransform(item.id, { rotation: Number(e.target.value) })
                        }
                        className="w-10 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded text-center"
                      />
                    </div>

                    <div className="flex items-center gap-0.5">
                      <span className="text-slate-400">Op:</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={item.opacity}
                        onChange={(e) =>
                          updateLightTableSubItemTransform(item.id, { opacity: Number(e.target.value) })
                        }
                        className="w-9 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded text-center"
                      />
                      <span>%</span>
                    </div>

                    <button
                      onClick={() => removeLightTableSubItem(item.id)}
                      className="text-slate-400 hover:text-red-500 p-0.5 rounded transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[9px] text-slate-400 text-center py-1">
              登録されたサブレイヤーはありません (動画割り用の参照TGAを登録してドラッグ・回転移動できます)
            </div>
          )}
        </div>
      )}

      {/* サブレイヤーファイル選択非表示 Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleAddSubItemFile}
        multiple
        accept=".tga"
        className="hidden"
      />
    </div>
  );
};
