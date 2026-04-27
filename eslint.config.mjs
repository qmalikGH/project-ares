import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Prisma client.
    "lib/generated/**",
  ]),
  {
    rules: {
      // React 19 strict-mode rules — useful long-term but trip on legitimate
      // fetch-on-mount + setState patterns and `new Date()` for "now"-style
      // displays. Downgraded to warnings until we migrate to Server Actions /
      // useEffectEvent in v0.3.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
]);

export default eslintConfig;
