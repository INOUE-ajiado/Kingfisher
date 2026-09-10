import { describe, it, expect } from 'vitest';
import { isPdfFile } from './imageDecode';
import { isSupportedImageFile } from './fileSystemPath';
import { decodePdfBuffer } from './pdfDecode';

describe('PDF 画像サポートの検証', () => {
  it('isPdfFile が .pdf 拡張子を正常に識別すること', () => {
    expect(isPdfFile('timesheet.pdf')).toBe(true);
    expect(isPdfFile('DOCUMENT.PDF')).toBe(true);
    expect(isPdfFile('sample.png')).toBe(false);
    expect(isPdfFile('sample.tga')).toBe(false);
  });

  it('isSupportedImageFile が .pdf ファイルをサポート対象として返すこと', () => {
    expect(isSupportedImageFile('timesheet.pdf')).toBe(true);
    expect(isSupportedImageFile('Cut001_layout.PDF')).toBe(true);
  });

  it('decodePdfBuffer が例外を出さずにフォールバック TGAImage を返すこと', async () => {
    const dummyBuffer = new ArrayBuffer(8);
    const result = await decodePdfBuffer(dummyBuffer);

    expect(result).toBeDefined();
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.isReadOnly).toBe(true);
  });
});
