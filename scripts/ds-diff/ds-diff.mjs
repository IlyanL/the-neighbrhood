#!/usr/bin/env node
/**
 * ds-diff — compare a redesigned screen against the handoff prototype by
 * computed style, not by eye.
 *
 * Screenshots hide line-height and gutter errors. This measures them: it
 * renders one fixture twice — once under the handoff's own stylesheets, once
 * inside the running app's real cascade — walks both trees in parallel and
 * reports every property that differs.
 *
 *   node scripts/ds-diff/ds-diff.mjs sessions      # build the harness
 *   node scripts/ds-diff/ds-diff.mjs --clean       # remove it
 *
 * Then, in the Browser pane on any page of the dev server, with the viewport
 * set to 1440 wide:
 *
 *   await (await import('/__ds-diff/probe.js')).run()
 *   await (await import('/__ds-diff/probe.js')).run({ theme: 'dark' })
 *   await (await import('/__ds-diff/probe.js')).run({ all: true })
 *
 * Why it must run inside a live app page rather than a standalone file: the
 * app's real cascade is globals.css + Tailwind's preflight + next/font, none
 * of which exist in a bare harness. Measuring without them is what makes a
 * screen look correct when it is not — see the traps in the handoff README.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(ROOT, "public", "__ds-diff");

const arg = process.argv[2];

if (arg === "--clean") {
  rmSync(OUT, { recursive: true, force: true });
  console.log("removed public/__ds-diff");
  process.exit(0);
}

if (!arg || arg.startsWith("-")) {
  const have = existsSync(join(HERE, "fixtures"))
    ? readdirSync(join(HERE, "fixtures")).map((f) => f.replace(/\.html$/, "")).join(", ")
    : "none yet";
  console.error(`usage: node scripts/ds-diff/ds-diff.mjs <screen>\nfixtures: ${have}`);
  process.exit(1);
}

/* ---- locate the handoff bundle ------------------------------------------ */
const bundleRoot = readdirSync(ROOT).find((d) => d.startsWith("design_handoff_"));
if (!bundleRoot) {
  console.error("no design_handoff_* bundle at the repo root — nothing to diff against");
  process.exit(1);
}
const dsDir = join(ROOT, bundleRoot, "_ds");
const DS = join(dsDir, readdirSync(dsDir)[0]);

const fixturePath = join(HERE, "fixtures", `${arg}.html`);
if (!existsSync(fixturePath)) {
  console.error(`no fixture at scripts/ds-diff/fixtures/${arg}.html\n` +
    "Write one: plain markup using the screen's nb-* classes, no template tags.\n" +
    "The screens/*.html in the bundle are NOT usable directly — their content\n" +
    "comes from <x-import> and <sc-for>, which render nothing.");
  process.exit(1);
}
const fixture = readFileSync(fixturePath, "utf8");

/* ---- the reference page -------------------------------------------------
   Every token file and every component file, in the bundle's own order.
   `base.css` is load-bearing and easy to miss: it carries the body type scale
   and the heading reset that the rest of the system assumes. Leaving it out
   makes headings fall back to the UA's bold/normal and produces a page of
   diffs that are all artefact.
   ---------------------------------------------------------------------- */
const TOKENS = ["colors", "colors-dark", "typography", "spacing", "radius", "elevation", "motion", "base"];
const COMPONENTS = ["core/core", "layout/layout", "surfaces/surfaces", "sessions/sessions", "wall/wall"];
const protoCss =
  TOKENS.map((f) => readFileSync(join(DS, "tokens", `${f}.css`), "utf8")).join("\n") +
  COMPONENTS.map((f) => readFileSync(join(DS, "components", `${f}.css`), "utf8")).join("\n") +
  readFileSync(join(DS, "styles.css"), "utf8");

const reference = `<!doctype html><html><head><meta charset="utf-8"><style>${protoCss}</style>
<style>body{margin:0;background:var(--surface-page);color:var(--text-primary);font-family:var(--font-body)}*{box-sizing:border-box}button{font:inherit}</style>
</head><body><div class="ds-diff-root" style="width:1440px">${fixture}</div></body></html>`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "reference.html"), reference);
/* Only classes the bundle actually defines can be compared. The app has added
   its own (`.nb-agenda__drawer`, `.nb-railcard`, `.nb-pad`, …) for UI the
   prototype never drew; against the reference page those have no rules at all,
   so every one of their properties "differs" and the real signal drowns. The
   probe measures the intersection and counts the rest. */
const defined = [...new Set(
  (protoCss.match(/\.nb-[a-z0-9_-]+(?:__[a-z-]+)?/g) || []).map((c) => c.slice(1))
)].sort();
writeFileSync(join(OUT, "probe.js"), probeSource(defined));

/* ---- the class-vs-inline pair, when the screen has one -------------------
   The bundle draws several screens (`courses`, `profile`, `admin`, `policy`,
   and `payment`/`auth` after them) almost entirely with inline styles, so it
   defines no class for the probe above to compare the app's markup against.
   `fixtures/<screen>.xlate.html` holds both trees — the prototype's inline
   markup, a `<!--XLATE-SPLIT-->` line, then the markup the app renders — and
   xlate.js diffs them element for element inside the live page. That is the
   half that catches a class whose value drifted from the drawing. */
const xlatePath = join(HERE, "fixtures", `${arg}.xlate.html`);
let xlateNote = "";
if (existsSync(xlatePath)) {
  const [proto, app] = readFileSync(xlatePath, "utf8").split("<!--XLATE-SPLIT-->");
  if (app === undefined) {
    console.error(`fixtures/${arg}.xlate.html has no <!--XLATE-SPLIT--> line`);
    process.exit(1);
  }
  writeFileSync(join(OUT, "xlate-proto.html"), proto);
  writeFileSync(join(OUT, "xlate-app.html"), app);
  writeFileSync(join(OUT, "xlate.js"), readFileSync(join(HERE, "xlate.js"), "utf8"));
  xlateNote =
    `\n  This screen also has a class-vs-inline pair. After the run above:\n` +
    `     await (await import('/__ds-diff/xlate.js')).run('${arg}')\n`;
}

console.log(
  `built public/__ds-diff for "${arg}"\n\n` +
  `  1. resize the Browser pane viewport to 1440 wide\n` +
  `  2. open any dev-server page, then run:\n` +
  `     await (await import('/__ds-diff/probe.js')).run()\n` +
  xlateNote +
  `\n  run({ theme: 'dark' }) to check the dark ground, run({ all: true }) to\n` +
  `  see the suppressed app-wide deltas too.\n` +
  `  node scripts/ds-diff/ds-diff.mjs --clean when you are done.`
);

function probeSource(defined) {
  return `const DEFINED = new Set(${JSON.stringify(defined)});
` + String.raw`
/* Injected harness. Runs inside a live app page so the comparison sees the
   app's real cascade. Returns a short string — the point of this script is
   that reading the result costs a couple of hundred tokens, not twenty
   thousand. */

const PROPS = [
  "display", "gridTemplateColumns", "flexDirection", "fontSize", "fontWeight",
  "letterSpacing", "lineHeight", "color", "backgroundColor", "backgroundImage",
  "padding", "margin", "borderRadius", "borderTopWidth", "borderRightWidth",
  "borderBottomWidth", "borderLeftWidth", "borderColor", "gap", "cssFloat",
  "textAlign", "boxShadow", "justifyContent", "alignItems", "flexWrap",
  "opacity", "outlineWidth", "position", "overflow",
];

/* Deviations that are app-wide, understood, and deliberately not fixed.
   Suppressed by default so a real regression is not buried; --all shows them.

   1. The app never ported the bundle's "tokens/base.css", because a global
      body rule would restyle every screen still waiting its turn. So the app
      body is Tailwind's 16px/1.5 where the handoff is 14px/1.55. Anything
      that sets its own size is unaffected; anything inheriting is off by
      about a pixel of leading.
   2. Font stacks resolve to the same faces through different fallback lists
      (next/font injects "Sora Fallback" etc.), and text-measured widths move
      a few px with them. */
const SUPPRESS = [
  (p) => p === "fontFamily",
  (p, proto, app) => p === "fontSize" && proto === "14px" && app === "16px",
  (p, proto, app) => p === "lineHeight" && proto === "21.7px" && app === "24px",
  (p, proto, app) => p === "lineHeight" && Math.abs(px(proto) - px(app)) <= 1.5,
  /* An auto margin resolves against sibling text widths, which move with the
     font stack. Only flag a margin whose values are authored (whole px). */
  (p, proto, app) => p === "margin" && (proto.includes(".") || app.includes(".")),
  /* The identical hex computes one step apart on the two sides — the app's
     colours round-trip through globals.css, which states several of them in
     oklch. Verified on --surface-page (#141018) and --border-strong (#3d3446):
     same token, rgb off by one. Imperceptible, and it would flood every dark
     run. A real wrong colour is never this close. */
  (p, proto, app) => /color/i.test(p) && channelsWithin(proto, app, 1),
];

function channelsWithin(a, b, tol) {
  const nums = (v) => (String(v).match(/-?[\d.]+/g) || []).map(Number);
  const x = nums(a), y = nums(b);
  if (!x.length || x.length !== y.length) return false;
  return x.every((n, i) => Math.abs(n - y[i]) <= tol);
}

const px = (v) => (typeof v === "string" && v.endsWith("px") ? parseFloat(v) : NaN);
const HOST_ID = "ds-diff-host";
const FRAME_ID = "ds-diff-frame";

function label(el, i) {
  const cls = [...el.classList].filter((c) => c.startsWith("nb-") || c.startsWith("ds-")).join(".");
  return (cls ? "." + cls : el.tagName.toLowerCase()) + "#" + i;
}

function ancestorsOf(el) {
  const out = [];
  for (let p = el.parentElement; p && !p.classList.contains("ds-diff-root"); p = p.parentElement) out.push(p);
  return out;
}

function snap(el) {
  const cs = getComputedStyle(el);
  const o = {};
  for (const p of PROPS) o[p] = cs[p];
  const r = el.getBoundingClientRect();
  o.__w = Math.round(r.width);
  o.__h = Math.round(r.height);
  return o;
}

export async function run(opts = {}) {
  const { theme = "light", all = false, width = 1440 } = opts;

  /* The single most expensive mistake available here: measuring at the pane's
     own narrow width, silently getting the mobile breakpoints, and believing
     the numbers. Media queries read the viewport, not the fixture's width. */
  if (innerWidth !== width) {
    return "ABORTED — viewport is " + innerWidth + "px, expected " + width +
      "px. Media queries read the viewport, so measuring now would compare the " +
      "wrong breakpoint. Resize the pane first (resize_window " + width + "x900).";
  }

  document.getElementById(HOST_ID)?.remove();
  document.getElementById(FRAME_ID)?.remove();

  const html = await fetch("/__ds-diff/reference.html").then((r) => r.text());
  const inner = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));

  /* App side: the fixture inside this page, so globals.css, Tailwind's
     preflight and next/font all apply exactly as they do in production. */
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:fixed;left:0;top:0;width:" + width +
    "px;z-index:99999;overflow:auto;max-height:100vh;background:var(--surface-page)";
  host.innerHTML = inner;
  document.body.appendChild(host);

  /* Reference side: the bundle's own stylesheets, isolated in an iframe. */
  const frame = document.createElement("iframe");
  frame.id = FRAME_ID;
  frame.style.cssText = "position:fixed;left:-99999px;top:0;width:" + width + "px;height:3000px;border:0";
  document.body.appendChild(frame);
  frame.srcdoc = html;
  await new Promise((r) => (frame.onload = r));
  await new Promise((r) => setTimeout(r, 400));

  /* Dark is keyed differently on each side — ".dark" here (what theme.ts
     writes), [data-nb=dark] in the bundle. */
  const root = document.documentElement;
  const hadDark = root.classList.contains("dark");
  if (theme === "dark") {
    root.classList.add("dark");
    frame.contentDocument.documentElement.setAttribute("data-nb", "dark");
  } else {
    root.classList.remove("dark");
    frame.contentDocument.documentElement.removeAttribute("data-nb");
  }
  await new Promise((r) => setTimeout(r, 250));

  /* Both sides count descendants of .ds-diff-root, so the wrapper itself is
     not on one side only. */
  const a = [...host.querySelectorAll(".ds-diff-root *")];
  const b = [...frame.contentDocument.querySelectorAll(".ds-diff-root *")];

  if (a.length !== b.length) {
    cleanup();
    return "ABORTED — " + a.length + " elements here vs " + b.length +
      " in the reference. The fixture rendered differently on the two sides; " +
      "check for markup the app's own scripts rewrote.";
  }

  const lines = [];
  let suppressed = 0;
  const appOnly = new Set();
  const appOnlyClasses = new Set(
    [...host.querySelectorAll("[class]")].flatMap((el) =>
      [...el.classList].filter((c) => c.startsWith("nb-") && !DEFINED.has(c)))
  );
  let skipped = 0;
  for (let i = 0; i < a.length; i++) {
    /* An element is comparable only if it carries a class the bundle defines.
       App-only classes, and the bare elements nested inside them, inherit from
       a parent that has no counterpart — diffing those reports the absence of
       a rule, not a defect. */
    const own = [...a[i].classList].filter((c) => c.startsWith("nb-"));
    const undefinedHere = own.filter((c) => !DEFINED.has(c));
    /* An app-only container lays its children out differently from anything in
       the reference — the app's rail makes the agenda 358px narrower, and every
       width below it follows. So comparability is inherited: an element inside
       a class the bundle does not define is not measurable against it. */
    const inAppOnly = ancestorsOf(a[i]).some((el) =>
      el.classList.contains("ds-diff-app-only") ||
      [...el.classList].some((c) => c.startsWith("nb-") && !DEFINED.has(c)));
    /* A classless element inside a comparable container IS comparable — the
       agenda's <h3> carries no class of its own, and a missing heading
       line-height is exactly the kind of bug this exists to catch. Only an
       app-only class, on the element or above it, makes one incomparable. */
    if (undefinedHere.length || inAppOnly) {
      undefinedHere.forEach((c) => appOnly.add(c));
      skipped++;
      continue;
    }
    const app = snap(a[i]);
    const proto = snap(b[i]);
    const bad = [];
    for (const p of PROPS) {
      if (String(proto[p]) === String(app[p])) continue;
      if (!all && SUPPRESS.some((f) => f(p, proto[p], app[p]))) { suppressed++; continue; }
      bad.push("    " + p + ": proto " + proto[p] + "  →  app " + app[p]);
    }
    /* Height is where a leading or padding error shows. Width is text-measured
       and drifts a few px with the font stack, so it needs a looser bar. A
       container holding app-only markup aggregates heights that have no
       counterpart, so its own box says nothing. */
    const appOnlySel = [".ds-diff-app-only", ...[...appOnlyClasses].map((c) => "." + c)].join(",");
    /* Also true when a *sibling* holds app-only markup: grid row-mates share a
       height, and a taller event cell stretches the time cell beside it. */
    const holdsAppOnly = a[i].querySelector(appOnlySel) || a[i].parentElement?.querySelector(appOnlySel);
    if (!holdsAppOnly && (Math.abs(proto.__h - app.__h) > 2 || Math.abs(proto.__w - app.__w) > 12)) {
      bad.push("    box: proto " + proto.__w + "×" + proto.__h + "  →  app " + app.__w + "×" + app.__h);
    }
    if (bad.length) lines.push("  " + label(a[i], i) + "\n" + bad.join("\n"));
  }

  const scrollW = document.documentElement.scrollWidth;
  cleanup();
  if (!hadDark) root.classList.remove("dark"); else root.classList.add("dark");

  const head = theme + " @ " + width + "px · " + a.length + " elements, " +
    (a.length - skipped) + " comparable · " +
    (suppressed ? suppressed + " app-wide deltas suppressed (run({all:true}) to see them)" : "nothing suppressed") +
    (appOnly.size ? "\n  not in the bundle, so not compared: " + [...appOnly].sort().join(" ") : "") +
    (scrollW > width ? "\n  WARNING: page scrolls horizontally (" + scrollW + "px)" : "");

  return lines.length ? head + "\n\n" + lines.join("\n") : head + "\n\n  no unexplained differences";

  function cleanup() {
    document.getElementById(HOST_ID)?.remove();
    document.getElementById(FRAME_ID)?.remove();
  }
}
`;
}
