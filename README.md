# rubber-duck-sup

A Discord bot to help you rubber duck your problems.

## Setup

1. Install dependencies:
   ```sh
   npm install
   ```

2. Create a `.env` file and add the following environment variables:
   ```
   DISCORD_TOKEN=
   DISCORD_CLIENT_ID=
   DISCORD_PUBLIC_KEY=
   ```

3. Create the D1 database:
   ```sh
   npx wrangler d1 create rubber-duck-sup
   ```

4. Apply the database schema:
   ```sh
   npx wrangler d1 execute rubber-duck-sup --file=./schema.sql
   ```

## Development

Run the development server:
```sh
npm run dev
```

## Deployment

1. Deploy the worker:
   ```sh
   npm run deploy
   ```

2. Register the Discord slash commands:
   ```sh
   npm run deploy:commands
   ```
