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
  assert.equal(captured.init.headers['x-opencode-session'], undefined);
  assert.equal(captured.body.model, 'deepseek-chat');
  assert.equal(captured.body.max_tokens, 100);
  assert.equal(captured.body.stream, false);
  assert.equal(result.content, '## 总结\n内容');
  assert.equal(result.usage.totalTokens, 15);
});

test('callChat streams SSE deltas into one answer', async () => {
  const encoder = new TextEncoder();
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.stream, true);
    assert.equal(init.headers.Accept, 'text/event-stream');
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"第一"}}]}\n'),
        );
        controller.enqueue(
          encoder.encode(
            '\ndata: {"choices":[{"delta":{"content":"段"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          ),
        );
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  };
  const deltas = [];
  let resets = 0;
  const result = await AI.callChat({
    config: config(),
    messages: [{ role: 'user', content: '流式测试' }],
    stream: true,
    onDelta: (text) => deltas.push(text),
    onReset: () => {
      resets += 1;
    },
  });
  assert.equal(result.content, '第一段');
  assert.equal(result.finishReason, 'stop');
  assert.deepEqual(deltas, ['第一', '段']);
  assert.equal(resets, 1);
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

test('buildManualPrompt returns a self-contained prompt without calling the API', () => {
  const prompt = AI.buildManualPrompt({
    video: {
      title: '测试视频',
      owner: 'UP主A',
      duration: 125,
      pageCount: 2,
      pageNo: 1,
    },
    segments: [
      { from: 5, to: 8, content: '第一句字幕' },
      { from: 65, to: 70, content: '第二句字幕' },
    ],
    config: config({ style: 'notes', language: 'zh', customPrompt: '请突出操作步骤' }),
  });
  assert.match(prompt, /视频标题：测试视频/);
  assert.match(prompt, /UP 主：UP主A/);
  assert.match(prompt, /视频时长：02:05/);
  assert.match(prompt, /分P：P1\/2/);
  assert.match(prompt, /\[00:05\] 第一句字幕/);
  assert.match(prompt, /\[01:05\] 第二句字幕/);
  assert.match(prompt, /输出风格：输出详细、可复习的视频笔记/);
  assert.match(prompt, /请突出操作步骤/);
  assert.match(prompt, /请使用简体中文输出/);
  assert.throws(
    () => AI.buildManualPrompt({ video: {}, segments: [], config: config() }),
    /字幕内容为空/,
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

test('summarizeVideo retries truncated map notes and keeps every chunk', async () => {
  const segments = [];
  for (let i = 0; i < 120; i += 1) {
    segments.push({
      from: i * 2,
      to: i * 2 + 1,
      content: '这是一个用于测试分段总结的字幕句子，包含足够的长度来触发分段。',
    });
  }
  let mapAttempts = 0;
  let retriedFirstChunk = false;
  let finalPrompt = '';
  const budgets = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const user = body.messages[1].content;
    if (user.includes('信息笔记')) {
      mapAttempts += 1;
      const part = Number((user.match(/第 (\d+)\/\d+ 部分/) || [])[1]);
      budgets.push({ part, maxTokens: body.max_tokens });
      if (part === 1 && !retriedFirstChunk) {
        retriedFirstChunk = true;
        assert.equal(body.max_tokens, 3000);
        return jsonResponse({
          choices: [
            {
              message: { content: '- [00:00] 第一段笔记被截断' },
              finish_reason: 'length',
            },
          ],
        });
      }
      return jsonResponse({
        choices: [
          {
            message: { content: `- [00:01] 第${part}段完整笔记` },
            finish_reason: 'stop',
          },
        ],
      });
    }
    if (user.includes('分段笔记')) {
      finalPrompt = user;
      return jsonResponse({
        choices: [
          {
            message: { content: '## 一句话概括\n完整总结' },
            finish_reason: 'stop',
          },
        ],
      });
    }
    throw new Error(`unexpected prompt: ${user.slice(0, 60)}`);
  };

  const result = await AI.summarizeVideo({
    video: { title: '长视频', duration: 240, owner: 'UP' },
    segments,
    config: config({ chunkChars: 3000 }),
  });
  assert.equal(result.stats.chunks, 2);
  assert.equal(mapAttempts, 3);
  assert.deepEqual(budgets, [
    { part: 1, maxTokens: 3000 },
    { part: 1, maxTokens: 5000 },
    { part: 2, maxTokens: 3000 },
  ]);
  assert.match(finalPrompt, /第1段完整笔记/);
  assert.match(finalPrompt, /第2段完整笔记/);
  assert.doesNotMatch(finalPrompt, /被截断/);
});

test('summarizeVideo splits a chunk that still exceeds the output budget', async () => {
  const segments = [];
  for (let i = 0; i < 120; i += 1) {
    segments.push({
      from: i * 2,
      to: i * 2 + 1,
      content: '这是一个用于测试超长分段拆分的字幕句子，包含足够的长度来触发分段。',
    });
  }
  let mapCalls = 0;
  let finalPrompt = '';
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const user = body.messages[1].content;
    if (user.includes('信息笔记')) {
      mapCalls += 1;
      if (user.includes('第 1/2 部分（上）')) {
        return jsonResponse({
          choices: [
            {
              message: { content: '- [00:00] 上半段完整笔记' },
              finish_reason: 'stop',
            },
          ],
        });
      }
      if (user.includes('第 1/2 部分（下）')) {
        return jsonResponse({
          choices: [
            {
              message: { content: '- [00:01] 下半段完整笔记' },
              finish_reason: 'stop',
            },
          ],
        });
      }
      if (user.includes('第 1/2 部分')) {
        return jsonResponse({
          choices: [
            {
              message: { content: '- 一直截断' },
              finish_reason: 'length',
            },
          ],
        });
      }
      return jsonResponse({
        choices: [
          {
            message: { content: '- [00:02] 第二段完整笔记' },
            finish_reason: 'stop',
          },
        ],
      });
    }
    if (user.includes('分段笔记')) {
      finalPrompt = user;
      return jsonResponse({
        choices: [
          {
            message: { content: '## 一句话概括\n拆分后的完整总结' },
            finish_reason: 'stop',
          },
        ],
      });
    }
    throw new Error(`unexpected prompt: ${user.slice(0, 60)}`);
  };

  const result = await AI.summarizeVideo({
    video: { title: '长视频', duration: 240, owner: 'UP' },
    segments,
    config: config({ chunkChars: 3000 }),
  });
  assert.equal(result.stats.chunks, 2);
  assert.equal(mapCalls, 6);
  assert.match(finalPrompt, /上半段完整笔记/);
  assert.match(finalPrompt, /下半段完整笔记/);
  assert.match(finalPrompt, /第二段完整笔记/);
});

test('summarizeVideo fails instead of silently dropping an empty chunk note', async () => {
  const segments = [];
  for (let i = 0; i < 120; i += 1) {
    segments.push({
      from: i * 2,
      to: i * 2 + 1,
      content: '这是一个用于测试空分段笔记的字幕句子，包含足够的长度来触发分段。',
    });
  }
  let mapCalls = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const user = body.messages[1].content;
    if (user.includes('信息笔记')) {
      mapCalls += 1;
      return jsonResponse({
        choices: [
          {
            message: { content: '' },
            finish_reason: 'stop',
          },
        ],
      });
    }
    throw new Error('final summary should not run without map notes');
  };

  await assert.rejects(
    () =>
      AI.summarizeVideo({
        video: { title: '长视频', duration: 240, owner: 'UP' },
        segments,
        config: config({ chunkChars: 3000 }),
      }),
    /第 1\/2 段字幕提炼失败.*没有返回有效内容/,
  );
  assert.equal(mapCalls, 3);
});

test('OpenCode Go requests share one stable session header', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, session: init.headers['x-opencode-session'] });
    const user = JSON.parse(init.body).messages[1].content;
    if (user.includes('信息笔记')) {
      return jsonResponse({ choices: [{ message: { content: '- [00:01] 分段要点' } }] });
    }
    if (user.includes('分段笔记')) {
      return jsonResponse({ choices: [{ message: { content: '## 一句话概括\n合并后的总结。' } }] });
    }
    return jsonResponse({ choices: [{ message: { content: '## 一句话概括\n直接总结。' } }] });
  };

  const segments = [];
  for (let i = 0; i < 120; i += 1) {
    segments.push({
      from: i * 4,
      to: i * 4 + 3,
      content: `第${i + 1}段字幕，包含一个观点、一个例子和一个结论，用来触发分段总结。`,
    });
  }

  const result = await AI.summarizeVideo({
    video: { title: 'OpenCode Go 测试', duration: 480 },
    segments,
    config: config({
      apiBaseUrl: 'https://opencode.ai/inference/go/openai/v1',
      model: 'deepseek-v4.1-flash',
      chunkChars: 3000,
    }),
  });

  assert.ok(seen.length >= 2, `expected multiple requests, got ${seen.length}`);
  assert.ok(
    seen.every((item) => item.url === 'https://opencode.ai/inference/go/openai/v1/chat/completions'),
  );
  assert.match(seen[0].session, /^ses_[0-9a-f]{32}$/);
  assert.ok(seen.every((item) => item.session === seen[0].session), 'session id must stay stable');
  assert.match(result.summary, /合并后的总结/);
});

test('testConnection sends an OpenCode Go session header', async () => {
  let session;
  globalThis.fetch = async (url, init) => {
    session = init.headers['x-opencode-session'];
    return jsonResponse({ choices: [{ message: { content: 'OK' } }] });
  };
  const result = await AI.testConnection(
    config({
      apiBaseUrl: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
      model: 'deepseek-v4.1-flash',
    }),
  );
  assert.equal(result.ok, true);
  assert.match(session, /^ses_[0-9a-f]{32}$/);
});
