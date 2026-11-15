/*
 * Runs in the page's MAIN world at document_start. The isolated content script
 * cannot read window.__INITIAL_STATE__ or use the page's login cookies for
 * same-origin requests, so this tiny bridge exposes only the data we need.
 */
(function () {
  'use strict';

  const CONTENT_SOURCE = 'bsai-content';
  const PAGE_SOURCE = 'bsai-page';
  const INSTALL_FLAG = '__bsaiBridgeInstalled__';
  if (window[INSTALL_FLAG]) return;
  try {
    Object.defineProperty(window, INSTALL_FLAG, { value: true, configurable: false });
  } catch (_) {
    window[INSTALL_FLAG] = true;
  }

  function isAllowedUrl(value) {
    try {
      const url = new URL(String(value || ''), 'https://www.bilibili.com');
      return (
        url.protocol === 'https:' &&
        (url.hostname === 'bilibili.com' ||
          url.hostname.endsWith('.bilibili.com') ||
          url.hostname === 'hdslb.com' ||
          url.hostname.endsWith('.hdslb.com'))
      );
    } catch (_) {
      return false;
    }
  }

  function text(value, limit) {
    return String(value == null ? '' : value)
      .replace(/\u0000/g, '')
      .slice(0, limit || 500);
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function sanitizeSubtitle(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const candidates = []
      .concat(Array.isArray(raw.subtitles) ? raw.subtitles : [])
      .concat(Array.isArray(raw.list) ? raw.list : [])
      .slice(0, 40);
    return {
      subtitles: candidates.map((track) => ({
        id: number(track && track.id),
        id_str: text(track && track.id_str, 40),
        lan: text(track && track.lan, 30),
        lan_doc: text(track && track.lan_doc, 60),
        subtitle_url: text(track && track.subtitle_url, 1500),
        is_lock: Boolean(track && track.is_lock),
        ai_type: number(track && track.ai_type),
        author: {
          name: text(track && track.author && track.author.name, 120),
        },
      })),
    };
  }

  function readState() {
    const state =
      (window.__INITIAL_STATE__ && typeof window.__INITIAL_STATE__ === 'object'
        ? window.__INITIAL_STATE__
        : null) || {};
    const videoData =
      state.videoData && typeof state.videoData === 'object' ? state.videoData : {};
    const epInfo = state.epInfo && typeof state.epInfo === 'object' ? state.epInfo : {};
    const owner =
      videoData.owner && typeof videoData.owner === 'object' ? videoData.owner : {};
    const pages = Array.isArray(videoData.pages)
      ? videoData.pages.slice(0, 200).map((page) => ({
          cid: number(page && page.cid),
          page: number(page && page.page),
          part: text(page && page.part, 300),
          duration: number(page && page.duration),
        }))
      : [];
    return {
      href: location.href,
      title: document.title,
      page: number(new URL(location.href).searchParams.get('p')),
      videoData: {
        aid: number(videoData.aid),
        bvid: text(videoData.bvid, 30),
        cid: number(videoData.cid),
        title: text(videoData.title, 500),
        pic: text(videoData.pic, 2000),
        duration: number(videoData.duration),
        owner: { name: text(owner.name, 200) },
        pages,
        subtitle: sanitizeSubtitle(videoData.subtitle),
      },
      epInfo: {
        aid: number(epInfo.aid),
        bvid: text(epInfo.bvid, 30),
        cid: number(epInfo.cid),
        ep_id: number(epInfo.ep_id || epInfo.id),
        season_id: number(epInfo.season_id),
        title: text(epInfo.title || epInfo.index_title, 300),
        long_title: text(epInfo.long_title, 300),
        cover: text(epInfo.cover, 2000),
        duration: number(epInfo.duration),
        subtitle: sanitizeSubtitle(epInfo.subtitle),
      },
    };
  }

  async function fetchJson(url) {
    if (!isAllowedUrl(url)) {
      return { ok: false, status: 0, error: 'URL 不在允许的 B站域名内' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(String(url), {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json, text/plain, */*' },
        signal: controller.signal,
      });
      const responseText = await response.text();
      let data = null;
      try {
        data = JSON.parse(responseText);
      } catch (_) {
        return {
          ok: false,
          status: response.status,
          error: `响应不是 JSON（HTTP ${response.status}）`,
        };
      }
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: error && error.name === 'AbortError' ? '请求超时' : '页面请求失败',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function reply(id, payload) {
    window.postMessage(Object.assign({ source: PAGE_SOURCE, id }, payload), '*');
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== CONTENT_SOURCE || !data.id) return;

    if (data.type === 'GET_STATE') {
      let state;
      try {
        state = readState();
      } catch (_) {
        state = null;
      }
      reply(data.id, { type: 'STATE', ok: Boolean(state), state });
      return;
    }

    if (data.type === 'FETCH_JSON') {
      const result = await fetchJson(data.url);
      reply(data.id, Object.assign({ type: 'JSON' }, result));
    }
  });
})();
