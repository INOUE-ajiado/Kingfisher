import { StateCreator } from 'zustand';
import { RetakeItem } from '../../engine/retakeStore';
import { PaintStore } from '../types';

export interface RushParticipant {
  id: string;
  name: string;
  isHost: boolean;
  isMuted: boolean;
  joinedAt: number;
}

export interface RushArchiveItem {
  id: string;
  title: string;
  videoUrl: string;
  duration: number;
  createdAt: number;
  retakeItems: RetakeItem[];
}

export interface RushState {
  isRushOpen: boolean;
  roomId: string | null;
  isHost: boolean;
  isAuthenticated: boolean;
  roomName: string;
  passwordHash: string;
  videoUrl: string | null;
  videoName: string | null;
  isUploading: boolean;
  uploadProgress: number;
  isLive: boolean;
  isRecording: boolean;
  recordingStartTime: number | null;
  isMicMuted: boolean;
  isSpeakerMuted: boolean;
  participants: RushParticipant[];
  retakeItems: RetakeItem[];
  archives: RushArchiveItem[];
  isAuthModalOpen: boolean;
  authModalMode: 'create' | 'join';
}

export interface RushActions {
  openRushWindow: () => void;
  closeRushWindow: () => void;
  setRushRoom: (data: { roomId: string; isHost: boolean; roomName: string; videoUrl?: string; videoName?: string; passwordHash?: string }) => void;
  leaveRushRoom: () => void;
  setRushAuth: (authenticated: boolean) => void;
  setRushVideo: (url: string | null, name: string | null) => void;
  setRushUploading: (uploading: boolean, progress?: number) => void;
  setRushLive: (isLive: boolean) => void;
  setRushRecording: (isRecording: boolean) => void;
  setRushMicMuted: (muted: boolean) => void;
  setRushSpeakerMuted: (muted: boolean) => void;
  updateRushParticipants: (participants: RushParticipant[]) => void;
  updateRushRetakes: (items: RetakeItem[]) => void;
  addRushArchive: (archive: RushArchiveItem) => void;
  openRushAuthModal: (mode: 'create' | 'join') => void;
  closeRushAuthModal: () => void;
}

export type RushSlice = RushState & RushActions;

export const initialRushState: RushState = {
  isRushOpen: false,
  roomId: null,
  isHost: false,
  isAuthenticated: false,
  roomName: '',
  passwordHash: '',
  videoUrl: null,
  videoName: null,
  isUploading: false,
  uploadProgress: 0,
  isLive: false,
  isRecording: false,
  recordingStartTime: null,
  isMicMuted: false,
  isSpeakerMuted: false,
  participants: [],
  retakeItems: [],
  archives: [],
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

  setRushRoom: (data) =>
    set((state) => ({
      ...state,
      isRushOpen: true,
      roomId: data.roomId,
      isHost: data.isHost,
      roomName: data.roomName,
      videoUrl: data.videoUrl ?? state.videoUrl,
      videoName: data.videoName ?? state.videoName,
      passwordHash: data.passwordHash ?? state.passwordHash,
      isAuthenticated: true,
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

  setRushAuth: (authenticated) => set((state) => ({ ...state, isAuthenticated: authenticated })),

  setRushVideo: (url, name) => set((state) => ({ ...state, videoUrl: url, videoName: name })),

  setRushUploading: (uploading, progress = 0) =>
    set((state) => ({ ...state, isUploading: uploading, uploadProgress: progress })),

  setRushLive: (isLive) => set((state) => ({ ...state, isLive })),

  setRushRecording: (isRecording) =>
    set((state) => ({
      ...state,
      isRecording,
      recordingStartTime: isRecording ? Date.now() : null,
    })),

  setRushMicMuted: (muted) => set((state) => ({ ...state, isMicMuted: muted })),

  setRushSpeakerMuted: (muted) => set((state) => ({ ...state, isSpeakerMuted: muted })),

  updateRushParticipants: (participants) => set((state) => ({ ...state, participants })),

  updateRushRetakes: (items) => set((state) => ({ ...state, retakeItems: items })),

  addRushArchive: (archive) =>
    set((state) => ({ ...state, archives: [archive, ...state.archives] })),

  openRushAuthModal: (mode) =>
    set((state) => ({ ...state, isAuthModalOpen: true, authModalMode: mode })),

  closeRushAuthModal: () => set((state) => ({ ...state, isAuthModalOpen: false })),
});
