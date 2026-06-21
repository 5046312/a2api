import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distServerEntry = join(rootDir, 'dist', 'server', 'index.js');
const distWebEntry = join(rootDir, 'dist', 'web', 'index.html');
const binariesDir = join(rootDir, 'src-tauri', 'binaries');

function readRustHostTriple() {
  let output = '';
  try {
    output = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  } catch (error) {
    if (error?.code === 'ENOENT') return resolveHostTripleFromNode();
    throw error;
  }
  const match = output.match(/^host:\s+(.+)$/m);
  if (!match?.[1]) throw new Error('无法从 rustc -vV 读取 target triple');
  return match[1].trim();
}

function resolveTargetTriple() {
  return process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || process.env.TARGET || readRustHostTriple();
}

function resolveHostTripleFromNode() {
  const key = `${process.platform}:${process.arch}`;
  const triples = {
    'darwin:arm64': 'aarch64-apple-darwin',
    'darwin:x64': 'x86_64-apple-darwin',
    'linux:arm64': 'aarch64-unknown-linux-gnu',
    'linux:x64': 'x86_64-unknown-linux-gnu',
    'win32:arm64': 'aarch64-pc-windows-msvc',
    'win32:x64': 'x86_64-pc-windows-msvc',
    'win32:ia32': 'i686-pc-windows-msvc'
  };
  const triple = triples[key];
  if (!triple) throw new Error(`无法识别当前平台 target triple: ${key}`);
  console.warn(`[a2api-tauri] rustc 不在 PATH，按当前 Node 平台推断 target triple: ${triple}`);
  return triple;
}

function assertBuildOutput() {
  if (!existsSync(distServerEntry) || !existsSync(distWebEntry)) {
    throw new Error('缺少 dist 产物，请先执行 pnpm build');
  }
}

function warnUnsupportedNode() {
  const major = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);
  if (major < 22) {
    console.warn(`[a2api-tauri] 当前 Node ${process.versions.node} 低于项目要求的 22.x，sidecar 会复制当前 Node runtime。`);
  }
}

assertBuildOutput();
warnUnsupportedNode();

const targetTriple = resolveTargetTriple();
const ext = process.platform === 'win32' ? '.exe' : '';
const sidecarPath = join(binariesDir, `a2api-sidecar-${targetTriple}${ext}`);

mkdirSync(binariesDir, { recursive: true });
copyFileSync(process.execPath, sidecarPath);
if (process.platform !== 'win32') chmodSync(sidecarPath, 0o755);

console.info(`[a2api-tauri] 已准备 sidecar: ${sidecarPath}`);
