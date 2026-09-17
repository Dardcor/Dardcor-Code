# OpenAI Codex CLI統合

Dardcor CodeをOpenAI Codex CLIと統合し、OpenAI APIリクエストをDardcor Codeのインテリジェントルーティングシステム経由でルーティングします。

## 前提条件

- OpenAI Codex CLIがインストール済み
- Dardcor Codeがローカルで動作中、またはクラウドエンドポイントが設定済み
- Dardcor CodeダッシュボードからのAPIキー

## セットアップ

### 1. 環境変数を設定

シェル設定ファイル (`~/.bashrc`、`~/.zshrc`、または `~/.bash_profile`) で以下の環境変数を設定:

```bash
# Dardcor Code用Base URL
export OPENAI_BASE_URL="http://localhost:21128/v1"

# Dardcor CodeダッシュボードからのAPIキー
export OPENAI_API_KEY="your-dardcor-code-api-key"
```

### 2. シェル設定をリロード

```bash
source ~/.zshrc  # または ~/.bashrc
```

### 3. 設定を確認

環境変数が正しく設定されているか確認:

```bash
echo $OPENAI_BASE_URL
echo $OPENAI_API_KEY
```

## 利用可能なモデル

Dardcor Codeは以下のCodexモデルを提供します:

| モデルID | 説明 |
|----------|-------------|
| `cx/gpt-5.2-codex` | GPT-5.2 Codex - 最新バージョン |
| `cx/gpt-5.1-codex-max` | GPT-5.1 Codex Max - 拡張コンテキスト |

## 使用例

### 基本的な使用法

```bash
# GPT-5.2 Codexを使用
codex --model cx/gpt-5.2-codex "Write a function to sort an array"

# GPT-5.1 Codex Maxを使用
codex --model cx/gpt-5.1-codex-max "Explain this complex algorithm"
```

### コード生成

```bash
codex --model cx/gpt-5.2-codex "Create a REST API endpoint for user authentication"
```

### コード説明

```bash
codex --model cx/gpt-5.1-codex-max "Explain what this code does: $(cat myfile.js)"
```

## 設定ファイル

設定ファイルを使ってCodex CLIを設定することもできます。`~/.codex/config.json` を作成または編集:

```json
{
  "baseUrl": "http://localhost:21128/v1",
  "apiKey": "your-dardcor-code-api-key",
  "defaultModel": "cx/gpt-5.2-codex"
}
```

## トラブルシューティング

### 認証エラー

認証エラーが発生した場合:

1. Dardcor CodeダッシュボードでAPIキーが正しいか確認
2. `OPENAI_API_KEY` 環境変数が設定されているか確認
3. APIキーが期限切れでないか確認

### 接続の問題

接続エラーが発生した場合:

1. Dardcor Codeが動作中か確認: `curl http://localhost:21128/health`
2. 環境変数が正しく設定されているか確認
3. ファイアウォールがポート21128をブロックしていないか確認

### モデルが利用不可

「model not available」エラーが発生した場合:

1. モデル名がDardcor Code設定と一致するか確認
2. Dardcor CodeダッシュボードでOpenAIプロバイダー接続がアクティブか確認
3. 接続されたプロバイダーでモデルが利用可能か確認

## クラウドエンドポイント

localhostの代わりにDardcor Codeクラウドエンドポイントを使用するには:

```bash
export OPENAI_BASE_URL="https://dardcor-code.web.id"
```

Dardcor CodeクラウドダッシュボードでAPIキーが設定されていることを確認してください。

## 高度な設定

### カスタムタイムアウト

```bash
export OPENAI_TIMEOUT=60  # 秒
```

### デバッグモード

詳細なリクエスト/レスポンスログを表示するため、デバッグモードを有効化:

```bash
export CODEX_DEBUG=true
codex --model cx/gpt-5.2-codex "Your prompt"
```
