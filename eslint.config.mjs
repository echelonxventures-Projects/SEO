import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // These rules are React-Compiler-oriented advisories. This app renders
      // normally (the compiler is intentionally NOT enabled in next.config),
      // so standard, correct data-loading / prop-sync effects are expected.
      // Keep them visible as warnings, not build-breaking errors.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/incompatible-library": "off",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-render": "warn",
    },
  },
  // Throwaway dev/test harnesses: dynamic JSON access with `any` is acceptable.
  {
    files: ["scripts/**/*.{ts,mts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
]);

export default eslintConfig;
