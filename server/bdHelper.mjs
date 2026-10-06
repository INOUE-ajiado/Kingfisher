/**
 * Kingfisher BD Helper Server
 *
 * 外付けUSB Blu-rayドライブおよびマウントされたディスクから
 * 映像ストリームを検出し、指定区間の切り出し (ffmpeg) と配信を行うローカル常駐サーバー。
 *
 * 外部依存なし (Node.js 標準ライブラリのみ) で動作します。
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CLIPS_DIR = path.resolve(PROJECT_ROOT, 'scratch', 'bd_clips');

const PORT = 3001;

// clips ディレクトリの準備
if (!fs.existsSync(CLIPS_DIR)) {
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
}

/** ffmpeg の実行可能パスを探す */
function findBinary(name) {
  const candidates = [
    name,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  for (const bin of candidates) {
    try {
      execSync(`"${bin}" -version`, { stdio: 'ignore' });
      return bin;
    } catch {
      // 次の候補へ
    }
  }
  return null;
}

function getFfmpegPath() {
  return findBinary('ffmpeg');
}

function getFfprobePath() {
  return findBinary('ffprobe');
}

/** ファイルサイズを読みやすい形式に変換 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * macOS の /Volumes を走査して、接続されたディスクと動画ストリームを検出する
 */
function scanDiscs() {
  const volumesDir = '/Volumes';
  const discs = [];

  if (!fs.existsSync(volumesDir)) {
    return discs;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(volumesDir);
  } catch (err) {
    console.error('Failed to read /Volumes:', err);
    return discs;
  }

  for (const entry of entries) {
    // システムの内部ボリューム等はスキップ
    if (entry.startsWith('.') || entry === 'Macintosh HD' || entry === 'Recovery') {
      continue;
    }

    const volPath = path.join(volumesDir, entry);
    let stat;
    try {
      stat = fs.statSync(volPath);
    } catch {
      continue;
    }

    if (!stat.isDirectory()) continue;

    const bdmvPath = path.join(volPath, 'BDMV');
    const isBdmv = fs.existsSync(bdmvPath);
    const aacsPath = path.join(volPath, 'AACS');
    const hasAacs = fs.existsSync(aacsPath);
    const streams = [];

    if (isBdmv) {
      const streamDir = path.join(bdmvPath, 'STREAM');
      if (fs.existsSync(streamDir)) {
        try {
          const files = fs.readdirSync(streamDir);
          for (const file of files) {
            if (/\.(m2ts|ts)$/i.test(file)) {
              const fullPath = path.join(streamDir, file);
              const fileStat = fs.statSync(fullPath);
              streams.push({
                name: file,
                path: fullPath,
                size: fileStat.size,
                sizeFormatted: formatFileSize(fileStat.size),
              });
            }
          }
        } catch (e) {
          console.error(`Error reading stream dir in ${entry}:`, e);
        }
      }
    } else {
      // 通常の動画フォルダや非BDMVディスクの動画ファイルも再帰検索 (深さ2まで)
      const findVideos = (dir, depth = 0) => {
        if (depth > 2) return;
        try {
          const subFiles = fs.readdirSync(dir);
          for (const f of subFiles) {
            if (f.startsWith('.')) continue;
            const full = path.join(dir, f);
            const s = fs.statSync(full);
            if (s.isDirectory()) {
              findVideos(full, depth + 1);
            } else if (/\.(m2ts|ts|mp4|mov|mkv|m4v)$/i.test(f)) {
              streams.push({
                name: f,
                path: full,
                size: s.size,
                sizeFormatted: formatFileSize(s.size),
              });
            }
          }
        } catch {}
      };
      findVideos(volPath);
    }

    // ファイルサイズの降順（本編ファイルが先頭に来るように）でソート
    streams.sort((a, b) => b.size - a.size);

    discs.push({
      name: entry,
      path: volPath,
      isBdmv,
      hasAacs,
      streamCount: streams.length,
      streams,
    });
  }

  return discs;
}

/** CORS ヘッダーの付与 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
}

/** JSON レスポンス送信 */
function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** クリップ動画ファイルのストリーミング配信 (Range対応) */
function serveClipFile(req, res, clipFileName) {
  // パストラバーサル防止
  const safeName = path.basename(clipFileName);
  const filePath = path.join(CLIPS_DIR, safeName);

  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: 'Clip file not found' });
    return;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  setCorsHeaders(res);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'video/mp4');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      return res.end();
    }

    const chunksize = end - start + 1;
    const fileStream = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunksize,
    });
    fileStream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

/**
 * HTTP サーバーの作成
 */
const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // 1. ヘルスチェック & ステータス
  if (req.method === 'GET' && pathname === '/api/status') {
    const ffmpegPath = getFfmpegPath();
    const ffprobePath = getFfprobePath();
    const discs = scanDiscs();

    sendJson(res, 200, {
      ok: true,
      service: 'Kingfisher BD Helper',
      version: '1.0.0',
      ffmpeg: {
        installed: !!ffmpegPath,
        path: ffmpegPath,
      },
      ffprobe: {
        installed: !!ffprobePath,
        path: ffprobePath,
      },
      discCount: discs.length,
      discs: discs.map((d) => ({
        name: d.name,
        path: d.path,
        isBdmv: d.isBdmv,
        streamCount: d.streamCount,
      })),
    });
    return;
  }

  // 2. ディスク一覧 & ストリーム詳細
  if (req.method === 'GET' && pathname === '/api/discs') {
    const discs = scanDiscs();
    sendJson(res, 200, { discs });
    return;
  }

  // 3. 切り出し済みクリップ一覧
  if (req.method === 'GET' && pathname === '/api/clips') {
    try {
      const files = fs.readdirSync(CLIPS_DIR);
      const clips = files
        .filter((f) => /\.(mp4|mov)$/i.test(f))
        .map((f) => {
          const full = path.join(CLIPS_DIR, f);
          const s = fs.statSync(full);
          return {
            name: f,
            url: `/api/clips/${encodeURIComponent(f)}`,
            size: s.size,
            sizeFormatted: formatFileSize(s.size),
            createdAt: s.mtime,
          };
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      sendJson(res, 200, { clips });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 4. クリップ動画のストリーミング配信 (/api/clips/:filename)
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/api/clips/')) {
    const filename = decodeURIComponent(pathname.replace('/api/clips/', ''));
    serveClipFile(req, res, filename);
    return;
  }

  // 5. 切り出し実行 (POST /api/clip)
  if (req.method === 'POST' && pathname === '/api/clip') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { sourcePath, startTime, duration, title, rollId } = payload;

        if (!sourcePath || !fs.existsSync(sourcePath)) {
          sendJson(res, 400, { error: 'Source file does not exist', sourcePath });
          return;
        }

        const ffmpeg = getFfmpegPath();
        if (!ffmpeg) {
          sendJson(res, 500, {
            error: 'ffmpeg が見つかりません。Macに Homebrew で ffmpeg をインストールしてください (brew install ffmpeg)',
          });
          return;
        }

        const startSec = String(startTime || '00:00:00');
        const durSec = String(duration || '30'); // デフォルト30秒

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const cleanTitle = (title || 'bd_clip').replace(/[^a-zA-Z0-9_\-]/g, '_');
        const outputFileName = `${cleanTitle}_${timestamp}.mp4`;
        const outputPath = path.join(CLIPS_DIR, outputFileName);

        console.log(`[BD Helper] Clipping started:`);
        console.log(`  Source: ${sourcePath}`);
        console.log(`  Start: ${startSec}, Duration: ${durSec}s`);
        console.log(`  Output: ${outputPath}`);

        // ffmpeg 引数の組み立て:
        // -ss を入力の前に置くことで超高速シーク
        // H.264 / AAC / faststart (Web再生用最適化)
        const args = [
          '-y',
          '-ss', startSec,
          '-i', sourcePath,
          '-t', durSec,
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '19',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-movflags', '+faststart',
          outputPath,
        ];

        const proc = spawn(ffmpeg, args);
        let errorOutput = '';

        proc.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        proc.on('close', (code) => {
          if (code === 0 && fs.existsSync(outputPath)) {
            const stat = fs.statSync(outputPath);
            console.log(`[BD Helper] Clipping complete: ${outputFileName} (${formatFileSize(stat.size)})`);
            sendJson(res, 200, {
              success: true,
              clipName: outputFileName,
              clipUrl: `http://localhost:${PORT}/api/clips/${encodeURIComponent(outputFileName)}`,
              size: stat.size,
              sizeFormatted: formatFileSize(stat.size),
              rollId: rollId || 'rollA',
            });
          } else {
            console.error(`[BD Helper] ffmpeg failed with code ${code}:\n${errorOutput}`);
            let errorMsg = `ffmpeg execution failed (code ${code})`;
            if (errorOutput.includes('Invalid data found when processing input')) {
              errorMsg = 'このBlu-rayは市販パッケージのためAACS暗号化されています。生ファイルからの直接切り出しはできません。制作スタジオで作成されたBD-R（非暗号化盤）をご使用ください。';
            }
            sendJson(res, 500, {
              error: errorMsg,
              details: errorOutput.slice(-500),
            });
          }
        });
      } catch (err) {
        sendJson(res, 400, { error: 'Invalid JSON request payload', details: err.message });
      }
    });
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`====================================================`);
  console.log(` 💿 Kingfisher BD Helper Server running!`);
  console.log(`    URL: http://127.0.0.1:${PORT}`);
  console.log(`    Clips Cache: ${CLIPS_DIR}`);
  console.log(`    FFmpeg: ${getFfmpegPath() || 'Not found (install via brew install ffmpeg)'}`);
  console.log(`====================================================`);
});
