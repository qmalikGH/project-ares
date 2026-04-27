// Project Ares — Prisma Config
// Loads .env.local explicitly (not the default .env), so secrets stay in
// the same file Next.js reads (CLAUDE.md guarantee: single source of truth).
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
