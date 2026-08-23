# インストール

トラブルシューティングのヒント付きのMiawRouter詳細インストールガイド。

---

## 要件

### システム要件

- **Node.js**: バージョン 20.0.0以上
- **npm**: バージョン 10.0.0以上 (Node.jsに付属)
- **OS**: macOS、Linux、Windows (WSL推奨)
- **ディスク容量**: インストールに約200MB

### バージョンを確認

```bash
node --version
# v20.x.x以上が表示されるはず

npm --version
# 10.x.x以上が表示されるはず
```

**Node.jsがない場合?** [nodejs.org](https://nodejs.org/)からインストール

---

## インストール方法

### 方法1: グローバルインストール (推奨)

どこからでも使用できるようにMiawRouterをグローバルインストール:

```bash
npm install -g miawrouter
```

**MiawRouterを起動:**

```bash
miawrouter
```

**利点:**
- ✅ どのディレクトリからでも実行
- ✅ シンプルなコマンド: `miawrouter`
- ✅ `npm update -g miawrouter` で自動更新

### 方法2: ローカルインストール

特定のプロジェクトにインストール:

```bash
mkdir my-miawrouter
cd my-miawrouter
npm install miawrouter
```

**MiawRouterを起動:**

```bash
npx miawrouter
```

**利点:**
- ✅ プロジェクトごとに分離
- ✅ プロジェクトごとのバージョン管理
- ✅ グローバル名前空間の汚染なし

### 方法3: ソースから (開発)

GitHubからクローンしてビルド:

```bash
git clone .git
cd miawrouter/app
npm install
npm run build
npm start
```

**利点:**
- ✅ 最新の開発機能
- ✅ 開発に貢献可能
- ✅ カスタム変更

---

## 初回実行

### サーバーを起動

```bash
miawrouter
```

**何が起こるか:**
1. サーバーが `http://localhost:21128` で起動
2. ダッシュボードが自動的にブラウザで開く
3. `~/.miawrouter` にデータディレクトリが作成される
4. APIキーが自動生成される

### ダッシュボードログイン

**デフォルト認証情報:**
- パスワード: `123456`

**⚠️ パスワードをすぐに変更:**
1. ダッシュボードにログイン
2. Settings → Change Password
3. 強力なパスワードを使用

### APIキーを取得

```
Dashboard → Settings → API Keys
→ APIキーをコピー
→ CLIツールで使用
```

**APIキー形式の例:**
```
miaw_1234567890abcdef1234567890abcdef
```

---

## インストールを確認

### サーバーステータスを確認

```bash
curl http://localhost:21128/health
```

**期待されるレスポンス:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

### 利用可能なモデルを一覧表示

```bash
curl http://localhost:21128/v1/models \
  -H "Authorization: Bearer your-api-key"
```

**期待されるレスポンス:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "cc/claude-opus-4-5-20251101",
      "object": "model",
      "created": 1234567890,
      "owned_by": "claude-code"
    }
  ]
}
```

### チャットコンプリーションをテスト

```bash
curl http://localhost:21128/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cc/claude-opus-4-5-20251101",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

---

## 設定

### 環境変数

`.env` ファイルを作成するか、環境変数を設定:

```bash
# セキュリティ (本番環境では必須)
export JWT_SECRET="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"

# ストレージ
export DATA_DIR="~/.miawrouter"

# サーバー
export PORT="21128"
export NODE_ENV="production"

# ロギング
export ENABLE_REQUEST_LOGS="false"
```

### データディレクトリ

**デフォルトの場所:** `~/.miawrouter`

**内容:**
```
~/.miawrouter/
  ├── db.json           # データベース (プロバイダー、コンボ、使用量)
  ├── api-keys.json     # APIキー
  └── logs/             # リクエストログ (有効化されている場合)
```

**場所を変更:**

```bash
export DATA_DIR="/custom/path"
miawrouter
```

### ポート設定

**デフォルトポート:** `21128`

**ポートを変更:**

```bash
export PORT="3000"
miawrouter
```

**またはコマンドラインで:**

```bash
miawrouter --port 3000
```

---

## トラブルシューティング

### ポートがすでに使用されている

**エラー:**
```
Error: listen EADDRINUSE: address already in use :::21128
```

**解決策1: 既存のプロセスを終了**

```bash
# ポート21128を使用しているプロセスを検索
lsof -i :21128

# プロセスを終了
kill -9 <PID>
```

**解決策2: 別のポートを使用**

```bash
miawrouter --port 3000
```

### Permission Denied

**エラー:**
```
Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/miawrouter'
```

**解決策: sudoを使用 (非推奨) またはnpm権限を修正**

```bash
# npm権限を修正 (推奨)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# 再度インストール
npm install -g miawrouter
```

### Node.jsバージョンが古すぎる

**エラー:**
```
Error: The engine "node" is incompatible with this module
```

**解決策: Node.jsを更新**

```bash
# nvmを使用 (推奨)
nvm install 20
nvm use 20

# またはnodejs.orgからダウンロード
```

### ダッシュボードが開かない

**問題:** ダッシュボードが自動的に開かない

**解決策1: 手動で開く**

```
http://localhost:21128
```

**解決策2: ファイアウォールを確認**

```bash
# macOS: システム環境設定 → セキュリティでNode.jsを許可
# Linux: iptablesを確認
# Windows: Windowsファイアウォールを確認
```

### プロバイダーに接続できない

**問題:** OAuthログインが失敗、またはAPIキーが無効

**解決策1: インターネット接続を確認**

```bash
ping google.com
```

**解決策2: プロバイダーのステータスを確認**

- Claude Code: [status.anthropic.com](https://status.anthropic.com)
- OpenAI: [status.openai.com](https://status.openai.com)
- Gemini: [status.cloud.google.com](https://status.cloud.google.com)

**解決策3: APIキーを再生成**

```
Dashboard → Provider → Disconnect → Reconnect
```

### 高メモリ使用量

**問題:** MiawRouterがRAMを使いすぎている

**解決策: サーバーを再起動**

```bash
# 停止
pkill -f miawrouter

# 起動
miawrouter
```

**または自動再起動にPM2を使用:**

```bash
npm install -g pm2
pm2 start miawrouter --name miawrouter
pm2 save
```

---

## デプロイメントオプション

### ローカル開発

```bash
npm install -g miawrouter
miawrouter
```

**ユースケース:** 個人コーディング、テスト

### VPS/クラウドサーバー

```bash
# インストール
npm install -g miawrouter

# 設定
export JWT_SECRET="your-secure-secret"
export INITIAL_PASSWORD="your-password"
export NODE_ENV="production"

# PM2で起動
npm install -g pm2
pm2 start miawrouter --name miawrouter
pm2 save
pm2 startup
```

**ユースケース:** チームアクセス、リモートコーディング

### Docker

```bash
docker pull miawrouter/miawrouter:latest

docker run -d \
  -p 21128:21128 \
  -e JWT_SECRET="your-secure-secret" \
  -e INITIAL_PASSWORD="your-password" \
  -v miawrouter-data:/root/.miawrouter \
  --name miawrouter \
  miawrouter/miawrouter:latest
```

**ユースケース:** コンテナデプロイ、Kubernetes

### リバースプロキシ (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:21128;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        
        # SSE support for streaming
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
```

**ユースケース:** HTTPS、カスタムドメイン、ロードバランシング

---

## アンインストール

### グローバルインストールを削除

```bash
npm uninstall -g miawrouter
```

### データディレクトリを削除

```bash
rm -rf ~/.miawrouter
```

### 設定を削除

```bash
# シェル設定から環境変数を削除
nano ~/.bashrc  # または ~/.zshrc
# miawrouter関連のエクスポートを削除
```

---

## 次のステップ

- [スタートガイド](../getting-started.md) - プロバイダーを接続してコーディング開始
- [機能](../features/) - クォータトラッキング、コンボ、デプロイを確認
- [トラブルシューティング](../troubleshooting.md) - 一般的な問題の修正

---

## ヘルプが必要?

- **ウェブサイト**: [miawrouter.web.id](https://miawrouter.web.id)
- **GitHub**: 
- **Issues**: [/issues](/issues)
