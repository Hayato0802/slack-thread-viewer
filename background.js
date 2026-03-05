// アイコンクリックでサイドパネルを開く
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// デフォルトではサイドパネルを無効化（Slackタブでのみ有効）
chrome.sidePanel.setOptions({ enabled: false });

function isSlackUrl(url) {
  return url?.includes('app.slack.com/');
}

// タブごとのサイドパネル有効/無効を更新
async function updateSidePanelForTab(tabId, url) {
  const enabled = isSlackUrl(url);
  await chrome.sidePanel.setOptions({
    tabId,
    enabled,
    path: enabled ? 'sidepanel/sidepanel.html' : undefined,
  });
}

// SlackタブのURL変更を監視し、サイドパネルに通知
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateSidePanelForTab(tabId, tab.url);
  }
  if (changeInfo.url && isSlackUrl(tab.url)) {
    chrome.runtime.sendMessage({
      type: 'SLACK_TAB_UPDATED',
      tabId,
      url: tab.url,
    }).catch(() => {}); // サイドパネルが開いていない場合は無視
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await updateSidePanelForTab(tab.id, tab.url);
    if (isSlackUrl(tab.url)) {
      chrome.runtime.sendMessage({
        type: 'SLACK_TAB_UPDATED',
        tabId: tab.id,
        url: tab.url,
      }).catch(() => {});
    }
  } catch {}
});

// サイドパネルからSlackタブのURL変更リクエストを受信
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_SLACK_TAB') {
    chrome.tabs.query({ url: 'https://app.slack.com/*', active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        sendResponse({ tabId: tabs[0].id, url: tabs[0].url });
      } else {
        // アクティブでなくてもSlackタブを探す
        chrome.tabs.query({ url: 'https://app.slack.com/*', currentWindow: true }, (allTabs) => {
          if (allTabs.length > 0) {
            sendResponse({ tabId: allTabs[0].id, url: allTabs[0].url });
          } else {
            sendResponse({ tabId: null, url: null });
          }
        });
      }
    });
    return true; // async response
  }

  if (msg.type === 'OPEN_THREAD_IN_SLACK') {
    chrome.tabs.update(msg.tabId, { url: msg.url });
    sendResponse({ ok: true });
  }
});
