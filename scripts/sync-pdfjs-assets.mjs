import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// `new URL("..", import.meta.url)` already points at the project root, and
// fileURLToPath returns it WITH a trailing slash. Passing that through
// path.dirname() strips one level too many — which is how this resolved to
// /vercel instead of /vercel/path0 and failed every deploy at the install step.
const root = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = path.join(root, "public/pdfjs");

// Ask Node where pdfjs-dist actually is rather than assuming <root>/node_modules.
// pnpm stores the real package under .pnpm and leaves a symlink behind, and the
// layout differs again on CI, so hard-coding the path is what made this fragile.
const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));

const assets = [
  { from: "cmaps", to: "cmaps" },
  { from: "standard_fonts", to: "standard_fonts" },
  { from: "build/pdf.worker.min.mjs", to: "pdf.worker.min.mjs" },
];

mkdirSync(publicRoot, { recursive: true });

const failed = [];
for (const asset of assets) {
  try {
    cpSync(path.join(pdfjsRoot, asset.from), path.join(publicRoot, asset.to), { recursive: true });
  } catch (error) {
    failed.push(`${asset.from} (${error.code || error.message})`);
  }
}

// This runs as `postinstall`, so throwing here fails `pnpm install` and takes down
// every build and deploy. A missing PDF preview is a broken feature; a failed
// install is a broken site. Warn loudly and let the install finish.
if (failed.length) {
  console.warn(
    `\n[sync-pdfjs-assets] WARNING: could not copy ${failed.join(", ")} from ${pdfjsRoot}.\n` +
    "  PDF previews on the whiteboard will not render until this is resolved.\n" +
    "  This usually means pdfjs-dist changed its internal layout — check the paths above.\n",
  );
} else {
  console.log("Synced pdfjs-dist worker/cmaps/standard_fonts into public/pdfjs");
}
