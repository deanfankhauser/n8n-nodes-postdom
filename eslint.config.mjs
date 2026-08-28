// Lint config kept consistent with the postdom repo root (eslint.config.mjs).
// Verification note (checked 2026-08-28): `n8n-node lint` (@n8n/node-cli
// v0.45.4) refuses any config other than its own scaffold default while
// `n8n.strict` is true, and its ruleset (eslint-plugin-n8n-nodes-base) is not
// yet ESLint-10 compatible (`context.getFilename` crash). The community
// ruleset was therefore run standalone under ESLint 9 with
// `@n8n/node-cli/eslint` as the config: 0 errors, 0 warnings after fixing the
// credential icon, author email, raw re-throw, and an ID-casing description.
// Before Stage-3 submission, adopt the official scaffold config in CI so
// `n8n-node lint` runs first-class.
import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }
      ]
    }
  }
);
