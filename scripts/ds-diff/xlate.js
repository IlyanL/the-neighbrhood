/* Class-vs-inline translation check.
 *
 * ds-diff measures the *prototype's* markup under the app's cascade. It cannot
 * see the app's own classes, because the bundle draws these screens with inline
 * styles and defines no class to compare them to. This does the other half:
 * renders the prototype's inline markup and the app's class markup side by side
 * in the same live page, walks both trees in parallel and reports every
 * computed property that differs. Same idea as the harness the tutorProfile
 * pass used to find four wrong margins.
 */
const PROPS = ["display","gridTemplateColumns","flexDirection","fontSize","fontWeight",
  "letterSpacing","lineHeight","color","backgroundColor","padding","margin","borderRadius",
  "borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth","borderColor",
  "gap","textAlign","justifyContent","alignItems","flexWrap","position","overflow",
  "textTransform","fontVariantNumeric","maxWidth","minWidth","flexBasis","flexGrow"];

function snap(el) {
  const cs = getComputedStyle(el), o = {};
  for (const p of PROPS) o[p] = cs[p];
  const r = el.getBoundingClientRect();
  o.__w = Math.round(r.width); o.__h = Math.round(r.height);
  return o;
}
const near = (a, b, t) => {
  const n = (v) => (String(v).match(/-?[\d.]+/g) || []).map(Number);
  const x = n(a), y = n(b);
  return x.length && x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) <= t);
};

export async function run(name = "this screen", opts = {}) {
  const { all = false, width = 1440 } = opts;
  if (innerWidth !== width) return "ABORTED — viewport is " + innerWidth + "px, expected " + width;
  document.querySelectorAll(".xlate-host").forEach((n) => n.remove());
  const [pHtml, aHtml] = await Promise.all([
    fetch("/__ds-diff/xlate-proto.html?n=" + name + "&t=" + Date.now()).then((r) => r.text()),
    fetch("/__ds-diff/xlate-app.html?n=" + name + "&t=" + Date.now()).then((r) => r.text()),
  ]);
  const mk = (html) => {
    const d = document.createElement("div");
    d.className = "xlate-host";
    d.style.cssText = "position:fixed;left:0;top:0;width:" + width + "px;z-index:99999;overflow:hidden;height:1px;background:var(--surface-page)";
    d.innerHTML = '<div class="xr">' + html + "</div>";
    document.body.appendChild(d);
    return d;
  };
  const P = mk(pHtml), A = mk(aHtml);
  await new Promise((r) => setTimeout(r, 250));
  const a = [...P.querySelectorAll(".xr *")], b = [...A.querySelectorAll(".xr *")];
  if (a.length !== b.length) { P.remove(); A.remove(); return "ABORTED — " + a.length + " proto elements vs " + b.length + " app elements"; }
  const lines = [];
  let quiet = 0;
  for (let i = 0; i < a.length; i++) {
    const p = snap(a[i]), q = snap(b[i]);
    const bad = [];
    for (const k of PROPS) {
      if (String(p[k]) === String(q[k])) continue;
      if (!all && /color/i.test(k) && near(p[k], q[k], 1)) { quiet++; continue; }
      if (!all && k === "lineHeight" && near(p[k], q[k], 0.6)) { quiet++; continue; }
      if (!all && k === "margin" && (String(p[k]).includes(".") || String(q[k]).includes("."))) { quiet++; continue; }
      bad.push("    " + k + ": proto " + p[k] + "  →  app " + q[k]);
    }
    if (Math.abs(p.__h - q.__h) > 1 || Math.abs(p.__w - q.__w) > 1) bad.push("    box: proto " + p.__w + "×" + p.__h + "  →  app " + q.__w + "×" + q.__h);
    if (bad.length) {
      const cls = [...b[i].classList].join(".");
      lines.push("  " + (cls ? "." + cls : b[i].tagName.toLowerCase()) + "#" + i + "\n" + bad.join("\n"));
    }
  }
  P.remove(); A.remove();
  const head = name + " · " + a.length + " element pairs · " + quiet + " sub-pixel deltas quieted";
  return lines.length ? head + "\n\n" + lines.join("\n") : head + "\n\n  identical";
}
