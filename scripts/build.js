/*
 * Package the extension into dist/:
 *   dist/bilibili-subtitle-ai-v<version>/      load-unpacked folder
 *   dist/bilibili-subtitle-ai-v<version>.zip   release archive
 *
 * Zero dependencies: the ZIP container is written directly (deflate + CRC32).
 * Set SOURCE_DATE_EPOCH (seconds) to pin entry timestamps for reproducible
 * archives.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const DIST_ROOT = path.join(ROOT, 'dist');

// Files shipped at the archive root, in this order.
const ROOT_FILES = ['manifest.json', 'README.md', 'LICENSE'];

// Runtime/UI directories copied recursively. Tests, scripts and dist are not
// shipped.
const SOURCE_DIRS = ['background', 'content', 'shared', 'popup', 'options', 'icons', 'preview'];

// Transient files that must never end up in a release.
const EXCLUDED = [
  /(^|\/)\.DS_Store$/,
  /(^|\/)Thumbs\.db$/,
  /^preview\/_/,
  /^preview\/panel-summary-failure\.png$/,
];

const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_METHOD_DEFLATE = 8;

function fail(message) {
  throw new Error(message);
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function readManifest() {
  const manifestPath = path.join(ROOT, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail('找不到 manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`manifest.json 不是合法 JSON：${error.message}`);
  }
  const version = String(manifest.version || '').trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`manifest.version 不合法：${JSON.stringify(manifest.version)}`);
  }
  if (manifest.manifest_version !== 3) {
    fail(`manifest_version 应为 3，实际为 ${manifest.manifest_version}`);
  }
  return { manifest, version };
}

function listDirectory(absDir, relDir, out) {
  const entries = fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => {
    if (a.name === b.name) return 0;
    return a.name < b.name ? -1 : 1;
  });
  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    const rel = `${relDir}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      fail(`发布包不支持符号链接：${rel}`);
    } else if (entry.isDirectory()) {
      listDirectory(abs, rel, out);
    } else if (entry.isFile()) {
      if (!EXCLUDED.some((pattern) => pattern.test(rel))) {
        out.push({ abs, rel });
      }
    } else {
      fail(`不支持的文件类型：${rel}`);
    }
  }
}

function collectFiles() {
  const files = [];
  for (const name of ROOT_FILES) {
    const abs = path.join(ROOT, name);
    if (!fs.existsSync(abs)) fail(`缺少文件：${name}`);
    files.push({ abs, rel: name });
  }
  for (const dir of SOURCE_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) fail(`缺少目录：${dir}`);
    listDirectory(abs, dir, files);
  }
  if (!files.length) fail('没有可打包的文件');
  if (files.length > 65535) fail('文件数量超过 ZIP 上限（65535）');
  return files;
}

function manifestReferences(manifest) {
  const refs = [
    manifest.background && manifest.background.service_worker,
    manifest.action && manifest.action.default_popup,
    manifest.options_ui && manifest.options_ui.page,
  ];
  for (const icon of Object.values((manifest.action && manifest.action.default_icon) || {})) refs.push(icon);
  for (const icon of Object.values(manifest.icons || {})) refs.push(icon);
  for (const script of manifest.content_scripts || []) {
    for (const file of script.js || []) refs.push(file);
    for (const file of script.css || []) refs.push(file);
  }
  for (const resource of manifest.web_accessible_resources || []) {
    for (const file of resource.resources || []) refs.push(file);
  }
  return Array.from(
    new Set(
      refs
        .filter((ref) => typeof ref === 'string' && ref.trim())
        .map((ref) => toPosix(ref.trim()).replace(/^\/+/, '')),
    ),
  );
}

function verifyManifestFiles(files, manifest) {
  const shipped = new Set(files.map((file) => file.rel));
  for (const ref of manifestReferences(manifest)) {
    if (shipped.has(ref)) continue;
    const caseMatch = files.find((file) => file.rel.toLowerCase() === ref.toLowerCase());
    if (caseMatch) {
      fail(`manifest 路径大小写不一致：${ref}（实际文件为 ${caseMatch.rel}）`);
    }
    fail(`manifest 引用的文件不存在或未打包：${ref}`);
  }
}

function assertInsideDist(target) {
  const rel = path.relative(DIST_ROOT, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    fail(`拒绝操作 dist 之外的路径：${target}`);
  }
}

function prepareOutput() {
  const distRel = path.relative(ROOT, DIST_ROOT);
  if (!distRel || distRel.startsWith('..') || path.isAbsolute(distRel)) {
    fail(`dist 目录不在项目根目录内：${DIST_ROOT}`);
  }
  return DIST_ROOT;
}

function copyFiles(files, outDir) {
  try {
    fs.rmSync(outDir, { recursive: true, force: true });
  } catch (error) {
    fail(`无法清理旧产物 ${path.relative(ROOT, outDir)}，请关闭占用它的程序后重试：${error.message}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of files) {
    const dest = path.join(outDir, file.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file.abs, dest);
  }
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer (single-disk, no encryption, no ZIP64)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(value) {
  const date = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const month = Math.min(12, Math.max(1, date.getMonth() + 1));
  const day = Math.min(31, Math.max(1, date.getDate()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | (month << 5) | day,
  };
}

function readSourceDateEpoch() {
  const raw = process.env.SOURCE_DATE_EPOCH;
  if (raw === undefined || raw === '') return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    fail(`SOURCE_DATE_EPOCH 不是合法秒数：${raw}`);
  }
  return new Date(seconds * 1000);
}

function writeZip(zipPath, entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const stamp = toDosDateTime(entry.time);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(ZIP_LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(ZIP_FLAG_UTF8, 6);
    local.writeUInt16LE(ZIP_METHOD_DEFLATE, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(ZIP_CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(ZIP_FLAG_UTF8, 8);
    central.writeUInt16LE(ZIP_METHOD_DEFLATE, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(ZIP_EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(zipPath, Buffer.concat([...localChunks, centralDirectory, eocd]));
}

function verifyZip(zipPath, expectedCount) {
  const raw = fs.readFileSync(zipPath);
  if (raw.length < 22 || raw.readUInt32LE(0) !== ZIP_LOCAL_SIG) {
    fail('ZIP 写入校验失败：文件头异常');
  }
  const eocdOffset = raw.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset < 0) fail('ZIP 写入校验失败：找不到中央目录结束标记');
  const count = raw.readUInt16LE(eocdOffset + 10);
  if (count !== expectedCount) {
    fail(`ZIP 写入校验失败：条目数 ${count}，预期 ${expectedCount}`);
  }
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function build() {
  const { manifest, version } = readManifest();
  const baseName = `bilibili-subtitle-ai-v${version}`;
  const outDir = path.join(prepareOutput(), baseName);
  const zipPath = path.join(DIST_ROOT, `${baseName}.zip`);
  assertInsideDist(outDir);
  assertInsideDist(zipPath);

  const files = collectFiles();
  verifyManifestFiles(files, manifest);

  const epoch = readSourceDateEpoch();
  copyFiles(files, outDir);

  const entries = files.map((file) => ({
    name: file.rel,
    data: fs.readFileSync(file.abs),
    time: epoch || fs.statSync(file.abs).mtime,
  }));
  try {
    writeZip(zipPath, entries);
  } catch (error) {
    if (error && ['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) {
      fail(`写入 ${toPosix(path.relative(ROOT, zipPath))} 失败（${error.code}），请关闭占用该文件的程序后重试`);
    }
    throw error;
  }
  verifyZip(zipPath, entries.length);

  const zipBytes = fs.statSync(zipPath).size;
  const digest = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');

  console.log(`已构建 ${baseName}`);
  console.log(`  目录：${toPosix(path.relative(ROOT, outDir))}/（${files.length} 个文件）`);
  console.log(`  ZIP ：${toPosix(path.relative(ROOT, zipPath))}（${formatSize(zipBytes)}，${files.length} 个条目）`);
  console.log(`  SHA-256：${digest}`);
}

try {
  build();
} catch (error) {
  console.error(`构建失败：${error.message}`);
  process.exitCode = 1;
}
