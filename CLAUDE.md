# Slack Thread Viewer - Chrome拡張機能

## 概要
Slackの特定チャンネル内のスレッドを「最新返信順」にソートしてサイドパネルに表示するChrome拡張機能。古いメッセージへの返信が埋もれる問題を解決する。

## 技術スタック
- Chrome Extension Manifest V3
- Chrome Side Panel API / Identity API
- Slack Web API（OAuth 2.0 / xoxp-トークン）
- Vanilla JS + CSS（フレームワーク不使用）

## ファイル構成
```
slack-thread-viewer/
├── manifest.json          # 拡張設定（permissions, content_scripts等）
├── background.js          # Service Worker（タブ監視、メッセージング）
├── content.js             # Content Script（現在はプレースホルダー）
├── config.js              # Slack OAuth認証情報（.gitignore対象）
├── config.js.example      # config.jsのテンプレート
├── .gitignore             # config.jsを除外
├── sidepanel/
│   ├── sidepanel.html     # サイドパネルUI
│   ├── sidepanel.js       # メインロジック（API・ソート・描画・OAuth）
│   └── sidepanel.css      # Slackライクダークテーマ
├── options/
│   ├── options.html       # 設定画面（OAuthログイン・手動トークン入力）
│   └── options.js         # 設定ロジック（OAuthフロー・トークン管理）
└── icons/
    ├── icon16.svg
    ├── icon48.svg
    └── icon128.svg
```

## 主要機能

### 1. スレッド最新順表示
- `conversations.history` で親メッセージを取得
- `latest_reply` タイムスタンプでソート（降順）
- 返信が付いたスレッドが自動で上位に浮上

### 2. Slackタブ自動検出
- `background.js` が `tabs.onUpdated` / `tabs.onActivated` を監視
- Slack WebのURL（`app.slack.com/client/T.../C...`）からチャンネルIDを抽出
- チャンネル切り替え時にサイドパネルも自動追従

### 3. 「Slackで開く」ボタン
- スレッドカードにホバーで表示される「Slackで開く」ボタン
- クリックで `chrome.tabs.update` によりSlackタブでスレッドを開く
- URL形式: `https://app.slack.com/client/{teamId}/{channelId}/thread/{channelId}-{ts}`
- ※SPA内遷移はSlackのCSP制約により断念。URL遷移（リロードあり）方式

### 4. OAuth認証（社内配布対応）
- `chrome.identity.launchWebAuthFlow` を使用（外部サーバー不要）
- フロー: ログインボタン → Slack認証画面 → コード取得 → `oauth.v2.access` でトークン交換
- Client ID/Secretは `config.js` に定義（.gitignore対象）
- 手動トークン入力も「詳細設定」として残存

### 5. キーワード検索
- スレッド一覧をテキスト・投稿者名でリアルタイムフィルタリング
- 200msデバウンス

### 6. 時間帯グルーピング
- 「今日」「昨日」「今週」「1週間以上前」でグループ表示

### 7. もっと読み込む（ページネーション）
- `conversations.history` のcursorベースページネーション
- 初回100件、追加読み込み可能

### 8. 自動更新
- 30秒間隔でポーリング（トグルでON/OFF）

## Slack API使用

### 必要なOAuth Scopes（User Token Scopes）
| スコープ | 用途 |
|---------|------|
| `channels:history` | パブリックチャンネルのメッセージ読み取り |
| `channels:read` | パブリックチャンネル一覧取得 |
| `groups:history` | プライベートチャンネルのメッセージ読み取り |
| `groups:read` | プライベートチャンネル一覧取得 |
| `users:read` | ユーザー名・アバター取得 |

### 使用API
| メソッド | 用途 | レート制限 |
|---------|------|-----------|
| `auth.test` | トークン検証、teamId取得 | Tier 2 |
| `conversations.list` | チャンネル一覧 | Tier 2 |
| `conversations.history` | メッセージ取得（スレッド一覧用） | Tier 3 |
| `conversations.replies` | スレッド返信取得（詳細表示時のみ） | Tier 3 |
| `users.info` | ユーザー情報取得（キャッシュあり） | Tier 4 |
| `oauth.v2.access` | OAuthトークン交換 | - |

## chrome.storage使用
| キー | 内容 |
|-----|------|
| `slackToken` | xoxp-トークン |
| `userCache` | ユーザー情報キャッシュ（name, avatar） |
| `lastChannelId` | 最後に選択したチャンネルID |

## セットアップ

### 開発者向け
1. `chrome://extensions/` → デベロッパーモードON → フォルダを読み込む
2. `config.js.example` を `config.js` にコピーしてClient ID/Secretを記入
3. Slack Appの「Redirect URLs」に `chrome.identity.getRedirectURL()` の値を設定

### 社内配布
1. 管理者がSlack App作成（スコープ設定済み）
2. `config.js` にClient ID/Secret記入
3. Redirect URL設定（オプション画面下部に表示される）
4. 拡張をZIPまたはChrome Web Store（限定公開）で配布
5. ユーザーは「Slackでログイン」ボタン1回で利用開始

## アーキテクチャ

```
[ユーザー] → [拡張アイコンクリック] → [background.js: サイドパネル開く]
                                              ↓
[sidepanel.js] ← storage.onChanged ← [options.js: OAuthログイン]
      ↓
[Slack API] → conversations.history → latest_replyでソート → 描画
      ↓
[background.js] ← tabs.onUpdated ← [Slackタブ: チャンネル変更検知]
      ↓
[sidepanel.js: チャンネル自動切替]
```

## 既知の制限
- **SPA内遷移不可**: SlackのCSPにより、content scriptからのSPA内ルーティングは不可。「Slackで開く」はURL遷移（ページリロードあり）。
- **拡張ID固定**: 未パッケージの拡張はIDが変わる可能性あり。配布時はChrome Web Storeで固定推奨。
- **レート制限**: 多チャンネルの頻繁な切り替えでレート制限に達する可能性あり（通常利用では問題なし）。

## コード規約
- UIテキストは日本語
- コード・コメントは英語（一部日本語コメントあり）
- フレームワーク不使用（Vanilla JS）
- CSSはSlackのダークテーマカラーに準拠
  - 背景: `#1a1d21`, `#222529`
  - Slackパープル: `#4A154B`
  - アクセント: `#1264a3`, `#2eb67d`, `#e01e5a`
