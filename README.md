# rubber-duck-sup

ラバーダッキング（問題解決の手法）を支援するためのDiscordボットです。

## セットアップ

1.  依存関係をインストールします:
    ```sh
    npm install
    ```

2.  `.env` ファイルを作成し、以下の環境変数を追加します:
    ```
    DISCORD_TOKEN=
    DISCORD_CLIENT_ID=
    DISCORD_PUBLIC_KEY=
    DISCORD_GUILD_ID=    ```

3.  D1 データベースを作成します:
    ```sh
    npx wrangler d1 create rubber-duck-sup
    ```

4.  データベーススキーマを適用します:
    ```sh
    npx wrangler d1 migrations apply DB
    ```

## 開発

開発サーバーを起動します:
```sh
npm run dev
```

## データベースのマイグレーション (Database Migration)

このプロジェクトでは `sqlite3def` と `wrangler d1` を使用してデータベースのマイグレーションを管理します。

### マイグレーション手順

1.  **スキーマ定義の更新**
    `schema.sql` を直接編集して、テーブル定義などを変更します。

2.  **差分確認 (Dry Run)**
    `schema.sql` と現在のDBスキーマ(`schema.sqlite`)との差分を確認します。

    ```bash
    sqlite3def --dry-run schema.sqlite < schema.sql
    ```

3.  **マイグレーションファイルの作成**
    差分を元にマイグレーションファイルを生成します。ファイル名は `{yyyymmdd}_{連番}_{変更概要}.sql` の形式で作成してください。

    ```bash
    sqlite3def --dry-run schema.sqlite < schema.sql > migrations/YYYYMMDD_NNNN_summary.sql
    ```

    **重要:** 生成されたSQLファイルには `-- dry run --`, `BEGIN;`, `COMMIT;` が含まれている場合があります。Wrangler D1はこれらの記述に対応していないため、手動で削除し、`ALTER TABLE` などのDDL文のみを残してください。

    **修正前:**
    ```sql
    -- dry run --
    BEGIN;
    ALTER TABLE `sessions` ADD COLUMN `title` text;
    COMMIT;
    ```

    **修正後:**
    ```sql
    ALTER TABLE `sessions` ADD COLUMN `title` text;
    ```

4.  **ローカル環境への適用**
    作成したマイグレーションファイルをローカルのD1データベースに適用します。

    ```bash
    npx wrangler d1 migrations apply DB --local
    ```

5.  **本番環境への適用 (デプロイ後)**
    Cloudflare Pages のデプロイが完了した後、手動で本番のD1データベースにマイグレーションを適用する必要があります。

    ```bash
    npx wrangler d1 migrations apply DB --remote
    ```

## デプロイ

1.  ワーカーをデプロイします:
    ```sh
    npm run deploy
    ```

2.  Discord スラッシュコマンドを登録します:
    ```sh
    npm run deploy:commands
    ```
