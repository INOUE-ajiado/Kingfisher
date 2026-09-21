import { StateCreator } from 'zustand';
import { RetakeItem } from '../../engine/retakeStore';
import { PaintStore } from '../types';

export interface RushState {
  isRushOpen: boolean;
  roomId: string | null;
  isHost: boolean;
  roomName: string;
  /**
   * 参加に使った合言葉 (招待文のコピー用)。メモリにだけ持ち、どこにも保存しない。
   *
   * ⚠️ 以前はここを isAuthenticated / passwordHash と名付けていた。isAuthenticated は
   * AuthSlice (Google ログイン) と同じ名前で上書きし合い、退室するとログイン画面が
   * 全面を塞いでいた。スライスをまたいで同じ名前を使わないこと。
   */
  roomPassword: string;
  /** access 文書の鍵 (ルーム ID + 合言葉のハッシュ)。動画とリテイクの在りか */
  rushAccessKey: string | null;
  videoUrl: string | null;
  videoName: string | null;
  rushThumbnails: string[];
  isUploading: boolean;
  uploadProgress: number;
  isLive: boolean;
  isSpeakerMuted: boolean;
  retakeItems: RetakeItem[];
  isAuthModalOpen: boolean;
  authModalMode: 'create' | 'join';
}

export interface RushActions {
  openRushWindow: () => void;
  closeRushWindow: () => void;
  setRushRoom: (data: {
    roomId: string;
    isHost: boolean;
    roomName: string;
    password: string;
    accessKey: string;
    videoUrl: string | null;
    videoName: string | null;
    thumbnails: string[];
    isLive: boolean;
  }) => void;
  leaveRushRoom: () => void;
  setRushVideo: (url: string | null, name: string | null, thumbnails?: string[]) => void;
  setRushUploading: (uploading: boolean, progress?: number) => void;
  setRushLive: (isLive: boolean) => void;
  setRushSpeakerMuted: (muted: boolean) => void;
  updateRushRetakes: (items: RetakeItem[]) => void;
  openRushAuthModal: (mode: 'create' | 'join') => void;
  closeRushAuthModal: () => void;
}

export type RushSlice = RushState & RushActions;

export const initialRushState: RushState = {
  isRushOpen: false,
  roomId: null,
  isHost: false,
  roomName: '',
  roomPassword: '',
  rushAccessKey: null,
  videoUrl: null,
  videoName: null,
  rushThumbnails: [],
  isUploading: false,
  uploadProgress: 0,
  isLive: false,
  isSpeakerMuted: false,
  retakeItems: [],
  isAuthModalOpen: false,
  authModalMode: 'create',
};

export const createRushSlice: StateCreator<PaintStore, [], [], RushSlice> = (set) => ({
  ...initialRushState,

  openRushWindow: () =>
    set((state) => ({
      ...state,
      isRushOpen: true,
      paneLayout: { ...state.paneLayout, maximized: 'rush' },
    })),
  closeRushWindow: () =>
    set((state) => ({
      ...state,
      isRushOpen: false,
      paneLayout: {
        ...state.paneLayout,
        maximized: state.paneLayout.maximized === 'rush' ? null : state.paneLayout.maximized,
      },
    })),

  /** ルームに入る。前のルームの動画とリテイクは引き継がない */
  setRushRoom: (data) =>
    set((state) => ({
      ...initialRushState,
      isAuthModalOpen: state.isAuthModalOpen,
      authModalMode: state.authModalMode,
      isSpeakerMuted: state.isSpeakerMuted,
      isRushOpen: true,
      roomId: data.roomId,
      isHost: data.isHost,
      roomName: data.roomName,
      roomPassword: data.password,
      rushAccessKey: data.accessKey,
      videoUrl: data.videoUrl,
      videoName: data.videoName,
      rushThumbnails: data.thumbnails,
      isLive: data.isLive,
      paneLayout: { ...state.paneLayout, maximized: 'rush' },
    })),

  leaveRushRoom: () =>
    set((state) => ({
      ...initialRushState,
      paneLayout: {
        ...state.paneLayout,
        maximized: state.paneLayout.maximized === 'rush' ? null : state.paneLayout.maximized,
      },
    })),

  setRushVideo: (url, name, thumbnails) =>
    set((state) => ({
      videoUrl: url,
      videoName: name,
      rushThumbnails: thumbnails ?? state.rushThumbnails,
    })),

  setRushUploading: (uploading, progress = 0) =>
    set((state) => ({ ...state, isUploading: uploading, uploadProgress: progress })),

  setRushLive: (isLive) => set((state) => ({ ...state, isLive })),

  setRushSpeakerMuted: (muted) => set((state) => ({ ...state, isSpeakerMuted: muted })),

  updateRushRetakes: (items) => set((state) => ({ ...state, retakeItems: items })),

  openRushAuthModal: (mode) =>
    set((state) => ({ ...state, isAuthModalOpen: true, authModalMode: mode })),

  closeRushAuthModal: () => set((state) => ({ ...state, isAuthModalOpen: false })),
});
