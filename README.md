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

## デプロイ

1.  ワーカーをデプロイします:
    ```sh
    npm run deploy
    ```

2.  Discord スラッシュコマンドを登録します:
    ```sh
    npm run deploy:commands
    ```