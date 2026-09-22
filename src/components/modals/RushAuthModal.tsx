import React, { useState, useEffect } from 'react';
import {
  X,
  Lock,
  Users,
  Video,
  ShieldCheck,
  Key,
  PlusCircle,
  LogIn,
  UploadCloud,
  ListFilter,
  Radio,
  Clock,
  ShieldAlert,
  ArrowRight,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { usePaintStore } from '../../store/usePaintStore';
import { isAjiadoDomain } from '../../engine/firebase';
import {
  createRushRoomInDB,
  subscribeRushRooms,
  checkRoomNameExistsInDB,
  deleteRushRoomInDB,
  uploadRushVideoToStorage,
  verifyRushRoomAccess,
  clearLegacyRushCache,
  RushJoinError,
  RushRoomDoc,
  UploadedRushVideo,
} from '../../engine/rushService';
import { hasOperatorPrivilege, normalizeRoomId, readRoomIdFromSearch } from '../../engine/rushAccess';
import { describeRushError } from '../../engine/rushErrors';
import { generateThumbnailsFromFile } from '../../engine/rushThumbnails';

const MIN_PASSWORD_LENGTH = 4;

/** URL から ?room= を取り除く (参加し終えたあとに再び開かないように) */
function clearRoomParamFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('room')) return;
  url.searchParams.delete('room');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export const RushAuthModal: React.FC = () => {
  const isAuthModalOpen = usePaintStore((s) => s.isAuthModalOpen);
  const authModalMode = usePaintStore((s) => s.authModalMode);
  const closeRushAuthModal = usePaintStore((s) => s.closeRushAuthModal);
  const setRushRoom = usePaintStore((s) => s.setRushRoom);
  const openRushWindow = usePaintStore((s) => s.openRushWindow);
  const user = usePaintStore((s) => s.user);
  const loginWithGoogle = usePaintStore((s) => s.loginWithGoogle);

  const [mode, setMode] = useState<'list' | 'create' | 'join'>('list');
  const [roomName, setRoomName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [password, setPassword] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isJoining, setIsJoining] = useState(false);
  const [roomsError, setRoomsError] = useState('');

  // 削除モーダルの状態
  const [deletingRoom, setDeletingRoom] = useState<RushRoomDoc | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deletePassword, setDeletePassword] = useState('');

  // 作成済みルーム一覧データ
  const [rooms, setRooms] = useState<RushRoomDoc[]>([]);

  const isAjiadoUser = isAjiadoDomain(user?.email);

  // 旧版が localStorage に残した一覧の控え (合言葉が平文) を消す
  useEffect(() => {
    clearLegacyRushCache();
  }, []);

  useEffect(() => {
    if (authModalMode === 'create') setMode('create');
    else if (authModalMode === 'join') setMode('join');
    else setMode('list');
  }, [authModalMode, isAuthModalOpen]);

  // Firestore の作成済みルーム一覧を購読
  useEffect(() => {
    if (!isAuthModalOpen || !isAjiadoUser) return;
    setRoomsError('');
    const unsubscribe = subscribeRushRooms(
      (fetchedRooms) => {
        setRooms(fetchedRooms);
        setRoomsError('');
      },
      (error) => setRoomsError(`ルーム一覧を読み込めません: ${describeRushError(error)}`)
    );
    return () => unsubscribe();
  }, [isAuthModalOpen, isAjiadoUser]);

  // URLにroomパラメータがあれば自動補完
  useEffect(() => {
    if (typeof window !== 'undefined' && isAuthModalOpen) {
      const roomParam = readRoomIdFromSearch(window.location.search);
      if (roomParam) {
        setRoomIdInput(roomParam);
        setMode('join');
      }
    }
  }, [isAuthModalOpen]);

  if (!isAuthModalOpen) return null;

  // ホストの新規ルーム作成
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!isAjiadoUser) {
      setErrorMsg('@ajiado.co.jp ドメインのアカウントでログインしてください');
      return;
    }
    const trimmedName = roomName.trim();
    if (!trimmedName) {
      setErrorMsg('ルーム名を入力してください');
      return;
    }
    if (password.trim().length < MIN_PASSWORD_LENGTH) {
      setErrorMsg(`アクセスパスワードは ${MIN_PASSWORD_LENGTH} 文字以上で設定してください`);
      return;
    }

    setIsUploading(true);
    try {
      // 1. 同名ルームが存在しないか確認 (ローカル一覧 ＆ DB検索)
      const duplicateInState = rooms.some((r) => r.roomName.toLowerCase() === trimmedName.toLowerCase());
      if (duplicateInState || (await checkRoomNameExistsInDB(trimmedName))) {
        setErrorMsg(`すでに同名の配信ルーム「${trimmedName}」が存在します。別のルーム名を指定してください。`);
        return;
      }

      const newRoomId = `RUSH-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      let video: UploadedRushVideo | null = null;
      let thumbnails: string[] = [];

      if (selectedFile) {
        setUploadProgress(0);
        // サムネイルは手元のファイルから作る (クラウド上の動画からは CORS で作れない)
        const [uploaded, thumbs] = await Promise.all([
          uploadRushVideoToStorage(selectedFile, newRoomId, (pct) => setUploadProgress(pct)),
          generateThumbnailsFromFile(selectedFile),
        ]);
        video = uploaded;
        thumbnails = thumbs;
      }

      // Firestore にルーム情報を登録
      const accessKey = await createRushRoomInDB({
        roomId: newRoomId,
        roomName: trimmedName,
        hostEmail: user?.email || '',
        password: password.trim(),
        video,
        thumbnails,
      });

      setRushRoom({
        roomId: newRoomId,
        isHost: true,
        roomName: trimmedName,
        password: password.trim(),
        accessKey,
        videoUrl: null,
        videoName: video?.name ?? null,
        thumbnails,
        isLive: false,
      });

      openRushWindow();
      closeRushAuthModal();
      setPassword('');
      setRoomName('');
      setSelectedFile(null);
    } catch (err) {
      console.error('Failed to upload video / create room:', err);
      setErrorMsg(`動画のアップロードまたはルーム作成に失敗しました: ${describeRushError(err)}`);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // ルーム削除処理
  const handleConfirmDeleteRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deletingRoom || !deleteReason.trim() || !deletePassword.trim()) return;

    try {
      setIsDeleting(true);
      setDeleteError('');
      await deleteRushRoomInDB(deletingRoom, deletePassword.trim(), deleteReason.trim(), user?.email || '');
      setDeletingRoom(null);
      setDeleteReason('');
      setDeletePassword('');
    } catch (err) {
      console.error(err);
      setDeleteError(
        err instanceof RushJoinError ? err.message : `ルームの削除に失敗しました: ${describeRushError(err)}`
      );
    } finally {
      setIsDeleting(false);
    }
  };

  // 既存ルームへの参加 (ルーム ID と合言葉をクラウドで照合する)
  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!isAjiadoUser) {
      setErrorMsg('@ajiado.co.jp ドメインのアカウントでログインしてください');
      return;
    }
    if (!roomIdInput.trim()) {
      setErrorMsg('ルームIDを入力してください');
      return;
    }
    if (!password.trim()) {
      setErrorMsg('パスワードを入力してください');
      return;
    }

    setIsJoining(true);
    try {
      const { room, access, accessKey } = await verifyRushRoomAccess(roomIdInput, password.trim());

      // 作成者本人またはオペレーター権限保持者の場合はオペレーター専用画面で開く
      setRushRoom({
        roomId: room.id,
        isHost: hasOperatorPrivilege(room, user?.email),
        roomName: room.roomName,
        password: password.trim(),
        accessKey,
        // 動画の URL は入室後に Cloud Functions から受け取る (寿命 30 分の署名付き)
        videoUrl: null,
        videoName: access.videoName,
        thumbnails: access.thumbnails || [],
        isLive: !!room.isLive,
      });

      clearRoomParamFromUrl();
      openRushWindow();
      closeRushAuthModal();
      setPassword('');
    } catch (err) {
      console.error('Failed to join rush room:', err);
      setErrorMsg(
        err instanceof RushJoinError ? err.message : `参加できませんでした: ${describeRushError(err)}`
      );
    } finally {
      setIsJoining(false);
    }
  };

  // ルームカード選択
  const handleSelectRoomCard = (room: RushRoomDoc) => {
    setRoomIdInput(normalizeRoomId(room.id));
    setMode('join');
    setErrorMsg('');
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none">
      <div className="w-full max-w-lg bg-slate-900 border border-amber-500/30 rounded-xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[85vh]">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950/60">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-base">
            <Video className="w-5 h-5" />
            <span>ラッシュ専用セッション認証</span>
          </div>
          <button
            onClick={closeRushAuthModal}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* モード切替タブ */}
        <div className="flex border-b border-white/10 bg-slate-950/30">
          <button
            onClick={() => {
              setMode('list');
              setErrorMsg('');
            }}
            className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              mode === 'list'
                ? 'border-amber-400 text-amber-300 bg-amber-400/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ListFilter className="w-4 h-4" />
            <span>作成済みルーム ({rooms.length})</span>
          </button>
          <button
            onClick={() => {
              setMode('create');
              setErrorMsg('');
            }}
            className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              mode === 'create'
                ? 'border-amber-400 text-amber-300 bg-amber-400/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <PlusCircle className="w-4 h-4" />
            <span>新規配信を作成</span>
          </button>
          <button
            onClick={() => {
              setMode('join');
              setErrorMsg('');
            }}
            className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              mode === 'join'
                ? 'border-indigo-400 text-indigo-300 bg-indigo-400/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <LogIn className="w-4 h-4" />
            <span>ID指定で参加</span>
          </button>
        </div>

        {/* エラー表示 */}
        {errorMsg && (
          <div className="mx-5 mt-4 p-2.5 bg-red-950/60 border border-red-500/50 rounded-lg text-red-300 text-xs font-medium">
            {errorMsg}
          </div>
        )}

        {/* メインエリア (@ajiado.co.jp ドメイン判定) */}
        {!isAjiadoUser ? (
          <div className="p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">@ajiado.co.jp アカウントでのアクセス制限</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-sm mx-auto">
                作成済みラッシュルームの閲覧・参加・配信は、<strong>@ajiado.co.jp</strong> ドメインの組織Googleアカウントでログインしているユーザー限定です。
              </p>
            </div>
            <button
              onClick={() => loginWithGoogle()}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs transition-colors inline-flex items-center gap-2 shadow-lg shadow-amber-500/20"
            >
              <LogIn className="w-4 h-4" />
              <span>Googleでログイン (@ajiado.co.jp)</span>
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {mode === 'list' && (
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400 font-bold border-b border-white/5 pb-2">
                  <span>稼働中・作成済みのラッシュルーム</span>
                  <span className="text-[10px] text-emerald-400 font-mono">@ajiado.co.jp 認証済み</span>
                </div>

                {roomsError && (
                  <div className="p-2.5 bg-red-950/60 border border-red-500/50 rounded-lg text-red-300 text-xs font-medium">
                    {roomsError}
                  </div>
                )}

                {rooms.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 space-y-2">
                    <Video className="w-8 h-8 mx-auto opacity-30" />
                    <p className="text-xs">現在作成されているラッシュルームはありません</p>
                    <button
                      onClick={() => setMode('create')}
                      className="text-xs text-amber-400 hover:underline font-bold"
                    >
                      ＋ 新しい配信ルームを作成する
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {rooms.map((room) => (
                      <div
                        key={room.id}
                        onClick={() => handleSelectRoomCard(room)}
                        className="p-3.5 rounded-xl bg-slate-950/70 hover:bg-slate-950 border border-white/10 hover:border-amber-400/60 transition-all cursor-pointer group shadow-lg flex items-center justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {room.isLive && (
                              <span className="flex items-center gap-1 px-1.5 py-0.2 rounded bg-red-600 text-white font-bold text-[9px] animate-pulse">
                                <Radio className="w-2.5 h-2.5" /> LIVE
                              </span>
                            )}
                            <h4 className="font-bold text-xs text-slate-100 group-hover:text-amber-300 transition-colors truncate">
                              {room.roomName}
                            </h4>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-slate-400 font-mono">
                            <span>ID: {room.id}</span>
                            <span>ホスト: {room.hostEmail}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[10px] text-slate-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(room.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleSelectRoomCard(room)}
                            className="px-3 py-1 bg-amber-500/20 group-hover:bg-amber-500 text-amber-300 group-hover:text-slate-950 font-bold rounded text-xs transition-all flex items-center gap-1"
                          >
                            <span>参加</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                          {/* 削除できるのは作成者とオペレーターだけ (Firestore の規則でも強制) */}
                          {hasOperatorPrivilege(room, user?.email) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeletingRoom(room);
                                setDeleteReason('');
                                setDeletePassword('');
                                setDeleteError('');
                              }}
                              title="このルームを削除"
                              className="p-1.5 rounded bg-red-950/60 hover:bg-red-900 border border-red-500/30 text-red-300 hover:text-white transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {mode === 'create' && (
              <form onSubmit={handleCreateRoom} className="p-5 space-y-4 text-xs">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">ラッシュセッション名</label>
                  <input
                    type="text"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder="例: 第03話 C-012〜045 ラッシュチェック"
                    className="w-full bg-slate-950 border border-white/15 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">保護用パスワード</label>
                  <div className="relative">
                    <Key className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={`参加に必要なパスワード (${MIN_PASSWORD_LENGTH} 文字以上)`}
                      className="w-full bg-slate-950 border border-white/15 rounded-lg pl-9 pr-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">再生映像ファイル (クラウドストリーミング用)</label>
                  <div className="relative border-2 border-dashed border-white/20 rounded-lg p-4 bg-slate-950/40 text-center hover:border-amber-400/50 transition-colors cursor-pointer">
                    <input
                      type="file"
                      accept="video/*,.mp4,.mov,.webm"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <UploadCloud className="w-6 h-6 mx-auto mb-1 text-amber-400" />
                    {selectedFile ? (
                      <p className="text-amber-300 font-bold text-xs truncate">{selectedFile.name}</p>
                    ) : (
                      <div>
                        <p className="text-slate-300 font-medium">映像ファイルを選択またはドラッグ＆ドロップ</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">MP4, MOV, WebM 等</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* アップロード進捗表示 */}
                {isUploading && selectedFile && (
                  <div className="p-3 bg-slate-950 border border-amber-500/30 rounded-lg space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-amber-300">
                      <span>クラウドサーバーへ映像をアップロード中...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-amber-400 h-full rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isUploading}
                    className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 font-bold rounded-lg transition-colors flex items-center justify-center gap-2 text-sm shadow-lg shadow-amber-500/20"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>
                      {isUploading
                        ? selectedFile
                          ? `アップロード中 (${uploadProgress}%)`
                          : '作成中...'
                        : '配信ルームを作成して開始'}
                    </span>
                  </button>
                </div>
              </form>
            )}

            {mode === 'join' && (
              <form onSubmit={handleJoinRoom} className="p-5 space-y-4 text-xs">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">ラッシュ ルームID</label>
                  <input
                    type="text"
                    value={roomIdInput}
                    onChange={(e) => setRoomIdInput(e.target.value)}
                    placeholder="例: RUSH-A1B2C3"
                    className="w-full bg-slate-950 border border-white/15 rounded-lg px-3 py-2 text-slate-100 font-mono placeholder-slate-500 focus:outline-none focus:border-indigo-400 uppercase"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">アクセスパスワード</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="ホストから共有されたパスワード"
                      className="w-full bg-slate-950 border border-white/15 rounded-lg pl-9 pr-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-400"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isJoining}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2 text-sm shadow-lg shadow-indigo-600/20"
                  >
                    <Users className="w-4 h-4" />
                    <span>{isJoining ? '確認中...' : '配信セッションに参加'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {/* 削除確認モーダル (誤爆防止・理由入力必須) */}
      {deletingRoom && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-red-500/40 rounded-xl shadow-2xl p-5 space-y-4 text-slate-100">
            <div className="flex items-center gap-2 text-red-400 font-bold text-base border-b border-white/10 pb-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span>ラッシュルームの削除確認</span>
            </div>

            <div className="space-y-1 text-xs">
              <p className="text-slate-300">
                以下のルームを削除します。誤操作防止のため、<strong className="text-red-300">削除理由</strong>を入力してください。
              </p>
              <div className="p-2.5 rounded bg-slate-950 border border-white/10 font-bold text-amber-300">
                {deletingRoom.roomName} <span className="font-mono text-[10px] text-slate-400">({deletingRoom.id})</span>
              </div>
            </div>

            <form onSubmit={handleConfirmDeleteRoom} className="space-y-3">
              <div>
                <label className="block text-slate-300 font-bold text-xs mb-1">
                  削除理由 <span className="text-red-400">* 必須</span>
                </label>
                <textarea
                  rows={3}
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="例: ラッシュチェック完了のため / 誤って作成したため"
                  className="w-full bg-slate-950 border border-white/20 rounded-lg p-2.5 text-slate-100 text-xs focus:outline-none focus:border-red-400 resize-none leading-normal"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold text-xs mb-1">
                  このルームのパスワード <span className="text-red-400">* 必須</span>
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="動画とリテイク指示もあわせて削除します"
                  className="w-full bg-slate-950 border border-white/20 rounded-lg px-2.5 py-2 text-slate-100 text-xs focus:outline-none focus:border-red-400"
                />
              </div>

              {deleteError && (
                <div className="p-2 bg-red-950/60 border border-red-500/50 rounded-lg text-red-300 text-xs font-medium">
                  {deleteError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setDeletingRoom(null)}
                  className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-slate-300 text-xs transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={!deleteReason.trim() || !deletePassword.trim() || isDeleting}
                  className="px-4 py-1.5 rounded bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:hover:bg-red-600 text-white font-bold text-xs transition-colors flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isDeleting ? '削除中...' : '削除を確定する'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
