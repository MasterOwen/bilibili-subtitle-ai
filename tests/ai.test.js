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
      model: 'deepseek-flash',
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
      choices: [{ message: { content: '## 总结\n内容', reasoning_content: '先分析字幕结构' } }],
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
  assert.equal(captured.body.model, 'deepseek-flash');
  assert.equal(captured.body.max_tokens, 100);
  assert.equal(captured.body.stream, false);
  assert.equal(result.content, '## 总结\n内容');
  assert.equal(result.reasoning, '先分析字幕结构');
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

test('callChat streams reasoning_content separately from the answer', async () => {
  const encoder = new TextEncoder();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          const events = [
            'data: {"choices":[{"delta":{"reasoning_content":"先想"}}]}\n\n',
            'data: {"choices":[{"delta":{"reasoning_content":"一下"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"结论"}}]}\n\n',
            'data: [DONE]\n\n',
          ];
          for (const event of events) controller.enqueue(encoder.encode(event));
          controller.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
    );
  const reasoning = [];
  const deltas = [];
  const result = await AI.callChat({
    config: config(),
    messages: [{ role: 'user', content: '推理流测试' }],
    stream: true,
    onDelta: (text) => deltas.push(text),
    onReasoning: (text) => reasoning.push(text),
  });
  assert.equal(result.reasoning, '先想一下');
  assert.equal(result.content, '结论');
  assert.deepEqual(reasoning, ['先想', '一下']);
  assert.deepEqual(deltas, ['结论']);
});

test('callChat falls back to reasoning and reasoning_details without duplicating', async () => {
  const encoder = new TextEncoder();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"reasoning":"思考A","reasoning_details":[{"type":"reasoning.text","text":"思考A"}]}}]}\n\n',
            ),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
    );
  const reasoning = [];
  await AI.callChat({
    config: config(),
    messages: [{ role: 'user', content: '字段优先级测试' }],
    stream: true,
    onReasoning: (text) => reasoning.push(text),
  });
  assert.deepEqual(reasoning, ['思考A']);
});

test('summarizeVideo forwards reasoning deltas with the active phase', async () => {
  const encoder = new TextEncoder();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"内部推理"}}]}\n\n'),
          );
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"## 一句话概括 结论。"}}]}\n\n'),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
    );
  const events = [];
  const result = await AI.summarizeVideo({
    video: { title: '测试', duration: 60, owner: 'UP' },
    segments: [
      { from: 0, to: 5, content: '第一句话' },
      { from: 5, to: 10, content: '第二句话' },
    ],
    config: config({ chunkChars: 3000 }),
    onDelta: (event) => events.push(event),
  });
  assert.match(result.summary, /结论/);
  const reasoningEvents = events.filter((event) => event.reasoning === true);
  assert.equal(reasoningEvents.length, 1);
  assert.equal(reasoningEvents[0].text, '内部推理');
  assert.equal(reasoningEvents[0].phase, 'final');
  assert.ok(events.some((event) => event.reasoning !== true && event.text.includes('一句话概括')));
});

test('callChat lowers max_tokens when a provider rejects the requested budget', async () => {
  const budgets = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    budgets.push(body.max_tokens);
    if (budgets.length === 1) {
      return jsonResponse(
        { error: { message: 'max_tokens is too large: 30000; maximum is 8192' } },
        400,
      );
    }
    return jsonResponse({
      choices: [{ message: { content: 'OK' } }],
    });
  };
  const result = await AI.callChat({
    config: config(),
    messages: [{ role: 'user', content: '预算测试' }],
    maxTokens: 30000,
    retries: 2,
  });
  assert.equal(result.content, 'OK');
  assert.deepEqual(budgets, [30000, 8192]);
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
  assert.equal(budgets[0].part, 1);
  assert.ok(budgets[0].maxTokens >= 3000);
  assert.equal(budgets[1].part, 1);
  assert.ok(budgets[1].maxTokens > budgets[0].maxTokens);
  assert.equal(budgets[2].part, 2);
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

test('summarizeVideo writes a transcript in one request for a short video', async () => {
  let captured = '';
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    captured += `${body.messages[0].content}\n${body.messages[1].content}\n`;
    return jsonResponse({
      choices: [
        {
          message: {
            content: '逐字稿：\n\n大家好，呃，今天我们聊怎么把字幕整理成逐字稿，对吧？',
          },
          finish_reason: 'stop',
        },
      ],
    });
  };

  const result = await AI.summarizeVideo({
    video: { title: '逐字稿测试', duration: 60, owner: 'UP' },
    segments: [
      { from: 1, to: 3, content: '嗯，大家好，那我们现在开始。' },
      { from: 3, to: 6, content: '今天讲的是字幕整理。' },
    ],
    config: config({ style: 'transcript', chunkChars: 3000 }),
  });

  assert.match(captured, /口播逐字稿/);
  assert.match(captured, /对吧/);
  assert.match(captured, /不要概括/);
  assert.match(captured, /100-250 字/);
  assert.doesNotMatch(captured, /3-8 个自然段/);
  assert.doesNotMatch(captured, /信息笔记/);
  assert.equal(result.stats.calls, 1);
  assert.equal(result.stats.chunks, 1);
  // The model repeated the prefix; exactly one is kept.
  assert.ok(result.summary.startsWith('逐字稿：'));
  assert.equal(result.summary.match(/逐字稿：/g).length, 1);
  assert.match(result.summary, /今天我们聊怎么把字幕整理成逐字稿/);
});

test('summarizeVideo never condenses a long transcript', async () => {
  const segments = [];
  for (let i = 0; i < 120; i += 1) {
    segments.push({
      from: i * 2,
      to: i * 2 + 1,
      content: `第${i + 1}句：这一段字幕用来测试逐字稿是否按顺序完整保留，不能被合并或概括。`,
    });
  }
  const prompts = [];
  let chunkCalls = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const user = body.messages[1].content;
    prompts.push(user);
    if (user.includes('整理成逐字稿')) {
      chunkCalls += 1;
      const part = user.includes('第 1/2 部分') ? '一' : '二';
      return jsonResponse({
        choices: [
          {
            message: { content: `[00:00] 第${part}段的逐字稿正文。` },
            finish_reason: 'stop',
          },
        ],
      });
    }
    throw new Error(`unexpected prompt: ${user.slice(0, 40)}`);
  };

  const result = await AI.summarizeVideo({
    video: { title: '长逐字稿', duration: 240, owner: 'UP' },
    segments,
    config: config({ style: 'transcript', chunkChars: 3000 }),
  });

  assert.equal(result.stats.chunks, 2);
  assert.equal(chunkCalls, 2);
  assert.equal(result.stats.calls, 2);
  assert.equal(prompts.length, 2, 'transcript must not add merge/final requests');
  assert.ok(prompts.every((prompt) => !prompt.includes('分段笔记')));
  assert.ok(prompts.every((prompt) => !prompt.includes('整合成一份完整')));
  assert.match(result.summary, /### \d{2}:\d{2}–\d{2}:\d{2}/);
  assert.ok(result.summary.startsWith('逐字稿：'));
  const first = result.summary.indexOf('第一段的逐字稿正文');
  const second = result.summary.indexOf('第二段的逐字稿正文');
  assert.ok(first >= 0 && second > first, 'chunks must stay in subtitle order');
});

test('summarizeVideo splits an over-long transcript paragraph without rewriting it', async () => {
  const sentences = [];
  for (let i = 0; i < 24; i += 1) {
    sentences.push(`第${i + 1}句话说了一个完整的意思，大概二十多个字。`);
  }
  const wallOfText = sentences.join('');
  globalThis.fetch = async () =>
    jsonResponse({ choices: [{ message: { content: wallOfText }, finish_reason: 'stop' }] });

  const result = await AI.summarizeVideo({
    video: { title: '分段测试' },
    segments: [{ from: 1, to: 2, content: '一句字幕' }],
    config: config({ style: 'transcript', chunkChars: 3000 }),
  });

  const paragraphs = result.summary
    .replace(/^逐字稿：\n+/, '')
    .split(/\n{2,}/)
    .filter(Boolean);
  assert.ok(paragraphs.length >= 2, `expected several paragraphs, got ${paragraphs.length}`);
  assert.ok(
    paragraphs.every((paragraph) => paragraph.length <= 300),
    `paragraph too long: ${Math.max(...paragraphs.map((p) => p.length))}`,
  );
  // Nothing may be lost or reordered by the split.
  assert.equal(paragraphs.join(''), wallOfText);
});

test('buildManualPrompt follows the selected transcript style', () => {
  const prompt = AI.buildManualPrompt({
    video: { title: '手动逐字稿' },
    segments: [
      { from: 1, to: 2, content: '第一句字幕' },
      { from: 3, to: 4, content: '第二句字幕' },
    ],
    config: config({ style: 'transcript' }),
  });
  assert.match(prompt, /口播逐字稿/);
  assert.match(prompt, /不要概括/);
  assert.match(prompt, /口语/);
  assert.match(prompt, /100-250 字/);
  assert.doesNotMatch(prompt, /## 一句话概括/);
});

test('callChat maps the thinking level to provider-specific parameters', async () => {
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
  };
  async function call(overrides) {
    await AI.callChat({
      config: config(overrides),
      messages: [{ role: 'user', content: 'ping' }],
      retries: 0,
    });
  }

  await call({ thinking: 'low' });
  await call({ thinking: 'off' });
  await call({ thinking: 'auto' });
  await call({ apiBaseUrl: 'https://openrouter.ai/api/v1', thinking: 'low' });
  await call({ apiBaseUrl: 'https://openrouter.ai/api/v1', thinking: 'off' });
  await call({ apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', thinking: 'off' });
  await call({ apiBaseUrl: 'https://api.siliconflow.cn/v1', thinking: 'off' });

  assert.equal(bodies[0].reasoning_effort, 'low');
  assert.equal(bodies[1].reasoning_effort, 'minimal');
  assert.equal(bodies[2].reasoning_effort, undefined);
  assert.equal(bodies[2].reasoning, undefined);
  assert.deepEqual(bodies[3].reasoning, { effort: 'low' });
  assert.deepEqual(bodies[4].reasoning, { enabled: false });
  assert.deepEqual(bodies[5].thinking, { type: 'disabled' });
  assert.equal(bodies[6].enable_thinking, false);
});

test('callChat drops a thinking parameter the endpoint rejects', async () => {
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if ('reasoning_effort' in body) {
      return jsonResponse({ error: { message: "Unknown parameter: 'reasoning_effort'" } }, 400);
    }
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
  };

  const result = await AI.callChat({
    config: config({ thinking: 'low' }),
    messages: [{ role: 'user', content: 'ping' }],
    retries: 1,
  });

  assert.equal(result.content, 'ok');
  assert.equal(bodies.length, 2);
  assert.equal('reasoning_effort' in bodies[1], false);
});

test('callChat reports a timeout when a stream never sends its first token', async () => {
  const started = Date.now();
  globalThis.fetch = async (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });

  await assert.rejects(
    () =>
      AI.callChat({
        config: config(),
        messages: [{ role: 'user', content: 'ping' }],
        stream: true,
        timeoutMs: 120,
        retries: 0,
      }),
    /响应超时/,
  );
  assert.ok(Date.now() - started < 5000, 'the deadline must fire promptly');
});

test('callChat resets the deadline while stream deltas keep arriving', async () => {
  const encoder = new TextEncoder();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          let index = 0;
          const timer = setInterval(() => {
            if (index >= 5) {
              clearInterval(timer);
              controller.close();
              return;
            }
            const payload = JSON.stringify({ choices: [{ delta: { content: `段${index}` } }] });
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            index += 1;
          }, 80);
        },
      }),
      { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
    );

  const result = await AI.callChat({
    config: config(),
    messages: [{ role: 'user', content: 'ping' }],
    stream: true,
    timeoutMs: 180,
    retries: 0,
  });

  // The whole stream takes ~400ms, well past the 180ms deadline: only the
  // idle-based reset can complete it.
  assert.equal(result.content, '段0段1段2段3段4');
});

test('summarizeVideo splits a chunk that times out instead of failing the run', async () => {
  const segments = [];
  for (let i = 0; i < 40; i += 1) {
    segments.push({
      from: i * 2,
      to: i * 2 + 1,
      content: '这条字幕比较长，用来把单个分段撑到超时阈值以上，从而验证超时后的对半拆分。',
    });
  }
  let timeouts = 0;
  let successes = 0;
  globalThis.fetch = async (url, init) => {
    const user = JSON.parse(init.body).messages[1].content;
    const body = user.slice(user.lastIndexOf('字幕：') + 3);
    if (body.length > 800) {
      timeouts += 1;
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }
    successes += 1;
    return jsonResponse({ choices: [{ message: { content: `[OK ${body.length}]` } }] });
  };

  const result = await AI.summarizeVideo({
    video: { title: '超时拆分', duration: 120 },
    segments,
    config: config({ style: 'transcript', chunkChars: 1000 }),
    chunkTimeoutMs: 150,
  });

  assert.ok(timeouts >= 1, 'the oversized request should time out once');
  assert.ok(successes >= 2, 'halves should succeed after the timeout');
  assert.match(result.summary, /\[OK \d+\]/);
  assert.ok(result.stats.chunks >= 2);
});

test('summarizeVideo honors the configured chunk size for transcripts', async () => {
  const segments = [];
  for (let i = 0; i < 400; i += 1) {
    segments.push({
      from: i,
      to: i + 1,
      content: '这条字幕用于验证逐字稿的分段上限，需要足够长才能撑出多个分段。',
    });
  }

  async function run(chunkChars) {
    let maxBody = 0;
    globalThis.fetch = async (url, init) => {
      const user = JSON.parse(init.body).messages[1].content;
      const body = user.slice(user.lastIndexOf('字幕：') + 3);
      maxBody = Math.max(maxBody, body.length);
      return jsonResponse({ choices: [{ message: { content: `[OK ${body.length}]` } }] });
    };
    const result = await AI.summarizeVideo({
      video: { title: '逐字稿分段长度', duration: 400 },
      segments,
      config: config({ style: 'transcript', chunkChars }),
    });
    return { maxBody, chunks: result.stats.chunks };
  }

  const small = await run(3000);
  const large = await run(12000);

  assert.ok(small.maxBody <= 3100, `3000 字设置产生了 ${small.maxBody} 字的请求`);
  assert.ok(large.maxBody <= 12100, `12000 字设置产生了 ${large.maxBody} 字的请求`);
  // The old build silently capped transcripts at 4000 characters.
  assert.ok(large.maxBody > 4200, `逐字稿没有跟随设置：最大分段只有 ${large.maxBody} 字`);
  assert.ok(large.chunks < small.chunks, `更大的分段应减少请求数：${large.chunks} vs ${small.chunks}`);
});

test('summarizeVideo splits a transcript chunk the provider rejects as too large', async () => {
  const segments = [];
  for (let i = 0; i < 200; i += 1) {
    segments.push({
      from: i,
      to: i + 1,
      content: '这一段字幕用来模拟服务端 413：先拒绝过大的请求，拆半之后就能成功。',
    });
  }
  let rejected = 0;
  globalThis.fetch = async (url, init) => {
    const user = JSON.parse(init.body).messages[1].content;
    const body = user.slice(user.lastIndexOf('字幕：') + 3);
    if (body.length > 2500) {
      rejected += 1;
      return jsonResponse({ error: { message: 'request entity too large' } }, 413);
    }
    return jsonResponse({ choices: [{ message: { content: `[OK ${body.length}]` } }] });
  };

  const result = await AI.summarizeVideo({
    video: { title: '413 拆半重试', duration: 200 },
    segments,
    config: config({ style: 'transcript', chunkChars: 3000 }),
  });

  assert.ok(rejected >= 1, 'the oversized chunk should be rejected at least once');
  assert.ok(
    (result.summary.match(/\[OK \d+\]/g) || []).length >= 2,
    'halves of the rejected chunk should succeed after the split',
  );
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
