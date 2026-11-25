/*
 * Bilibili subtitle + AI summary content script.
 * Renders a Shadow-DOM panel, talks to the page bridge for session data and to
 * the service worker for Bilibili APIs / AI requests.
 */
(function () {
  'use strict';

  const U = globalThis.BiliSubUtils;
  const Settings = globalThis.BiliSubSettings;
  const History = globalThis.BiliSubHistory;
  if (!U || !Settings || !History) return;

  const ROOT_ID = 'bsai-root';
  const CONTENT_SOURCE = 'bsai-content';
  const PAGE_SOURCE = 'bsai-page';

  const ICONS = {
    sparkles:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2l1.55 4.25L17.8 9l-4.25 1.55L12 14.8l-1.55-4.25L6.2 9l4.25-1.55L12 3.2Z"/><path d="M18.4 15.1l.72 1.98 1.98.72-1.98.72-.72 1.98-.72-1.98-1.98-.72 1.98-.72.72-1.98Z"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    refresh:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/></svg>',
    download:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11"/><path d="M8 10.5l4 4 4-4"/><path d="M4 16.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5"/></svg>',
    copy:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    file:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></svg>',
    stop:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    info:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
    alert:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.8 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    subtitles:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h4M7 14h2M13 14h4M15 10h2"/></svg>',
    play:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 7 8 5-8 5V7Z"/></svg>',
    external:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>',
    login:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>',
    clock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  };

  function icon(name) {
    return ICONS[name] || '';
  }

  const PANEL_HTML = `
    <button class="bsai-pill" type="button" data-el="pill" aria-label="打开 B站字幕 AI 总结">
      <span class="bsai-pill-icon">${icon('sparkles')}</span>
      <span>字幕总结</span>
      <span class="bsai-pill-dot"></span>
    </button>

    <section class="bsai-panel" data-el="panel" role="dialog" aria-label="B站字幕 AI 总结" aria-hidden="true" tabindex="-1">
      <header class="bsai-header">
        <div class="bsai-brand">
          <div class="bsai-logo">${icon('sparkles')}</div>
          <div class="bsai-brand-text">
            <div class="bsai-brand-name">字幕总结 <span class="bsai-ai-chip">AI</span></div>
            <div class="bsai-brand-sub">Bilibili × AI</div>
          </div>
        </div>
        <div class="bsai-head-actions">
          <button class="bsai-icon-btn" type="button" data-act="settings" title="设置" aria-label="打开设置">${icon('settings')}</button>
          <button class="bsai-icon-btn" type="button" data-act="close" title="收起面板" aria-label="收起面板">${icon('close')}</button>
        </div>
      </header>

      <div class="bsai-video">
        <img class="bsai-cover" data-el="cover" alt="" hidden />
        <div class="bsai-video-text">
          <div class="bsai-video-title" data-el="videoTitle">正在获取视频信息…</div>
          <div class="bsai-video-meta" data-el="videoMeta"></div>
        </div>
      </div>

      <nav class="bsai-tabs" role="tablist" aria-label="字幕和总结">
        <button class="bsai-tab is-active" type="button" role="tab" aria-selected="true" data-tab="sub">
          字幕<span class="bsai-tab-count" data-el="tabSubCount" hidden></span>
        </button>
        <button class="bsai-tab" type="button" role="tab" aria-selected="false" data-tab="ai">AI 总结</button>
        <button class="bsai-tab" type="button" role="tab" aria-selected="false" data-tab="history">
          历史<span class="bsai-tab-count" data-el="tabHistoryCount" hidden></span>
        </button>
      </nav>

      <div class="bsai-body">
        <section class="bsai-view" data-view="sub">
          <div class="bsai-track-row">
            <div class="bsai-select-wrap">
              <select class="bsai-track-select" data-el="trackSelect" aria-label="选择字幕语言" disabled>
                <option>正在获取字幕…</option>
              </select>
            </div>
            <button class="bsai-btn icon-only" type="button" data-act="reload" title="重新获取视频和字幕" aria-label="重新获取视频和字幕">${icon('refresh')}</button>
          </div>

          <div class="bsai-search-row">
            <div class="bsai-search-wrap">
              <span class="bsai-search-icon">${icon('search')}</span>
              <input class="bsai-search" data-el="search" type="search" placeholder="搜索字幕内容" autocomplete="off" spellcheck="false" />
            </div>
            <span class="bsai-count" data-el="count"></span>
          </div>

          <div class="bsai-export-row">
            <button class="bsai-btn" type="button" data-export="srt" disabled>${icon('download')}SRT</button>
            <button class="bsai-btn" type="button" data-export="txt" disabled>${icon('file')}TXT</button>
            <button class="bsai-btn icon-only" type="button" data-copy="sub" disabled title="复制字幕文本" aria-label="复制字幕文本">${icon('copy')}</button>
          </div>

          <div class="bsai-status" data-el="subStatus" role="status"></div>

          <div class="bsai-loading" data-el="subLoading" hidden>
            <span class="bsai-spinner"></span>
            <span data-el="loadingText">正在获取字幕…</span>
          </div>

          <div class="bsai-sub-list" data-el="subList"></div>
          <div class="bsai-empty" data-el="subEmpty" hidden></div>
        </section>

        <section class="bsai-view" data-view="ai" hidden>
          <div class="bsai-ai-hero">
            <div class="bsai-ai-orb">${icon('sparkles')}</div>
            <div class="bsai-ai-copy">
              <h3>AI 视频总结</h3>
              <p data-el="aiHint">先加载字幕，再生成总结。</p>
              <div class="bsai-style-picker" data-el="stylePicker" role="group" aria-label="总结偏好"></div>
            </div>
          </div>

          <div class="bsai-ai-actions">
            <button class="bsai-btn primary" type="button" data-act="summarize" data-el="generate" disabled>${icon('sparkles')}<span data-el="summarizeLabel">生成总结</span></button>
            <button class="bsai-btn subtle" type="button" data-act="stop" data-el="stop" hidden>${icon('stop')}停止</button>
            <button class="bsai-btn ai-export" type="button" data-export="md" disabled title="导出 Markdown" aria-label="导出 Markdown">${icon('download')}<span>MD</span></button>
            <button class="bsai-btn ai-export" type="button" data-export="ai-txt" disabled title="导出 TXT" aria-label="导出总结 TXT">${icon('file')}<span>TXT</span></button>
            <button class="bsai-btn icon-only" type="button" data-copy="summary" disabled title="复制总结" aria-label="复制总结">${icon('copy')}</button>
          </div>

          <div class="bsai-status" data-el="aiStatus" role="status"></div>

          <div class="bsai-progress" data-el="progress" hidden>
            <div class="bsai-progress-text">
              <span class="bsai-spinner"></span>
              <span data-el="progressText">正在准备…</span>
            </div>
            <div class="bsai-progress-bar"><i data-el="progressBar"></i></div>
          </div>

          <div class="bsai-stream" data-el="aiStream" hidden>
            <div class="bsai-stream-head">
              <span data-el="streamPhase">AI 正在输出…</span>
              <span class="bsai-stream-badge"><i></i>实时</span>
            </div>
            <details class="bsai-reasoning" data-el="reasoning" hidden>
              <summary class="bsai-reasoning-head">
                <span class="bsai-reasoning-icon">${icon('sparkles')}</span>
                <span>深度思考</span>
                <span class="bsai-reasoning-meta" data-el="reasoningMeta"></span>
              </summary>
              <pre class="bsai-reasoning-text" data-el="reasoningText" aria-label="模型深度思考过程"></pre>
            </details>
            <pre data-el="streamText" aria-label="AI 实时输出"></pre>
          </div>

          <div class="bsai-summary" data-el="summary" hidden></div>
          <div class="bsai-summary-meta" data-el="summaryMeta" hidden></div>
          <div class="bsai-empty" data-el="aiEmpty" hidden></div>
        </section>

        <section class="bsai-view" data-view="history" hidden>
          <div class="bsai-history-head">
            <span class="bsai-history-usage" data-el="historyUsage">本机历史</span>
            <button class="bsai-btn subtle" type="button" data-act="clear-history" data-el="clearHistory" disabled>清空</button>
          </div>
          <div class="bsai-status" data-el="historyStatus" role="status"></div>
          <div class="bsai-history-list" data-el="historyList"></div>
          <div class="bsai-empty" data-el="historyEmpty" hidden></div>
        </section>
      </div>

      <footer class="bsai-footer">
        <span>字幕来自 Bilibili</span>
        <span>AI 内容仅供参考</span>
      </footer>

      <div class="bsai-toast" data-el="toast" role="status" aria-live="polite"></div>
    </section>
  `;

  const state = {
    route: null,
    routeKey: '',
    host: null,
    shadow: null,
    refs: {},
    open: false,
    activeTab: 'sub',
    loaded: false,
    loading: false,
    trackLoading: false,
    video: null,
    tracks: [],
    trackMap: new Map(),
    selectedTrackKey: '',
    preferredLan: '',
    segments: [],
    search: '',
    searchTimer: null,
    summary: '',
    summaryGeneratedAt: null,
    summaryStats: null,
    summaryFromHistory: false,
    summaryLoading: false,
    summaryStyle: '',
    styleSaving: false,
    historyItems: [],
    historyTotals: null,
    historyKey: '',
    historyRestoring: false,
    streamText: '',
    streamPhase: '',
    streamTimer: null,
    reasoningText: '',
    reasoningActive: false,
    promptCopying: false,
    summaryToken: 0,
    summaryPort: null,
    summaryHeartbeat: null,
    summaryWatchdog: null,
    warnings: [],
    aiStatus: null,
    aiStatusAt: 0,
    aiStatusLoading: false,
    aiError: '',
    settings: Settings.normalizeSettings(Settings.DEFAULTS),
    loadToken: 0,
    trackToken: 0,
    toastTimer: null,
    bridgeSeq: 0,
    bridgePending: new Map(),
    lastHref: location.href,
  };

  function $(selector) {
    return state.shadow ? state.shadow.querySelector(selector) : null;
  }

  function refsAll(selector) {
    return state.shadow ? Array.from(state.shadow.querySelectorAll(selector)) : [];
  }

  function createHost() {
    if (state.host && state.host.isConnected) return;
    if (state.host && !state.host.isConnected) {
      (document.body || document.documentElement).appendChild(state.host);
      return;
    }
    const host = document.createElement('div');
    host.id = ROOT_ID;
    host.style.cssText =
      'all: initial; position: fixed; inset: 0; z-index: 2147483000; pointer-events: none;';
    const shadow = host.attachShadow({ mode: 'open' });
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = chrome.runtime.getURL('content/panel.css');
    shadow.appendChild(stylesheet);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = PANEL_HTML;
    while (wrapper.firstChild) shadow.appendChild(wrapper.firstChild);
    (document.body || document.documentElement).appendChild(host);

    state.host = host;
    state.shadow = shadow;
    state.refs = {};
    shadow.querySelectorAll('[data-el]').forEach((node) => {
      state.refs[node.dataset.el] = node;
    });
    bindPanelEvents();
    renderStylePicker();
    refreshHistory();
    state.refs.cover.addEventListener('error', () => {
      state.refs.cover.hidden = true;
    });
  }

  function bindPanelEvents() {
    const refs = state.refs;
    refs.pill.addEventListener('click', () => openPanel());
    refs.pill.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openPanel();
      }
    });

    refs.panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.open) {
        event.stopPropagation();
        closePanel();
      }
    });

    refs.panel.addEventListener('click', onPanelClick);
    refs.search.addEventListener('input', onSearchInput);
    if (refs.stylePicker) {
      refs.stylePicker.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-style]');
        if (chip && refs.stylePicker.contains(chip)) applySummaryStyle(chip.dataset.style);
      });
    }

    refs.panel.addEventListener('click', (event) => {
      const row = event.target.closest('.bsai-sub-row');
      if (row && refs.subList.contains(row)) seekTo(Number(row.dataset.time));
    });

    refs.trackSelect.addEventListener('change', () => {
      const track = state.trackMap.get(refs.trackSelect.value);
      if (!track || !track.available) return;
      state.selectedTrackKey = refs.trackSelect.value;
      state.preferredLan = track.lan;
      abortSummary(true);
      resetSummary();
      loadSubtitle(track);
    });
    state.shadow.addEventListener('click', (event) => {
      const emptyAction = event.target.closest('[data-empty-act]');
      if (emptyAction) {
        handleEmptyAction(emptyAction.dataset.emptyAct);
        return;
      }
      const historyAction = event.target.closest('[data-history-act]');
      if (historyAction) {
        onHistoryAction(historyAction.dataset.historyAct, historyAction.dataset.key);
      }
    });
  }

  function onPanelClick(event) {
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      switchTab(tab.dataset.tab);
      return;
    }
    const exportButton = event.target.closest('[data-export]');
    if (exportButton) {
      const type = exportButton.dataset.export;
      if (type === 'srt' || type === 'txt') exportSubtitle(type);
      else exportSummary(type);
      return;
    }
    const copyButton = event.target.closest('[data-copy]');
    if (copyButton) {
      if (copyButton.dataset.copy === 'sub') copySubtitle();
      else copySummary();
      return;
    }
    const action = event.target.closest('[data-act]');
    if (!action) return;
    switch (action.dataset.act) {
      case 'settings':
        openOptions();
        break;
      case 'close':
        closePanel();
        break;
      case 'reload':
        loadVideo();
        break;
      case 'summarize':
        generateSummary();
        break;
      case 'stop':
        stopSummary();
        break;
      case 'clear-history':
        clearAllHistory();
        break;
      default:
        break;
    }
  }

  function onSearchInput() {
    state.search = state.refs.search.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => renderSegments(), 120);
  }

  function setOpen(open) {
    if (!state.host) return;
    state.open = Boolean(open);
    state.refs.panel.classList.toggle('is-open', state.open);
    state.refs.panel.setAttribute('aria-hidden', state.open ? 'false' : 'true');
    state.refs.pill.hidden = state.open;
    if (state.open) {
      if (!state.loaded && !state.loading) loadVideo();
      if (!state.aiStatus || Date.now() - state.aiStatusAt > 30000) refreshAiStatus();
      if (state.loaded && !state.summary) restoreFromHistory();
      refreshHistory();
    }
  }

  function openPanel() {
    if (!state.host) createHost();
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
  }

  function switchTab(tab) {
    if (tab !== 'sub' && tab !== 'ai' && tab !== 'history') return;
    state.activeTab = tab;
    refsAll('[data-tab]').forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    refsAll('[data-view]').forEach((view) => {
      view.hidden = view.dataset.view !== tab;
    });
    if (tab === 'ai') {
      renderAiEmpty();
      updateAiButtons();
    }
    if (tab === 'history') refreshHistory();
  }

  async function openOptions() {
    try {
      const response = await sendRuntimeMessage({ type: 'OPEN_OPTIONS' }, 8000);
      if (!response || !response.ok) {
        throw new Error((response && response.error) || '打开设置页失败');
      }
    } catch (_) {
      showToast('无法打开设置页，请在扩展管理中打开', 'error');
    }
  }

  function escapeStatusText(value) {
    return String(value == null ? '' : value);
  }

  function setStatus(element, text, type) {
    if (!element) return;
    element.classList.remove('is-visible', 'is-error', 'is-warn', 'is-success');
    if (!text) {
      element.replaceChildren();
      return;
    }
    const kind = type || 'info';
    element.classList.add('is-visible');
    if (kind === 'error') element.classList.add('is-error');
    else if (kind === 'warn') element.classList.add('is-warn');
    else if (kind === 'success') element.classList.add('is-success');
    const iconName = kind === 'error' || kind === 'warn' ? 'alert' : kind === 'success' ? 'check' : 'info';
    const iconHolder = document.createElement('span');
    iconHolder.innerHTML = icon(iconName);
    const label = document.createElement('span');
    label.textContent = escapeStatusText(text);
    element.replaceChildren(iconHolder, label);
  }

  function setEmpty(element, options) {
    if (!element) return;
    const opts = Object.assign({ icon: 'subtitles', title: '', desc: '', actions: [] }, options || {});
    element.replaceChildren();
    const iconBox = document.createElement('div');
    iconBox.className = 'bsai-empty-icon';
    iconBox.innerHTML = icon(opts.icon);
    const title = document.createElement('div');
    title.className = 'bsai-empty-title';
    title.textContent = opts.title || '';
    const desc = document.createElement('div');
    desc.className = 'bsai-empty-desc';
    desc.textContent = opts.desc || '';
    element.append(iconBox);
    if (opts.title) element.append(title);
    if (opts.desc) element.append(desc);
    if (opts.actions && opts.actions.length) {
      const actions = document.createElement('div');
      actions.className = 'bsai-empty-actions';
      for (const action of opts.actions) {
        const button = document.createElement(action.href ? 'a' : 'button');
        button.className = `bsai-btn${action.primary ? ' primary' : ''}`;
        if (action.href) {
          button.href = action.href;
          button.target = '_blank';
          button.rel = 'noopener noreferrer';
        } else {
          button.type = 'button';
          button.dataset.emptyAct = action.act || '';
        }
        if (action.icon && ICONS[action.icon]) {
          const iconHolder = document.createElement('span');
          iconHolder.innerHTML = icon(action.icon);
          button.appendChild(iconHolder);
        }
        const label = document.createElement('span');
        label.textContent = action.label || '';
        button.appendChild(label);
        actions.appendChild(button);
      }
      element.appendChild(actions);
    }
    element.hidden = false;
  }

  function hideEmpty(element) {
    if (!element) return;
    element.hidden = true;
    element.replaceChildren();
  }

  function handleEmptyAction(action) {
    if (action === 'retry' || action === 'retry-load') loadVideo();
    else if (action === 'settings') openOptions();
    else if (action === 'generate') generateSummary();
    else if (action === 'copy-prompt') copyPrompt();
    else if (action === 'clear-search') {
      state.search = '';
      if (state.refs.search) state.refs.search.value = '';
      renderSegments();
    }
  }

  function showToast(message, type, duration) {
    const toast = state.refs.toast;
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle('is-error', type === 'error');
    toast.classList.add('is-visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      toast.classList.remove('is-visible');
    }, duration || 2800);
  }

  function setSubLoading(loading, text) {
    if (!state.refs.subLoading) return;
    state.refs.subLoading.hidden = !loading;
    if (text && state.refs.loadingText) state.refs.loadingText.textContent = text;
    if (loading) {
      state.refs.subList.hidden = true;
      hideEmpty(state.refs.subEmpty);
    }
  }

  function setVideoPlaceholder(title, meta) {
    if (!state.refs.videoTitle) return;
    state.refs.videoTitle.textContent = title || '';
    state.refs.videoTitle.title = title || '';
    if (state.refs.videoMeta) state.refs.videoMeta.replaceChildren();
    if (meta && state.refs.videoMeta) {
      const span = document.createElement('span');
      span.textContent = meta;
      state.refs.videoMeta.appendChild(span);
    }
  }

  function renderVideo(video) {
    if (!video) return;
    state.refs.videoTitle.textContent = video.title || 'Bilibili 视频';
    state.refs.videoTitle.title = video.title || '';
    state.refs.videoMeta.replaceChildren();
    const items = [];
    if (video.owner) items.push(video.owner);
    if (video.duration) items.push(U.formatDuration(video.duration));
    if (video.bvid) items.push(video.bvid);
    if (video.pageCount > 1) items.push(`P${video.pageNo}/${video.pageCount}`);
    for (const text of items) {
      const span = document.createElement('span');
      span.textContent = text;
      state.refs.videoMeta.appendChild(span);
    }
    const cover = state.refs.cover;
    if (cover) {
      if (video.cover) {
        cover.src = video.cover;
        cover.hidden = false;
      } else {
        cover.removeAttribute('src');
        cover.hidden = true;
      }
    }
  }

  function updateTabCount() {
    const count = state.refs.tabSubCount;
    if (!count) return;
    if (state.segments.length) {
      count.textContent = String(state.segments.length);
      count.hidden = false;
    } else {
      count.textContent = '';
      count.hidden = true;
    }
  }

  function currentSummaryStyle() {
    const value =
      state.summaryStyle ||
      (state.aiStatus && state.aiStatus.style) ||
      'structured';
    if (!Settings || !Array.isArray(Settings.STYLES)) return value;
    return Settings.STYLES.some((item) => item.value === value) ? value : 'structured';
  }

  function summaryStyleLabel(value) {
    if (!Settings || !Array.isArray(Settings.STYLES)) return '结构化摘要';
    const style = Settings.STYLES.find((item) => item.value === value);
    return style ? style.label : '结构化摘要';
  }

  function renderStylePicker() {
    const picker = state.refs.stylePicker;
    if (!picker || !Settings || !Array.isArray(Settings.STYLES)) return;
    if (!picker.childElementCount) {
      const fragment = document.createDocumentFragment();
      for (const item of Settings.STYLES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'bsai-style-chip';
        button.dataset.style = item.value;
        button.title = item.hint;
        button.textContent = item.label;
        fragment.appendChild(button);
      }
      picker.replaceChildren(fragment);
    }
    updateStylePicker();
  }

  function updateStylePicker() {
    const picker = state.refs.stylePicker;
    if (!picker) return;
    const active = currentSummaryStyle();
    for (const button of picker.querySelectorAll('[data-style]')) {
      const selected = button.dataset.style === active;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.disabled = state.styleSaving;
    }
  }

  async function applySummaryStyle(style) {
    if (state.styleSaving) return;
    if (!Settings || !Array.isArray(Settings.STYLES)) return;
    if (!Settings.STYLES.some((item) => item.value === style)) return;
    const previous = currentSummaryStyle();
    if (previous === style) return;
    const label = summaryStyleLabel(style);
    state.styleSaving = true;
    state.summaryStyle = style;
    updateStylePicker();
    updateAiCopy();
    try {
      const response = await sendRuntimeMessage({ type: 'SET_STYLE', style }, 8000);
      if (!response || !response.ok) {
        throw new Error((response && response.error) || '保存失败');
      }
      const suffix = state.summaryLoading ? '，下次生成生效' : state.summary ? '，重新生成后生效' : '';
      showToast(`总结偏好已切换为「${label}」${suffix}`, 'success');
    } catch (error) {
      state.summaryStyle = previous;
      showToast(`偏好保存失败：${error.message}`, 'error');
    } finally {
      state.styleSaving = false;
      updateStylePicker();
      updateAiCopy();
      renderAiEmpty();
    }
  }

  function updateAiCopy() {
    const refs = state.refs;
    if (!refs.aiHint) return;
    const styleLabel = summaryStyleLabel(currentSummaryStyle());
    if (state.segments.length) {
      if (state.aiStatus && state.aiStatus.configured) {
        refs.aiHint.textContent = `将把 ${state.segments.length} 条字幕发送给 AI（${state.aiStatus.model}）生成${styleLabel}。`;
      } else {
        refs.aiHint.textContent = `已加载 ${state.segments.length} 条字幕。当前偏好：${styleLabel}；配置 AI 服务可直接生成，也可以复制提示词到其他网页 AI。`;
      }
    } else {
      refs.aiHint.textContent =
        currentSummaryStyle() === 'transcript' ? '先加载字幕，再生成逐字稿。' : '先加载字幕，再生成总结。';
    }
    if (refs.summarizeLabel) {
      const verb = currentSummaryStyle() === 'transcript' ? '逐字稿' : '总结';
      if (state.summaryLoading) refs.summarizeLabel.textContent = '正在生成…';
      else refs.summarizeLabel.textContent = state.summary ? '重新生成' : `生成${verb}`;
    }
  }

  function updateAiButtons() {
    const refs = state.refs;
    const hasSegments = state.segments.length > 0;
    if (refs.generate) {
      refs.generate.disabled = state.summaryLoading || !hasSegments;
    }
    if (refs.stop) {
      refs.stop.hidden = !state.summaryLoading;
    }
    const hasSummary = Boolean(state.summary);
    refsAll('[data-export="md"],[data-export="ai-txt"],[data-copy="summary"]').forEach((button) => {
      button.disabled = !hasSummary;
    });
    updateAiCopy();
  }

  function updateSubtitleButtons() {
    const hasSegments = state.segments.length > 0;
    refsAll('[data-export="srt"],[data-export="txt"],[data-copy="sub"]').forEach((button) => {
      button.disabled = !hasSegments || state.trackLoading;
    });
    if (state.refs.trackSelect) {
      state.refs.trackSelect.disabled = state.trackLoading || !state.tracks.length;
    }
    updateTabCount();
    updateAiButtons();
  }

  function resetSummary() {
    state.summary = '';
    state.summaryGeneratedAt = null;
    state.summaryStats = null;
    state.summaryFromHistory = false;
    state.aiError = '';
    resetAiStream();
    if (state.refs.summary) {
      state.refs.summary.hidden = true;
      state.refs.summary.replaceChildren();
    }
    if (state.refs.summaryMeta) {
      state.refs.summaryMeta.hidden = true;
      state.refs.summaryMeta.textContent = '';
    }
    if (state.refs.progress) state.refs.progress.hidden = true;
    setStatus(state.refs.aiStatus, '', '');
    renderAiEmpty();
    updateAiButtons();
  }

  function clearVideoData() {
    state.video = null;
    state.tracks = [];
    state.trackMap = new Map();
    state.selectedTrackKey = '';
    state.segments = [];
    state.search = '';
    state.summary = '';
    state.summaryGeneratedAt = null;
    state.summaryStats = null;
    state.summaryFromHistory = false;
    state.historyKey = '';
    state.warnings = [];
    state.aiError = '';
    state.loaded = false;
    state.loading = false;
    state.trackLoading = false;
    if (state.refs.search) state.refs.search.value = '';
    if (state.refs.subList) {
      state.refs.subList.replaceChildren();
      state.refs.subList.hidden = true;
    }
    if (state.refs.count) state.refs.count.textContent = '';
    if (state.refs.trackSelect) {
      state.refs.trackSelect.replaceChildren(new Option('正在获取字幕…', ''));
      state.refs.trackSelect.disabled = true;
    }
    setSubLoading(false);
    hideEmpty(state.refs.subEmpty);
    setStatus(state.refs.subStatus, '', '');
    setStatus(state.refs.aiStatus, '', '');
    if (state.refs.summary) {
      state.refs.summary.hidden = true;
      state.refs.summary.replaceChildren();
    }
    if (state.refs.summaryMeta) {
      state.refs.summaryMeta.hidden = true;
      state.refs.summaryMeta.textContent = '';
    }
    if (state.refs.progress) state.refs.progress.hidden = true;
    if (state.refs.summarizeLabel) state.refs.summarizeLabel.textContent = '生成总结';
    setVideoPlaceholder('正在获取视频信息…', '');
    updateSubtitleButtons();
    renderAiEmpty();
  }

  function renderTrackSelect() {
    const select = state.refs.trackSelect;
    if (!select) return;
    select.replaceChildren();
    state.trackMap = new Map();
    if (!state.tracks.length) {
      select.appendChild(new Option('无可用字幕', ''));
      select.disabled = true;
      return;
    }
    for (const track of state.tracks) {
      const key = track.id || `${track.lan}|${track.url}`;
      state.trackMap.set(key, track);
      const parts = [track.lanDoc || track.lan || '未知语言'];
      if (track.isAi) parts.push('AI');
      if (track.author) parts.push(track.author);
      select.appendChild(new Option(parts.join(' · '), key));
    }
    select.disabled = !state.tracks.length;
    if (state.selectedTrackKey && state.trackMap.has(state.selectedTrackKey)) {
      select.value = state.selectedTrackKey;
    }
  }

  function renderSegments() {
    if (!state.refs.subList) return;
    const list = state.refs.subList;
    const count = state.refs.count;
    const query = state.search.trim();
    const queryLower = query.toLowerCase();
    const filtered = query
      ? state.segments.filter((segment) => segment.content.toLowerCase().includes(queryLower))
      : state.segments;
    count.textContent = query
      ? `${filtered.length}/${state.segments.length} 条`
      : `${state.segments.length} 条`;
    list.replaceChildren();
    if (!state.segments.length) {
      list.hidden = true;
      return;
    }
    if (!filtered.length) {
      list.hidden = true;
      setEmpty(state.refs.subEmpty, {
        icon: 'search',
        title: '没有匹配的字幕',
        desc: `没有找到包含“${query}”的内容，换个关键词试试。`,
        actions: [{ label: '清除搜索', act: 'clear-search' }],
      });
      return;
    }
    hideEmpty(state.refs.subEmpty);
    list.hidden = false;
    const fragment = document.createDocumentFragment();
    for (const segment of filtered) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bsai-sub-row';
      row.dataset.time = String(segment.from);
      row.title = `跳转到 ${U.formatClock(segment.from)}`;
      const time = document.createElement('span');
      time.className = 'bsai-sub-time';
      time.textContent = U.formatClock(segment.from);
      const text = document.createElement('span');
      text.className = 'bsai-sub-text';
      if (query) appendHighlighted(text, segment.content, query);
      else text.textContent = segment.content;
      row.append(time, text);
      fragment.appendChild(row);
    }
    list.appendChild(fragment);
    list.scrollTop = 0;
  }

  function appendHighlighted(parent, text, query) {
    const lower = text.toLowerCase();
    const needle = query.toLowerCase();
    let cursor = 0;
    let index = lower.indexOf(needle);
    while (index !== -1) {
      if (index > cursor) parent.appendChild(document.createTextNode(text.slice(cursor, index)));
      const mark = document.createElement('mark');
      mark.className = 'bsai-sub-match';
      mark.textContent = text.slice(index, index + query.length);
      parent.appendChild(mark);
      cursor = index + query.length;
      index = lower.indexOf(needle, cursor);
    }
    if (cursor < text.length) parent.appendChild(document.createTextNode(text.slice(cursor)));
  }

  function seekTo(seconds) {
    const videos = Array.from(document.querySelectorAll('video'));
    if (!videos.length) {
      showToast('没有找到播放器，可能处于特殊播放模式', 'error');
      return;
    }
    const video = videos.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    try {
      video.currentTime = Math.max(0, Number(seconds) || 0);
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
      showToast(`已跳转到 ${U.formatClock(seconds)}`);
    } catch (_) {
      showToast('跳转失败，请先点击播放器', 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Bridge to the MAIN-world script
  // ---------------------------------------------------------------------------
  function bridgeRequest(type, payload, timeoutMs) {
    const id = `${Date.now().toString(36)}-${++state.bridgeSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.bridgePending.delete(id);
        reject(new Error('页面通信超时'));
      }, timeoutMs || 1500);
      state.bridgePending.set(id, { resolve, reject, timer });
      try {
        window.postMessage(Object.assign({ source: CONTENT_SOURCE, id, type }, payload || {}), '*');
      } catch (error) {
        clearTimeout(timer);
        state.bridgePending.delete(id);
        reject(error);
      }
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== PAGE_SOURCE || !data.id) return;
    const pending = state.bridgePending.get(data.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    state.bridgePending.delete(data.id);
    pending.resolve(data);
  });

  async function getPageState() {
    try {
      const result = await bridgeRequest('GET_STATE', {}, 1000);
      return result && result.ok && result.state ? result.state : null;
    } catch (_) {
      return null;
    }
  }

  async function pageFetchJson(url) {
    try {
      const result = await bridgeRequest('FETCH_JSON', { url }, 22000);
      return result && result.data ? result : null;
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime messaging
  // ---------------------------------------------------------------------------
  function sendRuntimeMessage(message, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('后台响应超时，请重试'));
      }, timeoutMs || 30000);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || '扩展后台不可用，请刷新页面'));
            return;
          }
          if (!response) {
            reject(new Error('扩展后台没有返回数据，请刷新页面后重试'));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('扩展已更新，请刷新 B站页面后重试'));
      }
    });
  }

  async function loadVideo() {
    if (!state.route) return;
    if (state.loading) return;
    const token = ++state.loadToken;
    state.loading = true;
    state.loaded = false;
    state.trackToken += 1;
    state.aiError = '';
    abortSummary(true);
    resetSummary();
    clearVideoData();
    state.loading = true;
    setSubLoading(true, '正在获取视频信息和字幕…');
    setStatus(state.refs.subStatus, '正在读取视频信息…', 'info');
    updateSubtitleButtons();

    try {
      const pageState = await getPageState();
      if (token !== state.loadToken) return;
      const response = await sendRuntimeMessage(
        { type: 'LOAD_VIDEO', payload: { href: location.href, pageState } },
        80000,
      );
      if (token !== state.loadToken) return;
      if (!response.ok) throw new Error(response.error || '获取视频信息失败');

      state.video = response.video || null;
      state.tracks = (response.tracks || []).filter((track) => track && track.available);
      state.warnings = (response.warnings || []).slice(0, 3);
      state.loading = false;
      state.loaded = true;
      state.historyKey = state.video ? History.entryKey(state.video) : '';
      if (state.video) renderVideo(state.video);

      if (!state.tracks.length) {
        const fallback = await fetchPlayerTracksFromPage(response.video);
        if (token !== state.loadToken) return;
        if (fallback && fallback.tracks && fallback.tracks.length) {
          state.tracks = U.mergeTracks(state.tracks, fallback.tracks).filter((track) => track.available);
          state.warnings = (state.warnings || []).concat(['已通过当前页面会话获取字幕']);
        }
      }

      if (!state.tracks.length) {
        setSubLoading(false);
        renderTrackSelect();
        updateSubtitleButtons();
        // No live subtitles: a saved snapshot still lets the user review and
        // export instead of staring at an empty panel.
        const restored = await restoreFromHistory({ reason: 'offline' });
        if (token !== state.loadToken) return;
        if (restored) {
          updateAiButtons();
          if (!state.segments.length) {
            showSubtitleEmpty({
              icon: 'subtitles',
              title: '历史记录里没有字幕快照',
              desc: '这次历史只保存了总结正文。可以直接在「AI 总结」里查看已恢复的总结，或重试获取在线字幕。',
              actions: [{ label: '重试', act: 'retry', icon: 'refresh', primary: true }],
            });
          }
          return;
        }
        const reason =
          response.reason ||
          '该视频没有可用字幕。B站只对部分视频提供字幕；AI 字幕需要视频本身已生成语音识别结果。';
        showSubtitleEmpty({
          icon: 'subtitles',
          title: response.needLogin ? '需要登录 B站才能获取字幕' : '没有找到可用字幕',
          desc: reason,
          actions: response.needLogin
            ? [
                {
                  label: '登录 B站',
                  href: 'https://passport.bilibili.com/login',
                  icon: 'login',
                  primary: true,
                },
                { label: '重试', act: 'retry', icon: 'refresh' },
              ]
            : [
                { label: '重试', act: 'retry', icon: 'refresh' },
                { label: '检查设置', act: 'settings', icon: 'settings' },
              ],
        });
        if (response.warnings && response.warnings.length) {
          setStatus(state.refs.subStatus, response.warnings[0], 'warn');
        } else {
          setStatus(state.refs.subStatus, '', '');
        }
        updateAiButtons();
        return;
      }

      const preferred =
        state.tracks.find((track) => track.lan === state.preferredLan) ||
        U.pickBestTrack(state.tracks, navigator.language);
      state.selectedTrackKey = preferred ? preferred.id || `${preferred.lan}|${preferred.url}` : '';
      renderTrackSelect();
      updateSubtitleButtons();
      if (preferred) await loadSubtitle(preferred, token);
      if (token !== state.loadToken) return;
      // Fresh subtitles are loaded; the saved summary (if any) belongs back on
      // screen so a refresh does not look like the work was lost.
      if (!state.summary) await restoreFromHistory();
      if (response.warnings && response.warnings.length) {
        setStatus(state.refs.subStatus, response.warnings[0], 'warn');
      }
    } catch (error) {
      if (token !== state.loadToken) return;
      state.loading = false;
      state.loaded = false;
      setSubLoading(false);
      setVideoPlaceholder('未能获取视频信息', '');
      renderTrackSelect();
      updateSubtitleButtons();
      showSubtitleEmpty({
        icon: 'alert',
        title: '获取视频信息失败',
        desc: error.message || '未知错误',
        actions: [
          { label: '重试', act: 'retry', icon: 'refresh', primary: true },
          { label: '检查设置', act: 'settings', icon: 'settings' },
        ],
      });
      setStatus(state.refs.subStatus, error.message || '获取视频信息失败', 'error');
    }
  }

  async function fetchPlayerTracksFromPage(video) {
    if (!video || !video.aid || !video.cid) return null;
    const url = `https://api.bilibili.com/x/player/v2?aid=${encodeURIComponent(
      video.aid,
    )}&cid=${encodeURIComponent(video.cid)}`;
    const result = await pageFetchJson(url);
    if (!result || !result.data) return null;
    return U.normalizePlayerTracks(result.data);
  }

  async function loadSubtitle(track, loadToken) {
    if (!track || !track.url) return;
    const token = ++state.trackToken;
    const currentLoadToken = loadToken == null ? state.loadToken : loadToken;
    state.trackLoading = true;
    state.segments = [];
    state.summary = '';
    resetSummary();
    updateSubtitleButtons();
    setSubLoading(true, `正在下载「${track.lanDoc || track.lan}」字幕…`);
    setStatus(state.refs.subStatus, '', '');
    hideEmpty(state.refs.subEmpty);

    try {
      let data = null;
      let viaPage = false;
      let responseError = '';
      const response = await sendRuntimeMessage(
        { type: 'FETCH_SUBTITLE', url: track.url },
        50000,
      );
      if (response && response.ok && response.data) {
        data = response.data;
      } else {
        responseError = (response && response.error) || '后台下载字幕失败';
      }
      if (!data) {
        const pageResult = await pageFetchJson(track.url);
        if (pageResult && pageResult.data) {
          data = pageResult.data;
          viaPage = true;
        } else if (pageResult && pageResult.error) {
          responseError = pageResult.error;
        }
      }
      if (token !== state.trackToken || currentLoadToken !== state.loadToken) return;
      if (!data) throw new Error(responseError || '下载字幕失败');

      const segments = U.normalizeSegments(data);
      if (!segments.length) throw new Error('字幕文件为空，可能字幕尚未生成完成');

      state.segments = segments;
      state.loaded = true;
      state.trackLoading = false;
      setSubLoading(false);
      updateSubtitleButtons();
      updateTabCount();
      renderSegments();
      updateAiCopy();
      updateAiButtons();
      if (viaPage) {
        setStatus(state.refs.subStatus, '已通过当前页面登录状态获取字幕', 'success');
      } else if (state.warnings && state.warnings.length) {
        setStatus(state.refs.subStatus, state.warnings[0], 'warn');
      }
      if (state.activeTab === 'ai') renderAiEmpty();
    } catch (error) {
      if (token !== state.trackToken || currentLoadToken !== state.loadToken) return;
      state.trackLoading = false;
      state.segments = [];
      setSubLoading(false);
      updateSubtitleButtons();
      showSubtitleEmpty({
        icon: 'alert',
        title: '字幕下载失败',
        desc: error.message || '未知错误',
        actions: [
          { label: '重试', act: 'retry', icon: 'refresh', primary: true },
          { label: '重新获取视频', act: 'retry-load', icon: 'refresh' },
        ],
      });
      setStatus(state.refs.subStatus, error.message || '字幕下载失败', 'error');
      updateAiCopy();
      updateAiButtons();
      // Bilibili sometimes stops serving an old subtitle URL; the snapshot from
      // a previous session keeps this video usable.
      const restored = await restoreFromHistory({ reason: 'offline' });
      if (restored && token === state.trackToken) {
        setStatus(
          state.refs.subStatus,
          `字幕下载失败（${error.message || '未知错误'}），已恢复本地保存的字幕快照。`,
          'warn',
        );
      }
    }
  }

  function showSubtitleEmpty(options) {
    if (!state.refs.subList) return;
    state.refs.subList.hidden = true;
    setEmpty(state.refs.subEmpty, options);
    if (state.refs.count) state.refs.count.textContent = '0 条';
  }

  // ---------------------------------------------------------------------------
  // AI summary
  // ---------------------------------------------------------------------------
  async function refreshAiStatus(force) {
    if (state.aiStatusLoading) return state.aiStatus;
    if (!force && state.aiStatus && Date.now() - state.aiStatusAt < 30000) return state.aiStatus;
    state.aiStatusLoading = true;
    try {
      const response = await sendRuntimeMessage({ type: 'AI_STATUS' }, 12000);
      if (response && response.ok) {
        state.aiStatus = response;
        state.aiStatusAt = Date.now();
        state.summaryStyle = response.style || state.summaryStyle || 'structured';
      } else if (response) {
        state.aiStatus = { ok: false, configured: false, error: response.error };
      }
    } catch (_) {
      state.aiStatus = state.aiStatus || { ok: false, configured: false };
    } finally {
      state.aiStatusLoading = false;
    }
    updateAiCopy();
    updateStylePicker();
    renderAiEmpty();
    updateAiButtons();
    return state.aiStatus;
  }

  function renderAiEmpty() {
    const empty = state.refs.aiEmpty;
    if (!empty) return;
    if (state.summaryLoading || state.summary) {
      empty.hidden = true;
      empty.replaceChildren();
      return;
    }
    if (state.aiError) {
      setEmpty(empty, {
        icon: 'alert',
        title: '总结生成失败',
        desc: state.aiError,
        actions: [
          { label: '重试', act: 'generate', icon: 'refresh', primary: true },
          { label: '设置', act: 'settings', icon: 'settings' },
        ],
      });
      return;
    }
    if (!state.segments.length) {
      setEmpty(empty, {
        icon: 'subtitles',
        title: '还没有字幕',
        desc: '先在「字幕」标签页加载当前视频的字幕，AI 才能进行总结或整理逐字稿。',
      });
      return;
    }
    if (!state.aiStatus || !state.aiStatus.configured) {
      setEmpty(empty, {
        icon: 'settings',
        title: '配置 AI 服务，或复制提示词',
        desc: '配置 API Key 后可直接在扩展内生成；也可以不配置，复制完整提示词粘贴到 ChatGPT、Claude、DeepSeek 等网页 AI 中手动生成。',
        actions: [
          { label: '去设置', act: 'settings', icon: 'settings', primary: true },
          { label: '复制提示词', act: 'copy-prompt', icon: 'copy' },
        ],
      });
      return;
    }
    if (!state.aiStatus.permissionGranted) {
      setEmpty(empty, {
        icon: 'alert',
        title: '需要授权 API 域名',
        desc: `扩展尚未获得访问 ${state.aiStatus.baseHost || 'AI 服务'} 的权限，请在设置页保存一次以授权。`,
        actions: [
          { label: '去设置', act: 'settings', icon: 'settings', primary: true },
          { label: '复制提示词', act: 'copy-prompt', icon: 'copy' },
        ],
      });
      return;
    }
    const transcript = currentSummaryStyle() === 'transcript';
    setEmpty(empty, {
      icon: 'sparkles',
      title: transcript ? '整理一份逐字稿' : '生成一份视频总结',
      desc: `将使用 ${state.aiStatus.model || 'AI'} 分析 ${state.segments.length} 条字幕，整理成可导出的 Markdown ${
        transcript ? '逐字稿（保留原话与时间点，不做概括）' : '总结'
      }；也可以复制提示词到其他网页 AI。`,
      actions: [
        { label: '开始生成', act: 'generate', icon: 'sparkles', primary: true },
        { label: '复制提示词', act: 'copy-prompt', icon: 'copy' },
      ],
    });
  }

  function setProgress(percent, text) {
    if (!state.refs.progress) return;
    state.refs.progress.hidden = false;
    if (state.refs.progressText) state.refs.progressText.textContent = text || '正在生成…';
    if (state.refs.progressBar) state.refs.progressBar.style.width = `${Math.max(2, Math.min(100, percent))}%`;
  }

  function renderAiStream() {
    const refs = state.refs;
    if (!refs.aiStream || !refs.streamText) return;
    const pre = refs.streamText;
    const hasAnswer = Boolean(state.streamText);
    const answerNearBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
    pre.textContent = state.streamText;
    pre.hidden = !hasAnswer;
    if (hasAnswer && answerNearBottom) pre.scrollTop = pre.scrollHeight;

    if (refs.reasoning) {
      const hasReasoning = Boolean(state.reasoningText);
      refs.reasoning.hidden = !hasReasoning;
      if (hasReasoning) {
        const reasoningPre = refs.reasoningText;
        if (reasoningPre) {
          const reasoningNearBottom =
            reasoningPre.scrollHeight - reasoningPre.scrollTop - reasoningPre.clientHeight < 40;
          reasoningPre.textContent = state.reasoningText;
          if (reasoningNearBottom) reasoningPre.scrollTop = reasoningPre.scrollHeight;
        }
        if (refs.reasoningMeta) {
          refs.reasoningMeta.textContent = state.reasoningActive
            ? `思考中… ${state.reasoningText.length} 字`
            : `已思考 ${state.reasoningText.length} 字`;
        }
      }
    }

    refs.aiStream.hidden = false;
    if (refs.streamPhase) {
      const phase = state.streamPhase || 'AI 正在输出…';
      refs.streamPhase.textContent = state.reasoningActive ? `${phase} · 深度思考中` : phase;
    }
  }

  function scheduleAiStreamRender() {
    if (state.streamTimer) return;
    state.streamTimer = setTimeout(() => {
      state.streamTimer = null;
      renderAiStream();
    }, 60);
  }

  function appendAiStream(delta) {
    if (!delta || typeof delta !== 'object') return;
    const phase = delta.phase;
    if (phase === 'map') {
      const verb =
        currentSummaryStyle() === 'transcript' ? '正在整理逐字稿' : '正在提炼信息笔记';
      state.streamPhase = `第 ${delta.current || 1}/${delta.total || 1} 段 · ${verb}`;
    } else if (phase === 'reduce') {
      state.streamPhase = `正在合并分段笔记 · 第 ${delta.current || 1} 轮`;
    } else if (phase === 'final') {
      state.streamPhase = '正在生成最终总结';
    } else {
      state.streamPhase = 'AI 正在输出…';
    }
    if (delta.reset) {
      state.streamText = '';
      state.reasoningText = '';
      state.reasoningActive = false;
    }

    const text = typeof delta.text === 'string' ? delta.text : '';
    if (delta.reasoning) {
      if (text) {
        if (!state.reasoningText && state.refs.reasoning) state.refs.reasoning.open = true;
        state.reasoningActive = true;
        state.reasoningText += text;
        if (state.reasoningText.length > 60000) {
          state.reasoningText = state.reasoningText.slice(-60000);
        }
      }
    } else if (text) {
      if (state.reasoningActive) {
        state.reasoningActive = false;
        // The model moved on to the visible answer; keep the trace available
        // but collapse it so the stream area shows the answer.
        if (state.reasoningText && state.refs.reasoning) state.refs.reasoning.open = false;
      }
      state.streamText += text;
      if (state.streamText.length > 40000) {
        state.streamText = state.streamText.slice(-40000);
      }
    }

    if (delta.reset) renderAiStream();
    else scheduleAiStreamRender();
  }

  function resetAiStream() {
    if (state.streamTimer) {
      clearTimeout(state.streamTimer);
      state.streamTimer = null;
    }
    state.streamText = '';
    state.streamPhase = '';
    state.reasoningText = '';
    state.reasoningActive = false;
    if (state.refs.aiStream) state.refs.aiStream.hidden = true;
    if (state.refs.streamText) state.refs.streamText.textContent = '';
    if (state.refs.streamPhase) state.refs.streamPhase.textContent = '';
    if (state.refs.reasoning) {
      state.refs.reasoning.hidden = true;
      state.refs.reasoning.open = true;
    }
    if (state.refs.reasoningText) state.refs.reasoningText.textContent = '';
    if (state.refs.reasoningMeta) state.refs.reasoningMeta.textContent = '';
  }

  function armSummaryWatchdog() {
    clearTimeout(state.summaryWatchdog);
    state.summaryWatchdog = setTimeout(() => {
      if (!state.summaryLoading) return;
      const port = state.summaryPort;
      state.summaryLoading = false;
      state.summaryToken += 1;
      stopSummaryHeartbeat();
      try {
        if (port) {
          port.postMessage({ type: 'abort' });
          port.disconnect();
        }
      } catch (_) {
        /* ignore */
      }
      state.summaryPort = null;
      if (state.refs.progress) state.refs.progress.hidden = true;
      resetAiStream();
      state.aiError = 'AI 响应超时，请检查网络或换用更快的模型后重试。';
      setStatus(state.refs.aiStatus, state.aiError, 'error');
      renderAiEmpty();
      updateAiButtons();
    }, 300000);
  }

  function startSummaryHeartbeat(port) {
    stopSummaryHeartbeat();
    state.summaryHeartbeat = setInterval(() => {
      try {
        port.postMessage({ type: 'ping' });
      } catch (_) {
        stopSummaryHeartbeat();
      }
    }, 15000);
  }

  function stopSummaryHeartbeat() {
    if (!state.summaryHeartbeat) return;
    clearInterval(state.summaryHeartbeat);
    state.summaryHeartbeat = null;
  }

  function cleanupSummaryPort() {
    stopSummaryHeartbeat();
    resetAiStream();
    clearTimeout(state.summaryWatchdog);
    state.summaryWatchdog = null;    if (state.summaryPort) {
      try {
        state.summaryPort.disconnect();
      } catch (_) {
        /* ignore */
      }
    }
    state.summaryPort = null;
  }

  function summaryVideoPayload() {
    return {
      title: state.video ? state.video.title : '',
      owner: state.video ? state.video.owner : '',
      duration: state.video ? state.video.duration : 0,
      url: state.video ? state.video.url : location.href,
      bvid: state.video ? state.video.bvid : '',
      cid: state.video ? state.video.cid : 0,
      pageNo: state.video ? state.video.pageNo : 1,
      pageCount: state.video ? state.video.pageCount : 1,
    };
  }

  /** Subtitle track metadata stored alongside the summary for later review. */
  function currentTrackMeta() {
    const track = state.trackMap.get(state.selectedTrackKey) || null;
    if (!track) return null;
    return {
      lan: track.lan || '',
      lanDoc: track.lanDoc || track.lan || '',
      author: track.author || '',
      isAi: Boolean(track.isAi),
    };
  }

  function summarySegmentsPayload() {
    return state.segments.map((segment) => ({
      from: segment.from,
      to: segment.to,
      content: segment.content,
    }));
  }

  async function generateSummary() {
    if (state.summaryLoading) return;
    if (!state.segments.length) {
      switchTab('sub');
      showToast('请先加载字幕', 'error');
      return;
    }
    state.aiError = '';
    resetAiStream();
    let status = state.aiStatus;
    if (!status || Date.now() - state.aiStatusAt > 30000) status = await refreshAiStatus(true);
    if (!status || !status.configured) {
      switchTab('ai');
      state.aiError = '';
      setStatus(
        state.refs.aiStatus,
        '还没有配置 AI 服务：可以在设置页配置，或点击下方“复制提示词”到其他网页 AI 生成。',
        'warn',
      );
      renderAiEmpty();
      updateAiButtons();
      return;
    }
    if (!status.permissionGranted) {
      const message = '扩展还没有访问 AI 接口域名的权限，请到设置页保存一次以授权。';
      state.aiError = message;
      setStatus(state.refs.aiStatus, message, 'error');
      renderAiEmpty();
      updateAiButtons();
      return;
    }

    const token = ++state.summaryToken;
    state.summaryLoading = true;
    state.aiError = '';
    switchTab('ai');
    setStatus(state.refs.aiStatus, '', '');
    setProgress(4, '正在连接 AI 服务…');
    updateAiButtons();
    renderAiEmpty();

    let port;
    try {
      port = chrome.runtime.connect({ name: 'bili-ai-summary' });
    } catch (error) {
      state.summaryLoading = false;
      state.aiError = '无法连接扩展后台，请刷新页面后重试。';
      setStatus(state.refs.aiStatus, state.aiError, 'error');
      if (state.refs.progress) state.refs.progress.hidden = true;
      renderAiEmpty();
      updateAiButtons();
      return;
    }
    state.summaryPort = port;
    startSummaryHeartbeat(port);

    port.onMessage.addListener((message) => {
      if (token !== state.summaryToken) return;
      if (!message || typeof message !== 'object') return;
      if (message.type === 'pong') {
        armSummaryWatchdog();
        return;
      }
      if (message.type === 'delta') {
        appendAiStream(message.delta || {});
        armSummaryWatchdog();
        return;
      }
      if (message.type === 'progress') {
        armSummaryWatchdog();
        const progress = message.progress || {};
        let percent = 10;
        let text = progress.message || '正在生成…';
        if (progress.phase === 'map') {
          percent = 10 + (Number(progress.current) / Math.max(1, Number(progress.total))) * 62;
        } else if (progress.phase === 'reduce') {
          percent = 75;
        } else if (progress.phase === 'final') {
          percent = 90;
        }
        setProgress(percent, text);
      } else if (message.type === 'done') {
        clearTimeout(state.summaryWatchdog);
        state.summary = message.summary || '';
        state.summaryFromHistory = false;
        state.summaryGeneratedAt = message.generatedAt ? new Date(message.generatedAt) : new Date();
        if (Number.isNaN(state.summaryGeneratedAt.getTime())) state.summaryGeneratedAt = new Date();
        state.summaryStats = message.stats || null;
        state.summaryLoading = false;
        state.aiError = '';
        state.summaryToken += 1;
        setProgress(100, '总结完成');
        setTimeout(() => {
          if (state.refs.progress) state.refs.progress.hidden = true;
        }, 350);
        if (state.refs.summary) {
          state.refs.summary.innerHTML = U.renderMarkdown(state.summary);
          state.refs.summary.hidden = false;
          state.refs.summary.scrollTop = 0;
        }
        const historyInfo = message.history || null;
        if (historyInfo && historyInfo.saved && historyInfo.key) state.historyKey = historyInfo.key;
        if (state.refs.summaryMeta) {
          const stats = state.summaryStats;
          const pieces = [
            `生成于 ${U.formatLocalDateTime(state.summaryGeneratedAt)}`,
            state.aiStatus && state.aiStatus.model ? state.aiStatus.model : '',
            stats && stats.chunks ? `${stats.chunks} 个分段` : '',
            historyInfo && historyInfo.saved ? '已存入本地历史' : '',
          ].filter(Boolean);
          state.refs.summaryMeta.textContent = pieces.join(' · ');
          state.refs.summaryMeta.hidden = false;
        }
        setStatus(state.refs.aiStatus, '总结完成，可以导出或复制。', 'success');
        hideEmpty(state.refs.aiEmpty);
        cleanupSummaryPort();
        updateAiButtons();
        if (historyInfo && historyInfo.saved) {
          refreshHistory();
          if (historyInfo.quotaRetry) {
            showToast('存储空间接近上限，只保留了最新总结', 'error', 4200);
          }
        } else if (historyInfo && historyInfo.error) {
          showToast(`总结已生成，但未能存入历史：${historyInfo.error}`, 'error', 4200);
        }
      } else if (message.type === 'error') {
        clearTimeout(state.summaryWatchdog);
        state.summaryLoading = false;
        state.summaryToken += 1;
        state.aiError = message.error || 'AI 总结失败';
        if (state.refs.progress) state.refs.progress.hidden = true;
        setStatus(state.refs.aiStatus, state.aiError, 'error');
        cleanupSummaryPort();
        renderAiEmpty();
        updateAiButtons();
      } else if (message.type === 'aborted') {
        clearTimeout(state.summaryWatchdog);
        state.summaryLoading = false;
        state.summaryToken += 1;
        if (state.refs.progress) state.refs.progress.hidden = true;
        setStatus(state.refs.aiStatus, '已停止生成。', 'warn');
        cleanupSummaryPort();
        renderAiEmpty();
        updateAiButtons();
      }
    });

    port.onDisconnect.addListener(() => {
      if (token !== state.summaryToken || !state.summaryLoading) return;
      const runtimeError = chrome.runtime.lastError;
      state.summaryLoading = false;
      state.summaryToken += 1;
      stopSummaryHeartbeat();
      state.aiError =
        (runtimeError && runtimeError.message) ||
        '与后台的连接意外中断，请重试；长视频可在设置中减小分段长度后重试。';
      if (state.refs.progress) state.refs.progress.hidden = true;
      setStatus(state.refs.aiStatus, state.aiError, 'error');
      state.summaryPort = null;
      clearTimeout(state.summaryWatchdog);
      resetAiStream();
      renderAiEmpty();
      updateAiButtons();
    });

    armSummaryWatchdog();
    try {
      port.postMessage({
        type: 'start',
        payload: {
          video: summaryVideoPayload(),
          segments: summarySegmentsPayload(),
          subtitle: currentTrackMeta(),
        },
      });
    } catch (error) {
      state.summaryLoading = false;
      state.summaryToken += 1;
      state.aiError = '发送字幕给 AI 失败，请刷新页面后重试。';
      if (state.refs.progress) state.refs.progress.hidden = true;
      setStatus(state.refs.aiStatus, state.aiError, 'error');
      cleanupSummaryPort();
      renderAiEmpty();
      updateAiButtons();
    }
  }

  async function copyPrompt() {
    if (state.promptCopying) return;
    if (!state.segments.length) {
      showToast('请先加载字幕', 'error');
      return;
    }
    state.promptCopying = true;
    showToast('正在准备提示词…', '', 10000);
    try {
      const response = await sendRuntimeMessage(
        {
          type: 'BUILD_PROMPT',
          video: summaryVideoPayload(),
          segments: summarySegmentsPayload(),
        },
        20000,
      );
      if (!response || !response.ok || !response.prompt) {
        throw new Error((response && response.error) || '生成提示词失败');
      }
      if (!(await copyText(response.prompt))) {
        showToast('复制失败，请重试', 'error', 4200);
        return;
      }
      setStatus(
        state.refs.aiStatus,
        '提示词已复制，可粘贴到 ChatGPT、Claude、DeepSeek 等网页 AI 中并发送。',
        'success',
      );
      showToast('提示词已复制，请到 ChatGPT / Claude / DeepSeek 等网页 AI 中粘贴并发送', 'success', 4200);
    } catch (error) {
      showToast(error.message || '复制提示词失败', 'error', 4200);
    } finally {
      state.promptCopying = false;
    }
  }

  function stopSummary() {
    if (!state.summaryLoading || !state.summaryPort) return;
    try {
      state.summaryPort.postMessage({ type: 'abort' });
      setStatus(state.refs.aiStatus, '正在停止生成…', 'warn');
    } catch (_) {
      state.summaryLoading = false;
      cleanupSummaryPort();
      updateAiButtons();
    }
  }

  // ---------------------------------------------------------------------------
  // Summary history (local, bounded)
  // ---------------------------------------------------------------------------
  function updateHistoryCount() {
    const badge = state.refs.tabHistoryCount;
    if (!badge) return;
    const count = state.historyItems.length;
    badge.textContent = count ? String(count) : '';
    badge.hidden = !count;
  }

  async function refreshHistory() {
    if (!state.host || !state.refs.historyList) return;
    try {
      const result = await History.listHistory();
      state.historyItems = Array.isArray(result.items) ? result.items : [];
      state.historyTotals = result.totals || null;
    } catch (_) {
      state.historyItems = [];
      state.historyTotals = null;
    }
    renderHistory();
  }

  function historyMetaLine(item) {
    const parts = [];
    if (item.owner) parts.push(item.owner);
    if (item.pageCount > 1) parts.push(`P${item.pageNo}/${item.pageCount}`);
    const when = item.generatedAt || item.savedAt;
    if (when) {
      const label = U.formatLocalDateTime(new Date(when));
      if (label) parts.push(label);
    }
    if (item.model) parts.push(item.model);
    parts.push(summaryStyleLabel(item.style));
    if (item.hasSubtitles) parts.push(`${item.subtitleCount} 条字幕`);
    else parts.push('无字幕快照');
    return parts.filter(Boolean).join(' · ');
  }

  function historyActionButton(item, action, label, title) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bsai-btn';
    button.dataset.historyAct = action;
    button.dataset.key = item.key;
    button.title = title;
    button.textContent = label;
    return button;
  }

  function historyRow(item) {
    const row = document.createElement('article');
    row.className = 'bsai-history-item';
    if (state.historyKey && item.key === state.historyKey) row.classList.add('is-current');

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'bsai-history-main';
    main.dataset.historyAct = 'load';
    main.dataset.key = item.key;
    main.title = '载入这条总结';

    const title = document.createElement('div');
    title.className = 'bsai-history-title';
    title.textContent = item.title || item.bvid || item.key;

    const meta = document.createElement('div');
    meta.className = 'bsai-history-meta';
    meta.textContent = historyMetaLine(item);

    const preview = document.createElement('div');
    preview.className = 'bsai-history-preview';
    preview.textContent = item.summaryPreview || '';

    main.append(title, meta, preview);

    const actions = document.createElement('div');
    actions.className = 'bsai-history-actions';
    actions.append(
      historyActionButton(item, 'export-md', 'MD', '导出 Markdown'),
      historyActionButton(item, 'export-txt', 'TXT', '导出纯文本'),
      historyActionButton(item, 'delete', '删除', '删除这条历史总结'),
    );

    row.append(main, actions);
    return row;
  }

  function renderHistory() {
    const list = state.refs.historyList;
    if (!list) return;
    const totals = state.historyTotals;
    if (state.refs.historyUsage) {
      state.refs.historyUsage.textContent = totals
        ? `${totals.count}/${totals.maxEntries} 条 · ${History.formatBytes(
            totals.bytes,
          )} / ${History.formatBytes(totals.maxBytes)}`
        : '本机历史';
    }
    if (state.refs.clearHistory) state.refs.clearHistory.disabled = !state.historyItems.length;
    updateHistoryCount();
    list.replaceChildren();
    if (!state.historyItems.length) {
      list.hidden = true;
      setEmpty(state.refs.historyEmpty, {
        icon: 'clock',
        title: '还没有历史总结',
        desc: `生成总结或逐字稿后会自动保存在本机（最多 ${History.MAX_ENTRIES} 条 / ${History.formatBytes(
          History.MAX_TOTAL_BYTES,
        )}）。刷新页面、关闭标签页后仍可在这里回看和导出。`,
      });
      return;
    }
    hideEmpty(state.refs.historyEmpty);
    list.hidden = false;
    const fragment = document.createDocumentFragment();
    for (const item of state.historyItems) fragment.appendChild(historyRow(item));
    list.appendChild(fragment);
  }

  async function onHistoryAction(action, key) {
    if (!key) return;
    if (action === 'load') {
      await loadHistoryEntry(key);
      return;
    }
    if (action === 'export-md' || action === 'export-txt') {
      try {
        const entry = await History.readEntry(key);
        if (!entry) {
          showToast('这条历史已不存在', 'error');
          refreshHistory();
          return;
        }
        exportHistoryEntry(entry, action === 'export-md' ? 'md' : 'txt');
      } catch (error) {
        showToast(error.message || '导出失败', 'error');
      }
      return;
    }
    if (action === 'delete') {
      if (!window.confirm('删除这条历史总结？删除后只能重新生成。')) return;
      try {
        const response = await sendRuntimeMessage({ type: 'HISTORY_DELETE', key }, 12000);
        if (!response || !response.ok) throw new Error((response && response.error) || '删除失败');
        showToast('已删除这条历史');
        await refreshHistory();
        if (state.historyKey === key && state.summaryFromHistory && state.refs.aiStatus) {
          setStatus(state.refs.aiStatus, '这条总结的历史记录已删除，当前内容仍保留在页面上。', 'warn');
        }
      } catch (error) {
        showToast(error.message || '删除失败', 'error');
      }
    }
  }

  async function clearAllHistory() {
    if (!state.historyItems.length) return;
    if (!window.confirm(`清空全部 ${state.historyItems.length} 条历史总结？此操作无法撤销。`)) return;
    try {
      const response = await sendRuntimeMessage({ type: 'HISTORY_CLEAR' }, 15000);
      if (!response || !response.ok) throw new Error((response && response.error) || '清空失败');
      setStatus(state.refs.historyStatus, '历史已清空。', 'success');
      await refreshHistory();
    } catch (error) {
      setStatus(state.refs.historyStatus, error.message || '清空失败', 'error');
    }
  }

  function videoFromEntry(entry) {
    return {
      title: entry.title || 'Bilibili 视频',
      baseTitle: entry.title || 'Bilibili 视频',
      partTitle: '',
      owner: entry.owner || '',
      duration: Number(entry.duration) || 0,
      url: entry.url || '',
      bvid: entry.bvid || '',
      cid: Number(entry.cid) || 0,
      aid: 0,
      cover: '',
      pageNo: Number(entry.pageNo) || 1,
      pageCount: Number(entry.pageCount) || 1,
      isBangumi: false,
    };
  }

  /**
   * Put one stored record back into the panel: video header, subtitle snapshot
   * (so SRT/TXT export still works), summary body and its metadata.
   */
  function applyHistoryEntry(entry, options) {
    if (!entry || typeof entry.summary !== 'string' || !entry.summary) return false;
    const opts = options || {};
    const entryVideo = videoFromEntry(entry);
    const sameVideo =
      Boolean(state.video && entryVideo.bvid) &&
      String(state.video.bvid || '').toUpperCase() === String(entryVideo.bvid).toUpperCase() &&
      Number(state.video.pageNo || 1) === Number(entryVideo.pageNo || 1);

    if (!sameVideo && (!state.video || opts.replace)) {
      state.video = entryVideo;
      state.tracks = [];
      state.trackMap = new Map();
      state.selectedTrackKey = '';
      renderVideo(state.video);
      renderTrackSelect();
    }

    const snapshot =
      entry.subtitle && Array.isArray(entry.subtitle.segments) ? entry.subtitle.segments : [];
    if (snapshot.length && (!state.segments.length || (!sameVideo && opts.replace))) {
      state.segments = snapshot.map((segment) => ({
        from: Number(segment.from) || 0,
        to: Number(segment.to) || 0,
        content: String(segment.content || ''),
      }));
      state.loaded = true;
      renderSegments();
      updateTabCount();
      updateSubtitleButtons();
      if (entry.subtitle.truncated) {
        setStatus(state.refs.subStatus, '历史字幕快照过长，只保存了前一部分，导出内容不完整。', 'warn');
      } else if (!state.tracks.length) {
        setStatus(state.refs.subStatus, '字幕来自本地历史快照，可正常导出。', 'warn');
      }
    } else if (!sameVideo && opts.replace) {
      // Switching to another video's history must not leave the previous
      // video's subtitles under the new title.
      state.segments = [];
      renderSegments();
      updateSubtitleButtons();
      showSubtitleEmpty({
        icon: 'subtitles',
        title: '这条历史没有字幕快照',
        desc: '只保存了总结正文，可以直接在「AI 总结」里查看和导出。',
      });
    }

    state.summary = entry.summary;
    const generated = entry.generatedAt || entry.savedAt;
    state.summaryGeneratedAt = generated ? new Date(generated) : new Date();
    if (Number.isNaN(state.summaryGeneratedAt.getTime())) state.summaryGeneratedAt = new Date();
    const stats = entry.stats && typeof entry.stats === 'object' ? entry.stats : {};
    state.summaryStats = {
      chunks: Number(stats.chunks) || 0,
      calls: Number(stats.calls) || 0,
      usage: {
        promptTokens: Number(stats.promptTokens) || 0,
        completionTokens: Number(stats.completionTokens) || 0,
        totalTokens: Number(stats.totalTokens) || 0,
      },
      subtitleCount: Number(stats.subtitleCount) || Number(entry.subtitle && entry.subtitle.count) || 0,
    };
    state.summaryStyle = entry.style || state.summaryStyle;
    state.summaryFromHistory = true;
    state.aiError = '';
    state.historyKey = entry.key;

    if (state.refs.summary) {
      state.refs.summary.innerHTML = U.renderMarkdown(state.summary);
      state.refs.summary.hidden = false;
      state.refs.summary.scrollTop = 0;
    }
    if (state.refs.summaryMeta) {
      const pieces = [
        '来自本地历史',
        `生成于 ${U.formatLocalDateTime(state.summaryGeneratedAt)}`,
        entry.model || '',
        state.summaryStats.chunks ? `${state.summaryStats.chunks} 个分段` : '',
      ].filter(Boolean);
      state.refs.summaryMeta.textContent = pieces.join(' · ');
      state.refs.summaryMeta.hidden = false;
    }
    if (state.refs.progress) state.refs.progress.hidden = true;
    hideEmpty(state.refs.aiEmpty);
    setStatus(
      state.refs.aiStatus,
      `已恢复 ${U.formatLocalDateTime(
        state.summaryGeneratedAt,
      )} 保存的总结，可直接导出；重新生成会覆盖这条历史。`,
      'success',
    );
    updateStylePicker();
    updateAiCopy();
    updateAiButtons();
    if (state.activeTab === 'history') refreshHistory();
    return true;
  }

  function exportHistoryEntry(entry, type) {
    const summary = String(entry.summary || '');
    if (!summary) {
      showToast('这条历史没有可导出的总结', 'error');
      return;
    }
    const video = videoFromEntry(entry);
    const generatedAt = U.formatLocalDateTime(
      entry.generatedAt ? new Date(entry.generatedAt) : new Date(entry.savedAt || Date.now()),
    );
    const isTranscript = entry.style === 'transcript';
    const suffix = isTranscript ? '逐字稿' : 'AI总结';
    const label = isTranscript ? '逐字稿' : 'AI 总结';
    if (type === 'md') {
      const content = U.summaryToMarkdown({
        video,
        summary,
        generatedAt,
        includeHeader: state.settings.includeHeader,
        label,
      });
      const filename = U.buildFilename(video.title, suffix, 'md');
      downloadText(filename, content, 'text/markdown', false);
      showToast(`已导出 ${filename}`);
      return;
    }
    const content = U.summaryToTxt({
      video,
      summary,
      generatedAt,
      includeHeader: state.settings.includeHeader,
      label,
    });
    const filename = U.buildFilename(video.title, suffix, 'txt');
    downloadText(filename, content, 'text/plain', true);
    showToast(`已导出 ${filename}`);
  }

  async function loadHistoryEntry(key) {
    if (state.summaryLoading) abortSummary(true);
    try {
      const entry = await History.readEntry(key);
      if (!entry) {
        showToast('这条历史已不存在', 'error');
        await refreshHistory();
        return;
      }
      applyHistoryEntry(entry, { replace: true });
      switchTab('ai');
      showToast('已载入历史总结');
    } catch (error) {
      showToast(error.message || '载入历史失败', 'error');
    }
  }

  /** Fallback key when the video API failed but the URL still names the video. */
  function keyFromRoute() {
    const route = state.route || U.parseBilibiliRoute(location.href);
    if (!route || route.kind !== 'video' || !route.bvid) return '';
    const page = Math.max(1, Math.floor(Number(route.page) || 1));
    return History.entryKey({ bvid: route.bvid, pageNo: page, pageCount: page > 1 ? page : 1 });
  }

  /**
   * Restore the saved summary for the current video after a refresh, or fall
   * back to it when Bilibili returns no subtitles. Never overwrites a summary
   * that is already on screen unless `replace` is requested.
   */
  async function restoreFromHistory(options) {
    const opts = options || {};
    if (state.historyRestoring || state.summaryLoading) return false;
    if (state.summary && !opts.replace) return false;
    const key = state.historyKey || keyFromRoute();
    if (!key) return false;
    state.historyRestoring = true;
    try {
      const entry = await History.readEntry(key);
      if (!entry) return false;
      const applied = applyHistoryEntry(entry, { replace: Boolean(opts.replace) });
      if (applied) {
        refreshHistory();
        if (opts.reason === 'offline') {
          setStatus(
            state.refs.subStatus,
            '在线字幕不可用，已恢复本地保存的字幕快照与总结。',
            'warn',
          );
        }
      }
      return applied;
    } catch (_) {
      return false;
    } finally {
      state.historyRestoring = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Export / copy
  // ---------------------------------------------------------------------------
  function subtitleHeader(track, timestamps) {
    if (!state.settings.includeHeader) return '';
    const lines = [state.video ? state.video.title : 'Bilibili 字幕'];
    if (state.video && state.video.url) lines.push(state.video.url);
    const meta = [];
    if (state.video && state.video.owner) meta.push(`UP主：${state.video.owner}`);
    if (state.video && state.video.duration) meta.push(`时长：${U.formatDuration(state.video.duration)}`);
    if (state.video && state.video.bvid) meta.push(state.video.bvid);
    if (meta.length) lines.push(meta.join(' · '));
    if (track) lines.push(`字幕语言：${track.lanDoc || track.lan || '未知'}`);
    lines.push(`导出时间：${U.formatLocalDateTime(new Date())}`);
    lines.push(timestamps ? '格式：[时间] 字幕内容' : '格式：纯文本（不含时间戳）');
    lines.push('', '='.repeat(48), '');
    return `${lines.join('\n')}\n`;
  }

  function buildSubtitleTxt(track, includeHeader) {
    const timestamps = Boolean(state.settings.txtTimestamps);
    const body = U.segmentsToTxt(state.segments, { timestamps, dedupe: true });
    const header = includeHeader === false ? '' : subtitleHeader(track, timestamps);
    return `${header}${body}\n`;
  }

  function exportSubtitle(type) {
    if (!state.segments.length) {
      showToast('当前没有可导出的字幕', 'error');
      return;
    }
    const track = state.trackMap.get(state.selectedTrackKey) || null;
    const title = state.video ? state.video.title : 'Bilibili 字幕';
    if (type === 'srt') {
      const content = U.segmentsToSrt(state.segments);
      const filename = U.buildFilename(title, '字幕', 'srt');
      downloadText(filename, content, 'application/x-subrip', true);
      showToast(`已导出 ${filename}`);
      return;
    }
    const content = buildSubtitleTxt(track, state.settings.includeHeader);
    const filename = U.buildFilename(title, '字幕', 'txt');
    downloadText(filename, content, 'text/plain', true);
    showToast(`已导出 ${filename}`);
  }

  function exportSummary(type) {
    if (!state.summary) {
      showToast('还没有可导出的 AI 总结', 'error');
      return;
    }
    const title = state.video ? state.video.title : 'Bilibili 视频';
    const generatedAt = state.summaryGeneratedAt
      ? U.formatLocalDateTime(state.summaryGeneratedAt)
      : U.formatLocalDateTime(new Date());
    const isTranscript = currentSummaryStyle() === 'transcript';
    const suffix = isTranscript ? '逐字稿' : 'AI总结';
    const label = isTranscript ? '逐字稿' : 'AI 总结';
    if (type === 'md') {
      const content = U.summaryToMarkdown({
        video: state.video || {},
        summary: state.summary,
        generatedAt,
        includeHeader: state.settings.includeHeader,
        label,
      });
      const filename = U.buildFilename(title, suffix, 'md');
      downloadText(filename, content, 'text/markdown', false);
      showToast(`已导出 ${filename}`);
      return;
    }
    const content = U.summaryToTxt({
      video: state.video || {},
      summary: state.summary,
      generatedAt,
      includeHeader: state.settings.includeHeader,
      label,
    });
    const filename = U.buildFilename(title, suffix, 'txt');
    downloadText(filename, content, 'text/plain', true);
    showToast(`已导出 ${filename}`);
  }

  function downloadText(filename, content, mime, bom) {
    const parts = bom ? ['\ufeff', content] : [content];
    const blob = new Blob(parts, { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    (document.body || document.documentElement).appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {
      /* fall through */
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      (document.body || document.documentElement).appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  async function copySubtitle() {
    if (!state.segments.length) return;
    const text = U.segmentsToTxt(state.segments, {
      timestamps: Boolean(state.settings.txtTimestamps),
      dedupe: true,
    });
    if (await copyText(text)) showToast('字幕文本已复制');
    else showToast('复制失败，请使用 TXT 导出', 'error');
  }

  async function copySummary() {
    if (!state.summary) return;
    if (await copyText(state.summary)) showToast('AI 总结 Markdown 已复制');
    else showToast('复制失败，请使用 MD 导出', 'error');
  }

  // ---------------------------------------------------------------------------
  // Route handling / lifecycle
  // ---------------------------------------------------------------------------
  function abortSummary(silent) {
    state.summaryToken += 1;
    state.summaryLoading = false;
    stopSummaryHeartbeat();
    resetAiStream();
    clearTimeout(state.summaryWatchdog);
    if (state.summaryPort) {
      try {
        state.summaryPort.postMessage({ type: 'abort' });
        state.summaryPort.disconnect();
      } catch (_) {
        /* ignore */
      }
    }
    state.summaryPort = null;
    if (state.refs.progress) state.refs.progress.hidden = true;
    if (!silent) setStatus(state.refs.aiStatus, '已停止生成。', 'warn');
  }

  function handleRoute(route) {
    abortSummary(true);
    state.loadToken += 1;
    state.trackToken += 1;
    state.route = route;
    state.routeKey = route.key;
    state.loading = false;
    state.trackLoading = false;
    state.loaded = false;
    clearVideoData();
    if (state.open) loadVideo();
  }

  function destroyUI() {
    abortSummary(true);
    state.loadToken += 1;
    state.trackToken += 1;
    if (state.searchTimer) clearTimeout(state.searchTimer);
    if (state.toastTimer) clearTimeout(state.toastTimer);
    for (const pending of state.bridgePending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('页面已切换'));
    }
    state.bridgePending.clear();
    if (state.host) state.host.remove();
    state.host = null;
    state.shadow = null;
    state.refs = {};
    state.open = false;
    state.route = null;
    state.routeKey = '';
    state.loaded = false;
    state.loading = false;
    state.trackLoading = false;
    state.video = null;
    state.tracks = [];
    state.segments = [];
    state.summary = '';
    state.summaryGeneratedAt = null;
    state.summaryStats = null;
    state.aiError = '';
  }

  function tick() {
    const route = U.parseBilibiliRoute(location.href);
    if (!route) {
      if (state.host) destroyUI();
      state.lastHref = location.href;
      return;
    }
    if (!state.host) createHost();
    else if (!state.host.isConnected) {
      (document.body || document.documentElement).appendChild(state.host);
    }
    if (state.routeKey !== route.key) {
      const firstRoute = !state.route;
      state.route = route;
      state.routeKey = route.key;
      if (firstRoute) {
        clearVideoData();
      } else {
        handleRoute(route);
      }
    }
    state.lastHref = location.href;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'PING') {
      sendResponse({
        ok: true,
        supported: true,
        open: state.open,
        loaded: state.loaded,
      });
      return false;
    }
    if (message.type === 'TOGGLE_PANEL') {
      if (!state.host) createHost();
      if (message.open === true) openPanel();
      else if (message.open === false) closePanel();
      else if (state.open) closePanel();
      else openPanel();
      sendResponse({ ok: true, open: state.open });
      return false;
    }
    if (message.type === 'SETTINGS_CHANGED') {
      if (state.open) refreshAiStatus(true);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes[Settings.SETTINGS_KEY]) {
        state.settings = Settings.normalizeSettings(changes[Settings.SETTINGS_KEY].newValue);
        if (state.open) refreshAiStatus(true);
      }
      // Another tab (or the background save) changed the history: keep the
      // badge and the list in sync without polling.
      if (changes[History.HISTORY_KEY] && state.host) refreshHistory();
    });
  }

  Settings.loadSettings()
    .then((settings) => {
      state.settings = settings;
    })
    .catch(() => {
      /* defaults already applied */
    });

  window.addEventListener('popstate', tick, { passive: true });
  window.addEventListener('hashchange', tick, { passive: true });
  setInterval(tick, 900);
  tick();
})();
