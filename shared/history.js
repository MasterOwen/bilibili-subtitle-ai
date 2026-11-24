/*
 * Local summary history: one record per played video / part, keyed by bvid.
 *
 * Records live in chrome.storage.local under HISTORY_KEY and are capped by both
 * entry count and an estimated byte budget, so a long-lived install can never
 * push the extension over the storage quota. Writes are owned by the service
 * worker (serialized through one promise queue); content scripts only read, so
 * a page can never race a save that is already running.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.BiliSubHistory = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HISTORY_KEY = 'summaryHistory';
  const STORE_VERSION = 1;

  // chrome.storage.local allows 10 MB by default; keep history well below it so
  // settings, per-host API keys and future data always fit.
  const MAX_ENTRIES = 60;
  const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

  // A one-hour video is roughly 30-60k subtitle characters, so this only kicks
  // in for pathological streams. The snapshot keeps the beginning and marks
  // itself truncated instead of silently producing a wrong SRT.
  const MAX_SUBTITLE_CHARS = 150000;
  const MAX_SUBTITLE_SEGMENTS = 20000;
  const MAX_SUMMARY_CHARS = 40000;

  const MAX_KEY = 90;
  const MAX_TEXT = 500;
  const PREVIEW_CHARS = 180;

  const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function clampString(value, limit) {
    return String(value == null ? '' : value)
      .replace(/\u0000/g, '')
      .slice(0, limit || MAX_TEXT)
      .trim();
  }

  function isoOrEmpty(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString();
  }

  /**
   * History key for one playable unit. Multi-part videos get one entry per
   * part; anything without a bvid (rare) falls back to the cid.
   */
  function entryKey(video) {
    const v = video || {};
    const bvid = clampString(v.bvid, 30);
    const pageNo = Math.max(1, Math.floor(toNumber(v.pageNo) || 1));
    const pageCount = Math.max(1, Math.floor(toNumber(v.pageCount) || 1));
    if (bvid) return pageCount > 1 ? `${bvid}#p${pageNo}` : bvid;
    const cid = Math.floor(toNumber(v.cid));
    return cid > 0 ? `cid:${cid}` : '';
  }

  /**
   * Conservative storage size estimate. Chrome counts stored JSON bytes, so use
   * the larger of UTF-16 (2 bytes/code unit) and real UTF-8 length to stay on
   * the safe side for CJK-heavy summaries and subtitles.
   */
  function estimateBytes(value) {
    let json;
    try {
      json = JSON.stringify(value);
    } catch (_) {
      return 0;
    }
    if (json == null) return 0;
    const utf8 = encoder ? encoder.encode(json).length : json.length;
    return Math.max(json.length * 2, utf8);
  }

  function entrySize(entry) {
    const stored = Number(entry && entry.bytes);
    if (Number.isFinite(stored) && stored > 0) return stored;
    return estimateBytes(entry);
  }

  /** Copy subtitle segments into the bounded snapshot shape. */
  function snapshotSegments(segments) {
    const list = Array.isArray(segments) ? segments : [];
    const out = [];
    let chars = 0;
    let truncated = false;
    for (const item of list) {
      if (out.length >= MAX_SUBTITLE_SEGMENTS) {
        truncated = true;
        break;
      }
      if (!item || typeof item !== 'object') continue;
      const content = String(item.content == null ? '' : item.content)
        .replace(/\s+/g, ' ')
        .trim();
      if (!content) continue;
      if (chars + content.length > MAX_SUBTITLE_CHARS) {
        truncated = true;
        break;
      }
      const from = Math.max(0, toNumber(item.from));
      let to = toNumber(item.to);
      if (!(to > from)) to = from + 0.8;
      chars += content.length;
      out.push({
        from: Math.round(from * 100) / 100,
        to: Math.round(to * 100) / 100,
        content,
      });
    }
    return { segments: out, truncated, chars };
  }

  function normalizeStats(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const usage = input.usage && typeof input.usage === 'object' ? input.usage : {};
    return {
      chunks: Math.max(0, Math.floor(toNumber(input.chunks))),
      calls: Math.max(0, Math.floor(toNumber(input.calls))),
      promptTokens: Math.max(0, Math.floor(toNumber(usage.promptTokens))),
      completionTokens: Math.max(0, Math.floor(toNumber(usage.completionTokens))),
      totalTokens: Math.max(0, Math.floor(toNumber(usage.totalTokens))),
      subtitleCount: Math.max(0, Math.floor(toNumber(input.subtitleCount))),
    };
  }

  /**
   * Build the stored record for a finished summary. Returns null when there is
   * nothing worth keeping (empty summary or no stable video key).
   */
  function buildEntry(options) {
    const opts = options || {};
    const video = opts.video || {};
    const meta = opts.meta || {};
    const subtitleMeta = meta.subtitle && typeof meta.subtitle === 'object' ? meta.subtitle : {};
    const key = entryKey(video);
    if (!key) return null;

    const rawSummary = String(opts.summary == null ? '' : opts.summary)
      .replace(/\u0000/g, '')
      .trim();
    if (!rawSummary) return null;
    const summaryTruncated = rawSummary.length > MAX_SUMMARY_CHARS;
    const summary = summaryTruncated ? rawSummary.slice(0, MAX_SUMMARY_CHARS) : rawSummary;

    const snapshot = snapshotSegments(opts.segments);
    const now = new Date();
    const generatedAt = isoOrEmpty(opts.generatedAt) || now.toISOString();
    const stats = normalizeStats(meta.stats);

    const entry = {
      version: STORE_VERSION,
      key,
      bvid: clampString(video.bvid, 30),
      cid: Math.floor(toNumber(video.cid)),
      pageNo: Math.max(1, Math.floor(toNumber(video.pageNo) || 1)),
      pageCount: Math.max(1, Math.floor(toNumber(video.pageCount) || 1)),
      title: clampString(video.title, MAX_TEXT) || 'Bilibili 视频',
      owner: clampString(video.owner, 200),
      duration: Math.max(0, toNumber(video.duration)),
      url: clampString(video.url, 2000),
      summary,
      summaryChars: summary.length,
      generatedAt,
      savedAt: now.toISOString(),
      model: clampString(meta.model, 200),
      style: clampString(meta.style, 40) || 'structured',
      language: clampString(meta.language, 20) || 'zh',
      appVersion: clampString(opts.appVersion, 20),
      stats,
      subtitle: {
        lan: clampString(subtitleMeta.lan, 30),
        lanDoc: clampString(subtitleMeta.lanDoc, 60),
        author: clampString(subtitleMeta.author, 120),
        isAi: Boolean(subtitleMeta.isAi),
        count: snapshot.segments.length,
        chars: snapshot.chars,
        truncated: snapshot.truncated,
        segments: snapshot.segments,
      },
    };
    if (summaryTruncated) entry.summaryTruncated = true;
    entry.bytes = estimateBytes(entry);
    return entry;
  }

  function limitsOf(limits) {
    const input = limits && typeof limits === 'object' ? limits : {};
    const maxEntries = Math.floor(toNumber(input.maxEntries));
    const maxBytes = Math.floor(toNumber(input.maxBytes));
    return {
      maxEntries: maxEntries > 0 ? maxEntries : MAX_ENTRIES,
      maxBytes: maxBytes > 0 ? maxBytes : MAX_TOTAL_BYTES,
    };
  }

  function bySavedAtDesc(left, right) {
    const a = String((left && left.savedAt) || '');
    const b = String((right && right.savedAt) || '');
    if (a === b) return 0;
    return a < b ? 1 : -1;
  }

  /**
   * Keep the newest entries that fit both caps. The newest entry is always kept
   * even when it alone exceeds maxBytes, otherwise the just-saved summary would
   * disappear immediately.
   */
  function pruneEntries(entries, limits) {
    const { maxEntries, maxBytes } = limitsOf(limits);
    const list = (Array.isArray(entries) ? entries : []).filter((item) => item && item.key);
    list.sort(bySavedAtDesc);
    const kept = [];
    const evicted = [];
    let bytes = 0;
    for (const entry of list) {
      const size = entrySize(entry);
      const tooMany = kept.length >= maxEntries;
      const tooBig = kept.length > 0 && bytes + size > maxBytes;
      if (tooMany || tooBig) {
        evicted.push(entry.key);
        continue;
      }
      kept.push(entry);
      bytes += size;
    }
    return { entries: kept, evicted, bytes };
  }

  /** Insert or replace one entry, then apply both caps. */
  function upsertEntry(entries, entry, limits) {
    const rest = (Array.isArray(entries) ? entries : []).filter(
      (item) => item && item.key && (!entry || item.key !== entry.key),
    );
    return pruneEntries(entry ? [entry].concat(rest) : rest, limits);
  }

  /** Light list projection used by the panel; never includes the transcript. */
  function toListItem(entry) {
    if (!entry || typeof entry.key !== 'string' || !entry.key) return null;
    const subtitle = entry.subtitle && typeof entry.subtitle === 'object' ? entry.subtitle : {};
    const summary = typeof entry.summary === 'string' ? entry.summary : '';
    const segments = Array.isArray(subtitle.segments) ? subtitle.segments : [];
    return {
      key: clampString(entry.key, MAX_KEY),
      bvid: clampString(entry.bvid, 30),
      cid: Math.floor(toNumber(entry.cid)),
      pageNo: Math.max(1, Math.floor(toNumber(entry.pageNo) || 1)),
      pageCount: Math.max(1, Math.floor(toNumber(entry.pageCount) || 1)),
      title: clampString(entry.title, MAX_TEXT) || 'Bilibili 视频',
      owner: clampString(entry.owner, 200),
      duration: Math.max(0, toNumber(entry.duration)),
      url: clampString(entry.url, 2000),
      savedAt: isoOrEmpty(entry.savedAt),
      generatedAt: isoOrEmpty(entry.generatedAt),
      model: clampString(entry.model, 200),
      style: clampString(entry.style, 40) || 'structured',
      language: clampString(entry.language, 20) || 'zh',
      summaryChars: Math.max(0, Math.floor(toNumber(entry.summaryChars)) || summary.length),
      summaryPreview: summary.replace(/\s+/g, ' ').slice(0, PREVIEW_CHARS),
      subtitleCount: Math.max(0, Math.floor(toNumber(subtitle.count)) || segments.length),
      subtitleLanDoc: clampString(subtitle.lanDoc, 60),
      subtitleTruncated: Boolean(subtitle.truncated),
      hasSubtitles: segments.length > 0,
      bytes: entrySize(entry),
    };
  }

  /**
   * Tolerant read-side normalization. Deep-validating every transcript on each
   * panel open would be wasteful; this only guarantees the store shape and the
   * fields the UI relies on, and drops records that cannot be shown at all.
   */
  function normalizeStore(raw) {
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const byKey = new Map();
    for (const item of Array.isArray(input.entries) ? input.entries : []) {
      if (!item || typeof item !== 'object') continue;
      const key = clampString(item.key, MAX_KEY);
      const summary = typeof item.summary === 'string' ? item.summary : '';
      if (!key || !summary) continue;
      const subtitle = item.subtitle && typeof item.subtitle === 'object' ? item.subtitle : {};
      const entry = Object.assign({}, item, {
        key,
        summary: summary.slice(0, MAX_SUMMARY_CHARS),
        title: clampString(item.title, MAX_TEXT) || 'Bilibili 视频',
        savedAt: isoOrEmpty(item.savedAt),
        generatedAt: isoOrEmpty(item.generatedAt),
        subtitle: Object.assign({}, subtitle, {
          segments: Array.isArray(subtitle.segments) ? subtitle.segments.slice(0, MAX_SUBTITLE_SEGMENTS) : [],
          truncated: Boolean(subtitle.truncated),
        }),
      });
      entry.bytes = entrySize(entry);
      const existing = byKey.get(key);
      if (!existing || bySavedAtDesc(entry, existing) < 0) byKey.set(key, entry);
    }
    return { version: STORE_VERSION, entries: Array.from(byKey.values()) };
  }

  function formatBytes(bytes) {
    const n = Math.max(0, toNumber(bytes));
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${Math.round(n)} B`;
  }

  // ---------------------------------------------------------------------------
  // chrome.storage.local access
  // ---------------------------------------------------------------------------

  let memoryStore = { version: STORE_VERSION, entries: [] };
  let writeChain = Promise.resolve();

  function storageArea() {
    try {
      if (typeof chrome === 'undefined' || !chrome || !chrome.storage || !chrome.storage.local) {
        return null;
      }
      return chrome.storage.local;
    } catch (_) {
      return null;
    }
  }

  function emptyStore() {
    return { version: STORE_VERSION, entries: [] };
  }

  async function readStore() {
    const area = storageArea();
    if (!area) return normalizeStore(memoryStore);
    try {
      const stored = await area.get(HISTORY_KEY);
      return normalizeStore(stored ? stored[HISTORY_KEY] : null);
    } catch (_) {
      return emptyStore();
    }
  }

  async function writeStore(entries) {
    const payload = { version: STORE_VERSION, entries: Array.isArray(entries) ? entries : [] };
    const area = storageArea();
    if (!area) {
      memoryStore = payload;
      return payload;
    }
    await area.set({ [HISTORY_KEY]: payload });
    return payload;
  }

  /** Serialize writers inside this context (the service worker owns them). */
  function withLock(task) {
    const run = writeChain.then(task, task);
    writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function totalsFor(result, limits) {
    const resolved = limitsOf(limits);
    return {
      count: result.entries.length,
      bytes: result.bytes,
      maxEntries: resolved.maxEntries,
      maxBytes: resolved.maxBytes,
    };
  }

  async function listHistory(limits) {
    const resolved = limitsOf(limits);
    const store = await readStore();
    const pruned = pruneEntries(store.entries, resolved);
    return {
      items: pruned.entries.map(toListItem).filter(Boolean),
      totals: totalsFor(pruned, resolved),
    };
  }

  async function readEntry(key) {
    const wanted = clampString(key, MAX_KEY);
    if (!wanted) return null;
    const store = await readStore();
    return store.entries.find((entry) => entry.key === wanted) || null;
  }

  /**
   * Save one entry, replacing any previous record for the same key. On a quota
   * error it retries once with only the new entry kept, so a full disk still
   * records the summary the user just paid for.
   */
  async function upsertHistory(entry, limits) {
    if (!entry || !entry.key) throw new Error('历史记录不完整');
    return withLock(async () => {
      const resolved = limitsOf(limits);
      const store = await readStore();
      let pruned = upsertEntry(store.entries, entry, resolved);
      try {
        await writeStore(pruned.entries);
        return { entry, evicted: pruned.evicted, totals: totalsFor(pruned, resolved), quotaRetry: false };
      } catch (error) {
        const fallback = pruneEntries([entry], { maxEntries: 1, maxBytes: resolved.maxBytes });
        try {
          await writeStore(fallback.entries);
        } catch (_) {
          throw new Error('本地存储空间不足，无法保存历史总结');
        }
        return {
          entry,
          evicted: store.entries.map((item) => item.key),
          totals: totalsFor(fallback, resolved),
          quotaRetry: true,
          quotaError: error && error.message ? error.message : '',
        };
      }
    });
  }

  async function deleteEntry(key) {
    const wanted = clampString(key, MAX_KEY);
    if (!wanted) return { removed: 0 };
    return withLock(async () => {
      const store = await readStore();
      const entries = store.entries.filter((entry) => entry.key !== wanted);
      await writeStore(entries);
      return { removed: store.entries.length - entries.length };
    });
  }

  async function clearHistory() {
    return withLock(async () => {
      const store = await readStore();
      await writeStore([]);
      return { removed: store.entries.length };
    });
  }

  return {
    HISTORY_KEY,
    STORE_VERSION,
    MAX_ENTRIES,
    MAX_TOTAL_BYTES,
    MAX_SUBTITLE_CHARS,
    MAX_SUMMARY_CHARS,
    MAX_TEXT,
    PREVIEW_CHARS,
    entryKey,
    estimateBytes,
    entrySize,
    snapshotSegments,
    buildEntry,
    normalizeStore,
    limitsOf,
    pruneEntries,
    upsertEntry,
    toListItem,
    formatBytes,
    readStore,
    readEntry,
    listHistory,
    upsertHistory,
    deleteEntry,
    clearHistory,
  };
});
