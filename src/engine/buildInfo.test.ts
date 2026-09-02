import { describe, it, expect } from 'vitest';
import { describeBuild, describeEnvironment } from './buildInfo';

/**
 * ⚠️ ログを解析するとき、版と環境が無いと毎回そこから聞き直すことになる。
 * 実際に「直した版で試していますか」を確かめられずに詰まった (2026-09-03)。
 */

describe('動いている版', () => {
  it('本番はバンドルのハッシュがそのまま版になる', () => {
    const out = describeBuild({
      scripts: ['https://example.com/assets/index-Ce87cBhc.js', 'https://example.com/assets/other.js'],
    });

    expect(out).toBe('版: index-Ce87cBhc.js');
  });

  it('開発サーバーはその旨を書く (直った版と取り違えないため)', () => {
    expect(describeBuild({ scripts: ['http://localhost:5199/src/main.tsx'] })).toContain('開発ビルド');
    expect(describeBuild({ scripts: ['http://localhost:5199/@vite/client'] })).toContain('開発ビルド');
  });

  it('分からなければ不明と書く (取り繕わない)', () => {
    expect(describeBuild({ scripts: [] })).toBe('版: 不明');
    expect(describeBuild({})).toBe('版: 不明');
  });
});

describe('環境', () => {
  it('速さと機能に関わるものを並べる', () => {
    const out = describeEnvironment({
      hardwareConcurrency: 16,
      deviceMemory: 32,
      screen: { width: 2560, height: 1440 },
      devicePixelRatio: 1,
      hasWorker: true,
      hasOffscreenCanvas: true,
      hasFileSystemAccess: true,
    });

    expect(out).toContain('コア 16');
    expect(out).toContain('メモリ 32GB');
    expect(out).toContain('画面 2560x1440');
    expect(out).toContain('担当 可');
    expect(out).toContain('フォルダ書き込み 可');
    // 倍率 1 は当たり前なので出さない
    expect(out).not.toContain('倍率');
  });

  it('使えない機能はそう書く (できない理由の手がかりになる)', () => {
    const out = describeEnvironment({ hasWorker: false, hasOffscreenCanvas: false, hasFileSystemAccess: false });

    expect(out).toContain('コア ?');
    expect(out).toContain('担当 不可');
    expect(out).toContain('OffscreenCanvas 不可');
    expect(out).toContain('フォルダ書き込み 不可');
  });

  it('何も分からなくても落ちない', () => {
    expect(describeEnvironment({})).toContain('環境:');
  });
});
