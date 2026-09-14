import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import fs from 'fs';
import path from 'path';

async function testEncoders() {
  const ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => {
    if (message.includes('V.....') || message.includes('encoders:')) {
      console.log(message);
    }
  });

  const corePath = path.resolve('public/ffmpeg/ffmpeg-core.js');
  const wasmPath = path.resolve('public/ffmpeg/ffmpeg-core.wasm');

  const coreBuf = fs.readFileSync(corePath);
  const wasmBuf = fs.readFileSync(wasmPath);

  const coreBlob = new Blob([coreBuf], { type: 'text/javascript' });
  const wasmBlob = new Blob([wasmBuf], { type: 'application/wasm' });

  const coreURL = URL.createObjectURL(coreBlob);
  const wasmURL = URL.createObjectURL(wasmBlob);

  await ffmpeg.load({ coreURL, wasmURL });
  await ffmpeg.exec(['-encoders']);
}

testEncoders().catch(console.error);
