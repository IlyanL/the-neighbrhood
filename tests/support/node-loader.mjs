// Registered via --import so `node --test` can import real project modules — route files and
// the lib/ code they pull in — without a bundler. Node's own ESM resolver has two gaps this
// closes, neither of which needed touching a single line of application source:
//
// 1. The `@/*` tsconfig path alias (Next/webpack understand it; plain Node doesn't).
// 2. Extensionless specifiers in general — both `@/foo` and a plain relative import like
//    `./ics` are written without an extension, which only works under a bundler's resolution.
//    `next/server` has the same underlying problem for a different reason: it has no
//    package.json `exports` map, so Node won't find `next/server.js` from the bare specifier
//    `next/server` the way a bundler would.
//
// This only activates on resolution failure, so it can't change how anything inside
// node_modules resolves its own internal imports.
//
// `--import` alone only runs a file for its side effects — it doesn't wire up `resolve`/`load`
// exports as loader hooks. This file registers itself as the hook provider below, which is
// what actually activates it.

import { register } from "node:module";

const ROOT = new URL("../../", import.meta.url).href;

async function resolveWithExtensions(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND") {
      for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        try {
          return await nextResolve(specifier + suffix, context);
        } catch {
          // try the next suffix
        }
      }
    }
    throw err;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return resolveWithExtensions(ROOT + specifier.slice(2), context, nextResolve);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return resolveWithExtensions(specifier, context, nextResolve);
  }
  if (specifier.startsWith("next/") && !specifier.endsWith(".js")) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      if (err?.code === "ERR_MODULE_NOT_FOUND") {
        return nextResolve(specifier + ".js", context);
      }
      throw err;
    }
  }
  return nextResolve(specifier, context);
}

register(import.meta.url, import.meta.url);
