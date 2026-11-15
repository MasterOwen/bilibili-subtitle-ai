'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const RUN_DIR = path.join(__dirname, '.tmp-background');
const PROFILE_DIR = path.join(RUN_DIR, 'profile');
const DEBUG_PORT = 9341;

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
  throw new Error('找不到 playwright-core');
}

async function waitForDebugEndpoint(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (response.ok) return;
    } catch (_) {
      /* wait */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Chromium did not start');
}

async function main() {
  const { chromium } = loadPlaywright();
  fs.rmSync(RUN_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const chromePath = process.env.CHROME_PATH || chromium.executablePath();
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-proxy-server',
    `--user-data-dir=${PROFILE_DIR}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--remote-allow-origins=*',
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
    '--window-size=1200,800',
    '--lang=zh-CN',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    'about:blank',
  ];
  const chrome = spawn(chromePath, args, { stdio: 'ignore', windowsHide: true });
  let browser = null;
  try {
    await waitForDebugEndpoint(20000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
    const context = browser.contexts()[0];
    let workers = context.serviceWorkers();
    if (!workers.length) {
      await context.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
      workers = context.serviceWorkers();
    }
    const worker = workers.find((item) => item.url().includes('background/service-worker.js')) || workers[0];
    if (!worker) throw new Error('production service worker did not start');
    const extensionId = new URL(worker.url()).host;
    console.log('extension id:', extensionId);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/options.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const ping = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'PING' }));
    console.log('PING:', ping);
    if (!ping || !ping.ok) throw new Error('PING failed');

    const aiStatus = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'AI_STATUS' }));
    console.log('AI_STATUS:', JSON.stringify(aiStatus));
    if (!aiStatus || !aiStatus.ok || aiStatus.configured) {
      throw new Error('default AI status should be unconfigured');
    }

    const testAi = await page.evaluate(() =>
      chrome.runtime.sendMessage({
        type: 'TEST_AI',
        config: {
          apiBaseUrl: 'https://example.com/v1',
          apiKey: 'sk-test',
          model: 'test',
        },
      }),
    );
    console.log('TEST_AI without host permission:', JSON.stringify(testAi));
    if (!testAi || testAi.ok || testAi.code !== 'AI_PERMISSION_REQUIRED') {
      throw new Error('TEST_AI should fail with AI_PERMISSION_REQUIRED before permission is granted');
    }

    const load = await page.evaluate(() =>
      chrome.runtime.sendMessage({
        type: 'LOAD_VIDEO',
        payload: {
          href: 'https://www.bilibili.com/video/BV1GJ411x7h7/',
          pageState: null,
        },
      }),
    );
    console.log(
      'LOAD_VIDEO:',
      JSON.stringify({
        ok: load && load.ok,
        error: load && load.error,
        video: load && load.video && {
          bvid: load.video.bvid,
          cid: load.video.cid,
          title: load.video.title,
          duration: load.video.duration,
        },
        tracks: load && load.tracks && load.tracks.length,
        needLogin: load && load.needLogin,
      }),
    );

    if (!load || typeof load.ok !== 'boolean') throw new Error('LOAD_VIDEO returned no structured response');

    const live = await context.newPage();
    try {
      await live.goto('https://www.bilibili.com/video/BV1GJ411x7h7/', {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await live.waitForFunction(() => Boolean(document.getElementById('bsai-root')), null, {
        timeout: 20000,
      });
      await live.evaluate(() => {
        const host = document.getElementById('bsai-root');
        const pill = host && host.shadowRoot && host.shadowRoot.querySelector('.bsai-pill');
        if (pill) pill.click();
      });
      await live.waitForFunction(
        () => {
          const host = document.getElementById('bsai-root');
          const root = host && host.shadowRoot;
          if (!root) return false;
          const loading = root.querySelector('[data-el=subLoading]');
          const empty = root.querySelector('[data-el=subEmpty]');
          return (loading && loading.hidden) && (empty && !empty.hidden);
        },
        null,
        { timeout: 30000 },
      );
      const panelText = await live.evaluate(() => {
        const host = document.getElementById('bsai-root');
        return host && host.shadowRoot ? host.shadowRoot.querySelector('.bsai-panel').innerText : '';
      });
      console.log('real page panel:', panelText.replace(/\n+/g, ' | ').slice(0, 500));
    } catch (error) {
      console.warn('real Bilibili page check skipped/failed:', error.message);
    } finally {
      await live.close().catch(() => {});
    }
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
    await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      fs.rmSync(RUN_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    } catch (_) {
      /* profile may still be locked briefly; it is only a temp directory */
    }
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
