'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../shared/utils.js');

test('formats clocks for display and SRT', () => {
  assert.equal(U.formatClock(7), '00:07');
  assert.equal(U.formatClock(754), '12:34');
  assert.equal(U.formatClock(3723), '1:02:03');
  assert.equal(U.formatSrtClock(3723.456), '01:02:03,456');
});

test('parses Bilibili video and bangumi routes', () => {
  const video = U.parseBilibiliRoute('https://www.bilibili.com/video/BV1GJ411x7h7/?p=3&spm=abc');
  assert.equal(video.kind, 'video');
  assert.equal(video.bvid, 'BV1GJ411x7h7');
  assert.equal(video.page, 3);
  assert.equal(video.key, 'video:BV1GJ411X7H7:p3');

  const old = U.parseBilibiliRoute('https://www.bilibili.com/video/av12345/');
  assert.equal(old.aid, 12345);

  const ep = U.parseBilibiliRoute('https://www.bilibili.com/bangumi/play/ep123456');
  assert.equal(ep.kind, 'bangumi');
  assert.equal(ep.epId, 123456);

  const ss = U.parseBilibiliRoute('https://www.bilibili.com/bangumi/play/ss99/');
  assert.equal(ss.seasonId, 99);

  assert.equal(U.parseBilibiliRoute('https://www.bilibili.com/'), null);
  assert.equal(U.parseBilibiliRoute('https://example.com/video/BV1GJ411x7h7'), null);
});

test('normalizes subtitle payloads and strips control tags', () => {
  const segments = U.normalizeSegments({
    body: [
      { from: 2.5, to: 4, content: ' 第二句 ' },
      { from: 0, to: 1.2, content: '{\\an8}第一句<br>换行' },
      { from: 5, to: 5, content: '补齐结束时间' },
      { from: 9, to: 10, content: '   ' },
    ],
  });
  assert.equal(segments.length, 3);
  assert.equal(segments[0].content, '第一句\n换行');
  assert.equal(segments[1].from, 2.5);
  assert.equal(segments[2].to, 5.8);
});

test('builds valid SRT and plain text', () => {
  const segments = [
    { from: 0, to: 1.2, content: '你好' },
    { from: 1.2, to: 2.8, content: '世界' },
    { from: 2.8, to: 2.8, content: '世界' },
  ];
  const srt = U.segmentsToSrt(segments);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:01,200\n你好\n/);
  assert.match(srt, /2\n00:00:01,200 --> 00:00:02,800\n世界/);
  assert.match(srt, /00:00:02,800 --> 00:00:03,600/);

  assert.equal(U.segmentsToTxt(segments), '你好\n世界');
  assert.equal(U.segmentsToTxt(segments, { timestamps: true }), '[00:00] 你好\n[00:01] 世界');
});

test('normalizes, merges and picks subtitle tracks', () => {
  const first = U.normalizePlayerTracks({
    data: {
      need_login_subtitle: true,
      subtitle: {
        subtitles: [
          {
            id_str: '2',
            lan: 'en-US',
            lan_doc: 'English',
            subtitle_url: '//aisubtitle.hdslb.com/a.json',
          },
          { id_str: '3', lan: 'zh-CN', lan_doc: '中文（中国）', is_lock: true },
        ],
      },
    },
  });
  assert.equal(first.needLogin, true);
  assert.equal(first.tracks.filter((item) => item.available).length, 1);
  assert.equal(first.tracks.find((item) => item.lan === 'en-US').url, 'https://aisubtitle.hdslb.com/a.json');

  const merged = U.mergeTracks(first, [
    { id: '3', lan: 'zh-CN', lan_doc: '中文（中国）', subtitle_url: 'https://aisubtitle.hdslb.com/zh.json' },
  ]);
  assert.equal(merged.find((item) => item.id === '3').available, true);
  assert.equal(U.pickBestTrack(merged, 'zh-CN').lan, 'zh-CN');
  assert.equal(U.pickBestTrack(merged, 'en-US').lan, 'en-US');
  assert.equal(U.pickBestTrack([], 'zh-CN'), null);
});

test('chunks long subtitle transcripts without exceeding the limit', () => {
  const segments = [];
  for (let i = 0; i < 120; i += 1) {
    segments.push({
      from: i * 3,
      to: i * 3 + 2.5,
      content: `这是第${i + 1}句字幕，包含一些用于测试分段的中文内容。`,
    });
  }
  const chunks = U.chunkSegments(segments, 3000);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 3000, `chunk too long: ${chunk.text.length}`);
    assert.match(chunk.text, /^\[\d{2}:\d{2}\]/);
  }
  assert.ok(chunks[1].from >= chunks[0].from);
});

test('renders Markdown safely and supports headings, lists, tables and code', () => {
  const html = U.renderMarkdown(
    [
      '## 核心要点',
      '- **重点**：<script>alert(1)</script>',
      '- 第二项',
      '',
      '| 项目 | 数值 |',
      '| --- | --- |',
      '| A | 1 |',
      '',
      '```js',
      'const x = "<tag>";',
      '```',
    ].join('\n'),
  );
  assert.match(html, /<h2>核心要点<\/h2>/);
  assert.match(html, /<ul><li><strong>重点<\/strong>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<table>/);
  assert.match(html, /<pre class="md-code" data-lang="js"><code>const x = &quot;&lt;tag&gt;&quot;;<\/code><\/pre>/);
});

test('builds export documents with metadata', () => {
  const video = {
    title: '测试视频',
    url: 'https://www.bilibili.com/video/BV1GJ411x7h7/',
    owner: 'UP主',
    duration: 754,
    bvid: 'BV1GJ411x7h7',
    pageNo: 1,
    pageCount: 2,
  };
  const md = U.summaryToMarkdown({
    video,
    summary: '# 多余的标题\n\n## 一句话概括\n\n这是总结。',
    generatedAt: '2026-11-15 09:00',
  });
  assert.match(md, /^# 测试视频/);
  assert.doesNotMatch(md, /多余的标题/);
  assert.match(md, /> 视频：\[测试视频\]/);
  assert.match(md, /UP主：UP主 · 时长：12:34/);
  assert.match(md, /## 一句话概括/);

  const txt = U.summaryToTxt({ video, summary: '## 标题\n\n- **要点**', generatedAt: '2026-11-15 09:00' });
  assert.match(txt, /^测试视频/);
  assert.match(txt, /标题/);
  assert.match(txt, /- 要点/);
  assert.doesNotMatch(txt, /\*\*/);
});

test('sanitizes filenames for Windows downloads', () => {
  assert.equal(U.sanitizeFilename('a/b:c*d?e"f<g>h|i\\j'), 'a_b_c_d_e_f_g_h_i_j');
  assert.equal(U.buildFilename('标题', '字幕', 'srt'), '标题_字幕.srt');
  assert.equal(U.sanitizeFilename('CON'), '_CON');
  assert.ok(U.sanitizeFilename('x'.repeat(200)).length <= 90);
});
