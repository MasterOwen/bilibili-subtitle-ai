'use strict';

/**
 * End-to-end smoke test for the real content script + panel UI.
 *
 * It builds a disposable copy of the extension whose service worker is a mock,
 * serves a Bilibili-shaped page over HTTPS on www.bilibili.com, launches
 * Chromium with the extension loaded, then drives the Shadow DOM with
 * Playwright over CDP.
 *
 * Run:
 *   $env:PLAYWRIGHT_CORE="...\playwright-core"; node tests/browser-smoke.js
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawn, spawnSync } = require('node:child_process');
const { generateCertificate } = require('./mock/generate-cert');

const ROOT = path.join(__dirname, '..');
const RUN_DIR = path.join(__dirname, '.tmp-run');
const EXT_DIR = path.join(RUN_DIR, 'extension');
const PROFILE_DIR = path.join(RUN_DIR, 'profile');
const PREVIEW_DIR = path.join(ROOT, 'preview');
const DEBUG_PORT = 9339;
const VIEWPORT = { width: 1440, height: 900 };

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE,
    'playwright-core',
    path.join(
      process.env.LOCALAPPDATA || '',
      'npm-cache',
      '_npx',
      'e41f203b7505f1fb',
      'node_modules',
      'playwright-core',
    ),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) {
      /* try next */
    }
  }
  throw new Error('找不到 playwright-core。请设置 PLAYWRIGHT_CORE 指向已安装的 playwright-core。');
}

function buildTestExtension() {
  fs.rmSync(RUN_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXT_DIR, { recursive: true });
  for (const entry of ['manifest.json', 'background', 'content', 'shared', 'popup', 'options', 'icons']) {
    fs.cpSync(path.join(ROOT, entry), path.join(EXT_DIR, entry), { recursive: true });
  }
  fs.copyFileSync(
    path.join(__dirname, 'mock', 'mock-service-worker.js'),
    path.join(EXT_DIR, 'mock-service-worker.js'),
  );

  const manifestPath = path.join(EXT_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.background.service_worker = 'mock-service-worker.js';
  manifest.host_permissions.push('http://www.bilibili.com/*');
  for (const script of manifest.content_scripts) {
    script.matches = ['https://www.bilibili.com/*', 'http://www.bilibili.com/*'];
  }
  for (const resource of manifest.web_accessible_resources) {
    resource.matches = ['https://www.bilibili.com/*', 'http://www.bilibili.com/*'];
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function startServer() {
  const page = fs.readFileSync(path.join(__dirname, 'mock', 'page.html'));
  // 证书在运行时用 openssl 现场生成，仓库不保存私钥。
  const { key, cert } = generateCertificate({ dir: path.join(RUN_DIR, 'certs') });
  const server = https.createServer(
    { key, cert },
    (req, res) => {
      if (req.url && req.url.startsWith('/video/')) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(page);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    },
  );
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function waitForDebugEndpoint(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (response.ok) return;
    } catch (_) {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Chromium remote debugging endpoint did not start');
}

async function shadowEval(page, expression, arg) {
  return page.evaluate(
    ({ source, value }) => {
      const host = document.getElementById('bsai-root');
      if (!host || !host.shadowRoot) return null;
      // eslint-disable-next-line no-new-func
      const fn = new Function('shadow', 'arg', source);
      return fn(host.shadowRoot, value);
    },
    { source: expression, value: arg },
  );
}

async function main() {
  const { chromium } = loadPlaywright();
  buildTestExtension();
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const { server, port } = await startServer();
  const chromePath = process.env.CHROME_PATH || chromium.executablePath();
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-proxy-server',
    '--ignore-certificate-errors',
    '--allow-insecure-localhost',
    '--host-resolver-rules=MAP www.bilibili.com 127.0.0.1',
    `--user-data-dir=${PROFILE_DIR}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--remote-allow-origins=*',
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    '--force-device-scale-factor=1',
    '--lang=zh-CN',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    'about:blank',
  ];

  const chrome = spawn(chromePath, args, { stdio: 'ignore', windowsHide: true });
  let browser = null;
  const pageErrors = [];
  try {
    await waitForDebugEndpoint(20000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
    const context = browser.contexts()[0];
    let workers = context.serviceWorkers();
    if (!workers.length) {
      await context.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
      workers = context.serviceWorkers();
    }
    const worker = workers.find((item) => item.url().includes('mock-service-worker.js')) || workers[0];
    if (!worker) throw new Error('extension service worker did not start');
    const extensionId = new URL(worker.url()).host;
    console.log('extension id:', extensionId);

    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.setViewportSize(VIEWPORT);
    const url = `https://www.bilibili.com:${port}/video/BV1GJ411x7h7/`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => Boolean(document.getElementById('bsai-root')), null, {
      timeout: 15000,
    });

    const pillVisible = await shadowEval(page, 'return Boolean(shadow.querySelector(".bsai-pill"));');
    if (!pillVisible) throw new Error('floating pill was not rendered');
    await shadowEval(page, 'shadow.querySelector(".bsai-pill").click(); return true;');
    await page.waitForFunction(
      () => {
        const host = document.getElementById('bsai-root');
        const panel = host && host.shadowRoot && host.shadowRoot.querySelector('.bsai-panel');
        return Boolean(panel && panel.classList.contains('is-open'));
      },
      null,
      { timeout: 10000 },
    );

    await page.waitForFunction(
      () => {
        const host = document.getElementById('bsai-root');
        const root = host && host.shadowRoot;
        return Boolean(root && root.querySelectorAll('.bsai-sub-row').length >= 10);
      },
      null,
      { timeout: 15000 },
    );

    const subtitleCount = await shadowEval(
      page,
      'return shadow.querySelectorAll(".bsai-sub-row").length;',
    );
    console.log('subtitle rows:', subtitleCount);
    const titleMetrics = await shadowEval(
      page,
      `const title = shadow.querySelector('.bsai-video-title');
       const card = shadow.querySelector('.bsai-video');
       const cs = getComputedStyle(title);
       return JSON.stringify({
         title: title.getBoundingClientRect().toJSON(),
         card: card.getBoundingClientRect().toJSON(),
         height: cs.height,
         lineHeight: cs.lineHeight,
         fontSize: cs.fontSize,
         paddingTop: cs.paddingTop,
         display: cs.display,
         overflow: cs.overflow,
         lineClamp: cs.webkitLineClamp,
         clientHeight: title.clientHeight,
         scrollHeight: title.scrollHeight,
       });`,
    );
    console.log('title metrics:', titleMetrics);
    await page.screenshot({ path: path.join(PREVIEW_DIR, 'panel-subtitles.png') });

    async function captureDownload(selector) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        shadowEval(page, `shadow.querySelector('${selector}').click(); return true;`),
      ]);
      const downloadPath = await download.path();
      const content = fs.readFileSync(downloadPath, 'utf8').replace(/^\ufeff/, '');
      return { name: download.suggestedFilename(), content };
    }

    const srt = await captureDownload('[data-export=srt]');
    if (!srt.name.endsWith('_字幕.srt')) throw new Error(`unexpected SRT filename: ${srt.name}`);
    if (!srt.content.includes('00:00:00,000 --> 00:00:06,000')) {
      throw new Error('SRT export does not contain the expected timestamp');
    }
    console.log('SRT export:', srt.name, srt.content.length, 'chars');

    const txt = await captureDownload('[data-export=txt]');
    if (!txt.name.endsWith('_字幕.txt') || !txt.content.includes('测试视频：把字幕变成 AI 笔记')) {
      throw new Error('TXT subtitle export is invalid');
    }
    console.log('TXT export:', txt.name, txt.content.length, 'chars');

    await shadowEval(page, 'shadow.querySelector("[data-tab=ai]").click(); return true;');
    await shadowEval(page, 'shadow.querySelector("[data-act=summarize]").click(); return true;');
    try {
      await page.waitForFunction(
        () => {
          const host = document.getElementById('bsai-root');
          const root = host && host.shadowRoot;
          return Boolean(root && root.querySelector('.bsai-summary h2'));
        },
        null,
        { timeout: 15000 },
      );
    } catch (error) {
      const dump = await shadowEval(
        page,
        `return {
          panel: shadow.querySelector('.bsai-panel').innerText,
          aiStatus: (shadow.querySelector('[data-el=aiStatus]') || {}).innerText || '',
          progressHidden: (shadow.querySelector('[data-el=progress]') || {}).hidden,
          summaryHTML: (shadow.querySelector('[data-el=summary]') || {}).innerHTML || '',
          summarizeDisabled: (shadow.querySelector('[data-act=summarize]') || {}).disabled,
        };`,
      );
      console.error('summary wait failed; panel dump:', JSON.stringify(dump, null, 2));
      console.error('page errors:', pageErrors);
      await page.screenshot({ path: path.join(PREVIEW_DIR, 'panel-summary-failure.png') });
      throw error;
    }
    await page.waitForTimeout(500);
    const summaryText = await shadowEval(
      page,
      'return shadow.querySelector(".bsai-summary").innerText;',
    );
    if (!summaryText.includes('一句话概括')) throw new Error('summary did not render expected content');
    if (!(await shadowEval(page, 'return Boolean(shadow.querySelector(".bsai-summary table"));'))) {
      throw new Error('markdown table was not rendered');
    }
    console.log('summary chars:', summaryText.length);
    await shadowEval(
      page,
      'const toast = shadow.querySelector("[data-el=toast]"); toast.classList.remove("is-visible"); toast.style.display = "none"; return true;',
    );
    await page.screenshot({ path: path.join(PREVIEW_DIR, 'panel-summary.png') });

    const md = await captureDownload('[data-export=md]');
    if (!md.name.endsWith('_AI总结.md') || !md.content.includes('## 一句话概括')) {
      throw new Error('Markdown summary export is invalid');
    }
    const summaryTxt = await captureDownload('[data-export=ai-txt]');
    if (!summaryTxt.name.endsWith('_AI总结.txt') || !summaryTxt.content.includes('一句话概括')) {
      throw new Error('TXT summary export is invalid');
    }
    console.log('summary exports:', md.name, summaryTxt.name);

    const optionsPage = await context.newPage();
    optionsPage.on('pageerror', (error) => pageErrors.push(String(error)));
    await optionsPage.setViewportSize({ width: 1440, height: 1100 });
    await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await optionsPage.waitForTimeout(600);
    await optionsPage.addStyleTag({
      content: '.savebar { display: none !important; } body { padding-bottom: 36px !important; }',
    });
    await optionsPage.screenshot({
      path: path.join(PREVIEW_DIR, 'options.png'),
      fullPage: true,
    });

    const popupPage = await context.newPage();
    await popupPage.addInitScript(() => {
      try {
        chrome.tabs.query = async () => [
          { id: 1, url: 'https://www.bilibili.com/video/BV1GJ411x7h7/' },
        ];
        chrome.tabs.sendMessage = (id, message, callback) => callback({ ok: true, open: false });
      } catch (_) {
        /* popup will show its normal state if APIs cannot be stubbed */
      }
    });
    await popupPage.setViewportSize({ width: 380, height: 390 });
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await popupPage.waitForTimeout(500);
    await popupPage.screenshot({
      path: path.join(PREVIEW_DIR, 'popup.png'),
    });

    if (pageErrors.length) {
      throw new Error(`page errors: ${pageErrors.join(' | ')}`);
    }
    console.log('screenshots written to', PREVIEW_DIR);
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) {
      /* ignore */
    }
    try {
      spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch (_) {
      /* ignore */
    }
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      fs.rmSync(RUN_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    } catch (_) {
      /* profile may still be locked briefly */
    }
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
