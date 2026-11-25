/*
 * Settings defaults, validation and API URL helpers. UMD so the same file can
 * be imported by the MV3 service worker, options page and Node tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.BiliSubSettings = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SETTINGS_KEY = 'settings';

  const DEFAULTS = Object.freeze({
    apiBaseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    apiKeys: {},
    model: 'deepseek-flash',
    language: 'zh',
    style: 'structured',
    thinking: 'auto',
    chunkChars: 7000,
    customPrompt: '',
    txtTimestamps: false,
    includeHeader: true,
  });

  const PRESETS = Object.freeze({
    deepseek: {
      label: 'DeepSeek',
      apiBaseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-flash',
      hint: '在 platform.deepseek.com 创建 API Key',
    },
    opencodeGo: {
      label: 'OpenCode Go',
      apiBaseUrl: 'https://opencode.ai/inference/go/openai/v1',
      model: 'deepseek-v4.1-flash',
      hint: '需要 OpenCode Go 订阅；扩展会自动附加 x-opencode-session 会话头',
    },
    openai: {
      label: 'OpenAI',
      apiBaseUrl: 'https://api.openai.com/v1',
      model: 'gpt-6.2-sol',
      hint: '在 platform.openai.com 创建 API Key',
    },
    siliconflow: {
      label: '硅基流动',
      apiBaseUrl: 'https://api.siliconflow.cn/v1',
      model: 'deepseek-ai/DeepSeek-V4.1-Flash',
      hint: '在 cloud.siliconflow.cn 创建 API Key',
    },
    zhipu: {
      label: '智谱 GLM',
      apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-5.3',
      hint: '在 open.bigmodel.cn 创建 API Key',
    },
    custom: {
      label: '自定义 / 本地模型',
      apiBaseUrl: '',
      model: '',
      hint: '支持 OpenAI Chat Completions 兼容接口',
    },
  });

  const STYLES = Object.freeze([
    { value: 'structured', label: '结构化摘要', hint: '概括 + 要点 + 分章节脉络 + 结论' },
    { value: 'brief', label: '精简要点', hint: '3-5 句概括 + 高密度要点，适合快速了解' },
    { value: 'notes', label: '详细笔记', hint: '按主题展开，保留解释、例子和步骤' },
    { value: 'study', label: '学习提纲', hint: '概念、框架、重点难点与复习问题' },
    {
      value: 'transcript',
      label: '逐字稿',
      hint: '保留口播语气：修错字、补标点、分段，不改成书面腔',
    },
  ]);

  const LANGUAGES = Object.freeze([
    { value: 'zh', label: '简体中文' },
    { value: 'en', label: 'English' },
    { value: 'source', label: '跟随字幕语言' },
  ]);

  /**
   * Reasoning budget. "auto" sends nothing and keeps the provider default;
   * the other levels are translated per provider in background/ai.js and are
   * silently dropped when an endpoint rejects the parameter.
   */
  const THINKING_LEVELS = Object.freeze([
    { value: 'auto', label: '跟随模型默认', hint: '不发送推理参数，由服务商和模型决定' },
    { value: 'low', label: '低', hint: '尽量降低推理量，响应更快；部分服务商不支持' },
    { value: 'off', label: '关闭（尽量）', hint: '尽量关闭深度思考；推理模型通常无法完全关闭' },
  ]);

  /**
   * API keys are stored per API host so switching providers does not carry one
   * provider's key over to another. Hostnames are the same key used by the
   * host permission patterns.
   */
  function normalizeApiKeys(raw) {
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const result = {};
    let count = 0;
    for (const [rawHost, rawKey] of Object.entries(input)) {
      if (count >= 20) break;
      const host = String(rawHost == null ? '' : rawHost)
        .trim()
        .toLowerCase()
        .slice(0, 253);
      if (!host || /[\s\\/]/.test(host) || host === '__proto__' || host === 'prototype') continue;
      const key = String(rawKey == null ? '' : rawKey).trim().slice(0, 2000);
      if (!key) continue;
      result[host] = key;
      count += 1;
    }
    return result;
  }

  function normalizeSettings(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const pick = (key) => (input[key] === undefined ? DEFAULTS[key] : input[key]);
    const chunk = Number(pick('chunkChars'));
    const styleValue = String(pick('style') || DEFAULTS.style);
    const languageValue = String(pick('language') || DEFAULTS.language);
    const thinkingValue = String(pick('thinking') || DEFAULTS.thinking);
    return {
      apiBaseUrl: String(pick('apiBaseUrl') || '').trim().replace(/\/+$/, ''),
      apiKey: String(pick('apiKey') || '').trim(),
      apiKeys: normalizeApiKeys(pick('apiKeys')),
      model: String(pick('model') || '').trim(),
      language: LANGUAGES.some((item) => item.value === languageValue) ? languageValue : DEFAULTS.language,
      style: STYLES.some((item) => item.value === styleValue) ? styleValue : DEFAULTS.style,
      thinking: THINKING_LEVELS.some((item) => item.value === thinkingValue)
        ? thinkingValue
        : DEFAULTS.thinking,
      chunkChars: Number.isFinite(chunk) ? Math.min(30000, Math.max(3000, Math.round(chunk / 500) * 500)) : DEFAULTS.chunkChars,
      customPrompt: String(pick('customPrompt') || '').trim().slice(0, 1500),
      txtTimestamps: Boolean(pick('txtTimestamps')),
      includeHeader: Boolean(pick('includeHeader')),
    };
  }

  async function loadSettings() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return normalizeSettings(DEFAULTS);
    }
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return normalizeSettings(stored && stored[SETTINGS_KEY]);
  }

  async function saveSettings(settings) {
    const normalized = normalizeSettings(settings);
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return normalized;
    }
    await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
    return normalized;
  }

  function isConfigured(settings) {
    return Boolean(settings && settings.apiBaseUrl && settings.apiKey && settings.model);
  }

  function assertHttpUrl(value) {
    let url;
    try {
      url = new URL(String(value || '').trim());
    } catch (_) {
      throw new Error('API Base URL 格式不正确');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('API Base URL 必须以 http:// 或 https:// 开头');
    }
    return url;
  }

  /** Hostname used as the per-provider API key bucket. */
  function hostnameFor(baseUrl) {
    try {
      return assertHttpUrl(baseUrl).hostname.toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function apiKeyForHost(apiKeys, baseUrl) {
    const host = hostnameFor(baseUrl);
    if (!host || !apiKeys || typeof apiKeys !== 'object') return '';
    const value = apiKeys[host];
    return typeof value === 'string' ? value : '';
  }

  /**
   * Accepts a base URL (…/v1, …/v1/) or a full …/chat/completions URL.
   */
  function buildChatCompletionsUrl(baseUrl) {
    const url = assertHttpUrl(baseUrl);
    const path = url.pathname.replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(path)) {
      url.pathname = path;
      url.search = '';
      url.hash = '';
      return url.href;
    }
    url.pathname = `${path || '/v1'}/chat/completions`.replace(/\/{2,}/g, '/');
    url.search = '';
    url.hash = '';
    return url.href;
  }

  function originPatternFor(baseUrl) {
    const url = assertHttpUrl(baseUrl);
    // Extension match patterns do not include ports; omitting the port grants
    // the host for all ports (needed by local OpenAI-compatible servers).
    return `${url.protocol}//${url.hostname}/*`;
  }

  function presetForSettings(settings) {
    const base = String((settings && settings.apiBaseUrl) || '').replace(/\/+$/, '').toLowerCase();
    const model = String((settings && settings.model) || '').toLowerCase();
    for (const [key, preset] of Object.entries(PRESETS)) {
      if (key === 'custom') continue;
      if (preset.apiBaseUrl.replace(/\/+$/, '').toLowerCase() === base) return key;
      if (preset.model.toLowerCase() === model && base.includes(new URL(preset.apiBaseUrl).hostname)) return key;
    }
    return 'custom';
  }

  return {
    SETTINGS_KEY,
    DEFAULTS,
    PRESETS,
    STYLES,
    LANGUAGES,
    THINKING_LEVELS,
    normalizeSettings,
    loadSettings,
    saveSettings,
    isConfigured,
    buildChatCompletionsUrl,
    assertHttpUrl,
    hostnameFor,
    apiKeyForHost,
    originPatternFor,
    presetForSettings,
  };
});
