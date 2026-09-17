import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePaintStore } from './usePaintStore';

describe('inputMode slice', () => {
  beforeEach(() => {
    usePaintStore.setState({ inputMode: 'mouse' });
  });

  it('defaults to mouse input mode', () => {
    const state = usePaintStore.getState();
    expect(state.inputMode).toBe('mouse');
  });

  it('updates input mode to trackpad and back to mouse', () => {
    const { setInputMode } = usePaintStore.getState();

    setInputMode('trackpad');
    expect(usePaintStore.getState().inputMode).toBe('trackpad');

    setInputMode('mouse');
    expect(usePaintStore.getState().inputMode).toBe('mouse');
  });

  describe('with localStorage', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('remembers the chosen mode in localStorage', () => {
      const store = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      });
      const { setInputMode } = usePaintStore.getState();

      setInputMode('trackpad');
      expect(localStorage.getItem('kingfisher_input_mode')).toBe('trackpad');

      setInputMode('mouse');
      expect(localStorage.getItem('kingfisher_input_mode')).toBe('mouse');
    });
  });
});
