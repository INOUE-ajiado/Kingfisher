#!/usr/bin/env node
/**
 * Kingfisher MCP サーバー
 *
 * AI に渡す前提知識を「読み手の解釈」に委ねず、構造化された事実として提供する。
 *
 * 2 種類の情報を扱う:
 *   1. 人が管理する知識 (mcp/knowledge/project.json)
 *      仕様書と実装の乖離、独自仕様、既知の不具合、進め方の約束事など、
 *      コードを読んだだけでは分からない・誤解しやすいこと。
 *   2. コードから毎回読み取る事実 (ライブ検査)
 *      ストアの API 一覧、ツールオプションが実際に効いているか、テスト結果など、
 *      古くなると害になる情報は都度コードを読んで返す。
 *
 * 起動: node mcp/server.js  (stdio)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'src');

const knowledge = JSON.parse(readFileSync(join(HERE, 'knowledge', 'project.json'), 'utf8'));

// ---------------------------------------------------------------- ユーティリティ

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function text(value) {
  return {
    content: [
      { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

function runCommand(command, args) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5 * 60 * 1000,
    });
    return { ok: true, output: stdout.trim() };
  } catch (err) {
    const output = `${err.stdout || ''}${err.stderr || ''}`.trim();
    return { ok: false, output: output || String(err.message || err) };
  }
}

// ---------------------------------------------------------------- ライブ検査

/** ストアのスライス構成と公開 API を types.ts / slices から読み取る */
function inspectStore() {
  const types = readIfExists(join(SRC, 'store', 'types.ts'));
  if (!types) return { error: 'src/store/types.ts が見つかりません' };

  const slices = [];
  const sliceBlock = /\/\*\* (.+?) \*\/\s*\nexport interface (\w+Slice) \{([\s\S]*?)\n\}/g;
  let match;
  while ((match = sliceBlock.exec(types)) !== null) {
    const [, description, name, body] = match;
    const members = [...body.matchAll(/^\s{2}(\w+)\??\s*:/gm)].map((m) => m[1]);
    slices.push({ name, description, memberCount: members.length, members });
  }

  const composed = types.match(/export interface PaintStore\s*\n?\s*extends ([\s\S]*?)\{\}/);
  return {
    note: 'コンポーネントは PaintStore だけを見ればよい。スライスは責務ごとの分割で、共通の get() を通じて相互参照できる。',
    composedFrom: composed
      ? composed[1].replace(/\s+/g, ' ').replace(/,\s*$/, '').split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    slices,
  };
}

/**
 * ツールオプションが実際に塗りアルゴリズムへ届いているかを検査する。
 * 「UI にはあるが効かない」状態を過去に何度も踏んでいるため、都度コードで確認する。
 */
function inspectToolOptions() {
  const engine = readIfExists(join(SRC, 'engine', 'paintAlgorithm.ts'));
  const store = readIfExists(join(SRC, 'store', 'slices', 'toolSlice.ts'));
  if (!engine || !store) return { error: 'paintAlgorithm.ts か toolSlice.ts が見つかりません' };

  // traceColors のようなネストがあるため、対応する閉じ括弧まで数えて切り出す
  const start = store.indexOf('toolOptions: {');
  let declared = [];
  if (start >= 0) {
    let depth = 0;
    let end = start;
    for (let i = store.indexOf('{', start); i < store.length; i++) {
      if (store[i] === '{') depth++;
      else if (store[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const block = store.slice(start, end);
    declared = [...block.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
  }

  // 型宣言以外の場所で参照されているかどうかを見る
  const body = engine.replace(/export interface ToolOptions \{[\s\S]*?\n\}/, '');

  return {
    note: 'usedInEngine が false のオプションは、UI とストアには存在するが塗り処理へ届いていない可能性が高い。過去に隙間閉じ・contiguous・sampleSize・referenceLayer がこの状態だった。',
    options: declared.map((name) => ({
      name,
      usedInEngine: new RegExp(`\\boptions\\.${name}\\b`).test(body),
    })),
    falseNegatives: {
      brushSize: 'drawBrushLine へ radius として直接渡すため options 経由ではない。効いている。',
      maxNoiseSize: 'removeSingleNoiseAt へ直接渡す。CellWindow 側で使うため false で正常。',
      frameHold: 'アニメーション再生の間隔に使う。塗り処理とは無関係なので false で正常。',
    },
    howToRead:
      'usedInEngine が false かつ falseNegatives に載っていないオプションは、UI とストアには存在するが塗り処理へ届いていない疑いが濃い。',
  };
}

/** どこからも import されていないファイルを洗い出す */
function findDeadFiles() {
  const files = walk(SRC).filter((f) => !/\.test\.tsx?$/.test(f));
  const sources = files.map((f) => ({ path: f, code: readFileSync(f, 'utf8') }));

  const dead = [];
  for (const file of files) {
    const rel = relative(SRC, file);
    const base = rel.replace(/\.(ts|tsx)$/, '');
    const name = base.split('/').pop();
    if (name === 'main' || name === 'App' || name === 'vite-env') continue;

    // import 文は拡張子付き ('./AuthGuard.tsx') のこともあるので許容する
    const referenced = sources.some(
      (s) =>
        s.path !== file &&
        new RegExp(`['"\`][^'"\`]*\\b${name}(\\.tsx?)?['"\`]`).test(s.code)
    );
    if (!referenced) dead.push(relative(ROOT, file));
  }
  return {
    note: '参照ゼロのファイル。意図的に残しているものもある (engine/webgpuRenderer.ts は将来の WebGPU 移行用に保留)。',
    files: dead,
  };
}

/** git の状態 */
function inspectGit() {
  const branch = runCommand('git', ['branch', '--show-current']);
  const status = runCommand('git', ['status', '--short']);
  const log = runCommand('git', ['log', '--oneline', '-8']);
  return {
    branch: branch.output,
    uncommittedFiles: status.output ? status.output.split('\n') : [],
    recentCommits: log.output ? log.output.split('\n') : [],
    warning:
      branch.output === 'main'
        ? 'main に直接いる。コミット前に git checkout -b improve/<topic> でブランチを切ること。'
        : null,
  };
}

// ---------------------------------------------------------------- ツール定義

const TOOLS = [
  {
    name: 'kingfisher_briefing',
    description:
      'Kingfisher の作業を始める前に必ず最初に呼ぶ。プロジェクトの概要、実装済みと未実装の切り分け、注意事項、進め方の約束事、未解決の課題をまとめて返す。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'kingfisher_domain_rules',
    description:
      '独自仕様 (純白=透明、相対パス、異名連番、左右連動のコマ差、履歴モデルなど) を返す。コードを読んだだけでは誤解しやすい規則。画像処理・ファイル操作・ウィンドウ操作に触れる前に呼ぶ。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '特定の規則だけを引く場合の id' } },
      additionalProperties: false,
    },
  },
  {
    name: 'kingfisher_store_api',
    description:
      'Zustand ストアのスライス構成と公開 API を、src/store/types.ts から毎回読み取って返す。状態を追加・変更する前に呼ぶ。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'kingfisher_tool_options_status',
    description:
      'ツールオプション (隙間閉じ・contiguous・sampleSize など) が実際に塗りアルゴリズムへ届いているかをコードから検査する。「UI にはあるが効かない」状態を検出する。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'kingfisher_known_issues',
    description:
      '未解決の課題と、過去に修正した不具合の一覧を返す。未解決の課題には「調査済みで正常だった箇所」が含まれるので、同じ調査を繰り返さずに済む。不具合の調査を始める前に呼ぶ。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'kingfisher_dead_files',
    description: 'どこからも import されていないファイルを洗い出す。リファクタリング前の確認に使う。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'kingfisher_git_status',
    description:
      '現在のブランチ、未コミットのファイル、直近のコミットを返す。main に直接いる場合は警告する。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'kingfisher_verify',
    description:
      '型チェック・テスト・ビルドを実行して結果を返す。コードを変更したら必ず呼ぶ。',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: { type: 'string', enum: ['typecheck', 'test', 'build'] },
          description: '実行する検証。省略時はすべて',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'kingfisher_search',
    description: 'src 配下を検索し、一致した行を前後の文脈付きで返す。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '検索する文字列または正規表現' },
        context: { type: 'number', description: '前後に含める行数 (既定 2)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------- サーバー

const server = new Server(
  { name: 'kingfisher', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'kingfisher://briefing',
      name: 'Kingfisher プロジェクト概要',
      description: '実装済みと未実装の切り分け、注意事項、進め方の約束事',
      mimeType: 'application/json',
    },
    {
      uri: 'kingfisher://domain-rules',
      name: 'Kingfisher 独自仕様',
      description: '純白=透明、相対パス、異名連番、左右連動のコマ差など',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  const payload =
    uri === 'kingfisher://domain-rules'
      ? knowledge.domainRules
      : {
          name: knowledge.name,
          summary: knowledge.summary,
          techStack: knowledge.techStack,
          criticalWarnings: knowledge.criticalWarnings,
          workflow: knowledge.workflow,
        };
  return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  switch (name) {
    case 'kingfisher_briefing':
      return text({
        name: knowledge.name,
        summary: knowledge.summary,
        production: knowledge.production,
        repositoryVisibility: knowledge.repositoryVisibility,
        lastReviewed: knowledge.lastReviewed,
        techStack: knowledge.techStack,
        criticalWarnings: knowledge.criticalWarnings,
        workflow: knowledge.workflow,
        openIssues: knowledge.openIssues,
        nextStep:
          '独自仕様は kingfisher_domain_rules、状態管理は kingfisher_store_api、不具合調査は kingfisher_known_issues を呼ぶこと。',
      });

    case 'kingfisher_domain_rules': {
      const rules = args.id
        ? knowledge.domainRules.filter((r) => r.id === args.id)
        : knowledge.domainRules;
      return text(rules.length ? rules : { error: `該当する規則がありません: ${args.id}` });
    }

    case 'kingfisher_store_api':
      return text(inspectStore());

    case 'kingfisher_tool_options_status':
      return text(inspectToolOptions());

    case 'kingfisher_known_issues':
      return text({
        openIssues: knowledge.openIssues,
        knownFixedBugs: knowledge.knownFixedBugs,
        note: '未解決の課題の verifiedOk は調査済みで正常だった箇所。同じ確認を繰り返さないこと。',
      });

    case 'kingfisher_dead_files':
      return text(findDeadFiles());

    case 'kingfisher_git_status':
      return text(inspectGit());

    case 'kingfisher_verify': {
      const steps = args.steps?.length ? args.steps : ['typecheck', 'test', 'build'];
      const results = {};
      for (const step of steps) {
        if (step === 'typecheck') results.typecheck = runCommand('npx', ['tsc', '--noEmit']);
        if (step === 'test') results.test = runCommand('npm', ['test']);
        if (step === 'build') results.build = runCommand('npm', ['run', 'build']);
      }
      const allOk = Object.values(results).every((r) => r.ok);
      return text({ allOk, results });
    }

    case 'kingfisher_search': {
      const contextLines = typeof args.context === 'number' ? args.context : 2;
      let pattern;
      try {
        pattern = new RegExp(args.query, 'i');
      } catch {
        pattern = new RegExp(args.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }

      const hits = [];
      for (const file of walk(SRC)) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (!pattern.test(line)) return;
          hits.push({
            file: relative(ROOT, file),
            line: i + 1,
            context: lines
              .slice(Math.max(0, i - contextLines), i + contextLines + 1)
              .join('\n'),
          });
        });
      }
      return text({ matches: hits.length, hits: hits.slice(0, 40) });
    }

    default:
      return text({ error: `未知のツール: ${name}` });
  }
});

await server.connect(new StdioServerTransport());
