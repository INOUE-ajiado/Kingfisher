import React, { useState, useEffect, useCallback } from 'react';
import { X, Disc, Film, Clock, Play, RefreshCw, AlertCircle, CheckCircle2, HardDrive } from 'lucide-react';
import { usePaintStore } from '../../store/usePaintStore';
import { RollId } from '../../store/types';

const HELPER_API_URL = 'http://localhost:3001';

interface DiscStream {
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
}

interface DetectedDisc {
  name: string;
  path: string;
  isBdmv: boolean;
  streamCount: number;
  streams: DiscStream[];
}

interface HelperStatus {
  ok: boolean;
  ffmpeg: { installed: boolean; path: string | null };
  discCount: number;
  discs: Array<{ name: string; path: string; isBdmv: boolean; streamCount: number }>;
}

interface SavedClip {
  name: string;
  url: string;
  size: number;
  sizeFormatted: string;
  createdAt: string;
}

export const BdImportModal: React.FC = () => {
  const { activeModal, setActiveModal, loadRollFile, openRollWindow } = usePaintStore();

  const [isLoading, setIsLoading] = useState(false);
  const [helperConnected, setHelperConnected] = useState<boolean | null>(null);
  const [helperStatus, setHelperStatus] = useState<HelperStatus | null>(null);
  const [discs, setDiscs] = useState<DetectedDisc[]>([]);
  const [selectedDiscIdx, setSelectedDiscIdx] = useState<number>(0);
  const [selectedStreamPath, setSelectedStreamPath] = useState<string>('');
  
  // 切り出しパラメータ
  const [startTime, setStartTime] = useState<string>('00:00:00');
  const [duration, setDuration] = useState<string>('30');
  const [clipTitle, setClipTitle] = useState<string>('cut_bd_ref');
  const [targetRoll, setTargetRoll] = useState<RollId>('rollB');

  // クリップ履歴
  const [savedClips, setSavedClips] = useState<SavedClip[]>([]);
  const [activeTab, setActiveTab] = useState<'extract' | 'history'>('extract');

  const [message, setMessage] = useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null);

  const isOpen = activeModal === 'bdImport';

  // ヘルパー状態とディスク情報の取得
  const fetchStatusAndDiscs = useCallback(async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const statusRes = await fetch(`${HELPER_API_URL}/api/status`);
      if (!statusRes.ok) throw new Error('Helper not responding');
      const statusData: HelperStatus = await statusRes.json();
      setHelperStatus(statusData);
      setHelperConnected(true);

      const discsRes = await fetch(`${HELPER_API_URL}/api/discs`);
      if (discsRes.ok) {
        const discsData = await discsRes.json();
        const detectedDiscs: DetectedDisc[] = discsData.discs || [];
        setDiscs(detectedDiscs);
        if (detectedDiscs.length > 0) {
          const firstDisc = detectedDiscs[0];
          if (firstDisc.streams.length > 0) {
            setSelectedStreamPath(firstDisc.streams[0].path);
          }
        }
      }

      // 履歴も取得
      const clipsRes = await fetch(`${HELPER_API_URL}/api/clips`);
      if (clipsRes.ok) {
        const clipsData = await clipsRes.json();
        setSavedClips(clipsData.clips || []);
      }
    } catch {
      setHelperConnected(false);
      setHelperStatus(null);
      setDiscs([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void fetchStatusAndDiscs();
    }
  }, [isOpen, fetchStatusAndDiscs]);

  // ディスク切り替え時のストリーム初期化
  const handleDiscChange = (idx: number) => {
    setSelectedDiscIdx(idx);
    const disc = discs[idx];
    if (disc && disc.streams.length > 0) {
      setSelectedStreamPath(disc.streams[0].path);
    } else {
      setSelectedStreamPath('');
    }
  };

  // 切り出し実行
  const handleExtractClip = async () => {
    if (!selectedStreamPath) {
      setMessage({ type: 'error', text: '対象の動画ストリームが選択されていません。' });
      return;
    }

    setIsLoading(true);
    setMessage({ type: 'info', text: 'BD映像から切り出し処理中 (ffmpeg)...' });

    try {
      const res = await fetch(`${HELPER_API_URL}/api/clip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePath: selectedStreamPath,
          startTime: startTime.trim(),
          duration: duration.trim(),
          title: clipTitle.trim(),
          rollId: targetRoll,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '切り出しに失敗しました');
      }

      // 切り出された動画を取得して File オブジェクト化
      const videoRes = await fetch(data.clipUrl);
      const videoBlob = await videoRes.blob();
      const videoFile = new File([videoBlob], data.clipName, { type: 'video/mp4' });

      // ロールビューアへロード
      loadRollFile(targetRoll, videoFile);
      openRollWindow(targetRoll);

      setMessage({
        type: 'success',
        text: `切り出し完了！ ${targetRoll === 'rollA' ? 'ロール A' : 'ロール B'} にロードしました (${data.sizeFormatted})`,
      });

      // 履歴を更新
      void fetchStatusAndDiscs();
    } catch (err: any) {
      setMessage({ type: 'error', text: `エラー: ${err.message}` });
    } finally {
      setIsLoading(false);
    }
  };

  // 履歴からのロード
  const handleLoadSavedClip = async (clip: SavedClip, rollId: RollId) => {
    setIsLoading(true);
    try {
      const videoRes = await fetch(`${HELPER_API_URL}${clip.url}`);
      const videoBlob = await videoRes.blob();
      const videoFile = new File([videoBlob], clip.name, { type: 'video/mp4' });

      loadRollFile(rollId, videoFile);
      openRollWindow(rollId);
      setMessage({
        type: 'success',
        text: `${clip.name} を ${rollId === 'rollA' ? 'ロール A' : 'ロール B'} にロードしました`,
      });
    } catch (err: any) {
      setMessage({ type: 'error', text: `クリップの読み込みに失敗しました: ${err.message}` });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const currentDisc = discs[selectedDiscIdx];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-100">
      <div className="bg-slate-900 border border-indigo-500/30 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950 border-b border-white/10">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
            <Disc className="w-5 h-5 text-indigo-400 animate-spin-slow" />
            <span>Blu-ray (BD) 映像取り込み & ロール連携</span>
          </div>
          <button
            onClick={() => setActiveModal(null)}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* サブバー (ヘルパー状態 & タブ) */}
        <div className="flex items-center justify-between px-5 py-2 bg-slate-950/60 border-b border-white/5 text-xs">
          <div className="flex items-center gap-2">
            {helperConnected === true ? (
              <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  ローカルヘルパー接続中
                  {helperStatus?.ffmpeg.installed ? ` (ffmpeg: ${helperStatus.ffmpeg.path})` : ' (⚠️ ffmpeg未検出)'}
                </span>
              </span>
            ) : helperConnected === false ? (
              <span className="flex items-center gap-1.5 text-red-400 font-bold">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>ローカルヘルパー未検出</span>
              </span>
            ) : (
              <span className="text-slate-400">接続確認中...</span>
            )}
            <button
              onClick={() => void fetchStatusAndDiscs()}
              disabled={isLoading}
              title="再検出"
              className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="flex items-center gap-1 bg-slate-800/80 p-0.5 rounded-lg border border-white/10">
            <button
              onClick={() => setActiveTab('extract')}
              className={`px-3 py-1 rounded text-[11px] font-bold transition-colors ${
                activeTab === 'extract'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              切り出し作成
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1 rounded text-[11px] font-bold transition-colors ${
                activeTab === 'history'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              切り出し履歴 ({savedClips.length})
            </button>
          </div>
        </div>

        {/* メインコンテンツ */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs text-slate-200">
          {/* ヘルパー未接続時の案内アラート */}
          {helperConnected === false && (
            <div className="p-3.5 rounded-lg bg-red-950/50 border border-red-500/40 text-red-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-red-300">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <span>ローカル常駐ヘルパーが起動していません</span>
              </div>
              <p className="text-[11px] leading-relaxed text-red-200/90">
                外付けBDドライブの読み込みおよびffmpeg切り出しを行うには、Macのターミナルで以下のコマンドを実行してください：
              </p>
              <div className="p-2 bg-black/60 rounded font-mono text-[11px] text-amber-300 select-all border border-white/10">
                npm run helper
              </div>
              <p className="text-[10px] text-red-300/70">
                ※ 起動後に上部の再検出ボタンをクリックすると接続されます。
              </p>
            </div>
          )}

          {/* 通知メッセージ */}
          {message && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                message.type === 'error'
                  ? 'bg-red-950/60 border-red-500/40 text-red-200'
                  : message.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                  : 'bg-indigo-950/60 border-indigo-500/40 text-indigo-200'
              }`}
            >
              {message.type === 'error' ? (
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
              ) : message.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
              ) : (
                <RefreshCw className="w-4 h-4 flex-shrink-0 animate-spin text-indigo-400" />
              )}
              <span>{message.text}</span>
            </div>
          )}

          {activeTab === 'extract' ? (
            <>
              {/* ディスク・ボリューム選択 */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
                  <span>検出されたディスク / ドライブ (/Volumes):</span>
                </label>
                {discs.length === 0 ? (
                  <div className="p-3 rounded bg-slate-950/60 border border-white/10 text-slate-400 text-center">
                    接続されたディスク・動画ボリュームが見つかりません。外付けドライブにBDがマウントされているか確認してください。
                  </div>
                ) : (
                  <select
                    value={selectedDiscIdx}
                    onChange={(e) => handleDiscChange(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-white/20 rounded-lg px-3 py-2 text-slate-100 font-medium focus:outline-none focus:border-indigo-400"
                  >
                    {discs.map((d, i) => (
                      <option key={d.path} value={i}>
                        {d.isBdmv ? '💿 [BDMV] ' : '📁 '}
                        {d.name} ({d.streamCount} ストリーム) — {d.path}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* ストリームファイル選択 */}
              {currentDisc && currentDisc.streams.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5 text-indigo-400" />
                    <span>本編 / ストリームファイル選択:</span>
                  </label>
                  <select
                    value={selectedStreamPath}
                    onChange={(e) => setSelectedStreamPath(e.target.value)}
                    className="w-full bg-slate-950 border border-white/20 rounded-lg px-3 py-2 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-indigo-400"
                  >
                    {currentDisc.streams.map((s) => (
                      <option key={s.path} value={s.path}>
                        {s.name} ({s.sizeFormatted}) — {s.path}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 切り出し設定 */}
              <div className="grid grid-cols-2 gap-3 p-3.5 rounded-lg bg-slate-950/70 border border-white/10">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-indigo-300 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>開始タイムコード (時:分:秒):</span>
                  </label>
                  <input
                    type="text"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    placeholder="00:05:00"
                    className="w-full bg-slate-900 border border-white/20 rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-indigo-400"
                  />
                  <div className="flex gap-1 pt-0.5">
                    {['00:00:00', '00:01:00', '00:05:00', '00:10:00'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setStartTime(preset)}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white transition-colors"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-indigo-300 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>切り出し長さ (秒):</span>
                  </label>
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    placeholder="30"
                    className="w-full bg-slate-900 border border-white/20 rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-indigo-400"
                  />
                  <div className="flex gap-1 pt-0.5">
                    {['15', '30', '60', '120'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setDuration(preset)}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white transition-colors"
                      >
                        {preset}秒
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400">クリップ名:</label>
                  <input
                    type="text"
                    value={clipTitle}
                    onChange={(e) => setClipTitle(e.target.value)}
                    placeholder="cut_bd_ref"
                    className="w-full bg-slate-900 border border-white/20 rounded px-2.5 py-1.5 text-slate-100 text-xs focus:outline-none focus:border-indigo-400"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400">ロード先ロール面:</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTargetRoll('rollA')}
                      className={`py-1.5 rounded font-bold transition-colors ${
                        targetRoll === 'rollA'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-slate-900 text-slate-400 hover:text-white border border-white/10'
                      }`}
                    >
                      ロール A
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetRoll('rollB')}
                      className={`py-1.5 rounded font-bold transition-colors ${
                        targetRoll === 'rollB'
                          ? 'bg-violet-600 text-white shadow-xs'
                          : 'bg-slate-900 text-slate-400 hover:text-white border border-white/10'
                      }`}
                    >
                      ロール B (推奨)
                    </button>
                  </div>
                </div>
              </div>

              {/* 実行ボタン */}
              <button
                type="button"
                disabled={isLoading || !helperConnected || !selectedStreamPath}
                onClick={handleExtractClip}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold flex items-center justify-center gap-2 shadow-lg transition-all"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>切り出し処理を実行中...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>BDから切り出して {targetRoll === 'rollA' ? 'ロール A' : 'ロール B'} にロード</span>
                  </>
                )}
              </button>
            </>
          ) : (
            /* 切り出し履歴一覧 */
            <div className="space-y-2">
              <p className="text-[11px] text-slate-400">
                過去に切り出したクリップ動画 (scratch/bd_clips) を直接ロールに開くことができます。
              </p>
              {savedClips.length === 0 ? (
                <div className="p-8 text-center text-slate-500 bg-slate-950/40 rounded-lg">
                  切り出し履歴はありません
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                  {savedClips.map((clip) => (
                    <div
                      key={clip.name}
                      className="p-2.5 rounded-lg bg-slate-950/70 border border-white/10 flex items-center justify-between gap-3 hover:border-indigo-500/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-mono font-bold text-slate-200 truncate">{clip.name}</div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                          <span>{clip.sizeFormatted}</span>
                          <span>•</span>
                          <span>{new Date(clip.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleLoadSavedClip(clip, 'rollA')}
                          className="px-2 py-1 rounded bg-indigo-600/80 hover:bg-indigo-600 text-white font-bold text-[10px] transition-colors"
                        >
                          ロール A
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleLoadSavedClip(clip, 'rollB')}
                          className="px-2 py-1 rounded bg-violet-600/80 hover:bg-violet-600 text-white font-bold text-[10px] transition-colors"
                        >
                          ロール B
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
