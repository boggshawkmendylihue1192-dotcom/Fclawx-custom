#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OWNER = process.env.GITHUB_OWNER || 'boggshawkmendylihue1192-dotcom';
const REPO = process.env.GITHUB_REPO || 'Fclawx-custom';
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node scripts/publish-github-release.mjs [tag]');
  console.log('Publishes release assets for the current package version. Defaults to v<package.version>.');
  process.exit(0);
}
const TAG = process.argv[2] || `v${VERSION}`;
const RELEASE_NAME = `ClawX ${VERSION}`;
const API = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl';
const tmp = mkdtempSync(join(tmpdir(), 'clawx-release-'));

function tokenFromGitCredential() {
  const input = 'protocol=https\nhost=github.com\n\n';
  const output = execFileSync('git', ['credential', 'fill'], { input, encoding: 'utf8' });
  const line = output.split(/\r?\n/).find((item) => item.startsWith('password='));
  return line?.slice('password='.length) || '';
}

const token = process.env.GITHUB_TOKEN || tokenFromGitCredential();
if (!token) {
  throw new Error('GITHUB_TOKEN is not set and git credential store did not return a token.');
}

function runCurl(args, outputPath) {
  const fullArgs = [
    '--http1.1',
    '-L',
    '--retry', '8',
    '--retry-delay', '5',
    '--retry-all-errors',
    '--connect-timeout', '45',
    ...args,
  ];
  if (outputPath) fullArgs.push('-o', outputPath);
  const result = spawnSync(CURL, fullArgs, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`curl failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function apiJson(method, url, body) {
  const out = join(tmp, `${Math.random().toString(16).slice(2)}.json`);
  const args = [
    '-X', method,
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28',
    '-w', '%{http_code}',
  ];
  if (body) {
    const bodyPath = join(tmp, `${Math.random().toString(16).slice(2)}-body.json`);
    writeFileSync(bodyPath, JSON.stringify(body), 'utf8');
    args.push('-H', 'Content-Type: application/json', '--data-binary', `@${bodyPath}`);
  }
  args.push(url);
  const code = runCurl(args, out);
  const raw = existsSync(out) ? readFileSync(out, 'utf8') : '';
  return { code: Number(code), body: raw ? JSON.parse(raw) : null };
}

let releaseResponse = apiJson('GET', `${API}/tags/${TAG}`);
if (releaseResponse.code === 404) {
  releaseResponse = apiJson('POST', API, {
    tag_name: TAG,
    target_commitish: 'main',
    name: RELEASE_NAME,
    body: [
      '工作台功能完善版本：',
      '- 后台任务调度状态、失败记录和运行报告更完整。',
      '- 工作区文件编辑升级为 Monaco，并增加保存前备份和 diff 视图。',
      '- Git 面板增加状态、diff、日志和提交。',
      '- 智能路由支持兜底规则和模型策略说明注入。',
      '- 发布脚本增加重试，后续 Release 可恢复执行。',
    ].join('\n'),
    draft: true,
    prerelease: false,
  });
}
if (releaseResponse.code < 200 || releaseResponse.code >= 300) {
  throw new Error(`Release create/get failed: HTTP ${releaseResponse.code}`);
}

const release = releaseResponse.body;
const uploadBase = release.upload_url.replace(/\{.*$/, '');
const assets = [
  join(ROOT, 'release', `ClawX-${VERSION}-win-x64.exe`),
  join(ROOT, 'release', `ClawX-${VERSION}-win-x64.exe.blockmap`),
  join(ROOT, 'release', 'latest.yml'),
];

for (const assetPath of assets) {
  if (!existsSync(assetPath)) throw new Error(`Missing asset: ${assetPath}`);
  const assetName = basename(assetPath);
  const fresh = apiJson('GET', release.url).body;
  for (const asset of fresh.assets || []) {
    if (asset.name === assetName) {
      apiJson('DELETE', asset.url);
    }
  }
  console.log(`Uploading ${assetName}...`);
  runCurl([
    '-X', 'POST',
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'Content-Type: application/octet-stream',
    '--data-binary', `@${assetPath}`,
    `${uploadBase}?name=${encodeURIComponent(assetName)}`,
  ]);
}

const published = apiJson('PATCH', release.url, { draft: false }).body;
console.log(published.html_url);
