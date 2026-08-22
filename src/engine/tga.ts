/**
 * TGA (Targa) Image Decoder and Encoder for Kingfisher
 * Supports 24-bit RGB and 32-bit RGBA uncompressed TGA formats.
 */

export interface TGAImage {
  width: number;
  height: number;
  pixelDepth: number; // 24 or 32
  data: Uint8ClampedArray; // RGBA byte array (width * height * 4)
  isReadOnly?: boolean;
}

export function decodeTGA(buffer: ArrayBuffer): TGAImage {
  const view = new DataView(buffer);
  const idLength = view.getUint8(0);
  const colorMapType = view.getUint8(1);
  const imageType = view.getUint8(2);

  if (colorMapType !== 0) {
    throw new Error('Color mapped TGA files are not supported.');
  }

  // Type 2: Uncompressed True-Color, Type 10: RLE True-Color
  if (imageType !== 2 && imageType !== 10) {
    throw new Error(`Unsupported TGA image type: ${imageType}`);
  }

  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const pixelDepth = view.getUint8(16);
  const descriptor = view.getUint8(17);

  if (pixelDepth !== 24 && pixelDepth !== 32) {
    throw new Error(`Unsupported pixel depth: ${pixelDepth}. Expected 24 or 32.`);
  }

  const isTopDown = (descriptor & 0x20) !== 0;
  const bytesPerPixel = pixelDepth / 8;
  const offset = 18 + idLength;

  const rgbaData = new Uint8ClampedArray(width * height * 4);
  const rawBytes = new Uint8Array(buffer, offset);

  if (imageType === 2) {
    // Uncompressed
    let rawIndex = 0;
    for (let y = 0; y < height; y++) {
      const targetY = isTopDown ? y : height - 1 - y;
      const rowOffset = targetY * width * 4;

      for (let x = 0; x < width; x++) {
        const b = rawBytes[rawIndex];
        const g = rawBytes[rawIndex + 1];
        const r = rawBytes[rawIndex + 2];
        const a = bytesPerPixel === 4 ? rawBytes[rawIndex + 3] : 255;
        rawIndex += bytesPerPixel;

        const idx = rowOffset + x * 4;
        rgbaData[idx] = r;
        rgbaData[idx + 1] = g;
        rgbaData[idx + 2] = b;
        // Pure white (255, 255, 255) is treated as transparent alpha 0 per Kingfisher spec
        if (r === 255 && g === 255 && b === 255) {
          rgbaData[idx + 3] = 0;
        } else {
          rgbaData[idx + 3] = a;
        }
      }
    }
  } else if (imageType === 10) {
    // RLE compressed TGA
    let rawIndex = 0;
    let pixelCount = 0;
    const totalPixels = width * height;
    const tempPixelBuf = new Uint8ClampedArray(totalPixels * 4);

    while (pixelCount < totalPixels && rawIndex < rawBytes.length) {
      const chunkHeader = rawBytes[rawIndex++];
      const count = (chunkHeader & 0x7f) + 1;

      if ((chunkHeader & 0x80) !== 0) {
        // RLE packet
        const b = rawBytes[rawIndex++];
        const g = rawBytes[rawIndex++];
        const r = rawBytes[rawIndex++];
        const a = bytesPerPixel === 4 ? rawBytes[rawIndex++] : 255;

        for (let i = 0; i < count; i++) {
          const pIdx = (pixelCount + i) * 4;
          tempPixelBuf[pIdx] = r;
          tempPixelBuf[pIdx + 1] = g;
          tempPixelBuf[pIdx + 2] = b;
          tempPixelBuf[pIdx + 3] = (r === 255 && g === 255 && b === 255) ? 0 : a;
        }
      } else {
        // Raw packet
        for (let i = 0; i < count; i++) {
          const b = rawBytes[rawIndex++];
          const g = rawBytes[rawIndex++];
          const r = rawBytes[rawIndex++];
          const a = bytesPerPixel === 4 ? rawBytes[rawIndex++] : 255;
          const pIdx = (pixelCount + i) * 4;
          tempPixelBuf[pIdx] = r;
          tempPixelBuf[pIdx + 1] = g;
          tempPixelBuf[pIdx + 2] = b;
          tempPixelBuf[pIdx + 3] = (r === 255 && g === 255 && b === 255) ? 0 : a;
        }
      }
      pixelCount += count;
    }

    // Orient top-down or bottom-up
    for (let y = 0; y < height; y++) {
      const targetY = isTopDown ? y : height - 1 - y;
      const srcRow = y * width * 4;
      const dstRow = targetY * width * 4;
      rgbaData.set(tempPixelBuf.subarray(srcRow, srcRow + width * 4), dstRow);
    }
  }

  return { width, height, pixelDepth, data: rgbaData };
}

export function encodeTGA(image: TGAImage): ArrayBuffer {
  const { width, height, data } = image;
  const headerSize = 18;
  const pixelBytes = width * height * 4; // Output 32-bit BGRA
  const buffer = new ArrayBuffer(headerSize + pixelBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // TGA Header (Uncompressed 32-bit True-Color, Top-Left)
  view.setUint8(0, 0); // ID length
  view.setUint8(1, 0); // Color map type
  view.setUint8(2, 2); // Image type: Uncompressed True-Color
  view.setUint16(12, width, true);
  view.setUint16(14, height, true);
  view.setUint8(16, 32); // 32 bits per pixel
  view.setUint8(17, 0x20); // Top-left origin descriptor

  let dstOffset = headerSize;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    // BGRA format for TGA
    bytes[dstOffset] = b;
    bytes[dstOffset + 1] = g;
    bytes[dstOffset + 2] = r;
    // If fully transparent alpha 0, write back as pure white RGB
    bytes[dstOffset + 3] = a === 0 ? 255 : a;
    dstOffset += 4;
  }

  return buffer;
}
