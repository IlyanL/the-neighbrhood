"use client";

/**
 * The chrome every screen renders inside — the handoff's `_shared-chrome.html`.
 *
 * Structure, from that file:
 *
 *   <div class="nb-stage">                     165deg plum, --spectrum-4 → --spectrum-deep-7
 *     <div class="nb-nav nb-nav--onstage">     brand · links · actions, 64px, in flow
 *     <div class="nb-stagehead">               eyebrow · h1 · lede · search   (optional)
 *   <SpectrumRail />                           the 2px rail + its glow
 *
 * The header block is deliberately optional: the handoff's own template gates
 * it behind `{{ hasHeader }}`, so a screen that has not been through the
 * redesign yet renders the nav on the stage and keeps its existing in-page
 * header, rather than showing two titles.
 */

import type React from "react";
import { useEffect, useRef } from "react";
import type { ViewName } from "@/app/components/product-navigation";
import { NbAvatar, NbButton, NbIcon, NbSearchField, NbSpectrumRail } from "@/app/components/nb";

/* The six links, in the handoff's order. `Tutors` points at the tutor
   directory; the app's own tutoring sub-navigation (Sessions, Tutor profile)
   stays where it is, as the handoff's on-stage sub-tab row. */
export const NB_NAV: Array<{ label: string; view: ViewName }> = [
  { label: "Home", view: "Home" },
  { label: "Explore", view: "Explore" },
  { label: "Tutors", view: "View Tutors" },
  { label: "Courses", view: "Courses" },
  { label: "Clubs", view: "Clubs" },
  { label: "Housing", view: "Housing" },
];

/* Which nav link reads as current for a given view. Taken from the handoff's
   NAV_CURRENT, extended to the views the prototype has no screen for
   (Settings and Contact Us sit under Home, as Profile does). */
const NAV_CURRENT: Record<ViewName, string> = {
  Home: "Home",
  Explore: "Explore",
  "View Tutors": "Tutors",
  Courses: "Courses",
  Clubs: "Clubs",
  Housing: "Housing",
  Profile: "Home",
  "Tutor Profile": "Tutors",
  Settings: "Home",
  "My Sessions": "Tutors",
  Chat: "Home",
  "Contact Us": "Home",
  Admin: "Home",
};

export type NbStageHeader = {
  eyebrow: string;
  /* A heading may carry exactly one gradient-clipped phrase — pass it as an
     <em>; `.nb-stagehead h1 em` does the clipping. */
  heading: React.ReactNode;
  lede: string;
  search?: { placeholder: string; value: string; onChange: React.ChangeEventHandler<HTMLInputElement> };
  back?: { label: string; onBack: () => void };
  subTabs?: Array<{ label: string; selected: boolean; onSelect: () => void; ariaLabel?: string }>;
  subTabsLabel?: string;
};

export function NbStage({ view, header, actions, goTo, children }: {
  view: ViewName;
  header?: NbStageHeader;
  actions: React.ReactNode;
  goTo: (view: ViewName) => void;
  children?: React.ReactNode;
}) {
  const current = NAV_CURRENT[view];
  const searchField = useRef<HTMLInputElement>(null);

  /* The field advertises ⌘ K, so it has to answer to it. */
  useEffect(() => {
    if (!header?.search) return;
    function focusSearch(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      searchField.current?.focus();
      searchField.current?.select();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [header?.search]);

  return (
    <>
      <div className="nb-stage" style={{ position: "relative", background: "linear-gradient(165deg, var(--spectrum-4) 0%, var(--spectrum-deep-7) 100%)", color: "#fff" }}>
        <div className="nb-nav nb-nav--onstage" style={{ position: "relative" }}>
          <button type="button" className="nb-nav__brand" onClick={() => goTo("Home")} aria-label="The Neighbrhood home">
            <i className="nb-nav__mark" />The Neighbrhood
          </button>
          <nav className="nb-nav__links" aria-label="Primary navigation">
            {NB_NAV.map((link) => (
              <button key={link.label} type="button" data-cur={link.label === current ? "" : undefined} aria-current={link.label === current ? "page" : undefined} onClick={() => goTo(link.view)}>{link.label}</button>
            ))}
          </nav>
          <div className="nb-nav__actions">{actions}</div>
        </div>

        {header && (
          <div className="nb-pad nb-stagehead">
            {header.subTabs && header.subTabs.length > 0 && (
              <div role="tablist" aria-label={header.subTabsLabel ?? "Sections"} className="nb-stagehead__subtabs">
                {header.subTabs.map((tab) => (
                  <NbButton key={tab.label} role="tab" aria-selected={tab.selected} variant={tab.selected ? "solid" : "onstage"} size="sm" style={{ borderRadius: 100 }} onClick={tab.onSelect}>{tab.label}</NbButton>
                ))}
              </div>
            )}
            {header.back && <NbButton variant="onstage" size="sm" style={{ marginBottom: 20 }} onClick={header.back.onBack}>{header.back.label}</NbButton>}
            <p className="nb-stagehead__eyebrow">{header.eyebrow}</p>
            <h1>{header.heading}</h1>
            <p className="nb-stagehead__lede">{header.lede}</p>
            {header.search && (
              <NbSearchField placeholder={header.search.placeholder} value={header.search.value} onChange={header.search.onChange} inputRef={searchField} label="Search The Neighbrhood" />
            )}
          </div>
        )}
        {children}
      </div>
      <NbSpectrumRail />
    </>
  );
}

/* --------------------------------------------------------------------------
   The two action clusters.

   Signed in, the handoff shows messages · notifications · avatar. This app
   also has global search, a create menu, a theme toggle and an admin panel,
   none of which the prototype draws — they are rendered here in the same
   idiom (36px on-stage icon buttons using glyphs from the nine-glyph set, and
   one on-stage text button) rather than dropped.
   ----------------------------------------------------------------------- */
export function NbIconAction({ label, glyph, badge = false, onClick, ariaExpanded, style }: {
  label: string;
  glyph: React.ReactNode;
  badge?: boolean;
  onClick: () => void;
  ariaExpanded?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      className="nb-btn nb-btn--onstage nb-btn--sm"
      style={{ position: "relative", width: 36, height: 36, padding: 0, justifyContent: "center", ...style }}
      aria-label={label}
      aria-expanded={ariaExpanded}
      onClick={onClick}
    >
      {glyph}
      {badge && <i style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: 100, background: "var(--attention)", border: "1.5px solid var(--spectrum-4)" }} />}
    </button>
  );
}

/* The messages and notification glyphs are the two the handoff draws inline in
   `_shared-chrome.html` rather than pulling from the icon set, so they are
   inlined here at the same weights. */
export const NB_MESSAGES_GLYPH = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 14.5A2.5 2.5 0 0 1 17.5 17H8l-4 3.5V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5z" /></svg>
);

export const NB_BELL_GLYPH = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9" /><path d="M10.4 19.5a2 2 0 0 0 3.2 0" /></svg>
);

export function NbStageAvatar({ initials, onClick, ariaExpanded }: { initials: string; onClick: () => void; ariaExpanded?: boolean }) {
  return (
    <NbAvatar
      small
      role="button"
      tabIndex={0}
      aria-haspopup="menu"
      aria-expanded={ariaExpanded}
      aria-label="Open account menu"
      style={{ background: "rgba(255,255,255,.18)", color: "#fff", cursor: "pointer" }}
      onClick={onClick}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); } }}
    >
      {initials}
    </NbAvatar>
  );
}

export function NbGuestActions({ onSignIn, onJoin }: { onSignIn: () => void; onJoin: () => void }) {
  return (
    <>
      <NbButton variant="onstage" size="sm" onClick={onSignIn}>Sign in</NbButton>
      <NbButton variant="solid" size="sm" onClick={onJoin}>Join</NbButton>
    </>
  );
}

export function NbSunAction({ onClick }: { onClick: () => void }) {
  return <NbIconAction label="Switch theme" glyph={<NbIcon name="sun" size={18} />} onClick={onClick} />;
}

/* --------------------------------------------------------------------------
   The account menu.

   The prototype draws no menu at all — its avatar navigates straight to the
   profile — so this is one of the four app affordances §4 of the handoff keeps
   rather than dropping to match the drawing. It renders on `.nb-acct`, the DS
   floating layer, and owns its own outside-click dismissal: Escape is handled
   once for every shell overlay in `app/page.tsx`, but nothing there closed a
   menu on a click elsewhere in the page.

   `open` is lifted rather than local because the three nav popovers are
   mutually exclusive and the page closes all of them on `goTo`.
   ----------------------------------------------------------------------- */
export type NbAccountMenuItem = { label: string; onSelect: () => void };

export function NbAccountMenu({ initials, name, email, items, signOut, open, onOpenChange }: {
  initials: string;
  name: string;
  email: string;
  items: NbAccountMenuItem[];
  signOut: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function dismissOnOutsideClick(event: PointerEvent) {
      if (anchor.current?.contains(event.target as Node)) return;
      onOpenChange(false);
    }
    document.addEventListener("pointerdown", dismissOnOutsideClick);
    return () => document.removeEventListener("pointerdown", dismissOnOutsideClick);
  }, [open, onOpenChange]);

  return (
    <div className="global-action-anchor" ref={anchor}>
      <NbStageAvatar initials={initials} ariaExpanded={open} onClick={() => onOpenChange(!open)} />
      {open && (
        <div className="nb-acct" role="menu" aria-label="Your account">
          <div className="nb-acct__id">
            <NbAvatar small aria-hidden="true">{initials}</NbAvatar>
            <span className="nb-acct__who">
              <span className="nb-acct__name">{name}</span>
              <span className="nb-acct__mail">{email}</span>
            </span>
          </div>
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" className="nb-acct__item" onClick={() => { onOpenChange(false); item.onSelect(); }}>
              {item.label}
              <NbIcon name="arrow-right" size={15} />
            </button>
          ))}
          <button type="button" role="menuitem" className="nb-acct__item nb-acct__out" onClick={() => { onOpenChange(false); signOut(); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
