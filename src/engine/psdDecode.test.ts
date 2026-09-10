import { describe, it, expect } from 'vitest';
import { isPsdFile } from './imageDecode';
import { isSupportedImageFile } from './fileSystemPath';

describe('PSD ファイル判定', () => {
  it('psd 拡張子を正常に識別できる', () => {
    expect(isPsdFile('sample.psd')).toBe(true);
    expect(isPsdFile('SAMPLE.PSD')).toBe(true);
    expect(isPsdFile('sample.tga')).toBe(false);
    expect(isPsdFile('sample.png')).toBe(false);
  });

  it('サポート対象画像に psd が含まれる', () => {
    expect(isSupportedImageFile('sample.psd')).toBe(true);
    expect(isSupportedImageFile('A0001.PSD')).toBe(true);
  });
});
