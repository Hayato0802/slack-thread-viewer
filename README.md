# Slack Thread Viewer

Slackチャンネルのスレッドを**最新返信順**にソートしてサイドパネルに表示するChrome拡張機能。

古いメッセージへの新しい返信が埋もれる問題を解決します。

## 機能

- **スレッド最新順表示** - 返信が付いたスレッドが自動で上位に浮上
- **Slackタブ自動検出** - 開いているSlackのチャンネルに自動追従
- **スレッド詳細表示** - サイドパネル内でスレッドの返信を閲覧
- **「Slackで開く」** - ワンクリックでSlack上のスレッドへ直接ジャンプ
- **キーワード検索** - テキスト・投稿者名でリアルタイムフィルタリング
- **時間帯グルーピング** - 「今日」「昨日」「今週」「1週間以上前」で区分
- **自動更新** - 30秒間隔のポーリング（ON/OFF切替可能）
- **ダーク/ライトテーマ** - ワンクリックで切替、設定は永続化
- **OAuth認証** - 外部サーバー不要、ブラウザ内で完結

## セットアップ

1. リポジトリをダウンロード
   - **Git**: `git clone https://github.com/Hayato0802/slack-thread-viewer.git`
   - **GitHub GUI**: リポジトリページの **Code** > **Download ZIP** でダウンロードし、展開
2. 管理者から受け取った `config.js` をプロジェクトルートに配置
3. `chrome://extensions/` を開き「デベロッパーモード」をON
4. 「パッケージ化されていない拡張機能を読み込む」でフォルダを選択
5. Slack Webを開いた状態で拡張アイコンをクリック
6. サイドパネルの「Slackでログイン」ボタンをクリック
7. 認証完了後、自動でスレッド一覧が表示されます

## 使い方

- Slackでチャンネルを切り替えると、サイドパネルも自動で追従
- スレッドをクリックすると詳細を表示
- スレッドをダブルクリックするとSlackで直接開く
- Slackタブ以外ではサイドパネルは無効化されます

## 技術スタック

- Chrome Extension Manifest V3
- Chrome Side Panel API / Identity API
- Slack Web API（OAuth 2.0）
- Vanilla JS + CSS（フレームワーク不使用）

## ファイル構成

```
slack-thread-viewer/
├── manifest.json          # 拡張設定
├── background.js          # Service Worker（タブ監視、サイドパネル制御）
├── content.js             # Content Script
├── config.js              # OAuth認証情報（.gitignore対象）
├── config.js.example      # config.jsのテンプレート
├── sidepanel/
│   ├── sidepanel.html     # サイドパネルUI
│   ├── sidepanel.js       # メインロジック
│   └── sidepanel.css      # ダーク/ライトテーマ対応CSS
├── options/
│   ├── options.html       # 設定画面
│   └── options.js         # 設定ロジック
└── icons/
    ├── icon16.svg
    ├── icon48.svg
    └── icon128.svg
```

## 管理者向け

<details>
<summary>Slack App作成・config.js準備</summary>

### 1. Slack Appを作成

1. [Slack API](https://api.slack.com/apps) で新しいAppを作成
2. **OAuth & Permissions** > **User Token Scopes** に以下を追加:
   - `channels:history` / `channels:read`
   - `groups:history` / `groups:read`
   - `users:read`

### 2. config.jsを作成

```bash
cp config.js.example config.js
```

`config.js` を編集してSlack AppのClient IDとClient Secretを記入:

```js
const SLACK_CLIENT_ID = 'your-client-id';
const SLACK_CLIENT_SECRET = 'your-client-secret';
```

### 3. Redirect URL設定

1. 拡張をChromeにインストール
2. 拡張の設定画面（オプション）下部に表示される **Redirect URL** をSlack Appの **Redirect URLs** に追加

### 4. 配布

- 作成した `config.js` をユーザーに手渡し
- ユーザーはリポジトリをクローン → `config.js` 配置 → Chrome登録で利用開始

</details>

## 既知の制限

- **SPA内遷移不可**: SlackのCSP制約により「Slackで開く」はページリロードを伴います
- **拡張ID**: 未パッケージの拡張はインストールごとにIDが変わる可能性があります。配布時はChrome Web Storeで固定推奨
- **DMは非対応**: ダイレクトメッセージのスレッド表示には対応していません

## ライセンス

MIT
