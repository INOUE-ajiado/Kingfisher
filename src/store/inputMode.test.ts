import { describe, it, expect, beforeEach } from 'vitest';
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
});
