// eslint.config.mjs
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import nextPlugin from "@next/eslint-plugin-next";

export default [
  // 1) Ignore build artifacts
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/out/**",
      "**/build/**",
      "next-env.d.ts",
    ],
  },

  // 2) App rules
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
        // If you want type-aware linting, set project to your tsconfig:
        // project: "./tsconfig.json",
      },
    },
    settings: {
      react: { version: "detect" },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "jsx-a11y": jsxA11yPlugin,
      "@next/next": nextPlugin,
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // React + hooks + a11y recommended
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...jsxA11yPlugin.configs.recommended.rules,

      // Next.js core-web-vitals rules (this is what "next/core-web-vitals" gives you)
      ...nextPlugin.configs["core-web-vitals"].rules,

      // TypeScript recommended (non-type-checked preset)
      ...tsPlugin.configs.recommended.rules,

      // Optional: a couple of sensible tweaks
      "react/react-in-jsx-scope": "off", // Next.js doesn’t need React in scope
      "react/jsx-uses-react": "off",
    },
  },
];
