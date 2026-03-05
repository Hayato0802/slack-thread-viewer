// ===== State =====
let token = '';
let channels = [];
let channelMap = {}; // id -> channel
let selectedChannelId = '';
let threads = [];
let allThreads = []; // before search filter
let userCache = {};
let autoRefreshTimer = null;
let teamId = '';
let slackTabId = null;
let nextCursor = ''; // for pagination
let lastThreadsHash = ''; // for change detection

// ===== Theme =====
function applyTheme(theme) {
  document.body.className = theme === 'light' ? 'theme-light' : 'theme-dark';
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.innerHTML = theme === 'light' ? '&#9788;' : '&#9790;';
}

// Apply saved theme immediately to avoid flash
(async () => {
  const { theme } = await chrome.storage.local.get(['theme']);
  applyTheme(theme || 'dark');
})();

// ===== DOM Elements =====
const setupView = document.getElementById('setupView');
const noSlackView = document.getElementById('noSlackView');
const mainView = document.getElementById('mainView');
const settingsBtn = document.getElementById('settingsBtn');
const channelNameEl = document.getElementById('channelName');
const currentChannelEl = document.getElementById('currentChannel');
const searchInput = document.getElementById('searchInput');
const channelSelect = document.getElementById('channelSelect');
const refreshBtn = document.getElementById('refreshBtn');
const autoRefreshToggle = document.getElementById('autoRefreshToggle');
const lastUpdated = document.getElementById('lastUpdated');
const loading = document.getElementById('loading');
const threadList = document.getElementById('threadList');
const loadMoreWrap = document.getElementById('loadMoreWrap');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const emptyState = document.getElementById('emptyState');
const threadDetail = document.getElementById('threadDetail');
const backBtn = document.getElementById('backBtn');
const openInSlackBtn = document.getElementById('openInSlackBtn');
const threadMessages = document.getElementById('threadMessages');

// ===== Slack API =====
async function slackApi(method, params = {}) {
  const url = new URL(`https://slack.com/api/${method}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data;
}

// ===== User Cache =====
async function getUser(userId) {
  if (userCache[userId]) return userCache[userId];
  try {
    const data = await slackApi('users.info', { user: userId });
    const user = {
      name: data.user.real_name || data.user.name,
      avatar: data.user.profile.image_48,
    };
    userCache[userId] = user;
    chrome.storage.local.set({ userCache });
    return user;
  } catch {
    return { name: userId, avatar: '' };
  }
}

async function batchGetUsers(userIds) {
  const uncached = [...new Set(userIds)].filter(id => id && !userCache[id]);
  await Promise.all(uncached.map(id => getUser(id)));
}

// ===== Slack Tab Detection =====
function parseSlackUrl(url) {
  if (!url) return null;
  // https://app.slack.com/client/T.../C...
  const match = url.match(/app\.slack\.com\/client\/(T[A-Z0-9]+)\/(C[A-Z0-9]+|G[A-Z0-9]+|D[A-Z0-9]+)/);
  if (match) return { teamId: match[1], channelId: match[2] };
  return null;
}

async function detectSlackTab() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_SLACK_TAB' }, (response) => {
      if (response?.tabId) {
        slackTabId = response.tabId;
        const parsed = parseSlackUrl(response.url);
        resolve(parsed);
      } else {
        resolve(null);
      }
    });
  });
}

function openThreadInSlack(channelId, threadTs) {
  if (!slackTabId || !teamId) return;
  const url = `https://app.slack.com/client/${teamId}/${channelId}/thread/${channelId}-${threadTs}`;
  chrome.runtime.sendMessage({ type: 'OPEN_THREAD_IN_SLACK', tabId: slackTabId, url });
}

// ===== Channel Loading =====
async function loadChannels() {
  channels = [];
  let cursor = '';
  do {
    const params = { types: 'public_channel,private_channel', limit: 200, exclude_archived: true };
    if (cursor) params.cursor = cursor;
    const data = await slackApi('conversations.list', params);
    channels.push(...data.channels);
    cursor = data.response_metadata?.next_cursor || '';
  } while (cursor);

  channels.sort((a, b) => a.name.localeCompare(b.name));
  channelMap = {};
  channels.forEach(ch => { channelMap[ch.id] = ch; });

  // Populate fallback dropdown
  channelSelect.innerHTML = '<option value="">チャンネルを選択...</option>';
  channels.forEach(ch => {
    const opt = document.createElement('option');
    opt.value = ch.id;
    opt.textContent = `${ch.is_private ? '\u{1F512}' : '#'} ${ch.name}`;
    channelSelect.appendChild(opt);
  });
}

function updateChannelDisplay() {
  const ch = channelMap[selectedChannelId];
  if (ch) {
    channelNameEl.textContent = ch.name;
    currentChannelEl.querySelector('.channel-icon').textContent = ch.is_private ? '\u{1F512}' : '#';
  } else {
    channelNameEl.textContent = selectedChannelId || '検出中...';
  }
}

// ===== Thread Loading =====
async function loadThreads(append = false) {
  if (!selectedChannelId) return;

  if (!append) {
    emptyState.style.display = 'none';
    loadMoreWrap.style.display = 'none';
    nextCursor = '';
    allThreads = [];
  }

  try {
    const params = { channel: selectedChannelId, limit: 100 };
    if (append && nextCursor) {
      params.cursor = nextCursor;
    }

    const data = await slackApi('conversations.history', params);
    const messages = data.messages || [];
    nextCursor = data.response_metadata?.next_cursor || '';

    // Parent messages only, with sort key
    const newThreads = messages
      .filter(m => !m.thread_ts || m.thread_ts === m.ts)
      .map(m => ({
        ...m,
        sortKey: parseFloat(m.latest_reply || m.ts),
      }));

    if (append) {
      allThreads.push(...newThreads);
    } else {
      allThreads = newThreads;
    }

    // Sort all by latest reply
    allThreads.sort((a, b) => b.sortKey - a.sortKey);

    // Change detection: skip re-render if data unchanged
    const newHash = allThreads.map(t => `${t.ts}:${t.latest_reply || ''}:${t.reply_count || 0}`).join('|');
    if (!append && newHash === lastThreadsHash) {
      // Data unchanged, just update timestamp
      updateLastUpdated();
      loading.style.display = 'none';
      return;
    }
    lastThreadsHash = newHash;

    // Batch fetch user info
    const userIds = allThreads.map(t => t.user).filter(Boolean);
    await batchGetUsers(userIds);

    applySearchFilter();
    updateLastUpdated();

    // Show "load more" if there are more messages
    loadMoreWrap.style.display = nextCursor ? 'block' : 'none';
  } catch (e) {
    threadList.innerHTML = `<div class="empty-state"><p>エラー: ${e.message}</p></div>`;
  } finally {
    loading.style.display = 'none';
  }
}

// ===== Search Filter =====
function applySearchFilter() {
  const query = searchInput.value.trim().toLowerCase();
  if (query) {
    threads = allThreads.filter(t => {
      const text = (t.text || '').toLowerCase();
      const user = userCache[t.user];
      const userName = user ? user.name.toLowerCase() : '';
      return text.includes(query) || userName.includes(query);
    });
  } else {
    threads = [...allThreads];
  }
  renderThreads();
}

// ===== Time Grouping =====
function getTimeGroup(ts) {
  const date = new Date(parseFloat(ts) * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);

  if (date >= today) return '今日';
  if (date >= yesterday) return '昨日';
  if (date >= weekAgo) return '今週';
  return '1週間以上前';
}

// ===== Rendering =====
function renderThreads() {
  if (threads.length === 0) {
    threadList.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }
  emptyState.style.display = 'none';

  // Double buffering: build new list off-DOM, then swap in one shot
  const fragment = document.createDocumentFragment();
  let currentGroup = '';

  threads.forEach(thread => {
    // Time group header
    const group = getTimeGroup(thread.latest_reply || thread.ts);
    if (group !== currentGroup) {
      currentGroup = group;
      const label = document.createElement('div');
      label.className = 'time-group-label';
      label.textContent = group;
      fragment.appendChild(label);
    }

    const card = document.createElement('div');
    card.className = 'thread-card';

    // Single click -> open in side panel detail
    card.addEventListener('click', () => openThreadDetail(thread));

    // Double click -> open in Slack directly
    card.addEventListener('dblclick', (e) => {
      e.preventDefault();
      openThreadInSlack(selectedChannelId, thread.ts);
    });

    const user = userCache[thread.user] || { name: thread.user || '不明', avatar: '' };
    const replyCount = thread.reply_count || 0;
    const latestReplyTime = thread.latest_reply ? formatTime(thread.latest_reply) : '';
    const postTime = formatTime(thread.ts);
    const preview = stripMrkdwn(thread.text || '').slice(0, 120);

    card.innerHTML = `
      <div class="thread-card-header">
        ${user.avatar ? `<img class="thread-avatar" src="${escapeHtml(user.avatar)}" alt="">` : '<div class="thread-avatar"></div>'}
        <span class="thread-author">${escapeHtml(user.name)}</span>
        <span class="thread-time">${escapeHtml(postTime)}</span>
      </div>
      <div class="thread-preview">${escapeHtml(preview)}</div>
      <div class="thread-footer">
        ${replyCount > 0 ? `<span class="reply-count">${replyCount}件の返信</span>` : '<span></span>'}
        ${latestReplyTime ? `<span class="last-reply-time">最終: ${escapeHtml(latestReplyTime)}</span>` : ''}
        <button class="btn-slack-small" data-ts="${thread.ts}">Slackで開く</button>
      </div>
    `;

    // "Slackで開く" button on card - stop propagation so it doesn't open detail
    card.querySelector('.btn-slack-small').addEventListener('click', (e) => {
      e.stopPropagation();
      openThreadInSlack(selectedChannelId, thread.ts);
    });

    fragment.appendChild(card);
  });

  // Swap: save scroll position, replace content, restore scroll
  const scrollTop = threadList.scrollTop;
  threadList.replaceChildren(fragment);
  threadList.scrollTop = scrollTop;
}

// ===== Thread Detail =====
let currentThread = null;

async function openThreadDetail(thread) {
  currentThread = thread;
  threadDetail.style.display = 'flex';
  threadMessages.innerHTML = '<div class="loading"><div class="spinner"></div><span>読み込み中...</span></div>';

  try {
    const data = await slackApi('conversations.replies', {
      channel: selectedChannelId,
      ts: thread.ts,
      limit: 100,
    });

    const messages = data.messages || [];
    const userIds = messages.map(m => m.user).filter(Boolean);
    await batchGetUsers(userIds);

    threadMessages.innerHTML = '';
    messages.forEach((msg, i) => {
      const user = userCache[msg.user] || { name: msg.user || '不明', avatar: '' };
      const el = document.createElement('div');
      el.className = `message ${i === 0 ? 'parent-message' : ''}`;
      el.innerHTML = `
        ${user.avatar ? `<img class="message-avatar" src="${escapeHtml(user.avatar)}" alt="">` : '<div class="message-avatar"></div>'}
        <div class="message-body">
          <div class="message-header">
            <span class="message-author">${escapeHtml(user.name)}</span>
            <span class="message-time">${escapeHtml(formatTime(msg.ts))}</span>
          </div>
          <div class="message-text">${formatMessageText(msg.text || '')}</div>
        </div>
      `;
      threadMessages.appendChild(el);
    });
  } catch (e) {
    threadMessages.innerHTML = `<div class="empty-state"><p>エラー: ${e.message}</p></div>`;
  }
}

function closeThread() {
  threadDetail.style.display = 'none';
  currentThread = null;
}

// ===== Utilities =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function stripMrkdwn(text) {
  return text
    .replace(/<@[A-Z0-9]+>/g, '@user')
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/[*_~`]/g, '');
}

function formatMessageText(text) {
  let escaped = escapeHtml(text);
  escaped = escaped.replace(
    /&lt;(https?:\/\/[^|&]+)\|([^&]+)&gt;/g,
    '<a href="$1" target="_blank">$2</a>'
  );
  escaped = escaped.replace(
    /&lt;(https?:\/\/[^&]+)&gt;/g,
    '<a href="$1" target="_blank">$1</a>'
  );
  escaped = escaped.replace(/&lt;@([A-Z0-9]+)&gt;/g, (_, id) => {
    const user = userCache[id];
    return `<strong>@${user ? escapeHtml(user.name) : id}</strong>`;
  });
  escaped = escaped.replace(/&lt;#[A-Z0-9]+\|([^&]+)&gt;/g, '<strong>#$1</strong>');
  escaped = escaped.replace(/\n/g, '<br>');
  return escaped;
}

function formatTime(ts) {
  const date = new Date(parseFloat(ts) * 1000);
  const now = new Date();
  const diff = (now - date) / 1000;

  if (diff < 60) return '今';
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;

  const isSameYear = date.getFullYear() === now.getFullYear();
  if (isSameYear) {
    return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function pad(n) { return n.toString().padStart(2, '0'); }

function updateLastUpdated() {
  const now = new Date();
  lastUpdated.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} 更新`;
}

// ===== Auto Refresh =====
function startAutoRefresh() {
  stopAutoRefresh();
  if (autoRefreshToggle.checked && selectedChannelId) {
    autoRefreshTimer = setInterval(() => loadThreads(), 30000);
  }
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

// ===== DM Detection =====
function isDmChannel(channelId) {
  return channelId?.startsWith('D');
}

function showDmNotice() {
  stopAutoRefresh();
  loading.style.display = 'none';
  threadList.innerHTML = '';
  emptyState.style.display = 'none';
  loadMoreWrap.style.display = 'none';
  channelNameEl.textContent = 'ダイレクトメッセージ';
  threadList.innerHTML = '<div class="empty-state" style="display:flex;"><p>DMにはスレッド表示は対応していません。<br>チャンネルを開いてください。</p></div>';
}

// ===== Channel Switch =====
async function switchChannel(channelId) {
  if (channelId === selectedChannelId) return;
  selectedChannelId = channelId;

  if (isDmChannel(channelId)) {
    showDmNotice();
    return;
  }

  chrome.storage.local.set({ lastChannelId: channelId });
  updateChannelDisplay();
  searchInput.value = '';
  await loadThreads();
  startAutoRefresh();
}

// ===== OAuth Login (from side panel) =====
const oauthLoginBtn = document.getElementById('oauthLoginBtn');
const setupStatus = document.getElementById('setupStatus');

oauthLoginBtn.addEventListener('click', async () => {
  if (typeof SLACK_CLIENT_ID === 'undefined' || SLACK_CLIENT_ID === 'YOUR_CLIENT_ID') {
    setupStatus.textContent = 'config.js未設定。管理者に連絡してください。';
    return;
  }

  oauthLoginBtn.disabled = true;
  oauthLoginBtn.textContent = '認証中...';
  setupStatus.textContent = '';

  try {
    const redirectUrl = chrome.identity.getRedirectURL();
    const scopes = 'channels:history,channels:read,groups:history,groups:read,users:read';
    const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${SLACK_CLIENT_ID}&user_scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUrl)}`;

    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });

    const url = new URL(responseUrl);
    const code = url.searchParams.get('code');
    if (!code) throw new Error('認証コード取得失敗');

    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: SLACK_CLIENT_ID,
        client_secret: SLACK_CLIENT_SECRET,
        code,
        redirect_uri: redirectUrl,
      }),
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    const newToken = data.authed_user?.access_token;
    if (!newToken) throw new Error('トークン取得失敗');

    await chrome.storage.local.set({ slackToken: newToken });
    // init() will be triggered by storage.onChanged listener

  } catch (e) {
    if (e.message?.includes('canceled') || e.message?.includes('cancelled')) {
      setupStatus.textContent = 'キャンセルされました';
    } else {
      setupStatus.textContent = `エラー: ${e.message}`;
    }
  } finally {
    oauthLoginBtn.disabled = false;
    oauthLoginBtn.textContent = 'Slackでログイン';
  }
});

// ===== Event Handlers =====
const themeToggleBtn = document.getElementById('themeToggleBtn');
themeToggleBtn.addEventListener('click', async () => {
  const current = document.body.classList.contains('theme-light') ? 'light' : 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await chrome.storage.local.set({ theme: next });
});

const openOptionsBtn = document.getElementById('openOptionsBtn');
openOptionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

channelSelect.addEventListener('change', () => {
  if (channelSelect.value) switchChannel(channelSelect.value);
});

refreshBtn.addEventListener('click', () => {
  if (selectedChannelId) loadThreads();
});

autoRefreshToggle.addEventListener('change', () => {
  autoRefreshToggle.checked ? startAutoRefresh() : stopAutoRefresh();
});

// Search with debounce
let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => applySearchFilter(), 200);
});

loadMoreBtn.addEventListener('click', () => loadThreads(true));

backBtn.addEventListener('click', closeThread);

// "Slackで開く" button in thread detail
openInSlackBtn.addEventListener('click', () => {
  if (currentThread) {
    openThreadInSlack(selectedChannelId, currentThread.ts);
  }
});

// Listen for Slack tab URL changes from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SLACK_TAB_UPDATED') {
    slackTabId = msg.tabId;
    const parsed = parseSlackUrl(msg.url);
    if (parsed && parsed.channelId !== selectedChannelId) {
      teamId = parsed.teamId;
      switchChannel(parsed.channelId);
    }
  }
});

// ===== Initialization =====
async function init() {
  // Check if config.js is loaded
  if (typeof SLACK_CLIENT_ID === 'undefined') {
    setupView.style.display = 'flex';
    mainView.style.display = 'none';
    noSlackView.style.display = 'none';
    oauthLoginBtn.style.display = 'none';
    setupStatus.textContent = 'config.js が見つかりません。config.js.example をコピーして config.js を作成し、Client ID/Secret を設定してください。';
    return;
  }

  // Load user cache
  const cached = await chrome.storage.local.get(['userCache']);
  if (cached.userCache) userCache = cached.userCache;

  // Load token
  const result = await chrome.storage.local.get(['slackToken']);
  token = result.slackToken || '';

  if (!token) {
    setupView.style.display = 'flex';
    mainView.style.display = 'none';
    noSlackView.style.display = 'none';
    oauthLoginBtn.style.display = '';
    return;
  }

  try {
    // Get team ID
    const authData = await slackApi('auth.test');
    teamId = authData.team_id;

    // Load channels for lookup
    await loadChannels();

    // Auto-detect current Slack channel
    const detected = await detectSlackTab();
    if (detected) {
      slackTabId = slackTabId; // already set in detectSlackTab
      teamId = detected.teamId;
      selectedChannelId = detected.channelId;

      setupView.style.display = 'none';
      noSlackView.style.display = 'none';
      mainView.style.display = 'flex';

      if (isDmChannel(detected.channelId)) {
        showDmNotice();
      } else {
        updateChannelDisplay();
        await loadThreads();
        startAutoRefresh();
      }
    } else {
      // No Slack tab found - show main view with manual select
      setupView.style.display = 'none';
      noSlackView.style.display = 'none';
      mainView.style.display = 'flex';
      channelNameEl.textContent = 'Slackでチャンネルを開いてください';

      // Restore last channel as fallback
      const saved = await chrome.storage.local.get(['lastChannelId']);
      if (saved.lastChannelId && channelMap[saved.lastChannelId]) {
        switchChannel(saved.lastChannelId);
      }
    }
  } catch (e) {
    setupView.style.display = 'none';
    noSlackView.style.display = 'none';
    mainView.style.display = 'flex';
    threadList.innerHTML = `<div class="empty-state"><p>API接続エラー: ${e.message}<br>設定を確認してください</p></div>`;
  }
}

// Listen for token changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.slackToken) {
    token = changes.slackToken.newValue || '';
    if (token) init();
  }
});

init();
