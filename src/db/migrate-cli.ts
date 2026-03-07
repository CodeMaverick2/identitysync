import "dotenv/config";
import { loadConfig } from "../config/index.js";
import { runMigrations } from "./migrate.js";

runMigrations(loadConfig())
  .then(() => {
    console.log("Migration completed.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
