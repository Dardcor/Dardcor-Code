# 🏠 ローカルホストデプロイメント

開発と個人利用のため、ローカルマシンでMiawRouterを実行。

---

## 📦 インストール

npm経由でMiawRouterをグローバルインストール:

```bash
npm install -g miawrouter
```

**要件:**
- Node.js 20以上
- npm 9以上

---

## 🚀 サーバーの起動

一つのコマンドでMiawRouterを起動:

```bash
miawrouter
```

ダッシュボードが自動的にブラウザで `http://localhost:3000` に開きます。

**デフォルト設定:**
- **ダッシュボード**: `http://localhost:3000`
- **APIエンドポイント**: `http://localhost:21128/v1`
- **データディレクトリ**: `~/.miawrouter`

---

## 🔧 設定

### カスタムデータディレクトリ

環境変数を使ってカスタムデータディレクトリを設定:

```bash
DATA_DIR=/path/to/data miawrouter
```

### カスタムポート

APIポート(21128)とダッシュボードポート(3000)はアプリケーションで設定されています。変更するにはソースコードを修正するか、サポートされている場合は環境変数を使用してください。

---

## 🛑 サーバーの停止

MiawRouterが実行されているターミナルで `Ctrl+C` を押します。

```bash
# miawrouterを実行しているターミナル
^C  # Ctrl+Cを押す
```

サーバーはグレースフルにシャットダウンし、すべてのデータを保存します。

---

## 🔄 サーバーの再起動

起動コマンドを再度実行するだけです:

```bash
miawrouter
```

すべての設定、APIキー、コンボはデータディレクトリに保持されます。

---

## 📊 MiawRouterの更新

最新バージョンに更新:

```bash
npm update -g miawrouter
```

現在のバージョンを確認:

```bash
npm list -g miawrouter
```

---

## 🔍 トラブルシューティング

### ポートがすでに使用されている

ポート21128または3000がすでに使用されている場合:

```bash
# ポートを使用しているプロセスを検索 (macOS/Linux)
lsof -i :21128
lsof -i :3000

# プロセスを終了
kill -9 <PID>
```

### 権限エラー

インストール中に権限エラーが発生した場合:

```bash
# sudoを使用 (非推奨)
sudo npm install -g miawrouter

# またはnpm権限を修正 (推奨)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### データディレクトリの問題

データディレクトリにアクセスできない場合:

```bash
# 権限を確認
ls -la ~/.miawrouter

# 権限を修正
chmod 755 ~/.miawrouter
```

---

## 📁 データディレクトリ構造

```
~/.miawrouter/
├── db.json           # メインデータベース (プロバイダー、コンボ、設定)
├── logs/             # アプリケーションログ
└── cache/            # 一時キャッシュファイル
```

**データのバックアップ:**

```bash
# バックアップ
cp -r ~/.miawrouter ~/.miawrouter.backup

# 復元
cp -r ~/.miawrouter.backup ~/.miawrouter
```

---

## 🔗 次のステップ

- [プロバイダーを接続](/providers/subscription.md)
- [コンボを作成](/features/combos.md)
- [CLIツールとの統合](/integration/cursor.md)
