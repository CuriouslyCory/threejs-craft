import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 no longer auto-loads `.env` for the CLI, so we import `dotenv/config`
 * here and wire the datasource URL through explicitly.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
