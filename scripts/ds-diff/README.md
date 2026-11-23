# ds-diff

Compares a redesigned screen against the handoff prototype **by computed
style**. Screenshots hide line-height and gutter errors; this catches them.

```bash
node scripts/ds-diff/ds-diff.mjs sessions   # build the harness
```

Then in the Browser pane, viewport at 1440, on any dev-server page:

```js
await (await import('/__ds-diff/probe.js')).run()
await (await import('/__ds-diff/probe.js')).run({ theme: 'dark' })
await (await import('/__ds-diff/probe.js')).run({ all: true })   // show suppressed
node scripts/ds-diff/ds-diff.mjs --clean     # when you are done
```

Output is a few hundred tokens. That is the point — doing this by hand costs
tens of thousands and is easy to get subtly wrong.

## Adding a screen

Write `fixtures/<screen>.html`: plain markup using that screen's `nb-*`
classes, exercising each state once. **The bundle's own `screens/*.html`
cannot be used** — their content comes from `<x-import>` and `<sc-for>`, which
render nothing.

Put anything using an app-only class (`.nb-railcard`, `.nb-agenda__drawer`, …)
inside a trailing `<div class="ds-diff-app-only">`. Never wrap compared markup
in an app-only container: it changes the geometry of everything inside, and
those elements stop being measurable.

## The class-vs-inline pair

The bundle draws several screens (`courses`, `profile`, `admin`, `policy`, and
`payment`/`auth` after them) almost entirely with **inline styles**, so it
defines no class for the probe above to compare the app's markup against. Those
screens get a second fixture, `fixtures/<screen>.xlate.html`, holding both trees
in one file:

```
<!-- the prototype's inline markup -->
<!--XLATE-SPLIT-->
<!-- the markup the app actually renders, on its nb-* classes -->
```

Both are laid out in the live page and diffed element for element:

```js
await (await import('/__ds-diff/xlate.js')).run('profile')
```

The trees must have the same element count and order. What this catches, and the
other probe cannot: a class whose value drifted from the drawing. On `profile`
it found five in one run — `.nb-id__block p` beating `.nb-panel__tag`'s
specificity, a 16px link margin the prototype draws at 9, `display: block` on an
inline label, a `min-width: 0` leaking onto the action column, and (via
`policy`) `.nb-panel__title` carrying display leading on a `<p>`.

**Reading the output:** "proto" is the inline tree *under the app's cascade*, so
it inherits the app's body 16px/1.5 and its letter-spacing. "app" is your
classes. A residue of `lineHeight: proto 22.5px → app 23.25px` and
`letterSpacing: proto -0.192px → app normal` means your class is restating the
bundle's own value where the bare markup inherits the app's — that is the app
side being **more** correct, not a defect. Anything else is yours.

## What it does and does not compare

Compared: elements carrying a class the bundle defines, plus their classless
descendants (the agenda's `<h3>` has no class, and its missing heading
line-height was a real bug).

Not compared: anything with an app-only class, or inside one. Those have no
counterpart in the reference — reporting them means reporting the absence of a
rule, not a defect. They are listed by name in the summary.

Suppressed by default, all verified as app-wide and understood:

- the app never ported the bundle's `tokens/base.css`, so its body is
  Tailwind's 16px/1.5 against the handoff's 14px/1.55
- font stacks resolve to the same faces through different fallback lists, and
  text-measured widths move a few px with them
- identical hex computing one rgb step apart, because several colours
  round-trip through oklch in `globals.css`
- auto margins, which resolve against those text widths

**Known residue:** one bare `<strong>` in the sessions fixture reports a 3px
height delta. It is the body-leading deviation above, surfacing as a box rather
than a property. Left visible on purpose — widening the filter to hide it would
also hide a real one-step leading error.

## Validated

Reverting the two fixes this harness was built from — the agenda `<h3>`
line-height and `letter-spacing: normal` on `.nb-btn` — makes it report both.
Re-run that fault injection if you change the filters.
