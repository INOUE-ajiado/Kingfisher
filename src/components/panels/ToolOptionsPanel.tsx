import React from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { SkipForward, Anchor, Eye, Sliders, Layers, Palette, RefreshCw, Film } from 'lucide-react';

export const ToolOptionsPanel: React.FC = () => {
  const {
    activeTool,
    toolOptions,
    setGapCloseLevel,
    setEnableIncludeTrace,
    setRetainTraceLine,
    toggleTraceColor,
    setBrushSize,
    setExpandContract,
    setContiguous,
    setReferenceLayer,
    nextCell,
    lightTable,
    setLightTableEnabled,
    setOnionSkinFrames,
    setOnionSkinOpacityConfig,
    setOnionSkinDisplayMode,
    setOnionSkinShowAllFrames,
    pegStabilizer,
    togglePegStabilizerEnabled,
    runPegStabilizerAutoDetect,
    setPegManualOffset,
    togglePegGuide,
    referenceCanvas,
    setAutoRevertTool,
    resetCanvasTransform,
    canvasBgMatteMode,
    setCanvasBgMatteMode,
    canvasCustomBgColor,
    setCanvasCustomBgColor,
  } = usePaintStore();

  return (
    <div className="h-full bg-slate-50 dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col select-none text-xs overflow-y-auto no-scrollbar p-2.5 gap-3">
      {/* パネルヘッダー */}
      <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800 pb-1.5 flex-shrink-0">
        <Sliders className="w-4 h-4 text-blue-500" />
        <span>ツールオプション (Tool Options)</span>
      </div>

      {/* 1. ⚓ タップ穴スタビライザー (Peg Hole Stabilizer) */}
      <div className="bg-white dark:bg-slate-800/80 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2 shadow-xs">
        <div className="flex items-center justify-between font-bold text-slate-700 dark:text-slate-300">
          <button
            onClick={runPegStabilizerAutoDetect}
            className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
            title="タップ穴自動検出＆傾き自動補正を実行"
          >
            <Anchor className="w-3.5 h-3.5" />
            <span>タップ補正 (Peg Stabilizer)</span>
          </button>
          <input
            type="checkbox"
            checked={pegStabilizer.enabled}
            onChange={togglePegStabilizerEnabled}
            className="rounded accent-blue-600 cursor-pointer w-4 h-4"
          />
        </div>

        {pegStabilizer.enabled && (
          <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-700/60 text-[11px]">
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 font-mono">
              <span>ステータス:</span>
              <span className={`font-bold ${pegStabilizer.status === 'success' ? 'text-emerald-500' : 'text-slate-400'}`}>
                {pegStabilizer.status === 'success' ? '補正適用中' : '未検出'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1 text-[10px] font-mono">
              <div>
                <span className="text-slate-400 block">X:</span>
                <input
                  type="number"
                  value={pegStabilizer.manualX}
                  onChange={(e) => setPegManualOffset(Number(e.target.value), pegStabilizer.manualY, pegStabilizer.manualRotation)}
                  className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-1 py-0.5 text-center font-bold"
                />
              </div>
              <div>
                <span className="text-slate-400 block">Y:</span>
                <input
                  type="number"
                  value={pegStabilizer.manualY}
                  onChange={(e) => setPegManualOffset(pegStabilizer.manualX, Number(e.target.value), pegStabilizer.manualRotation)}
                  className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-1 py-0.5 text-center font-bold"
                />
              </div>
              <div>
                <span className="text-slate-400 block">Rot:</span>
                <input
                  type="number"
                  step="0.1"
                  value={pegStabilizer.manualRotation}
                  onChange={(e) => setPegManualOffset(pegStabilizer.manualX, pegStabilizer.manualY, Number(e.target.value))}
                  className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-1 py-0.5 text-center font-bold"
                />
              </div>
            </div>

            <button
              onClick={togglePegGuide}
              className="w-full mt-1 py-1 rounded bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1 font-semibold text-[10px]"
            >
              <Eye className="w-3 h-3 text-slate-400" />
              <span>ガイド線表示</span>
            </button>
          </div>
        )}
      </div>

      {/* 2. 💧 塗り・バケツツール設定 */}
      {(activeTool === 'fill' || activeTool === 'gradient' || activeTool === 'closedFill' || activeTool === 'noiseEraser') && (
        <div className="bg-white dark:bg-slate-800/80 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2.5 shadow-xs">
          <div className="font-bold text-slate-700 dark:text-slate-300">彩色・隙間閉じ設定</div>

          {/* 隙間閉じレベル */}
          <div>
            <div className="flex justify-between items-center mb-1 text-[11px]">
              <span className="text-slate-600 dark:text-slate-400 font-medium">隙間閉じ (Gap Close):</span>
              <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{toolOptions.gapCloseLevel}px</span>
            </div>
            <input
              type="range"
              min="0"
              max="20"
              value={toolOptions.gapCloseLevel}
              onChange={(e) => setGapCloseLevel(Number(e.target.value))}
              className="w-full accent-blue-600 cursor-pointer bg-slate-200 dark:bg-slate-700 my-1"
            />
          </div>

          {/* 色トレス線を含める */}
          <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-700/60">
            <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
              <input
                type="checkbox"
                checked={toolOptions.enableIncludeTrace}
                onChange={(e) => setEnableIncludeTrace(e.target.checked)}
                className="rounded accent-blue-600 cursor-pointer w-4 h-4"
              />
              <span>色トレス線を含む</span>
            </label>

            {toolOptions.enableIncludeTrace && (
              <div className="pl-5 space-y-1 text-[11px]">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={toolOptions.traceColors.red}
                      onChange={() => toggleTraceColor('red')}
                      className="accent-red-500 rounded cursor-pointer"
                    />
                    <span className="text-red-500 font-bold">赤</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={toolOptions.traceColors.blue}
                      onChange={() => toggleTraceColor('blue')}
                      className="accent-blue-500 rounded cursor-pointer"
                    />
                    <span className="text-blue-500 font-bold">青</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={toolOptions.traceColors.green}
                      onChange={() => toggleTraceColor('green')}
                      className="accent-emerald-500 rounded cursor-pointer"
                    />
                    <span className="text-emerald-500 font-bold">緑</span>
                  </label>
                </div>

                <label className="flex items-center gap-1.5 cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={toolOptions.retainTraceLine}
                    onChange={(e) => setRetainTraceLine(e.target.checked)}
                    className="accent-purple-500 rounded cursor-pointer"
                  />
                  <span className="text-slate-600 dark:text-slate-400">トレス線を塗らずに残す</span>
                </label>
              </div>
            )}
          </div>

          {/* 領域拡張 ＆ 隣接ピクセル */}
          <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-700/60">
            <div>
              <div className="flex justify-between items-center mb-1 text-[11px]">
                <span className="text-slate-600 dark:text-slate-400 font-medium">領域拡張:</span>
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{toolOptions.expandContract}px</span>
              </div>
              <input
                type="range"
                min="-10"
                max="10"
                value={toolOptions.expandContract}
                onChange={(e) => setExpandContract(Number(e.target.value))}
                className="w-full accent-blue-600 cursor-pointer bg-slate-200 dark:bg-slate-700 my-1"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
              <input
                type="checkbox"
                checked={toolOptions.contiguous}
                onChange={(e) => setContiguous(e.target.checked)}
                className="rounded accent-blue-600 cursor-pointer w-4 h-4"
              />
              <span>隣接ピクセルのみ</span>
            </label>
          </div>
        </div>
      )}

      {/* 3. 🖌️ ブラシ・ペン設定 */}
      {(activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser') && (
        <div className="bg-white dark:bg-slate-800/80 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2 shadow-xs">
          <div className="font-bold text-slate-700 dark:text-slate-300">ブラシ・消しゴムサイズ</div>
          <div>
            <div className="flex justify-between items-center mb-1 text-[11px]">
              <span className="text-slate-600 dark:text-slate-400 font-medium">サイズ:</span>
              <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{toolOptions.brushSize}px</span>
            </div>
            <input
              type="range"
              min="1"
              max="100"
              value={toolOptions.brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-full accent-blue-600 cursor-pointer bg-slate-200 dark:bg-slate-700 my-1"
            />
          </div>
        </div>
      )}

      {/* 4. 👁️ 参照先 ＆ 自動ツール復帰 */}
      <div className="bg-white dark:bg-slate-800/80 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2 shadow-xs">
        <div className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-blue-500" />
          <span>レイヤー参照 ＆ 自動復帰</span>
        </div>

        <div>
          <label className="block text-slate-600 dark:text-slate-400 mb-1 text-[11px]">参照先レイヤー:</label>
          <select
            value={toolOptions.referenceLayer}
            onChange={(e) => setReferenceLayer(e.target.value as any)}
            className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded text-xs px-2 py-1 font-medium"
          >
            <option value="current">編集レイヤーのみ</option>
            <option value="all">すべてのレイヤー</option>
            <option value="reference">参照レイヤー</option>
          </select>
        </div>

        <label className="flex items-center gap-2 cursor-pointer font-bold text-emerald-700 dark:text-emerald-400 text-[11px] pt-1">
          <input
            type="checkbox"
            checked={referenceCanvas.autoRevertTool}
            onChange={(e) => setAutoRevertTool(e.target.checked)}
            className="rounded accent-emerald-600 cursor-pointer w-4 h-4"
          />
          <span>スポイト後に自動ツール復帰</span>
        </label>
      </div>

      {/* 5. 🎨 キャンバス背景マット切替 (セルバレ・ドット抜け検出) */}
      <div className="bg-white dark:bg-slate-800/80 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2 shadow-xs">
        <div className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5 text-purple-500" />
          <span>キャンバス背景マット (点検用)</span>
        </div>

        <div className="grid grid-cols-5 gap-1 text-[10px]">
          <button
            onClick={() => setCanvasBgMatteMode('checkerboard')}
            title="市松模様 (Checkerboard)"
            className={`py-1 rounded font-bold transition-all border ${
              canvasBgMatteMode === 'checkerboard' ? 'bg-slate-200 dark:bg-slate-700 border-blue-500 text-blue-600 dark:text-blue-400' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
            }`}
          >
            🏁 市松
          </button>
          <button
            onClick={() => setCanvasBgMatteMode('black')}
            title="純黒マット (#000000) - 白フリンジ・ドット抜け検出"
            className={`py-1 rounded font-bold transition-all border ${
              canvasBgMatteMode === 'black' ? 'bg-black text-white border-blue-500' : 'bg-black text-slate-400 border-slate-800'
            }`}
          >
            ⬛ 黒
          </button>
          <button
            onClick={() => setCanvasBgMatteMode('white')}
            title="純白マット (#FFFFFF) - 暗部塗り漏れ検出"
            className={`py-1 rounded font-bold transition-all border ${
              canvasBgMatteMode === 'white' ? 'bg-white text-slate-900 border-blue-500' : 'bg-white text-slate-500 border-slate-300'
            }`}
          >
            ⬜ 白
          </button>
          <button
            onClick={() => setCanvasBgMatteMode('magenta')}
            title="マゼンタマット (#FF00FF) - 補色コントラスト検出"
            className={`py-1 rounded font-bold transition-all border ${
              canvasBgMatteMode === 'magenta' ? 'bg-[#ff00ff] text-white border-blue-500' : 'bg-[#ff00ff]/80 text-white/80 border-slate-700'
            }`}
          >
            🟪
          </button>
          <label
            title="カスタム背景色"
            className={`py-1 rounded font-bold transition-all border flex items-center justify-center gap-0.5 cursor-pointer ${
              canvasBgMatteMode === 'custom' ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
            }`}
          >
            <input
              type="radio"
              name="canvasPanelBgMatte"
              checked={canvasBgMatteMode === 'custom'}
              onChange={() => setCanvasBgMatteMode('custom')}
              className="hidden"
            />
            <span>🎨</span>
            <input
              type="color"
              value={canvasCustomBgColor}
              onChange={(e) => {
                setCanvasCustomBgColor(e.target.value);
                setCanvasBgMatteMode('custom');
              }}
              className="w-3 h-3 rounded cursor-pointer border-0 p-0 bg-transparent"
            />
          </label>
        </div>
      </div>

      {/* 6. 🎞️ オニオンスキン (ライトテーブル) */}
      <div className="space-y-1.5 pt-1 border-t border-slate-200 dark:border-slate-800">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Film className="w-3.5 h-3.5 text-purple-500" />
            オニオンスキン
          </span>
          <input
            type="checkbox"
            checked={lightTable.enabled}
            onChange={(e) => setLightTableEnabled(e.target.checked)}
            className="w-3.5 h-3.5 accent-purple-600 cursor-pointer"
          />
        </label>

        {lightTable.enabled && (
          <div className="space-y-2 pl-1 border-l-2 border-purple-500/30">
            {/* 対象範囲: カット全体 か 前後の枚数指定 か */}
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-[10px] text-slate-600 dark:text-slate-400">
                カット内の全セルを重ねる
              </span>
              <input
                type="checkbox"
                checked={lightTable.showAllFrames}
                onChange={(e) => setOnionSkinShowAllFrames(e.target.checked)}
                className="w-3 h-3 accent-purple-600 cursor-pointer"
              />
            </label>

            {lightTable.showAllFrames ? (
              <p className="text-[9px] text-slate-500 dark:text-slate-400 leading-relaxed">
                現在のセルを基準に、フォルダ内の前後すべてを重ねます。
                枚数が多いほど読み込みと描画に時間がかかります。
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] text-slate-600 dark:text-slate-400">前のセル</span>
                  <input
                    type="range"
                    min="0"
                    max="30"
                    value={lightTable.pastFrames}
                    onChange={(e) => setOnionSkinFrames(Number(e.target.value), lightTable.futureFrames)}
                    className="flex-1 h-1 accent-red-500 cursor-pointer"
                  />
                  <span className="w-8 text-right font-mono text-[10px] text-red-500">
                    {lightTable.pastFrames}枚
                  </span>
                </div>

                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] text-slate-600 dark:text-slate-400">次のセル</span>
                  <input
                    type="range"
                    min="0"
                    max="30"
                    value={lightTable.futureFrames}
                    onChange={(e) => setOnionSkinFrames(lightTable.pastFrames, Number(e.target.value))}
                    className="flex-1 h-1 accent-blue-500 cursor-pointer"
                  />
                  <span className="w-8 text-right font-mono text-[10px] text-blue-500">
                    {lightTable.futureFrames}枚
                  </span>
                </div>
              </>
            )}

            {/* 濃度 */}
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] text-slate-600 dark:text-slate-400">濃度</span>
              <input
                type="range"
                min="5"
                max="100"
                value={lightTable.startOpacity}
                onChange={(e) =>
                  setOnionSkinOpacityConfig(Number(e.target.value), lightTable.opacityStep)
                }
                className="flex-1 h-1 accent-purple-500 cursor-pointer"
              />
              <span className="w-8 text-right font-mono text-[10px] text-slate-600 dark:text-slate-300">
                {lightTable.startOpacity}%
              </span>
            </div>

            {/* 離れたセルほど薄くする度合い */}
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] text-slate-600 dark:text-slate-400" title="離れたセルほど薄くする度合い">
                減衰
              </span>
              <input
                type="range"
                min="0"
                max="50"
                value={lightTable.opacityStep}
                onChange={(e) =>
                  setOnionSkinOpacityConfig(lightTable.startOpacity, Number(e.target.value))
                }
                className="flex-1 h-1 accent-purple-500 cursor-pointer"
              />
              <span className="w-8 text-right font-mono text-[10px] text-slate-600 dark:text-slate-300">
                {lightTable.opacityStep}%
              </span>
            </div>

            {/* 表示モード */}
            <div className="flex items-center gap-1">
              {(
                [
                  { key: 'monochrome', label: '色分け' },
                  { key: 'half-color', label: '半調' },
                  { key: 'color', label: '原色' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.key}
                  onClick={() => setOnionSkinDisplayMode(mode.key)}
                  title={
                    mode.key === 'monochrome'
                      ? '前を赤・次を青の単色で表示'
                      : mode.key === 'half-color'
                      ? '元の色を残しつつ色味を寄せる'
                      : '元の色のまま重ねる'
                  }
                  className={`flex-1 py-1 rounded text-[9px] font-bold border transition-colors ${
                    lightTable.displayMode === mode.key
                      ? 'bg-purple-600 text-white border-purple-600'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 7. ⏭️ アクションボタン (Fit & Next Cell) */}
      <div className="space-y-1.5 pt-1">
        <button
          onClick={resetCanvasTransform}
          title="PC画面の高さに合わせて用紙フレームを上下ぴったり初期化 (Fit Height)"
          className="w-full py-1.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs border border-slate-300 dark:border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
          <span>画面高さにフィット</span>
        </button>

        <button
          onClick={() => nextCell('ツールオプションのコマ送りボタン')}
          className="w-full py-2 rounded bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
        >
          <span>Next Cell (PgDn)</span>
          <SkipForward className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
