import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma's legacy generator writes to node_modules/.prisma/client and ships
  // its own runtime — let Next.js leave it alone instead of trying to bundle it.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};

export default nextConfig;
