'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const History = require('../shared/history.js');

function makeEntry(index, overrides) {
  const day = String(index).padStart(2, '0');
  return Object.assign(
    {
      id: `id${index}`,
      key: `BVtest${index}`,
      version: History.STORE_VERSION,
      bvid: `BVtest${index}`,
      cid: index,
      pageNo: 1,
      pageCount: 1,
      title: `视频 ${index}`,
      owner: 'UP主',
      duration: 60,
      url: `https://www.bilibili.com/video/BVtest${index}`,
      summary: `总结 ${index}`,
      summaryChars: 4,
      generatedAt: `2026-01-${day}T00:00:00.000Z`,
      savedAt: `2026-01-${day}T00:00:00.000Z`,
      model: 'deepseek-v4.1-flash',
      style: 'structured',
      language: 'zh',
      stats: { chunks: 1, calls: 1, usage: { totalTokens: 100 } },
      subtitle: { segments: [], count: 0 },
      bytes: 100,
    },
    overrides || {},
  );
}

function installChrome(options) {
  const opt = options || {};
  const data = opt.data || {};
  const state = { failWrites: opt.failWrites || 0 };
  const area = {
    async get(key) {
      if (this.failReads > 0) {
        this.failReads -= 1;
        throw new Error('read failed');
      }
      const out = {};
      if (typeof key === 'string' && key in data) out[key] = data[key];
      return out;
    },
    async set(items) {
      if (state.failWrites > 0) {
        state.failWrites -= 1;
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      Object.assign(data, items);
    },
    failReads: 0,
  };
  global.chrome = { storage: { local: area } };
  return { data, state, area };
}

function uninstallChrome() {
  delete global.chrome;
}

test('derives one stable history key per playable unit', () => {
  assert.equal(History.entryKey({ bvid: 'BV1xx411c7mD', pageNo: 1, pageCount: 1 }), 'BV1xx411c7mD');
  assert.equal(History.entryKey({ bvid: 'BV1xx411c7mD', pageNo: 2, pageCount: 3 }), 'BV1xx411c7mD#p2');
  assert.equal(History.entryKey({ bvid: '  BV1xx411c7mD  ', pageNo: 1, pageCount: 1 }), 'BV1xx411c7mD');
  assert.equal(History.entryKey({ cid: 123456, pageNo: 1, pageCount: 1 }), 'cid:123456');
  assert.equal(History.entryKey({}), '');
  assert.equal(History.entryKey(null), '');
});

test('estimates storage bytes conservatively for CJK content', () => {
  const ascii = History.estimateBytes({ text: 'abcdef' });
  const cjk = History.estimateBytes({ text: '中文总结' });
  assert.ok(ascii > 0);
  assert.ok(cjk >= Buffer.byteLength(JSON.stringify({ text: '中文总结' }), 'utf8'));
  assert.ok(History.estimateBytes({ text: 'abcdef'.repeat(10) }) > ascii);
  assert.equal(History.estimateBytes(undefined), 0);
});

test('snapshots subtitle segments and marks truncation', () => {
  const segments = [
    { from: 1.234, to: 2.345, content: '  第一行  ' },
    { from: 3, to: 0, content: '第二行' },
    { from: 4, to: 5, content: '   ' },
  ];
  const snap = History.snapshotSegments(segments);
  assert.equal(snap.segments.length, 2);
  assert.equal(snap.truncated, false);
  assert.deepEqual(snap.segments[0], { from: 1.23, to: 2.35, content: '第一行' });
  assert.ok(snap.segments[1].to > snap.segments[1].from);

  const long = Array.from({ length: 200 }, () => ({ from: 0, to: 1, content: 'x'.repeat(1000) }));
  const capped = History.snapshotSegments(long);
  assert.equal(capped.truncated, true);
  assert.ok(capped.chars <= History.MAX_SUBTITLE_CHARS);
  assert.ok(capped.segments.length < long.length);
});

test('builds a complete history entry with metadata and clamps summary length', () => {
  const video = {
    bvid: 'BV1xx411c7mD',
    cid: 42,
    pageNo: 1,
    pageCount: 1,
    title: '测试视频',
    owner: '测试UP',
    duration: 754,
    url: 'https://www.bilibili.com/video/BV1xx411c7mD',
  };
  const entry = History.buildEntry({
    video,
    segments: [{ from: 0, to: 1.5, content: '你好' }],
    summary: '## 一句话概括\n内容',
    generatedAt: new Date('2026-01-02T03:04:05.000Z'),
    appVersion: '1.1.0',
    meta: {
      model: 'deepseek-v4.1-flash',
      style: 'brief',
      language: 'zh',
      stats: {
        chunks: 2,
        calls: 3,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        subtitleCount: 1,
      },
      subtitle: { lan: 'zh-CN', lanDoc: '中文（自动生成）', author: 'A', isAi: true },
    },
  });

  assert.ok(entry);
  assert.equal(entry.key, 'BV1xx411c7mD');
  assert.ok(entry.id.startsWith('BV1xx411c7mD@'), `unexpected id: ${entry.id}`);
  assert.equal(entry.title, '测试视频');
  assert.equal(entry.owner, '测试UP');
  assert.equal(entry.model, 'deepseek-v4.1-flash');
  assert.equal(entry.style, 'brief');
  assert.equal(entry.generatedAt, '2026-01-02T03:04:05.000Z');
  assert.equal(entry.stats.calls, 3);
  assert.equal(entry.stats.totalTokens, 30);
  assert.equal(entry.subtitle.lanDoc, '中文（自动生成）');
  assert.equal(entry.subtitle.isAi, true);
  assert.equal(entry.subtitle.count, 1);
  assert.equal(entry.subtitle.segments.length, 1);
  assert.equal(entry.appVersion, '1.1.0');
  assert.ok(entry.bytes > 0);

  // Two generations of one video must not share an id.
  const second = History.buildEntry({ video, summary: '再来一次' });
  assert.notEqual(second.id, entry.id);

  const longSummary = History.buildEntry({ video, summary: 'a'.repeat(History.MAX_SUMMARY_CHARS + 50) });
  assert.equal(longSummary.summary.length, History.MAX_SUMMARY_CHARS);
  assert.equal(longSummary.summaryTruncated, true);
});

test('refuses to build an entry without a summary or a stable key', () => {
  const video = { bvid: 'BV1xx411c7mD', pageCount: 1, pageNo: 1 };
  assert.equal(History.buildEntry({ video, summary: '   ' }), null);
  assert.equal(History.buildEntry({ video: {}, summary: '有效总结' }), null);
  assert.equal(History.buildEntry({ video: null, segments: [], summary: '' }), null);
});

test('prunes by entry count, keeping the newest records', () => {
  const entries = [makeEntry(1), makeEntry(2), makeEntry(3), makeEntry(4)];
  const result = History.pruneEntries(entries, { maxEntries: 3, maxBytes: 1024 * 1024 });
  assert.deepEqual(
    result.entries.map((entry) => entry.key),
    ['BVtest4', 'BVtest3', 'BVtest2'],
  );
  assert.deepEqual(result.evicted.sort(), ['id1']);
  assert.equal(result.bytes, 300);
});

test('prunes by byte budget but never drops the newest entry', () => {
  const entries = [makeEntry(1), makeEntry(2), makeEntry(3)];
  const result = History.pruneEntries(entries, { maxEntries: 10, maxBytes: 250 });
  assert.deepEqual(
    result.entries.map((entry) => entry.key),
    ['BVtest3', 'BVtest2'],
  );

  const huge = History.pruneEntries([makeEntry(9, { bytes: 5000 })], {
    maxEntries: 10,
    maxBytes: 1000,
  });
  assert.equal(huge.entries.length, 1);
  assert.equal(huge.entries[0].key, 'BVtest9');

  const defaultLimits = History.pruneEntries(entries);
  assert.equal(defaultLimits.entries.length, 3);
});

test('keeps every generation of the same video', () => {
  const first = makeEntry(1, { id: 'gen-1', key: 'BVsame', savedAt: '2026-01-01T00:00:00.000Z' });
  const second = makeEntry(1, {
    id: 'gen-2',
    key: 'BVsame',
    summary: '第二次生成',
    savedAt: '2026-01-02T00:00:00.000Z',
  });
  const limits = { maxEntries: 10, maxBytes: 1024 * 1024 };

  const once = History.appendEntry([first], second, limits);
  assert.equal(once.entries.length, 2);
  assert.deepEqual(
    once.entries.map((entry) => entry.id),
    ['gen-2', 'gen-1'],
  );

  // Re-appending the exact same record must not duplicate it.
  const twice = History.appendEntry(once.entries, second, limits);
  assert.equal(twice.entries.length, 2);
});

test('projects list items without the subtitle transcript', () => {
  const entry = makeEntry(1, {
    summary: `开头${'字'.repeat(400)}结尾`,
    subtitle: {
      count: 42,
      lanDoc: '中文',
      truncated: false,
      segments: [{ from: 0, to: 1, content: '一段字幕' }],
    },
  });
  const item = History.toListItem(entry);
  assert.equal(item.id, 'id1');
  assert.equal(item.key, 'BVtest1');
  assert.equal(item.subtitleCount, 42);
  assert.equal(item.hasSubtitles, true);
  assert.equal(item.subtitleLanDoc, '中文');
  assert.ok(item.summaryPreview.length <= History.PREVIEW_CHARS);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'segments'), false);
  assert.equal(History.toListItem(null), null);
});

test('normalizes a corrupt store, backfills ids and keeps generations', () => {
  const legacyOld = makeEntry(1, { summary: '旧版本' });
  delete legacyOld.id;
  const legacyNew = makeEntry(1, { summary: '较新的版本', savedAt: '2026-03-01T00:00:00.000Z' });
  delete legacyNew.id;
  const duplicateA = makeEntry(2, { id: 'dup', summary: '旧' });
  const duplicateB = makeEntry(2, { id: 'dup', summary: '新', savedAt: '2026-04-01T00:00:00.000Z' });

  const store = History.normalizeStore({
    version: 99,
    entries: [
      legacyOld,
      legacyNew,
      duplicateA,
      duplicateB,
      { key: '', summary: '没有 key' },
      { key: 'BVnokey' },
      null,
      'garbage',
      makeEntry(3, { subtitle: null }),
    ],
  });

  assert.equal(store.version, History.STORE_VERSION);
  const keys = store.entries.map((entry) => entry.key).sort();
  assert.deepEqual(keys, ['BVtest1', 'BVtest1', 'BVtest2', 'BVtest3']);
  assert.equal(new Set(store.entries.map((entry) => entry.id)).size, store.entries.length);
  const generations = store.entries.filter((entry) => entry.key === 'BVtest1');
  assert.deepEqual(
    generations.map((entry) => entry.summary),
    ['较新的版本', '旧版本'],
  );
  assert.equal(store.entries.find((entry) => entry.key === 'BVtest2').summary, '新');
  assert.deepEqual(store.entries.find((entry) => entry.key === 'BVtest3').subtitle.segments, []);
  assert.equal(History.normalizeStore(null).entries.length, 0);
});

test('round-trips entries through chrome.storage.local', async () => {
  const fake = installChrome();
  try {
    const video = {
      bvid: 'BV1xx411c7mD',
      cid: 7,
      pageNo: 1,
      pageCount: 1,
      title: '存储测试',
      owner: 'UP',
      duration: 120,
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
    };
    const first = History.buildEntry({
      video,
      segments: [{ from: 0, to: 2, content: '字幕内容' }],
      summary: '## 总结\n正文',
      meta: { model: 'm', style: 'notes', language: 'zh', subtitle: { lan: 'zh-CN', lanDoc: '中文' } },
    });
    const second = History.buildEntry({ video, summary: '第二次生成', generatedAt: new Date() });

    const savedFirst = await History.appendHistory(first);
    assert.equal(savedFirst.totals.count, 1);
    const savedSecond = await History.appendHistory(second);
    assert.equal(savedSecond.totals.count, 2, 'both generations must be stored');
    assert.equal(fake.data[History.HISTORY_KEY].entries.length, 2);

    const byId = await History.readEntry(first.id);
    assert.equal(byId.summary, '## 总结\n正文');
    assert.equal(byId.subtitle.segments[0].content, '字幕内容');

    // Key lookup is the newest generation (auto-restore path).
    const latest = await History.latestEntry('BV1xx411c7mD');
    assert.equal(latest.id, second.id);
    assert.equal((await History.readEntry('BV1xx411c7mD')).id, second.id);
    assert.equal(await History.readEntry('missing'), null);
    assert.equal(await History.latestEntry('missing'), null);

    const listed = await History.listHistory();
    assert.equal(listed.items.length, 2);
    assert.equal(listed.items[0].title, '存储测试');
    assert.equal(listed.items[0].id, second.id);
    assert.equal(listed.totals.count, 2);
    assert.equal(listed.totals.maxEntries, History.MAX_ENTRIES);

    const removed = await History.deleteEntry(first.id);
    assert.equal(removed.removed, 1);
    assert.equal(await History.readEntry(first.id), null);
    assert.equal((await History.latestEntry('BV1xx411c7mD')).id, second.id);

    const cleared = await History.clearHistory();
    assert.equal(cleared.removed, 1);
    assert.deepEqual((await History.listHistory()).items, []);
  } finally {
    uninstallChrome();
  }
});

test('applies caps while saving through the store', async () => {
  installChrome();
  try {
    await History.appendHistory(makeEntry(1));
    await History.appendHistory(makeEntry(2));
    const result = await History.appendHistory(makeEntry(3), { maxEntries: 2 });
    assert.equal(result.totals.count, 2);
    assert.deepEqual(result.evicted, ['id1']);
    const listed = await History.listHistory({ maxEntries: 5 });
    assert.deepEqual(
      listed.items.map((item) => item.key),
      ['BVtest3', 'BVtest2'],
    );
  } finally {
    uninstallChrome();
  }
});

test('survives a quota error by keeping only the newest summary', async () => {
  const fake = installChrome();
  try {
    fake.data[History.HISTORY_KEY] = { version: History.STORE_VERSION, entries: [makeEntry(1)] };
    fake.state.failWrites = 1;
    const result = await History.appendHistory(makeEntry(2));
    assert.equal(result.quotaRetry, true);
    const listed = await History.listHistory();
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].key, 'BVtest2');
  } finally {
    uninstallChrome();
  }
});

test('reports a friendly error when storage keeps rejecting writes', async () => {
  const fake = installChrome({ failWrites: 2 });
  try {
    await assert.rejects(() => History.appendHistory(makeEntry(1)), /本地存储空间不足/);
    assert.equal(fake.data[History.HISTORY_KEY], undefined);
  } finally {
    uninstallChrome();
  }
});

test('falls back to memory when chrome.storage is unavailable', async () => {
  uninstallChrome();
  const entry = makeEntry(1);
  const saved = await History.appendHistory(entry);
  assert.equal(saved.totals.count, 1);
  assert.equal((await History.readEntry(entry.id)).summary, '总结 1');
  assert.equal((await History.readEntry('BVtest1')).summary, '总结 1');
  await History.clearHistory();
  assert.deepEqual((await History.listHistory()).items, []);
});

test('treats an unreadable store as empty instead of throwing', async () => {
  const fake = installChrome();
  try {
    fake.area.failReads = 1;
    const listed = await History.listHistory();
    assert.deepEqual(listed.items, []);
    assert.equal(await History.readEntry('BVtest1'), null);
  } finally {
    uninstallChrome();
  }
});
