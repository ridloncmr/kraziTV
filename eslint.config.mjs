// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "data/**"],
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: { allowDefaultProject: ["*.mjs"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Async methods often implement a Promise-returning contract without awaiting.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Re-throwing or forwarding a caught `unknown` is deliberate, not sloppy.
      "@typescript-eslint/only-throw-error": [
        "error",
        { allowThrowingUnknown: true },
      ],
      "@typescript-eslint/prefer-promise-reject-errors": [
        "error",
        { allowThrowingUnknown: true },
      ],
    },
  },
  {
    // Hook call order and effect dependencies are correctness rules in React.
    // The plugin's React Compiler rules stay off until the compiler is adopted;
    // they reject the setState-in-effect pattern the app uses for server state.
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["**/*.test.ts", "**/src/testing/**", "**/integration/**"],
    rules: {
      // HTTP inject bodies are `any`; tests assert on their shape directly.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // `expect(fake.method).toHaveBeenCalled()` passes methods unbound.
      "@typescript-eslint/unbound-method": "off",
      // Tests throw non-Error values to prove they are handled.
      "@typescript-eslint/only-throw-error": "off",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
