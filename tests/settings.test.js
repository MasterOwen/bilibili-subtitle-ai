'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Settings = require('../shared/settings.js');

test('normalizes and clamps settings', () => {
  const settings = Settings.normalizeSettings({
    apiBaseUrl: ' https://api.example.com/v1/ ',
    apiKey: '  sk-test  ',
    apiKeys: {
      ' OpenCode.AI ': '  oc_sk_test  ',
      'api.deepseek.com': 'sk-deep',
      'bad host': 'nope',
      '': 'nope',
    },
    model: ' model-x ',
    language: 'xx',
    style: 'unknown',
    chunkChars: 99999,
    customPrompt: 'x'.repeat(2000),
    txtTimestamps: 1,
    includeHeader: 0,
  });
  assert.equal(settings.apiBaseUrl, 'https://api.example.com/v1');
  assert.equal(settings.apiKey, 'sk-test');
  assert.deepEqual(settings.apiKeys, {
    'opencode.ai': 'oc_sk_test',
    'api.deepseek.com': 'sk-deep',
  });
  assert.equal(settings.model, 'model-x');
  assert.equal(settings.language, 'zh');
  assert.equal(settings.style, 'structured');
  assert.equal(settings.chunkChars, 30000);
  assert.equal(settings.customPrompt.length, 1500);
  assert.equal(settings.txtTimestamps, true);
  assert.equal(settings.includeHeader, false);
});

test('builds Chat Completions URLs from common base URLs', () => {
  assert.equal(
    Settings.buildChatCompletionsUrl('https://api.deepseek.com/v1'),
    'https://api.deepseek.com/v1/chat/completions',
  );
  assert.equal(
    Settings.buildChatCompletionsUrl('https://api.deepseek.com/'),
    'https://api.deepseek.com/v1/chat/completions',
  );
  assert.equal(
    Settings.buildChatCompletionsUrl('https://example.com/api/paas/v4'),
    'https://example.com/api/paas/v4/chat/completions',
  );
  assert.equal(
    Settings.buildChatCompletionsUrl('https://example.com/v1/chat/completions/'),
    'https://example.com/v1/chat/completions',
  );
  assert.equal(
    Settings.buildChatCompletionsUrl('https://opencode.ai/inference/go/openai/v1'),
    'https://opencode.ai/inference/go/openai/v1/chat/completions',
  );
  assert.equal(
    Settings.buildChatCompletionsUrl(
      'https://opencode.ai/inference/go/openai/v1/chat/completions',
    ),
    'https://opencode.ai/inference/go/openai/v1/chat/completions',
  );
  assert.throws(() => Settings.buildChatCompletionsUrl('ftp://example.com'), /http/);
  assert.throws(() => Settings.buildChatCompletionsUrl('not a url'), /格式/);
});

test('creates exact optional host permission patterns', () => {
  assert.equal(
    Settings.originPatternFor('https://api.deepseek.com/v1'),
    'https://api.deepseek.com/*',
  );
  assert.equal(
    Settings.originPatternFor('http://127.0.0.1:11434/v1'),
    'http://127.0.0.1/*',
  );
});

test('resolves per-provider API keys by hostname', () => {
  const keys = {
    'opencode.ai': 'oc_sk_test',
    'api.deepseek.com': 'sk-deep',
  };
  assert.equal(Settings.hostnameFor('https://opencode.ai/inference/go/openai/v1'), 'opencode.ai');
  assert.equal(Settings.hostnameFor('http://127.0.0.1:11434/v1'), '127.0.0.1');
  assert.equal(Settings.hostnameFor('not a url'), '');
  assert.equal(
    Settings.apiKeyForHost(keys, 'https://opencode.ai/inference/go/openai/v1/chat/completions'),
    'oc_sk_test',
  );
  assert.equal(Settings.apiKeyForHost(keys, 'https://api.openai.com/v1'), '');
  assert.equal(Settings.apiKeyForHost(null, 'https://opencode.ai/v1'), '');
});

test('detects provider presets and configuration completeness', () => {
  assert.equal(Settings.DEFAULTS.model, Settings.PRESETS.deepseek.model);
  assert.equal(Settings.DEFAULTS.apiBaseUrl, Settings.PRESETS.deepseek.apiBaseUrl);
  assert.equal(
    Settings.presetForSettings({
      apiBaseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-flash',
    }),
    'deepseek',
  );
  assert.equal(
    Settings.presetForSettings({
      apiBaseUrl: 'https://opencode.ai/inference/go/openai/v1',
      model: 'deepseek-v4.1-flash',
    }),
    'opencodeGo',
  );
  assert.equal(
    Settings.presetForSettings({
      apiBaseUrl: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
      model: 'deepseek-v4.1-flash',
    }),
    'opencodeGo',
  );
  assert.equal(
    Settings.presetForSettings({ apiBaseUrl: 'https://my-gateway.example/v1', model: 'custom' }),
    'custom',
  );
  assert.equal(
    Settings.isConfigured({ apiBaseUrl: 'https://x', apiKey: 'k', model: 'm' }),
    true,
  );
  assert.equal(Settings.isConfigured({ apiBaseUrl: 'https://x', apiKey: '', model: 'm' }), false);
});
