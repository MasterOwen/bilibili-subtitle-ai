/*
 * MV3 service worker: Bilibili API access, subtitle downloading, settings and
 * the long-lived AI summary port.
 */
importScripts('/shared/utils.js', '/shared/settings.js', '/background/ai.js');

const U = self.BiliSubUtils;
const Settings = self.BiliSubSettings;
const AI = self.BiliAI;

const BILI_WEB_ORIGIN = 'https://www.bilibili.com';
const BILI_API_ORIGIN = 'https://api.bilibili.com';
const SUBTITLE_CACHE_LIMIT = 6;
const subtitleCache = new Map();

class BiliApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BiliApiError';
    this.code = code;
  }
}

function errorResponse(error) {
  const message = error && error.message ? error.message : String(error || '未知错误');
  return {
    ok: false,
    error: message,
    code: error && error.code ? error.code : '',
  };
}

function pickString(value, limit) {
  return String(value == null ? '' : value)
    .replace(/\u0000/g, '')
    .slice(0, limit || 500);
}

function pickNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clampPage(page, count) {
  const total = Math.max(1, count || 1);
  return Math.min(total, Math.max(1, Math.floor(Number(page) || 1)));
}

function normalizeCover(value) {
  return U.normalizeMediaUrl(value || '');
}

function normalizeDuration(value) {
  const n = pickNumber(value);
  if (n <= 0) return 0;
  if (n > 86400) return Math.round(n / 1000);
  return Math.round(n);
}

function sanitizePageState(input) {
  const state = input && typeof input === 'object' ? input : {};
  const vd = state.videoData && typeof state.videoData === 'object' ? state.videoData : {};
  const ep = state.epInfo && typeof state.epInfo === 'object' ? state.epInfo : {};
  const owner = vd.owner && typeof vd.owner === 'object' ? vd.owner : {};
  const pages = Array.isArray(vd.pages)
    ? vd.pages.slice(0, 200).map((page) => ({
        cid: pickNumber(page && page.cid),
        page: pickNumber(page && page.page),
        part: pickString(page && page.part, 300),
        duration: normalizeDuration(page && page.duration),
      }))
    : [];
  return {
    href: pickString(state.href, 2000),
    page: pickNumber(state.page),
    videoData: {
      aid: pickNumber(vd.aid),
      bvid: pickString(vd.bvid, 30),
      cid: pickNumber(vd.cid),
      title: pickString(vd.title, 500),
      pic: pickString(vd.pic, 2000),
      duration: normalizeDuration(vd.duration),
      owner: { name: pickString(owner.name, 200) },
      pages,
      subtitle: vd.subtitle && typeof vd.subtitle === 'object' ? vd.subtitle : null,
    },
    epInfo: {
      aid: pickNumber(ep.aid),
      bvid: pickString(ep.bvid, 30),
      cid: pickNumber(ep.cid),
      ep_id: pickNumber(ep.ep_id || ep.id),
      season_id: pickNumber(ep.season_id),
      title: pickString(ep.title || ep.index_title, 300),
      long_title: pickString(ep.long_title, 300),
      cover: pickString(ep.cover, 2000),
      duration: normalizeDuration(ep.duration),
      subtitle: ep.subtitle && typeof ep.subtitle === 'object' ? ep.subtitle : null,
    },
  };
}

async function fetchJson(url, options) {
  const opts = Object.assign({ timeoutMs: 15000, credentials: 'include' }, options || {});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: opts.credentials,
      cache: 'no-store',
      headers: { Accept: 'application/json, text/plain, */*' },
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('请求 B站接口超时，请稍后重试');
    }
    throw new Error('无法连接 B站接口，请检查网络后重试');
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new BiliApiError(`B站接口请求失败（HTTP ${response.status}）`, `HTTP_${response.status}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new BiliApiError('B站接口返回了非 JSON 内容', 'BAD_JSON');
  }
  if (data && typeof data.code === 'number' && data.code !== 0) {
    const code = `BILI_${data.code}`;
    if (data.code === -101 || data.code === -400) {
      throw new BiliApiError('B站账号未登录或登录已失效', 'LOGIN_REQUIRED');
    }
    throw new BiliApiError(data.message || data.msg || `B站接口错误（${data.code}）`, code);
  }
  return data;
}

function apiUrl(path, params) {
  const url = new URL(path, BILI_API_ORIGIN);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.href;
}

async function getViewInfo(route, state) {
  const vd = state.videoData;
  let bvid = route.bvid || vd.bvid;
  let aid = route.aid || vd.aid;
  let view = null;
  let warning = '';
  try {
    const params = bvid ? { bvid } : { aid };
    if (!bvid && !aid) throw new Error('缺少视频 ID');
    const response = await fetchJson(apiUrl('/x/web-interface/view', params));
    view = response.data || null;
    if (view) {
      bvid = view.bvid || bvid;
      aid = view.aid || aid;
    }
  } catch (error) {
    warning = `视频信息接口不可用，已改用页面数据：${error.message}`;
  }
  if (!view && !vd.title) throw new Error(warning || '无法获取视频信息');

  const pages = Array.isArray(view && view.pages) && view.pages.length ? view.pages : vd.pages;
  const pageCount = pages && pages.length ? pages.length : 1;
  const pageNo = clampPage(route.page || state.page || 1, pageCount);
  const pageInfo = pages && pages.length ? pages[pageNo - 1] : null;
  const baseTitle = pickString((view && view.title) || vd.title, 500) || 'Bilibili 视频';
  const partTitle = pickString((pageInfo && pageInfo.part) || (vd.pages[pageNo - 1] && vd.pages[pageNo - 1].part), 300);
  const displayTitle =
    pageCount > 1 && partTitle ? `${baseTitle} · P${pageNo} ${partTitle}` : baseTitle;
  const cid = pickNumber((pageInfo && pageInfo.cid) || vd.cid);
  if (!cid) throw new Error('无法获取当前视频的 CID，请刷新页面后重试');

  const ownerName = pickString(
    (view && view.owner && view.owner.name) || (vd.owner && vd.owner.name),
    200,
  );
  const cover = normalizeCover((view && view.pic) || vd.pic);
  const duration = normalizeDuration(
    (pageInfo && pageInfo.duration) ||
      (view && view.duration) ||
      (state.videoData && state.videoData.duration),
  );
  const finalBvid = pickString(bvid, 30);
  const suffix = pageCount > 1 ? `?p=${pageNo}` : '';
  const url = finalBvid
    ? `${BILI_WEB_ORIGIN}/video/${finalBvid}/${suffix}`
    : `${BILI_WEB_ORIGIN}/video/av${aid}/`;

  return {
    video: {
      aid: pickNumber(aid),
      cid,
      bvid: finalBvid,
      title: displayTitle,
      baseTitle,
      partTitle,
      owner: ownerName,
      duration,
      cover,
      url,
      pageNo,
      pageCount,
    },
    viewData: view,
    warnings: warning ? [warning] : [],
  };
}

function episodeTitle(result, episode, state) {
  const seasonTitle = pickString(
    (result && (result.season_title || result.title)) ||
      (state.epInfo && (state.epInfo.season_title || state.epInfo.title)) ||
      (episode && episode.title),
    500,
  );
  const title = pickString((episode && episode.title) || (state.epInfo && state.epInfo.title), 200);
  const longTitle = pickString((episode && episode.long_title) || (state.epInfo && state.epInfo.long_title), 300);
  const pieces = [seasonTitle, title, longTitle].filter(Boolean);
  return pieces.length ? Array.from(new Set(pieces)).join(' · ') : 'Bilibili 番剧';
}

async function getBangumiInfo(route, state) {
  const ep = state.epInfo;
  let result = null;
  let warning = '';
  const params = route.epId
    ? { ep_id: route.epId }
    : route.seasonId
      ? { season_id: route.seasonId }
      : ep.ep_id
        ? { ep_id: ep.ep_id }
        : ep.season_id
          ? { season_id: ep.season_id }
          : null;
  if (params) {
    try {
      const response = await fetchJson(apiUrl('/pgc/view/web/season', params));
      result = response.result || null;
    } catch (error) {
      warning = `番剧信息接口不可用，已改用页面数据：${error.message}`;
    }
  }

  const episodes = (result && Array.isArray(result.episodes) && result.episodes) || [];
  let episode = null;
  if (route.epId) episode = episodes.find((item) => Number(item.ep_id || item.id) === route.epId) || null;
  if (!episode && ep.cid) episode = episodes.find((item) => Number(item.cid) === ep.cid) || null;
  if (!episode && ep.ep_id) episode = episodes.find((item) => Number(item.ep_id || item.id) === ep.ep_id) || null;
  if (!episode && episodes.length) episode = episodes[0];

  const cid = pickNumber((episode && episode.cid) || ep.cid);
  const aid = pickNumber((episode && episode.aid) || ep.aid);
  if (!cid) throw new Error('无法获取当前番剧的 CID，请刷新页面后重试');

  const title = episodeTitle(result, episode, state);
  const epId = pickNumber((episode && (episode.ep_id || episode.id)) || route.epId || ep.ep_id);
  const bvid = pickString((episode && episode.bvid) || ep.bvid, 30);
  const cover = normalizeCover((episode && episode.cover) || (result && result.cover) || ep.cover);
  const duration = normalizeDuration(
    (episode && episode.duration) || ep.duration || (result && result.duration),
  );
  const owner = pickString(
    (result && result.up_info && (result.up_info.uname || result.up_info.name)) || '',
    200,
  );
  return {
    video: {
      aid,
      cid,
      bvid,
      title,
      baseTitle: title,
      partTitle: '',
      owner,
      duration,
      cover,
      url: epId
        ? `${BILI_WEB_ORIGIN}/bangumi/play/ep${epId}`
        : `${BILI_WEB_ORIGIN}/bangumi/play/`,
      pageNo: 1,
      pageCount: 1,
      isBangumi: true,
    },
    viewData: result,
    warnings: warning ? [warning] : [],
  };
}

async function getPlayerTracks(video) {
  const params = { aid: video.aid, cid: video.cid };
  if (video.bvid) params.bvid = video.bvid;
  let playerData = null;
  let warning = '';
  let loginRequired = false;
  try {
    const response = await fetchJson(apiUrl('/x/player/wbi/v2', params));
    playerData = response.data || null;
  } catch (firstError) {
    if (firstError.code === 'LOGIN_REQUIRED') loginRequired = true;
    try {
      const response = await fetchJson(apiUrl('/x/player/v2', params));
      playerData = response.data || null;
    } catch (secondError) {
      if (secondError.code === 'LOGIN_REQUIRED') loginRequired = true;
      warning = `字幕列表接口不可用：${secondError.message}`;
    }
  }
  return { playerData, warning, loginRequired };
}

async function resolveTracks(video, pageState, viewData) {
  const { playerData, warning, loginRequired } = await getPlayerTracks(video);
  const playerTracks = U.normalizePlayerTracks(playerData);
  const viewTracks = U.normalizePlayerTracks({
    data: { subtitle: viewData && viewData.subtitle ? viewData.subtitle : null },
  });
  const stateTracks = U.normalizePlayerTracks({
    data: {
      subtitle:
        (pageState.videoData && pageState.videoData.subtitle) ||
        (pageState.epInfo && pageState.epInfo.subtitle) ||
        null,
    },
  });
  const merged = U.mergeTracks(playerTracks, viewTracks, stateTracks);
  const tracks = merged.filter((track) => track.available);
  const lockedCount = merged.filter((track) => !track.available).length;
  const warnings = [];
  if (warning) warnings.push(warning);

  let reason = '';
  const needLogin = playerTracks.needLogin || loginRequired;
  if (!tracks.length) {
    if (needLogin) {
      reason =
        'B站没有向当前会话返回字幕。请确认已登录 B站；部分视频的字幕仅登录后可见。若仍无字幕，说明该视频没有可用字幕。';
    } else if (lockedCount > 0) {
      reason = '该视频有字幕，但字幕被锁定或当前账号无权限获取。请登录 B站后重试。';
    } else {
      reason = '该视频没有可用字幕。B站只对部分视频提供字幕；AI 字幕需要视频本身已生成语音识别结果。';
    }
  }
  return {
    tracks,
    lockedCount,
    needLogin,
    reason,
    warnings,
  };
}

async function loadVideo(payload) {
  const route = U.parseBilibiliRoute(payload && payload.href);
  if (!route) throw new Error('当前页面不是支持的 B站视频播放页');
  const pageState = sanitizePageState(payload.pageState);
  const context =
    route.kind === 'video' ? await getViewInfo(route, pageState) : await getBangumiInfo(route, pageState);
  const trackResult = await resolveTracks(context.video, pageState, context.viewData);
  return {
    ok: true,
    video: context.video,
    tracks: trackResult.tracks,
    lockedCount: trackResult.lockedCount,
    needLogin: trackResult.needLogin,
    reason: trackResult.tracks.length ? '' : trackResult.reason,
    warnings: context.warnings.concat(trackResult.warnings),
  };
}

async function fetchSubtitle(url) {
  if (!U.isBilibiliMediaUrl(url)) throw new Error('字幕地址不在允许的 B站域名内');
  if (subtitleCache.has(url)) {
    const cached = subtitleCache.get(url);
    subtitleCache.delete(url);
    subtitleCache.set(url, cached);
    return cached;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json, text/plain, */*' },
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('下载字幕超时，请重试');
    throw new Error('下载字幕失败，请检查网络或登录状态');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`下载字幕失败（HTTP ${response.status}）`);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error('字幕文件格式异常，可能链接已失效');
  }
  if (!data || !Array.isArray(data.body)) throw new Error('字幕文件缺少 body 内容，可能链接已失效');
  subtitleCache.set(url, data);
  while (subtitleCache.size > SUBTITLE_CACHE_LIMIT) {
    subtitleCache.delete(subtitleCache.keys().next().value);
  }
  return data;
}

async function aiStatus() {
  const config = await Settings.loadSettings();
  const configured = Settings.isConfigured(config);
  let permissionGranted = false;
  if (configured) {
    try {
      const pattern = Settings.originPatternFor(config.apiBaseUrl);
      permissionGranted = await chrome.permissions.contains({ origins: [pattern] });
    } catch (_) {
      permissionGranted = false;
    }
  }
  let baseHost = '';
  try {
    baseHost = config.apiBaseUrl ? new URL(config.apiBaseUrl).host : '';
  } catch (_) {
    baseHost = '';
  }
  return {
    ok: true,
    configured,
    model: config.model,
    baseHost,
    permissionGranted,
    style: config.style,
    language: config.language,
  };
}

async function checkAiPermission(config) {
  let pattern;
  try {
    pattern = Settings.originPatternFor(config.apiBaseUrl);
  } catch (error) {
    throw new Error(error.message);
  }
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (!granted) {
    const error = new Error(`扩展还没有访问 ${pattern} 的权限，请到设置页点击“保存设置”授权 API 域名`);
    error.code = 'AI_PERMISSION_REQUIRED';
    throw error;
  }
}

async function runSummary(port, controller, payload) {
  const settings = await Settings.loadSettings();
  if (!Settings.isConfigured(settings)) {
    throw new Error('尚未配置 AI 接口，请先在设置页填写 Base URL、API Key 和模型');
  }
  await checkAiPermission(settings);
  const video = payload && payload.video ? payload.video : {};
  const segments = payload && Array.isArray(payload.segments) ? payload.segments : [];
  if (!segments.length) throw new Error('当前没有可总结的字幕');

  return AI.summarizeVideo({
    video,
    segments,
    config: settings,
    signal: controller.signal,
    onProgress: (progress) => safePost(port, { type: 'progress', progress }),
  });
}

function safePost(port, message) {
  try {
    port.postMessage(message);
  } catch (_) {
    /* Port closed by navigation or user. */
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'bili-ai-summary') return;
  const controller = new AbortController();
  let started = false;

  port.onDisconnect.addListener(() => {
    controller.abort();
  });

  port.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'abort') {
      controller.abort();
      return;
    }
    if (message.type !== 'start' || started) return;
    started = true;
    runSummary(port, controller, message.payload)
      .then((result) => {
        safePost(port, {
          type: 'done',
          summary: result.summary,
          generatedAt: result.generatedAt instanceof Date ? result.generatedAt.toISOString() : '',
          stats: result.stats,
        });
      })
      .catch((error) => {
        if (error && error.name === 'AbortError') {
          safePost(port, { type: 'aborted' });
          return;
        }
        safePost(port, {
          type: 'error',
          error: error && error.message ? error.message : 'AI 总结失败',
          code: error && error.code ? error.code : '',
        });
      });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || !message.type) return false;

  if (message.type === 'LOAD_VIDEO') {
    loadVideo(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }
  if (message.type === 'FETCH_SUBTITLE') {
    fetchSubtitle(message.url)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }
  if (message.type === 'AI_STATUS') {
    aiStatus()
      .then(sendResponse)
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }
  if (message.type === 'TEST_AI') {
    (async () => {
      const raw = message.config || {};
      const config = Settings.normalizeSettings(raw);
      if (!config.apiBaseUrl || !config.apiKey || !config.model) {
        throw new Error('请先填写 Base URL、API Key 和模型名称');
      }
      await checkAiPermission(config);
      return AI.testConnection(config);
    })()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }
  if (message.type === 'PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(Settings.SETTINGS_KEY).then((stored) => {
    if (!stored || !stored[Settings.SETTINGS_KEY]) {
      chrome.storage.local.set({ [Settings.SETTINGS_KEY]: Settings.normalizeSettings(Settings.DEFAULTS) });
    }
  });
});
