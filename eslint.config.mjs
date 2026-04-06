import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Minimal ESLint for the engine monorepo. Keeps `!= null` / `== null` idioms (eqeqeq null: ignore).
 * Type-aware rules are off to stay fast and avoid tsconfig edge cases in scripts.
 */
export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "coverage-engine/**",
      "packages/test-vectors/**",
      "**/*.html",
      "docs/**",
    ],
  },
  {
    files: ["**/*.{ts,mts,cts,tsx}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-useless-assignment": "warn",
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "writable",
      },
    },
    rules: {
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  // CommonJS entrypoints (CLI bin) use require(); TS recommended flags them otherwise.
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
