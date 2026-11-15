/*
 * Shared, dependency-free helpers used by the content script, service worker,
 * popup and unit tests. Kept as a classic script (UMD) so MV3 content scripts
 * and importScripts() can both consume it.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.BiliSubUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BILIBILI_HOSTS = new Set(['www.bilibili.com', 'm.bilibili.com', 'bilibili.com']);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /** Human-readable clock: 0:07, 12:34, 1:02:03. */
  function formatClock(value, forceHours) {
    let total = Math.max(0, Math.floor(toNumber(value)));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0 || forceHours) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
    return `${pad2(minutes)}:${pad2(seconds)}`;
  }

  /** SRT clock: 00:00:01,240 / 01:02:03,400. */
  function formatSrtClock(value) {
    const msTotal = Math.max(0, Math.round(toNumber(value) * 1000));
    const hours = Math.floor(msTotal / 3600000);
    const minutes = Math.floor((msTotal % 3600000) / 60000);
    const seconds = Math.floor((msTotal % 60000) / 1000);
    const millis = msTotal % 1000;
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${String(millis).padStart(3, '0')}`;
  }

  /** Duration for UI/metadata: 12:34 / 1:02:03. */
  function formatDuration(value) {
    return formatClock(value);
  }

  function cleanSubtitleText(value) {
    return String(value == null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Turn a Bilibili subtitle payload or body array into clean segments. */
  function normalizeSegments(payload) {
    const body = Array.isArray(payload)
      ? payload
      : payload && Array.isArray(payload.body)
        ? payload.body
        : [];
    const segments = [];
    for (const item of body) {
      if (!item || typeof item !== 'object') continue;
      const content = cleanSubtitleText(item.content != null ? item.content : item.text);
      if (!content) continue;
      let from = toNumber(item.from != null ? item.from : item.start);
      let to = toNumber(item.to != null ? item.to : item.end);
      from = Math.max(0, from);
      if (!Number.isFinite(to) || to <= from) to = from + 0.8;
      segments.push({ from, to, content });
    }
    segments.sort((a, b) => a.from - b.from || a.to - b.to);
    return segments;
  }

  function dedupeAdjacent(segments) {
    const out = [];
    let previous = null;
    for (const seg of segments) {
      const normalized = seg.content.replace(/\s+/g, ' ').trim();
      if (!normalized) continue;
      if (normalized === previous) continue;
      previous = normalized;
      out.push(seg);
    }
    return out;
  }

  function segmentsToSrt(segments) {
    if (!Array.isArray(segments) || !segments.length) return '';
    const blocks = [];
    let index = 1;
    for (const seg of segments) {
      const text = cleanSubtitleText(seg.content);
      if (!text) continue;
      const start = Math.max(0, toNumber(seg.from));
      let end = toNumber(seg.to);
      if (end <= start) end = start + 0.8;
      blocks.push(`${index}\n${formatSrtClock(start)} --> ${formatSrtClock(end)}\n${text}`);
      index += 1;
    }
    return blocks.length ? `${blocks.join('\n\n')}\n` : '';
  }

  function segmentsToTxt(segments, options) {
    const opts = Object.assign({ timestamps: false, dedupe: true }, options || {});
    const source = opts.dedupe ? dedupeAdjacent(segments || []) : segments || [];
    const lines = [];
    for (const seg of source) {
      const text = cleanSubtitleText(seg.content).replace(/\s*\n\s*/g, ' ');
      if (!text) continue;
      lines.push(opts.timestamps ? `[${formatClock(seg.from)}] ${text}` : text);
    }
    return lines.join('\n');
  }

  function parseBilibiliRoute(href) {
    let url;
    try {
      url = new URL(String(href || ''));
    } catch (_) {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (!BILIBILI_HOSTS.has(host)) return null;

    const video = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av(\d+))\/?/i);
    if (video) {
      const raw = video[1];
      const bvid = /^bv/i.test(raw) ? `BV${raw.slice(2)}` : '';
      const aid = video[2] ? Number(video[2]) : 0;
      const pageValue = Number(url.searchParams.get('p'));
      const page = Number.isFinite(pageValue) && pageValue > 0 ? Math.floor(pageValue) : 1;
      return {
        kind: 'video',
        bvid: bvid || '',
        aid: aid || 0,
        page,
        key: `video:${(bvid || `av${aid}`).toUpperCase()}:p${page}`,
      };
    }

    const bangumi = url.pathname.match(/^\/bangumi\/play\/(ep|ss)(\d+)\/?/i);
    if (bangumi) {
      const type = bangumi[1].toLowerCase();
      const id = Number(bangumi[2]);
      return {
        kind: 'bangumi',
        epId: type === 'ep' ? id : 0,
        seasonId: type === 'ss' ? id : 0,
        key: `bangumi:${type}${id}`,
      };
    }
    return null;
  }

  function normalizeMediaUrl(value) {
    if (!value || typeof value !== 'string') return '';
    let url = value.trim();
    if (url.startsWith('//')) url = `https:${url}`;
    if (url.startsWith('/')) url = `https://www.bilibili.com${url}`;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
      if (parsed.protocol === 'http:') parsed.protocol = 'https:';
      return parsed.href;
    } catch (_) {
      return '';
    }
  }

  function isBilibiliMediaUrl(value) {
    try {
      const parsed = new URL(normalizeMediaUrl(value));
      return (
        parsed.protocol === 'https:' &&
        (parsed.hostname === 'bilibili.com' ||
          parsed.hostname.endsWith('.bilibili.com') ||
          parsed.hostname === 'hdslb.com' ||
          parsed.hostname.endsWith('.hdslb.com'))
      );
    } catch (_) {
      return false;
    }
  }

  function normalizeTrack(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const lan = String(raw.lan || raw.lan_doc || '').trim();
    const url = isBilibiliMediaUrl(raw.subtitle_url || raw.url || '')
      ? normalizeMediaUrl(raw.subtitle_url || raw.url)
      : '';
    const id = String(raw.id_str || raw.id || raw.subtitle_id || '').trim();
    if (!lan && !url && !id) return null;
    const lanDoc = String(raw.lan_doc || raw.lan || lan || '未知语言').trim();
    const isAi =
      /(^|-)ai($|-)/i.test(lan) ||
      /ai|自动|机器/i.test(lanDoc) ||
      Number(raw.ai_type) > 0;
    return {
      id,
      lan: lan || lanDoc,
      lanDoc,
      url,
      isAi,
      isLock: Boolean(raw.is_lock),
      author: raw.author && raw.author.name ? String(raw.author.name) : '',
      available: Boolean(url),
    };
  }

  /**
   * Accepts a full /x/player/v2 response, its data object, or an object with
   * subtitle.subtitles. Returns unique tracks plus login/lock hints.
   */
  function normalizePlayerTracks(payload) {
    const data = payload && payload.data && typeof payload.data === 'object' ? payload.data : payload;
    const subtitle = data && data.subtitle && typeof data.subtitle === 'object' ? data.subtitle : {};
    const candidates = []
      .concat(Array.isArray(subtitle.subtitles) ? subtitle.subtitles : [])
      .concat(Array.isArray(subtitle.list) ? subtitle.list : [])
      .concat(Array.isArray(data && data.subtitles) ? data.subtitles : []);

    const byKey = new Map();
    for (const candidate of candidates) {
      const track = normalizeTrack(candidate);
      if (!track) continue;
      const key = track.id || track.lan || track.url;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, track);
      } else if (!existing.url && track.url) {
        byKey.set(key, Object.assign({}, existing, track, { available: true }));
      }
    }
    const tracks = Array.from(byKey.values());
    tracks.sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return a.lan.localeCompare(b.lan);
    });
    return {
      tracks,
      needLogin: Boolean(data && data.need_login_subtitle),
      lockedCount: tracks.filter((t) => !t.available).length,
    };
  }

  /** Merge tracks from multiple API payloads, keeping the first useful URL. */
  function mergeTracks() {
    const byKey = new Map();
    for (let i = 0; i < arguments.length; i += 1) {
      const group = arguments[i];
      if (!group) continue;
      const list = Array.isArray(group) ? group : group.tracks || [];
      for (const item of list) {
        const track = normalizeTrack(item);
        if (!track) continue;
        const key = track.id || track.lan || track.url;
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, track);
        } else {
          byKey.set(
            key,
            Object.assign({}, existing, {
              url: existing.url || track.url,
              available: Boolean(existing.url || track.url),
              isLock: existing.isLock && track.isLock,
              lanDoc: existing.lanDoc || track.lanDoc,
              author: existing.author || track.author,
              isAi: existing.isAi || track.isAi,
            }),
          );
        }
      }
    }
    return Array.from(byKey.values());
  }

  const TRACK_PRIORITY = ['zh-cn', 'zh-hans', 'zh', 'ai-zh', 'zh-hant', 'zh-hk', 'zh-tw', 'en-us', 'en', 'ja', 'ko'];

  function trackScore(track, locale) {
    const lan = String(track.lan || '').toLowerCase();
    let index = TRACK_PRIORITY.indexOf(lan);
    if (index === -1) {
      index = TRACK_PRIORITY.findIndex((prefix) => lan.startsWith(prefix));
    }
    let score = index === -1 ? 50 : index * 10;
    if (!track.available) score += 500;
    if (track.isAi) score += 2;
    const primary = String(locale || '').toLowerCase().split('-')[0];
    if (primary && (lan === primary || lan.startsWith(`${primary}-`))) score -= 80;
    return score;
  }

  function pickBestTrack(tracks, locale) {
    const available = (tracks || []).filter((track) => track && track.available);
    if (!available.length) return null;
    return available.slice().sort((a, b) => trackScore(a, locale) - trackScore(b, locale))[0];
  }

  function safeSrtText(value) {
    return cleanSubtitleText(value).replace(/\n{3,}/g, '\n\n');
  }

  function chunkSegments(segments, maxChars) {
    const limit = clamp(Number(maxChars) || 7000, 1000, 20000);
    const chunks = [];
    let lines = [];
    let length = 0;
    let first = 0;
    let last = 0;

    function flush() {
      if (!lines.length) return;
      chunks.push({
        index: chunks.length,
        from: first,
        to: last,
        text: lines.join('\n'),
      });
      lines = [];
      length = 0;
    }

    for (const seg of segments || []) {
      const content = cleanSubtitleText(seg.content).replace(/\s*\n\s*/g, ' ');
      if (!content) continue;
      const prefix = `[${formatClock(seg.from)}] `;
      let remaining = content;
      while (remaining) {
        const room = limit - length - prefix.length - 1;
        if (room < 80) {
          flush();
          continue;
        }
        let piece = remaining;
        if (piece.length > room) {
          let cut = piece.lastIndexOf('。', room);
          if (cut < Math.floor(room * 0.55)) cut = piece.lastIndexOf('，', room);
          if (cut < Math.floor(room * 0.55)) cut = room;
          piece = piece.slice(0, cut + (cut < piece.length ? 1 : 0)).trim();
        }
        if (!piece) {
          flush();
          continue;
        }
        if (!lines.length) first = seg.from;
        lines.push(`${prefix}${piece}`);
        length += prefix.length + piece.length + 1;
        last = seg.to;
        remaining = remaining.slice(piece.length).trim();
      }
    }
    flush();
    return chunks;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInline(raw) {
    let text = escapeHtml(raw);
    const codeTokens = [];
    text = text.replace(/`([^`\n]+)`/g, function (_, code) {
      codeTokens.push(code);
      return `\u0000code${codeTokens.length - 1}\u0000`;
    });
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_, label, url) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    text = text.replace(
      /(^|[\s（(])\*([^*\n]+)\*(?=$|[\s）)，。；：！？,.!?;:])/g,
      '$1<em>$2</em>',
    );
    text = text.replace(/\u0000code(\d+)\u0000/g, function (_, index) {
      return `<code>${codeTokens[Number(index)]}</code>`;
    });
    return text;
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line || '');
  }

  function splitTableRow(line) {
    let text = String(line || '').trim();
    if (text.startsWith('|')) text = text.slice(1);
    if (text.endsWith('|')) text = text.slice(0, -1);
    return text.split('|').map((cell) => cell.trim());
  }

  function isListLine(line, indents) {
    const match = String(line || '').match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
    if (!match) return null;
    const indent = match[1].replace(/\t/g, '  ').length;
    indents.add(indent);
    return {
      indent,
      ordered: /^\d/.test(match[2]),
      tag: /^\d/.test(match[2]) ? 'ol' : 'ul',
      text: match[3],
    };
  }

  function isBlockStart(line) {
    return (
      /^\s*```/.test(line) ||
      /^\s*#{1,6}\s+/.test(line) ||
      /^\s*>/.test(line) ||
      /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
      /^\s*(?:---|___|\*\*\*)\s*$/.test(line)
    );
  }

  function renderMarkdown(markdown) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let i = 0;

    function renderListBlock(start) {
      const nodes = [];
      const indents = new Set();
      let cursor = start;
      while (cursor < lines.length) {
        const line = lines[cursor];
        const item = isListLine(line, indents);
        if (item) {
          nodes.push(item);
          cursor += 1;
          continue;
        }
        if (!line.trim()) {
          // A blank line ends the list unless the next non-blank line is indented.
          let next = cursor + 1;
          while (next < lines.length && !lines[next].trim()) next += 1;
          if (next < lines.length && /^\s{2,}/.test(lines[next])) {
            cursor += 1;
            continue;
          }
          break;
        }
        if (nodes.length && /^\s{2,}\S/.test(line)) {
          nodes[nodes.length - 1].text += ` ${line.trim()}`;
          cursor += 1;
          continue;
        }
        break;
      }

      const indentValues = Array.from(indents).sort((a, b) => a - b);
      const stack = [];
      const out = [];
      for (const node of nodes) {
        let depth = indentValues.indexOf(node.indent);
        if (depth < 0) depth = 0;
        while (stack.length && stack[stack.length - 1].depth > depth) {
          const top = stack.pop();
          out.push(`</li></${top.tag}>`);
        }
        if (stack.length && stack[stack.length - 1].depth === depth) {
          const top = stack[stack.length - 1];
          if (top.tag !== node.tag) {
            out.push(`</li></${top.tag}>`);
            stack.pop();
          } else {
            out.push('</li>');
          }
        }
        if (!stack.length || stack[stack.length - 1].depth < depth) {
          out.push(`<${node.tag}>`);
          stack.push({ tag: node.tag, depth });
        }
        out.push(`<li>${renderInline(node.text)}`);
      }
      while (stack.length) {
        const top = stack.pop();
        out.push(`</li></${top.tag}>`);
      }
      return { html: out.join(''), next: cursor };
    }

    while (i < lines.length) {
      const line = lines[i];

      if (/^\s*```/.test(line)) {
        const language = line.replace(/^\s*```/, '').trim();
        i += 1;
        const code = [];
        while (i < lines.length && !/^\s*```/.test(lines[i])) {
          code.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        output.push(
          `<pre class="md-code"${language ? ` data-lang="${escapeHtml(language)}"` : ''}><code>${escapeHtml(
            code.join('\n'),
          )}</code></pre>`,
        );
        continue;
      }

      if (!line.trim()) {
        i += 1;
        continue;
      }

      if (/^\s*(?:---|___|\*\*\*)\s*$/.test(line)) {
        output.push('<hr>');
        i += 1;
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = Math.min(6, heading[1].length);
        output.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
        i += 1;
        continue;
      }

      if (i + 1 < lines.length && line.includes('|') && isTableSeparator(lines[i + 1])) {
        const headers = splitTableRow(line);
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          rows.push(splitTableRow(lines[i]));
          i += 1;
        }
        const table = ['<div class="bsai-table-wrap"><table><thead><tr>'];
        for (const cell of headers) table.push(`<th>${renderInline(cell)}</th>`);
        table.push('</tr></thead><tbody>');
        for (const row of rows) {
          table.push('<tr>');
          for (let c = 0; c < headers.length; c += 1) {
            table.push(`<td>${renderInline(row[c] || '')}</td>`);
          }
          table.push('</tr>');
        }
        table.push('</tbody></table></div>');
        output.push(table.join(''));
        continue;
      }

      if (/^\s*>/.test(line)) {
        const quotes = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quotes.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        output.push(
          `<blockquote>${quotes
            .map((quote) => `<p>${renderInline(quote)}</p>`)
            .join('')}</blockquote>`,
        );
        continue;
      }

      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        const list = renderListBlock(i);
        output.push(list.html);
        i = list.next;
        continue;
      }

      const paragraph = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !isBlockStart(lines[i]) &&
        !(i + 1 < lines.length && lines[i].includes('|') && isTableSeparator(lines[i + 1]))
      ) {
        paragraph.push(lines[i]);
        i += 1;
      }
      if (paragraph.length) {
        output.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
      } else {
        // Safety valve for a line the block parser does not understand.
        output.push(`<p>${renderInline(line)}</p>`);
        i += 1;
      }
    }
    return output.join('\n');
  }

  function stripMarkdown(markdown) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let inCode = false;
    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        output.push(line);
        continue;
      }
      if (isTableSeparator(line)) continue;
      if (/^\s*(?:---|___|\*\*\*)\s*$/.test(line)) {
        output.push('');
        continue;
      }
      let text = line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)]*\)/g, '$1')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        .replace(/~~(.*?)~~/g, '$1')
        .replace(/`([^`]+)`/g, '$1');
      if (line.includes('|') && !/^\s*[-*+]\s/.test(line)) {
        text = text
          .replace(/^\s*\|/, '')
          .replace(/\|\s*$/, '')
          .split('|')
          .map((cell) => cell.trim())
          .join('  ');
      }
      output.push(text);
    }
    return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function normalizeSummaryMarkdown(markdown) {
    let text = String(markdown || '').replace(/\r\n?/g, '\n').trim();
    text = text.replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/, '');
    const lines = text.split('\n');
    let first = 0;
    while (first < lines.length && !lines[first].trim()) first += 1;
    if (first < lines.length && /^#\s+/.test(lines[first])) {
      lines.splice(first, 1);
      while (first < lines.length && !lines[first].trim()) lines.splice(first, 1);
    }
    return lines.join('\n').trim();
  }

  function markdownLinkText(value) {
    return String(value || '').replace(/([\\\[\]])/g, '\\$1');
  }

  function videoMetaLine(video) {
    const parts = [];
    if (video.owner) parts.push(`UP主：${video.owner}`);
    if (video.duration) parts.push(`时长：${formatDuration(video.duration)}`);
    if (video.bvid) parts.push(video.bvid);
    if (video.pageCount > 1) parts.push(`P${video.pageNo}/${video.pageCount}`);
    return parts.join(' · ');
  }

  function summaryToMarkdown(options) {
    const opts = options || {};
    const video = opts.video || {};
    const title = video.title || '视频总结';
    const includeHeader = opts.includeHeader !== false;
    const summary = normalizeSummaryMarkdown(opts.summary || '');
    if (!includeHeader) return `${summary}\n`;
    const lines = [`# ${title}`, ''];
    lines.push(`> 视频：[${markdownLinkText(title)}](${video.url || '#'})  `);
    const meta = videoMetaLine(video);
    if (meta) lines.push(`> ${meta}  `);
    if (opts.generatedAt) lines.push(`> AI 总结生成于 ${opts.generatedAt}  `);
    lines.push('> 内容由 AI 根据视频字幕整理，可能存在误差。', '', '---', '', summary, '');
    return lines.join('\n');
  }

  function summaryToTxt(options) {
    const opts = options || {};
    const video = opts.video || {};
    const title = video.title || '视频总结';
    const includeHeader = opts.includeHeader !== false;
    const body = stripMarkdown(normalizeSummaryMarkdown(opts.summary || ''));
    if (!includeHeader) return `${body}\n`;
    const lines = [title, video.url || '', videoMetaLine(video)];
    if (opts.generatedAt) lines.push(`AI 总结生成于 ${opts.generatedAt}`);
    lines.push('内容由 AI 根据视频字幕整理，可能存在误差。', '', '='.repeat(48), '', body, '');
    return lines.filter((line, index, arr) => line !== '' || arr[index - 1] !== '').join('\n');
  }

  function sanitizeFilename(value, maxLength) {
    const limit = maxLength || 90;
    let name = String(value || '')
      .replace(/\r?\n/g, ' ')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '');
    if (!name) name = 'bilibili_video';
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
    const chars = Array.from(name);
    if (chars.length > limit) name = chars.slice(0, limit).join('').trim();
    return name || 'bilibili_video';
  }

  function buildFilename(title, suffix, extension, maxLength) {
    const safeTitle = sanitizeFilename(title, maxLength || 90);
    const safeSuffix = sanitizeFilename(suffix || '', 24);
    return `${safeTitle}${safeSuffix ? `_${safeSuffix}` : ''}.${extension}`;
  }

  function formatLocalDateTime(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
      d.getHours(),
    )}:${pad2(d.getMinutes())}`;
  }

  function compactNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    if (n >= 100000000) return `${(n / 100000000).toFixed(1).replace(/\.0$/, '')}亿`;
    if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万`;
    return String(Math.round(n));
  }

  return {
    clamp,
    toNumber,
    formatClock,
    formatSrtClock,
    formatDuration,
    cleanSubtitleText,
    normalizeSegments,
    dedupeAdjacent,
    segmentsToSrt,
    segmentsToTxt,
    parseBilibiliRoute,
    normalizeMediaUrl,
    isBilibiliMediaUrl,
    normalizeTrack,
    normalizePlayerTracks,
    mergeTracks,
    pickBestTrack,
    chunkSegments,
    escapeHtml,
    renderMarkdown,
    stripMarkdown,
    normalizeSummaryMarkdown,
    summaryToMarkdown,
    summaryToTxt,
    sanitizeFilename,
    buildFilename,
    formatLocalDateTime,
    compactNumber,
    videoMetaLine,
  };
});
