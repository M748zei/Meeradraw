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
    "app/.well-known/workflow/v1/**",
  ]),
  {
    rules: {
      // The react-hooks v6 plugin bundled with Next 16 flags several correct,
      // idiomatic patterns as hard errors (fetching on mount inside an effect,
      // assigning window.location for a redirect). These are intentional here
      // and reviewed — keep them visible as warnings but don't fail the build.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
    },
  },
]);

export default eslintConfig;
