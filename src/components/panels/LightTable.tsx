import React, { useRef, useState } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { Play, Pause, Palette, Clapperboard, Plus, Trash2, Eye, EyeOff, Layers, Settings2 } from 'lucide-react';
import { decodeTGA } from '../../engine/tga';

export const LightTable: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const {
    lightTable,
    setLightTableEnabled,
    setLightTableOpacity,
    setOnionSkinFrames,
    setOnionSkinOpacityConfig,
    setOnionSkinDisplayMode,
    addLightTableSubItem,
    removeLightTableSubItem,
    updateLightTableSubItemTransform,
    toggleLightTableSubItemVisible,
    fileList,
    currentFileIndex,
    isPlaying,
    setIsPlaying,
    fps,
    setFps,
    toolOptions,
    setFrameHold,
  } = usePaintStore();

  const prevFrameName = currentFileIndex > 0 ? fileList[currentFileIndex - 1] : null;
  const currentFrameName = fileList[currentFileIndex] || 'No Cell';
  const nextFrameName = currentFileIndex < fileList.length - 1 ? fileList[currentFileIndex + 1] : null;

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
    <div className="bg-white dark:bg-slate-900 border-t border-slate-300 dark:border-slate-800 flex flex-col px-2 py-0.5 text-xs select-none gap-0.5">
      {/* メインコントロールバー */}
      <div className="h-6.5 flex items-center justify-between gap-2">
        {/* オニオンスキン基本トグル ＆ フレーム表示 */}
        <div className="flex items-center gap-1.5">
          <label className="flex items-center gap-1 cursor-pointer font-bold text-slate-700 dark:text-slate-200 text-[10px]">
            <input
              type="checkbox"
              checked={lightTable.enabled}
              onChange={(e) => setLightTableEnabled(e.target.checked)}
              className="rounded accent-blue-600 cursor-pointer w-3.5 h-3.5"
            />
            <span>オニオンスキン</span>
          </label>

          {/* 前後フレーム状況 */}
          <div className="flex items-center gap-1 ml-0.5">
            {prevFrameName ? (
              <div className="px-1.5 h-5 border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 font-medium rounded flex items-center justify-center text-[9px]">
                前: {prevFrameName.replace('.tga', '')}
              </div>
            ) : (
              <div className="px-1.5 h-5 border border-dashed border-slate-200 dark:border-slate-700 rounded flex items-center justify-center text-[9px] text-slate-400">
                前: なし
              </div>
            )}

            <div className="px-2 h-5 border border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 font-bold rounded flex items-center justify-center text-[10px]">
              現: {currentFrameName.replace('.tga', '')}
            </div>

            {nextFrameName ? (
              <div className="px-1.5 h-5 border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-medium rounded flex items-center justify-center text-[9px]">
                後: {nextFrameName.replace('.tga', '')}
              </div>
            ) : (
              <div className="px-1.5 h-5 border border-dashed border-slate-200 dark:border-slate-700 rounded flex items-center justify-center text-[9px] text-slate-400">
                後: なし
              </div>
            )}
          </div>

          {/* 前後表示枚数 */}
          <div className="flex items-center gap-1 text-[10px] ml-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
            <span className="text-slate-500">枚数(前/後):</span>
            <input
              type="number"
              min="0"
              max="5"
              value={lightTable.pastFrames}
              onChange={(e) => setOnionSkinFrames(Number(e.target.value), lightTable.futureFrames)}
              className="w-7 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded text-center"
            />
            <span>/</span>
            <input
              type="number"
              min="0"
              max="5"
              value={lightTable.futureFrames}
              onChange={(e) => setOnionSkinFrames(lightTable.pastFrames, Number(e.target.value))}
              className="w-7 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded text-center"
            />
          </div>

          {/* 表示モード切替 */}
          <button
            onClick={() => {
              const nextMode =
                lightTable.displayMode === 'monochrome'
                  ? 'half-color'
                  : lightTable.displayMode === 'half-color'
                  ? 'color'
                  : 'monochrome';
              setOnionSkinDisplayMode(nextMode);
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border transition-colors bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
          >
            <Palette className="w-3 h-3 text-red-500" />
            <span>
              {lightTable.displayMode === 'monochrome'
                ? 'モノクロ(前赤/後青)'
                : lightTable.displayMode === 'half-color'
                ? 'ハーフカラー'
                : 'フルカラー'}
            </span>
          </button>

          {/* 不透明度 */}
          <div className="flex items-center gap-1.5 ml-1 text-[11px]">
            <span className="text-slate-600 dark:text-slate-400">不透明度:</span>
            <input
              type="range"
              min="0"
              max="100"
              value={lightTable.startOpacity}
              onChange={(e) => setLightTableOpacity(Number(e.target.value))}
              className="w-14 accent-blue-600 cursor-pointer"
            />
            <span className="w-7 text-slate-700 dark:text-slate-300 font-mono text-[10px]">{lightTable.startOpacity}%</span>
          </div>

          {/* 詳細展開ボタン */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`p-1 rounded border transition-colors ${
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
        <div className="flex items-center gap-2 pl-3 border-l border-slate-200 dark:border-slate-700">
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
