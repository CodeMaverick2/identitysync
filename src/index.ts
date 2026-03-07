import "dotenv/config";
import { loadConfig } from "./config/index.js";
import { getPool } from "./db/client.js";
import { createApp } from "./app.js";
import { runMigrations } from "./db/migrate.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await runMigrations(config);
  const pool = getPool(config);
  const app = createApp(pool);

  app.listen(config.PORT, () => {
    console.log(`Server listening on port ${config.PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
