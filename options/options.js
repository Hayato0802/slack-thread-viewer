const oauthBtn = document.getElementById('oauthBtn');
const loginSection = document.getElementById('loginSection');
const loggedInCard = document.getElementById('loggedInCard');
const loggedInName = document.getElementById('loggedInName');
const loggedInWorkspace = document.getElementById('loggedInWorkspace');
const userAvatar = document.getElementById('userAvatar');
const logoutBtn = document.getElementById('logoutBtn');
const statusEl = document.getElementById('status');
const tokenInput = document.getElementById('token');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const manualStatusEl = document.getElementById('manualStatus');
const redirectUrlEl = document.getElementById('redirectUrl');

// Show redirect URL for admin setup
const redirectUrl = chrome.identity.getRedirectURL();
redirectUrlEl.textContent = redirectUrl;

// ===== OAuth Flow =====
const USER_SCOPES = 'channels:history,channels:read,groups:history,groups:read,users:read';

async function startOAuth() {
  if (typeof SLACK_CLIENT_ID === 'undefined' || SLACK_CLIENT_ID === 'YOUR_CLIENT_ID') {
    showStatus(statusEl, 'config.js にClient IDが設定されていません。管理者に連絡してください。', 'error');
    return;
  }

  oauthBtn.disabled = true;
  oauthBtn.textContent = '認証中...';

  try {
    const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${SLACK_CLIENT_ID}&user_scope=${USER_SCOPES}&redirect_uri=${encodeURIComponent(redirectUrl)}`;

    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });

    // Extract authorization code from redirect URL
    const url = new URL(responseUrl);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      throw new Error(`Slack認証エラー: ${error}`);
    }
    if (!code) {
      throw new Error('認証コードが取得できませんでした');
    }

    // Exchange code for token
    await exchangeCodeForToken(code);

  } catch (e) {
    if (e.message?.includes('user cancelled') || e.message?.includes('canceled')) {
      showStatus(statusEl, 'ログインがキャンセルされました', 'error');
    } else {
      showStatus(statusEl, `エラー: ${e.message}`, 'error');
    }
  } finally {
    oauthBtn.disabled = false;
    oauthBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M7.5 0C6.12 0 5 1.12 5 2.5S6.12 5 7.5 5H10V2.5C10 1.12 8.88 0 7.5 0Z" fill="#E01E5A"/><path d="M0 7.5C0 6.12 1.12 5 2.5 5S5 6.12 5 7.5V10H2.5C1.12 10 0 8.88 0 7.5Z" fill="#36C5F0"/><path d="M12.5 5C13.88 5 15 6.12 15 7.5S13.88 10 12.5 10H10V7.5C10 6.12 11.12 5 12.5 5Z" fill="#2EB67D"/><path d="M20 12.5C20 11.12 18.88 10 17.5 10S15 11.12 15 12.5V15h2.5C18.88 15 20 13.88 20 12.5Z" fill="#ECB22E"/><path d="M7.5 20C8.88 20 10 18.88 10 17.5S8.88 15 7.5 15H5v2.5C5 18.88 6.12 20 7.5 20Z" fill="#E01E5A"/><path d="M12.5 15C11.12 15 10 16.12 10 17.5v2.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V15h-2.5Z" fill="#2EB67D"/><path d="M17.5 5H15V2.5C15 1.12 16.12 0 17.5 0S20 1.12 20 2.5 18.88 5 17.5 5Z" fill="#ECB22E"/><path d="M0 12.5C0 13.88 1.12 15 2.5 15S5 13.88 5 12.5V10H2.5C1.12 10 0 11.12 0 12.5Z" fill="#36C5F0"/></svg>
      Slackでログイン
    `;
  }
}

async function exchangeCodeForToken(code) {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      code: code,
      redirect_uri: redirectUrl,
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`トークン交換失敗: ${data.error}`);
  }

  const token = data.authed_user?.access_token;
  if (!token) {
    throw new Error('ユーザートークンが取得できませんでした');
  }

  // Save token
  await chrome.storage.local.set({ slackToken: token });

  // Verify and show logged-in state
  await showLoggedInState(token);
  showStatus(statusEl, 'ログイン成功！', 'success');
}

// ===== Logged-in State =====
async function showLoggedInState(token) {
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    // Get user profile for avatar
    const userRes = await fetch(`https://slack.com/api/users.info?user=${data.user_id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const userData = await userRes.json();

    loggedInName.textContent = data.user;
    loggedInWorkspace.textContent = data.team;
    if (userData.ok && userData.user?.profile?.image_48) {
      userAvatar.src = userData.user.profile.image_48;
    }

    loggedInCard.style.display = 'block';
    loginSection.style.display = 'none';
  } catch {
    loggedInCard.style.display = 'none';
    loginSection.style.display = 'block';
  }
}

// ===== Logout =====
logoutBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(['slackToken', 'userCache', 'lastChannelId']);
  loggedInCard.style.display = 'none';
  loginSection.style.display = 'block';
  statusEl.className = 'status';
  statusEl.style.display = 'none';
});

// ===== Manual Token (Advanced) =====
function showStatus(el, message, type) {
  el.textContent = message;
  el.className = `status ${type}`;
}

async function testToken(token) {
  const res = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  return res.json();
}

saveBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    showStatus(manualStatusEl, 'トークンを入力してください', 'error');
    return;
  }
  if (!token.startsWith('xoxp-')) {
    showStatus(manualStatusEl, 'xoxp- で始まるUser OAuth Tokenを入力してください', 'error');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = '検証中...';

  try {
    const data = await testToken(token);
    if (data.ok) {
      await chrome.storage.local.set({ slackToken: token });
      showStatus(manualStatusEl, '保存しました', 'success');
      await showLoggedInState(token);
    } else {
      showStatus(manualStatusEl, `エラー: ${data.error}`, 'error');
    }
  } catch (e) {
    showStatus(manualStatusEl, `接続エラー: ${e.message}`, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存';
  }
});

testBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    showStatus(manualStatusEl, 'トークンを入力してください', 'error');
    return;
  }

  testBtn.disabled = true;
  testBtn.textContent = 'テスト中...';

  try {
    const data = await testToken(token);
    if (data.ok) {
      showStatus(manualStatusEl, `接続成功！ワークスペース: ${data.team}`, 'success');
    } else {
      showStatus(manualStatusEl, `エラー: ${data.error}`, 'error');
    }
  } catch (e) {
    showStatus(manualStatusEl, `接続エラー: ${e.message}`, 'error');
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = '接続テスト';
  }
});

// ===== Event Handlers =====
oauthBtn.addEventListener('click', startOAuth);

// ===== Init =====
async function init() {
  const result = await chrome.storage.local.get(['slackToken']);
  const token = result.slackToken || '';

  if (token) {
    tokenInput.value = token;
    await showLoggedInState(token);
  }
}

init();
