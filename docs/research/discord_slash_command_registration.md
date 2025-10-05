# Discord スラッシュコマンド登録調査メモ

## 背景

スラッシュコマンドは Discord が提供する標準 UI からアプリ機能へアクセスさせる仕組みで、利用者に対してコマンド一覧や入力補助を提供してくれる。

## 全体像

1. OAuth2 で `applications.commands`（必要に応じて `bot`）スコープを含む形でアプリをサーバーまたはユーザーにインストールする。
2. REST API を使ってコマンド定義を Discord に登録する（グローバルまたはギルドスコープ）。
3. 登録されたコマンドに対する呼び出しを、Bot や Webhook で受け取り処理する。

## 認可とインストールコンテキスト

- **スコープ**: `applications.commands` は必須。ボットとして振る舞う場合は `bot` スコープと必要権限を追加する。ユーザーインストール（DM での利用など）を許可する場合はインストール設定で User Install を有効化し、必要なデフォルト権限を設定する。
- **権限**: ギルド側では「Use Application Commands」権限でユーザーのコマンド利用可否を制御する。
- **可視性**: User install を有効化すると DM やグループ DM でもコマンドが提示されるが、呼び出し元の権限不足（例: チャンネルでの送信権限なし）の場合は自動的にレスポンス送信が制限される。

## 登録エンドポイント整理

Discord の Application Command API は以下の主なエンドポイントを提供する。citeturn15search11

- `PUT /applications/{application.id}/commands` : グローバルコマンドを一括上書き。
- `POST /applications/{application.id}/commands` : 単一のグローバルコマンドを作成。
- `POST /applications/{application.id}/guilds/{guild.id}/commands` : ギルド専用コマンドを作成（数秒で反映）。
- `PUT /applications/{application.id}/guilds/{guild.id}/commands` : ギルドコマンドを一括上書き。
- `GET /applications/{application.id}/commands` / `GET .../guilds/.../commands` : 登録済みコマンドの列挙。

Bot トークンまたは `applications.commands.update` を含む Bearer トークンで認証する。citeturn15search11

### 反映タイミング

- **グローバルコマンド**: 世界中に反映されるまで最大 1 時間程度。
- **ギルドコマンド**: 数秒で利用可能になるため開発・検証に向く。

## 登録スクリプト設計案

Discord 公式は「コマンドは定義変更時のみ再登録すべき」としており、デプロイとは独立した軽量スクリプトで登録するのが一般的な運用である。 以下は Node.js（TypeScript/ESM）での実装例イメージ：

```ts
import { REST, Routes } from "@discordjs/rest";
import { SlashCommandBuilder } from "discord.js";
import config from "./config.js"; // clientId, guildId, token

const commands = [
  new SlashCommandBuilder()
    .setName("progress")
    .setDescription("最新の進捗を登録する")
    .addStringOption((opt) =>
      opt.setName("summary").setDescription("進捗内容").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("セッションを終了する"),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

async function main() {
  if (config.guildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );
    console.log("Guild コマンドを更新しました");
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: commands,
    });
    console.log("Global コマンドを更新しました");
  }
}

main().catch((err) => {
  console.error("Slash コマンド登録に失敗", err);
  process.exit(1);
});
```

ポイント:

- コマンド定義をコードとして管理し、スクリプトは idempotent（上書き）に動かす。
- グローバル登録は本番確定時のみ実行し、開発時は `guildId` を指定する。
- 大量登録は 200 件/日/ギルドのレート制限に注意する。

## ワークフローへの組み込み

- **CI/CD**: `npm run deploy-commands` のような専用 npm script を用意し、手動またはリリース時のみ実行する。
- **構成管理**: コマンド定義 JSON を `src/commands/*.ts` に分割し、登録スクリプトで読み込む。Workers（本番実行環境）はランタイムで登録せず、登録済みコマンドを受けて応答するだけにする。
- **Secrets 取り扱い**: Bot トークンは CI のシークレットストアまたは `wrangler secret` に保存し、ローカル開発時は `.env` 経由でロードする。
- **ロールバック**: 誤登録時は空配列で `PUT` するか対象コマンドを `DELETE` してクリーンアップ。

## 注意事項

- コマンドの可視性は `contexts` や `integration_types` 設定にも依存するため、User Install を有効化した場合は追加のテストを行う。
- ギルド所有者が Slash Commands 権限を無効化するとユーザーに表示されない。サポート手順も併せて案内すること。
- 大規模更新は API レート制限を避けるためにバッチを分割し、バックオフ戦略を実装する。

## 次のアクション

1. `npm` プロジェクトに上記スクリプト骨子を追加し、`deploy-commands` タスクを提供する。
2. 開発環境ギルドで `/progress` `/stop` `/start` など MVP コマンドをギルド登録して疎通確認。
3. 本番リリース前にグローバル登録へ切り替え、反映完了までの 1 時間を考慮した告知を行う。
