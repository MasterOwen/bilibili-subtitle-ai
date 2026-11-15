(function () {
  'use strict';

  const Settings = globalThis.BiliSubSettings;
  if (!Settings) return;

  const PRESET_ORDER = ['deepseek', 'opencodeGo', 'openai', 'siliconflow', 'zhipu', 'custom'];
  const PRESET_SUBTITLE = {
    deepseek: 'api.deepseek.com',
    opencodeGo: 'opencode.ai',
    openai: 'api.openai.com',
    siliconflow: 'api.siliconflow.cn',
    zhipu: 'open.bigmodel.cn',
    custom: '任意兼容接口',
  };

  const els = {
    presetGrid: document.getElementById('presetGrid'),
    apiBaseUrl: document.getElementById('apiBaseUrl'),
    apiKey: document.getElementById('apiKey'),
    model: document.getElementById('model'),
    language: document.getElementById('language'),
    style: document.getElementById('style'),
    styleHints: document.getElementById('styleHints'),
    chunkChars: document.getElementById('chunkChars'),
    chunkOutput: document.getElementById('chunkOutput'),
    customPrompt: document.getElementById('customPrompt'),
    promptCount: document.getElementById('promptCount'),
    txtTimestamps: document.getElementById('txtTimestamps'),
    includeHeader: document.getElementById('includeHeader'),
    revealKey: document.getElementById('revealKey'),
    testBtn: document.getElementById('testBtn'),
    testLabel: document.getElementById('testLabel'),
    testResult: document.getElementById('testResult'),
    saveBtn: document.getElementById('saveBtn'),
    saveStatus: document.getElementById('saveStatus'),
    version: document.getElementById('version'),
  };

  let activePreset = 'deepseek';
  let testing = false;
  let savedSnapshot = '';

  function getPresetHost(key) {
    return PRESET_SUBTITLE[key] || '';
  }

  function renderPresets() {
    els.presetGrid.replaceChildren();
    for (const key of PRESET_ORDER) {
      const preset = Settings.PRESETS[key];
      if (!preset) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset';
      button.dataset.preset = key;
      button.setAttribute('aria-pressed', key === activePreset ? 'true' : 'false');
      if (preset.hint) button.title = preset.hint;
      const label = document.createElement('strong');
      label.textContent = preset.label;
      const sub = document.createElement('small');
      sub.textContent = key === 'custom' ? '自定义' : getPresetHost(key);
      button.append(label, sub);
      button.addEventListener('click', () => selectPreset(key));
      els.presetGrid.appendChild(button);
    }
    markActivePreset();
  }

  function markActivePreset() {
    els.presetGrid.querySelectorAll('.preset').forEach((button) => {
      const active = button.dataset.preset === activePreset;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function selectPreset(key) {
    activePreset = key;
    markActivePreset();
    const preset = Settings.PRESETS[key];
    if (!preset || key === 'custom') {
      els.apiBaseUrl.focus();
      return;
    }
    els.apiBaseUrl.value = preset.apiBaseUrl;
    els.model.value = preset.model;
    clearResult();
  }

  function syncPresetFromFields() {
    try {
      const next = Settings.presetForSettings({
        apiBaseUrl: els.apiBaseUrl.value,
        model: els.model.value,
      });
      if (next !== activePreset) {
        activePreset = next;
        markActivePreset();
      }
    } catch (_) {
      /* keep current preset while typing */
    }
  }

  function renderStyleHints() {
    els.styleHints.replaceChildren();
    for (const style of Settings.STYLES) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'style-hint';
      item.dataset.style = style.value;
      const label = document.createElement('b');
      label.textContent = style.label;
      const hint = document.createElement('small');
      hint.textContent = style.hint;
      item.append(label, hint);
      item.title = style.hint;
      item.addEventListener('click', () => {
        els.style.value = style.value;
        syncStyleHints();
      });
      els.styleHints.appendChild(item);
    }
    syncStyleHints();
  }

  function syncStyleHints() {
    els.styleHints.querySelectorAll('.style-hint').forEach((item) => {
      item.classList.toggle('is-active', item.dataset.style === els.style.value);
    });
  }

  function updateChunkOutput() {
    els.chunkOutput.textContent = `${els.chunkChars.value} 字`;
  }

  function updatePromptCount() {
    els.promptCount.textContent = String(els.customPrompt.value.length);
  }

  function readForm() {
    return Settings.normalizeSettings({
      apiBaseUrl: els.apiBaseUrl.value,
      apiKey: els.apiKey.value,
      model: els.model.value,
      language: els.language.value,
      style: els.style.value,
      chunkChars: Number(els.chunkChars.value),
      customPrompt: els.customPrompt.value,
      txtTimestamps: els.txtTimestamps.checked,
      includeHeader: els.includeHeader.checked,
    });
  }

  function fillForm(settings) {
    els.apiBaseUrl.value = settings.apiBaseUrl;
    els.apiKey.value = settings.apiKey;
    els.model.value = settings.model;
    els.language.value = settings.language;
    els.style.value = settings.style;
    els.chunkChars.value = String(settings.chunkChars);
    els.customPrompt.value = settings.customPrompt;
    els.txtTimestamps.checked = settings.txtTimestamps;
    els.includeHeader.checked = settings.includeHeader;
    activePreset = Settings.presetForSettings(settings);
    updateChunkOutput();
    updatePromptCount();
    syncStyleHints();
    markActivePreset();
    savedSnapshot = JSON.stringify(settings);
  }

  function clearResult() {
    els.testResult.className = 'result-line';
    els.testResult.textContent = '';
  }

  function setResult(text, kind) {
    els.testResult.className = `result-line is-visible ${kind || ''}`.trim();
    els.testResult.textContent = text;
  }

  function setSaveStatus(text, kind) {
    els.saveStatus.className = `save-status ${kind || ''}`.trim();
    els.saveStatus.textContent = text;
  }

  function validateConfig(config, requireAll) {
    if (!config.apiBaseUrl) {
      if (requireAll) return '请先填写 API Base URL';
      return '';
    }
    try {
      Settings.assertHttpUrl(config.apiBaseUrl);
    } catch (error) {
      return error.message;
    }
    if (requireAll) {
      if (!config.apiKey) return '请先填写 API Key';
      if (!config.model) return '请先填写模型名称';
    } else if (config.apiKey && !config.model) {
      return '已填写 API Key，还需要填写模型名称';
    }
    return '';
  }

  function requestOriginPermission(config) {
    return new Promise((resolve) => {
      let pattern;
      try {
        pattern = Settings.originPatternFor(config.apiBaseUrl);
      } catch (error) {
        resolve({ granted: false, error: error.message });
        return;
      }
      try {
        chrome.permissions.request({ origins: [pattern] }, (granted) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            resolve({ granted: false, error: runtimeError.message || '无法请求域名权限' });
            return;
          }
          resolve({ granted: Boolean(granted), pattern });
        });
      } catch (error) {
        resolve({ granted: false, error: error.message || '无法请求域名权限' });
      }
    });
  }

  function sendRuntimeMessage(message, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('请求超时，请检查网络后重试'));
      }, timeoutMs || 60000);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || '扩展后台不可用'));
            return;
          }
          if (!response) {
            reject(new Error('扩展后台没有返回数据，请重新加载扩展'));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('扩展后台不可用，请重新加载扩展'));
      }
    });
  }

  function setTesting(value) {
    testing = value;
    els.testBtn.disabled = value;
    els.saveBtn.disabled = value;
    els.testLabel.textContent = value ? '测试中…' : '测试连接';
    els.testBtn.querySelector('.btn-spinner').hidden = !value;
  }

  async function onTest() {
    if (testing) return;
    const config = readForm();
    const validation = validateConfig(config, true);
    if (validation) {
      setResult(validation, 'err');
      return;
    }

    setTesting(true);
    clearResult();
    setResult('正在请求 API 域名权限…', 'warn');
    const permission = await requestOriginPermission(config);
    if (!permission.granted) {
      setTesting(false);
      setResult(
        `未获得 ${permission.pattern || 'API 域名'} 的访问权限。测试和生成总结都需要该权限，请重试并点击“允许”。`,
        'err',
      );
      return;
    }

    setResult('正在连接 AI 服务，请稍候…', 'warn');
    let response = null;
    try {
      response = await sendRuntimeMessage(
        { type: 'TEST_AI', config },
        60000,
      );
      if (!response.ok) throw new Error(response.error || '连接失败');
      const model = (response.result && response.result.model) || config.model;
      setResult(`连接成功 · ${model}`, 'ok');
    } catch (error) {
      let message = error.message || '连接失败';
      // A stale MV3 service worker keeps running the previous ai.js after the
      // files are replaced unless the extension itself is reloaded.
      if (/x-opencode-session|MissingSessionID/i.test(message)) {
        const version =
          response && response.version ? `v${response.version}` : '未知（后台未上报，可能是旧版本）';
        const feature =
          response && response.features && response.features.openCodeSession
            ? '已加载会话头支持'
            : '未加载会话头支持';
        message += `（后台 ${version}，${feature}；请到 chrome://extensions 点击扩展的“重新加载”，再关闭重开本页后重试）`;
      }
      setResult(message, 'err');
    } finally {
      setTesting(false);
    }
  }

  async function onSave() {
    if (testing) return;
    const config = readForm();
    const validation = validateConfig(config, false);
    if (validation) {
      setSaveStatus(validation, 'err');
      return;
    }

    let permission = { granted: true };
    if (config.apiBaseUrl && config.apiKey && config.model) {
      permission = await requestOriginPermission(config);
    }
    try {
      await Settings.saveSettings(config);
      savedSnapshot = JSON.stringify(config);
      if (permission.granted) {
        setSaveStatus('已保存，设置已自动生效。', 'ok');
      } else {
        setSaveStatus(
          '已保存，但未授权 API 域名；生成总结前请重新保存并允许访问该域名。',
          'warn',
        );
      }
    } catch (error) {
      setSaveStatus(error.message || '保存失败', 'err');
    }
  }

  function onRevealKey() {
    const isPassword = els.apiKey.type === 'password';
    els.apiKey.type = isPassword ? 'text' : 'password';
    els.revealKey.setAttribute('aria-label', isPassword ? '隐藏 API Key' : '显示 API Key');
  }

  function isDirty() {
    return JSON.stringify(readForm()) !== savedSnapshot;
  }

  async function init() {
    renderPresets();
    renderStyleHints();
    els.style.addEventListener('change', syncStyleHints);
    els.chunkChars.addEventListener('input', updateChunkOutput);
    els.customPrompt.addEventListener('input', updatePromptCount);
    els.apiBaseUrl.addEventListener('input', syncPresetFromFields);
    els.model.addEventListener('input', syncPresetFromFields);
    for (const input of [els.apiBaseUrl, els.apiKey, els.model]) {
      input.addEventListener('input', clearResult);
    }
    els.revealKey.addEventListener('click', onRevealKey);
    els.testBtn.addEventListener('click', onTest);
    els.saveBtn.addEventListener('click', onSave);

    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSave();
      }
    });

    window.addEventListener('beforeunload', (event) => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    });

    // The options page can be reloaded from disk while Chrome still runs the
    // previous MV3 service worker. Warn before the user hits a confusing 400.
    try {
      const ping = await sendRuntimeMessage({ type: 'PING' }, 5000);
      if (ping && ping.ok && ping.version && !(ping.features && ping.features.openCodeSession)) {
        setSaveStatus(
          `扩展后台仍是旧版本 v${ping.version}，请到 chrome://extensions 点击“重新加载”后再测试。`,
          'warn',
        );
      }
    } catch (_) {
      /* Background may be starting; the test button reports failures. */
    }

    try {
      const settings = await Settings.loadSettings();
      fillForm(settings);
    } catch (error) {
      fillForm(Settings.normalizeSettings(Settings.DEFAULTS));
      setSaveStatus(`读取设置失败：${error.message || '未知错误'}`, 'err');
    }

    try {
      if (chrome.runtime && chrome.runtime.getManifest) {
        els.version.textContent = chrome.runtime.getManifest().version;
      }
    } catch (_) {
      /* ignore */
    }
  }

  init();
})();
