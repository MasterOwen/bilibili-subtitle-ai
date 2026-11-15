/* Mock background used only by tests/browser-smoke.js. */
'use strict';

const TRACKS = [
  {
    id: 'zh-cn-track',
    lan: 'zh-CN',
    lanDoc: '中文（中国）',
    url: 'https://aisubtitle.hdslb.com/mock/zh.json',
    available: true,
    isAi: false,
  },
  {
    id: 'en-track',
    lan: 'en-US',
    lanDoc: 'English (US)',
    url: 'https://aisubtitle.hdslb.com/mock/en.json',
    available: true,
    isAi: false,
  },
];

const SEGMENTS = [
  { from: 0, to: 6, content: '大家好，今天我们来聊一个很实际的问题：如何把长视频变成真正有用的笔记。' },
  { from: 6, to: 13, content: '很多人看完一个两小时的视频，过几天只记得“好像讲过”，却说不清核心观点。' },
  { from: 13, to: 21, content: '问题不在于记性，而在于视频的信息密度低，观点散落在不同时间点里。' },
  { from: 21, to: 29, content: '我的方法分成三步：先提取字幕，再让 AI 做结构化总结，最后用自己的话复盘。' },
  { from: 29, to: 38, content: '第一步，字幕是视频里最完整的文本信息，比标题、简介和弹幕都更可靠。' },
  { from: 38, to: 46, content: '注意，字幕里会有口头禅和重复，AI 总结时要明确要求它忽略这些噪音。' },
  { from: 46, to: 55, content: '第二步，分段处理。长视频不要一次性丢给模型，否则容易遗漏中段信息。' },
  { from: 55, to: 64, content: '可以按时间或字数切成若干段，每段先提炼要点，再把要点合并成全局总结。' },
  { from: 64, to: 72, content: '提示词里要保留三个东西：时间点、关键数字、作者的原始结论。' },
  { from: 72, to: 81, content: '第三步，复盘。看完 AI 总结后，用自己的话写三句话，检验是否真的理解。' },
  { from: 81, to: 90, content: '如果写不出来，说明总结里缺少因果关系，需要回到字幕里找论证过程。' },
  { from: 90, to: 99, content: '还有一个常见误区：把 AI 总结直接收藏，却从不回看。' },
  { from: 99, to: 108, content: '更好的做法是给总结加一个“下一步行动”，让它和你的工作产生连接。' },
  { from: 108, to: 118, content: '比如看完一个工具教程，就立刻用它完成一个小任务，而不是等“以后有空”。' },
  { from: 118, to: 127, content: '对于学习类视频，可以在总结末尾列三个复习问题，隔天自测。' },
  { from: 127, to: 136, content: '对于访谈类视频，重点保留人物观点、分歧和论证，而不是逐字稿。' },
  { from: 136, to: 145, content: '对于新闻类视频，要区分事实、推测和评论，避免把观点当成结论。' },
  { from: 145, to: 154, content: '字幕质量也很重要。自动字幕可能有同音字错误，关键人名和数据要二次核对。' },
  { from: 154, to: 163, content: '如果视频没有字幕，可以先确认是否登录，或者使用平台提供的 AI 字幕。' },
  { from: 163, to: 172, content: '最后总结一下：提取、分段、合并、复盘，这四步能让视频内容真正留下来。' },
  { from: 172, to: 181, content: '工具只是放大器，真正的理解仍然发生在你重新组织和表达的时候。' },
  { from: 181, to: 190, content: '希望这套方法对你有帮助，接下来我们用一个真实案例完整演示一遍。' },
  { from: 190, to: 200, content: '案例是一个 90 分钟的产品访谈，我们先看原始字幕的结构。' },
  { from: 200, to: 210, content: '访谈前半段在讲行业背景，中段讲产品决策，最后讲失败教训。' },
  { from: 210, to: 220, content: '分段时不要把这三个主题切碎，否则合并阶段会丢失上下文。' },
  { from: 220, to: 230, content: '更合理的方式是按语义边界切分，每段 5 到 10 分钟。' },
  { from: 230, to: 240, content: '每段笔记只保留三类信息：结论、证据、可执行动作。' },
  { from: 240, to: 250, content: '合并时先按主题聚类，再按时间顺序排列，这样既完整又易读。' },
  { from: 250, to: 260, content: '最终输出的总结应该能在三分钟内读完，并且能定位回原视频。' },
  { from: 260, to: 270, content: '这就是时间戳的价值：它让总结从“二手观点”变成可验证的索引。' },
  { from: 270, to: 280, content: '如果 AI 编造了字幕里没有的内容，要立刻在提示词里强调“只依据字幕”。' },
  { from: 280, to: 290, content: '必要时可以让模型在不确定的地方标注“字幕未提及”，而不是强行补全。' },
  { from: 290, to: 300, content: '这套流程同样适用于播客、课程和会议录音。' },
  { from: 300, to: 310, content: '只要你有文本，就可以用分段总结的方法降低信息损耗。' },
  { from: 310, to: 320, content: '今天就到这里，记得把方法用在你收藏夹里吃灰的那个长视频上。' },
];

const SUMMARY = `## 一句话概括
这是一份关于“如何把长视频转化为可用笔记”的方法分享。核心主张是：先提取字幕，再分段提炼并合并，最后用自己的话复盘，让视频信息真正留下来。

## 核心要点
- [00:21] 方法分为三步：提取字幕、AI 结构化总结、自己复盘。
- [00:46] 长视频要分段处理，避免一次性输入导致中段信息丢失。
- [01:04] 提示词要保留时间点、关键数字和原始结论。
- [01:12] 复盘时用自己的话写三句话，检验是否真正理解。
- [02:10] 分段要按语义边界，不要把主题切碎。
- [04:30] 时间戳让总结可以被验证，而不只是二手观点。

## 内容脉络
### 01. 为什么视频笔记容易失效 [00:00]
视频信息密度低，观点分散。只靠记忆，几天后往往只剩下模糊印象。

### 02. 三步法：提取、总结、复盘 [00:21]
字幕是最完整的文本来源；AI 负责压缩和结构化；人负责用自己的语言重建理解。

### 03. 分段与合并的关键细节 [00:46]
按语义边界切分，每段保留结论、证据和行动。合并时先聚类再排序，避免丢失上下文。

### 04. 不同视频类型的处理策略 [02:07]
学习类加复习问题，访谈类保留观点与分歧，新闻类区分事实与评论。

## 关键结论与行动建议
1. 选一个收藏夹里的长视频，先导出字幕。
2. 用“结论 / 证据 / 行动”三栏做分段笔记。
3. 总结完成后写三句话复述，并安排一个具体行动。

## 值得记住的数据与观点
| 主题 | 建议 |
| --- | --- |
| 分段长度 | 每段 5–10 分钟 |
| 总结阅读时长 | 控制在 3 分钟内 |
| 复盘 | 用自己的话写 3 句话 |

> 工具只是放大器，真正的理解发生在重新组织和表达的时候。`;

function respondAsync(sendResponse, payload, delay) {
  setTimeout(() => sendResponse(payload), delay || 120);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  if (message.type === 'LOAD_VIDEO') {
    respondAsync(
      sendResponse,
      {
        ok: true,
        video: {
          aid: 123456,
          cid: 7654321,
          bvid: 'BV1GJ411x7h7',
          title: '测试视频：把字幕变成 AI 笔记',
          baseTitle: '测试视频：把字幕变成 AI 笔记',
          partTitle: '正文',
          owner: '测试UP主',
          duration: 754,
          cover: '',
          url: 'https://www.bilibili.com/video/BV1GJ411x7h7/',
          pageNo: 1,
          pageCount: 1,
        },
        tracks: TRACKS,
        lockedCount: 0,
        needLogin: false,
        reason: '',
        warnings: [],
      },
      260,
    );
    return true;
  }
  if (message.type === 'FETCH_SUBTITLE') {
    respondAsync(sendResponse, { ok: true, data: { body: SEGMENTS } }, 180);
    return true;
  }
  if (message.type === 'AI_STATUS') {
    sendResponse({
      ok: true,
      configured: true,
      model: 'mock-summary-model',
      baseHost: 'api.example.com',
      permissionGranted: true,
      style: 'structured',
      language: 'zh',
    });
    return false;
  }
  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'bili-ai-summary') return;
  let timer = null;
  port.onMessage.addListener((message) => {
    if (!message || message.type !== 'start') return;
    port.postMessage({
      type: 'progress',
      progress: { phase: 'map', current: 1, total: 3, message: '正在提炼第 1/3 段字幕…' },
    });
    timer = setTimeout(() => {
      port.postMessage({
        type: 'progress',
        progress: { phase: 'final', current: 1, total: 1, message: '正在整合全篇，生成最终总结…' },
      });
    }, 420);
    setTimeout(() => {
      port.postMessage({
        type: 'done',
        summary: SUMMARY,
        generatedAt: new Date().toISOString(),
        stats: { chunks: 3, calls: 4, subtitleCount: SEGMENTS.length },
      });
    }, 900);
  });
  port.onDisconnect.addListener(() => clearTimeout(timer));
});
