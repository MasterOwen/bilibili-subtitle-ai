(function () {
  'use strict';

  const U = globalThis.BiliSubUtils;
  if (!U) return;

  const els = {
    pageCard: document.getElementById('pageCard'),
    statusDot: document.getElementById('statusDot'),
    pageValue: document.getElementById('pageValue'),
    openBtn: document.getElementById('openBtn'),
    openLabel: document.getElementById('openLabel'),
    refreshBtn: document.getElementById('refreshBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    tip: document.getElementById('tip'),
    version: document.getElementById('version'),
  };

  let activeTab = null;

  function setStatus(kind, text) {
    els.statusDot.className = `status-dot ${kind || ''}`.trim();
    els.pageValue.textContent = text;
  }

  function sendToTab(message, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!activeTab || !activeTab.id) {
        reject(new Error('没有活动标签页'));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('内容脚本未响应'));
      }, timeoutMs || 2000);
      try {
        chrome.tabs.sendMessage(activeTab.id, message, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || '内容脚本未响应'));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async function init() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tabs && tabs[0] ? tabs[0] : null;
    } catch (_) {
      activeTab = null;
    }

    try {
      if (chrome.runtime && chrome.runtime.getManifest) {
        els.version.textContent = chrome.runtime.getManifest().version;
      }
    } catch (_) {
      /* ignore */
    }

    const route = activeTab && activeTab.url ? U.parseBilibiliRoute(activeTab.url) : null;
    if (!route) {
      setStatus('err', '当前不是 B站视频播放页');
      els.openBtn.disabled = true;
      els.tip.textContent = '请先打开 bilibili.com 的视频或番剧播放页，再点击扩展图标。';
      return;
    }

    setStatus('warn', route.kind === 'video' ? route.bvid || 'B站视频' : 'B站番剧');
    els.openLabel.textContent = '正在连接页面…';
    try {
      const response = await sendToTab({ type: 'PING' }, 1600);
      if (!response || !response.ok) throw new Error('内容脚本未就绪');
      setStatus('ok', response.open ? '已连接到页面 · 面板已打开' : '已连接到页面');
      els.openBtn.disabled = false;
      els.openLabel.textContent = '打开字幕面板';
      els.tip.textContent = '也可以直接点击 B站页面右侧的「字幕总结」悬浮按钮。';
    } catch (_) {
      setStatus('err', '需要刷新 B站页面');
      els.openBtn.disabled = true;
      els.openLabel.textContent = '页面尚未就绪';
      els.refreshBtn.hidden = false;
      els.tip.textContent = '扩展刚安装或更新后，需要刷新一次 B站页面才能注入字幕面板。';
    }
  }

  els.openBtn.addEventListener('click', async () => {
    if (els.openBtn.disabled) return;
    els.openBtn.disabled = true;
    els.openLabel.textContent = '正在打开…';
    try {
      await sendToTab({ type: 'TOGGLE_PANEL', open: true }, 2200);
      window.close();
    } catch (_) {
      setStatus('err', '打开失败，请刷新页面');
      els.openBtn.disabled = true;
      els.openLabel.textContent = '打开失败';
      els.refreshBtn.hidden = false;
    }
  });

  els.refreshBtn.addEventListener('click', () => {
    if (!activeTab || !activeTab.id) return;
    chrome.tabs.reload(activeTab.id, () => {
      window.close();
    });
  });

  els.settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  init();
})();
