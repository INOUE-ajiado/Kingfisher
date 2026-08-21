import { floodFill, closedAreaFill, FillOptions } from './paintAlgorithm';

function testFloodFill() {
  const width = 10;
  const height = 10;
  const pixelData = new Uint8ClampedArray(width * height * 4);

  // Draw black line border around (2,2) to (7,7)
  for (let x = 2; x <= 7; x++) {
    const idx1 = (2 * width + x) * 4;
    const idx2 = (7 * width + x) * 4;
    pixelData[idx1] = pixelData[idx1 + 1] = pixelData[idx1 + 2] = 0; pixelData[idx1 + 3] = 255;
    pixelData[idx2] = pixelData[idx2 + 1] = pixelData[idx2 + 2] = 0; pixelData[idx2 + 3] = 255;
  }

  const options: FillOptions = {
    gapCloseLevel: 0,
    enableIncludeTrace: false,
    traceColors: { red: false, blue: false, green: false },
    tolerance: 0,
    brushSize: 5,
    expandContract: 0,
    contiguous: true,
    sampleSize: '1x1',
    referenceLayer: 'current',
  };

  floodFill(pixelData, width, height, 4, 4, { r: 255, g: 255, b: 0, a: 255 }, options);

  const polygon = [{ x: 1, y: 1 }, { x: 8, y: 1 }, { x: 8, y: 8 }, { x: 1, y: 8 }];
  closedAreaFill(pixelData, width, height, polygon, { r: 0, g: 255, b: 0, a: 255 }, options);
}

testFloodFill();
