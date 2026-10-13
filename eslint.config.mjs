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
    // Agent worktrees, vendored and generated files.
    ".claude/**",
    "vendor/**",
    "fixtures/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    // Playwright fixtures hand their value to the test through a callback named `use`, which
    // the React hooks rule mistakes for React's use().
    files: ["e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
]);

export default eslintConfig;
