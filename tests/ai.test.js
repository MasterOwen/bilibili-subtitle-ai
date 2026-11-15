'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.BiliSubUtils = require('../shared/utils.js');
globalThis.BiliSubSettings = require('../shared/settings.js');
require('../background/ai.js');

const AI = globalThis.BiliAI;
const originalFetch = globalThis.fetch;

function jsonResponse(payload, status) {
  return {
    ok: (status || 200) >= 200 && (status || 200) < 300,
    status: status || 200,
    text: async () => JSON.stringify(payload),
  };
}

function config(overrides) {
  return Object.assign(
    {
      apiBaseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      language: 'zh',
      style: 'structured',
      chunkChars: 3000,
      customPrompt: '',
    },
    overrides || {},
  );
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('callChat sends a Chat Completions request and extracts content', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return jsonResponse({
      choices: [{ message: { content: '## 总结\n内容' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  };
  const result = await AI.callChat({
    config: config(),
    messages: [{ role: 'user', content: 'ping' }],
    maxTokens: 100,
    retries: 0,
  });
  assert.equal(captured.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.Authorization, 'Bearer sk-test');
  assert.equal(captured.body.model, 'deepseek-chat');
  assert.equal(captured.body.max_tokens, 100);
  assert.equal(captured.body.stream, false);
  assert.equal(result.content, '## 总结\n内容');
  assert.equal(result.usage.totalTokens, 15);
});

test('callChat maps provider errors to useful Chinese messages', async () => {
  globalThis.fetch = async () =>
    jsonResponse({ error: { message: 'invalid api key' } }, 401);
  await assert.rejects(
    () =>
      AI.callChat({
        config: config(),
        messages: [{ role: 'user', content: 'ping' }],
        retries: 0,
      }),
    /API Key 无效.*invalid api key/,
  );
});

test('summarizeVideo uses a single request for short transcripts', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({
      choices: [{ message: { content: '# 视频总结\n## 一句话概括\n这是一个测试总结。' } }],
    });
  };
  const result = await AI.summarizeVideo({
    video: { title: '测试', duration: 60, owner: 'UP' },
    segments: [
      { from: 0, to: 5, content: '第一句话' },
      { from: 5, to: 10, content: '第二句话' },
    ],
    config: config({ chunkChars: 3000 }),
  });
  assert.equal(calls, 1);
  assert.doesNotMatch(result.summary, /^# 视频总结/);
  assert.match(result.summary, /一句话概括/);
  assert.equal(result.stats.calls, 1);
  assert.equal(result.stats.chunks, 1);
});

test('summarizeVideo maps and reduces long transcripts', async () => {
  const segments = [];
  for (let i = 0; i < 240; i += 1) {
    segments.push({
      from: i * 4,
      to: i * 4 + 3,
      content: `第${i + 1}段字幕，讲述一个具体的观点、例子和结论，用于测试长字幕的分段总结流程。`,
    });
  }
  let mapCalls = 0;
  let finalCalls = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const user = body.messages[1].content;
    if (user.includes('信息笔记')) {
      mapCalls += 1;
      return jsonResponse({
        choices: [{ message: { content: `- [00:${String(mapCalls).padStart(2, '0')}] 第${mapCalls}段要点` } }],
      });
    }
    if (user.includes('分段笔记')) {
      finalCalls += 1;
      return jsonResponse({
        choices: [{ message: { content: '## 一句话概括\n合并后的总结。\n\n## 核心要点\n- 要点' } }],
      });
    }
    throw new Error(`unexpected prompt: ${user.slice(0, 60)}`);
  };

  const progress = [];
  const result = await AI.summarizeVideo({
    video: { title: '长视频', duration: 960, owner: 'UP' },
    segments,
    config: config({ chunkChars: 3000 }),
    onProgress: (event) => progress.push(event),
  });
  assert.ok(mapCalls >= 2, `expected multiple map calls, got ${mapCalls}`);
  assert.equal(finalCalls, 1);
  assert.match(result.summary, /合并后的总结/);
  assert.equal(result.stats.calls, mapCalls + finalCalls);
  assert.ok(progress.some((event) => event.phase === 'map'));
  assert.ok(progress.some((event) => event.phase === 'final'));
});
