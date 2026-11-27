// Project Ares — Prisma Config
// Loads .env.local explicitly (not the default .env), so secrets stay in
// the same file Next.js reads (CLAUDE.md guarantee: single source of truth).
//
// `prisma generate` only needs the schema to emit types; a missing
// DATABASE_URL must not block the postinstall hook on Vercel preview
// branches. Migrations and runtime still validate the URL at the point
// they actually connect.
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

const DATABASE_URL_PLACEHOLDER =
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  // This block REPLACES the schema's datasource URLs, directUrl included.
  // Sprint 3.4 (#28, Teil 0.1): without directUrl here, `migrate deploy` ran
  // through Neon's pooler (PgBouncer). Prisma's migration lock is a
  // session-level advisory lock; through a transaction pooler it can stay
  // held on a pooled server connection, and the next build times out (P1002).
  datasource: {
    url: process.env.DATABASE_URL ?? DATABASE_URL_PLACEHOLDER,
    ...(process.env.DIRECT_URL ? { directUrl: process.env.DIRECT_URL } : {}),
  },
});
