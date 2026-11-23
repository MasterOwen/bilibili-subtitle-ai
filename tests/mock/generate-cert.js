'use strict';

/**
 * 在测试运行时用系统 openssl 生成一次性自签证书。
 *
 * 供 tests/browser-smoke.js 的本地 HTTPS mock 服务器使用，仓库里不再保存
 * 任何私钥文件。若 openssl 不在 PATH 上，可用 OPENSSL 环境变量指定。
 *
 * 也可以单独运行查看生成结果：
 *   node tests/mock/generate-cert.js [输出目录]
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_HOST = 'www.bilibili.com';
const DEFAULT_DAYS = 2;

function binaryCandidates() {
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;
  return [
    process.env.OPENSSL,
    'openssl',
    programFiles && path.join(programFiles, 'Git', 'usr', 'bin', 'openssl.exe'),
    programFiles && path.join(programFiles, 'Git', 'mingw64', 'bin', 'openssl.exe'),
    programFilesX86 && path.join(programFilesX86, 'Git', 'usr', 'bin', 'openssl.exe'),
    localAppData && path.join(localAppData, 'Programs', 'Git', 'usr', 'bin', 'openssl.exe'),
    '/usr/bin/openssl',
    '/usr/local/bin/openssl',
    '/opt/homebrew/bin/openssl',
  ].filter(Boolean);
}

let cachedBinary = null;

function resolveOpenSSL() {
  if (cachedBinary) return cachedBinary;
  for (const candidate of binaryCandidates()) {
    const probe = spawnSync(candidate, ['version'], { stdio: 'ignore', windowsHide: true });
    if (!probe.error && probe.status === 0) {
      cachedBinary = candidate;
      return candidate;
    }
  }
  throw new Error(
    '找不到 openssl，无法生成测试证书。请安装 OpenSSL（Windows 可安装 Git for Windows，' +
      '其自带 openssl），或用 OPENSSL 环境变量指向 openssl 可执行文件。',
  );
}

// 输出的 stderr 重定向到文件而不是管道：部分受限执行环境会拒绝管道形式的
// stdio（Node 报 EPERM），文件重定向在各平台都可靠。
function runOpenSSL(bin, args, dir) {
  const errPath = path.join(dir, 'openssl.stderr');
  const fd = fs.openSync(errPath, 'w');
  let result;
  try {
    result = spawnSync(bin, args, { stdio: ['ignore', 'ignore', fd], windowsHide: true });
  } finally {
    fs.closeSync(fd);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    let detail = '';
    try {
      detail = fs.readFileSync(errPath, 'utf8').trim();
    } catch (_) {
      /* 忽略读取失败 */
    }
    throw new Error(
      `openssl ${args[0]} 执行失败（退出码 ${result.status}）${detail ? `：\n${detail}` : ''}`,
    );
  }
}

/**
 * 生成一个仅用于本地 mock 服务器的自签证书。
 *
 * @param {{ dir?: string, host?: string, days?: number }} [options]
 * @returns {{ dir: string, keyPath: string, certPath: string, key: Buffer, cert: Buffer }}
 */
function generateCertificate(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const days = options.days || DEFAULT_DAYS;
  const dir = options.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'bsai-test-cert-'));
  fs.mkdirSync(dir, { recursive: true });

  const configPath = path.join(dir, 'openssl.cnf');
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  const bin = resolveOpenSSL();

  // 显式提供最小配置，避免依赖 openssl 发行版自带的 openssl.cnf。
  fs.writeFileSync(
    configPath,
    [
      '[req]',
      'distinguished_name = dn',
      'prompt = no',
      'x509_extensions = v3_req',
      '[dn]',
      `CN = ${host}`,
      '[v3_req]',
      `subjectAltName = DNS:${host}`,
      'basicConstraints = CA:TRUE',
      'keyUsage = digitalSignature, keyEncipherment',
      'extendedKeyUsage = serverAuth',
      '',
    ].join('\n'),
  );

  runOpenSSL(
    bin,
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      String(days),
      '-config',
      configPath,
      '-keyout',
      keyPath,
      '-out',
      certPath,
    ],
    dir,
  );

  return {
    dir,
    keyPath,
    certPath,
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

module.exports = { generateCertificate, resolveOpenSSL };

if (require.main === module) {
  const target = process.argv[2];
  const result = generateCertificate(target ? { dir: path.resolve(target) } : {});
  console.log(result.certPath);
  console.log(result.keyPath);
}
