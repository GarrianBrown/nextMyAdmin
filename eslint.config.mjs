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
    // Packaged app output — bundled/minified JS, never lint it.
    "dist-electron/**",
    // Electron main-process + build tooling are Node CommonJS, not part of the
    // Next app; the Next/TS lint config doesn't apply to them.
    "electron/**",
    "scripts/**",
  ]),
  {
    // Allow intentionally-unused `_`-prefixed args/vars (interface-stub params).
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
