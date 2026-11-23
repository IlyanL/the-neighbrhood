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
    // A stray Claude Code worktree (.claude/worktrees/*) carries its own full checkout,
    // including its own .next build output — the root-relative ".next/**" above only
    // catches this app's own build dir, not one nested inside a worktree.
    ".claude/worktrees/**",
    // Vendored pdfjs assets served as static files, not our source.
    "public/pdfjs/**",
    // Generated on demand by scripts/ds-diff — a measurement harness served to
    // the browser, rebuilt from the handoff bundle and never committed.
    "public/__ds-diff/**",
    // The design handoff bundle: a read-only reference (a compiled prototype
    // and its design-system export), not code this app builds or ships.
    "design_handoff_*/**",
  ]),
]);

export default eslintConfig;
