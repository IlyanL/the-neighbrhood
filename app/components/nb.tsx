/**
 * The Neighbrhood Design System primitives, as React.
 *
 * One component per specimen in the handoff's `_ds/…/components/` folder, each
 * rendering the same markup the handoff's own `.jsx` renders and taking its
 * styling from `app/components/neighbrhood-ds.css`. Screens compose these
 * rather than repeating the classes, which is what makes "the same button
 * everywhere" hold as more screens land.
 *
 * These are the one thing allowed to cross the app's Tailwind/CSS-Modules line
 * (AGENTS.md): `app/page.tsx` is Tailwind, `app/components/phase-two.tsx` is
 * CSS Modules, and both render these.
 */
"use client";

import NextImage from "next/image";
import { useState } from "react";
import type React from "react";

/* --------------------------------------------------------------------------
   Icon — the whole set is nine glyphs, copied from the handoff's
   `assets/icons/`. 24x24, fill none, stroke currentColor, round caps. Stroke
   weights are per-glyph and deliberate: 1.3 for the photo frame, 1.7 for the
   category glyphs and search/check, 2.2 for the forward arrow. Do not add to
   this set — the handoff is explicit that a tenth glyph is a design decision,
   not an implementation one.
   ----------------------------------------------------------------------- */
export type NbIconName = "image" | "arrow-right" | "book" | "chat" | "calendar" | "house" | "search" | "check" | "sun";

const ICON_PATHS: Record<NbIconName, { weight: number; paths: React.ReactNode }> = {
  image: { weight: 1.3, paths: <><rect x="3.5" y="5.5" width="17" height="13" rx="2.2" /><circle cx="8.8" cy="10.2" r="1.5" /><path d="m4.6 16.4 4.3-4 3.1 2.6 3-2.4 4.4 3.8" /></> },
  "arrow-right": { weight: 2.2, paths: <path d="M5 12h13M12.5 6l6 6-6 6" /> },
  book: { weight: 1.7, paths: <><path d="M12 6.6C9.4 5 6.7 4.7 4 5.3v12.2c2.7-.6 5.4-.3 8 1.3" /><path d="M12 6.6c2.6-1.6 5.3-1.9 8-1.3v12.2c-2.7-.6-5.4-.3-8 1.3" /><path d="M12 6.6v12.2" /></> },
  chat: { weight: 1.7, paths: <><path d="M4.5 5.5h15v10h-9l-6 4.2z" /><path d="M8.5 9.5h7M8.5 12.5h4.5" /></> },
  calendar: { weight: 1.7, paths: <><rect x="3.8" y="5.4" width="16.4" height="14.4" rx="2.4" /><path d="M3.8 10.2h16.4M8.4 3.4v3.4M15.6 3.4v3.4" /></> },
  house: { weight: 1.7, paths: <><path d="M3.6 11.2 12 4.3l8.4 6.9" /><path d="M5.9 10.4v9.4h12.2v-9.4" /><path d="M10 19.8v-5.2h4v5.2" /></> },
  search: { weight: 1.7, paths: <><circle cx="11" cy="11" r="6.4" /><path d="m16 16 4 4" /></> },
  check: { weight: 1.7, paths: <path d="m4.8 12.4 4.6 4.6 9.8-10" /> },
  sun: { weight: 1.8, paths: <><circle cx="12" cy="12" r="4.2" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></> },
};

export function NbIcon({ name, size = 19, strokeWidth, style }: { name: NbIconName; size?: number; strokeWidth?: number; style?: React.CSSProperties }) {
  const { weight, paths } = ICON_PATHS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth ?? weight} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block", flex: "0 0 auto", ...style }}>
      {paths}
    </svg>
  );
}

/* --------------------------------------------------------------------------
   Button. Ghost by default; `solid` is the plum gradient with the one shadow
   the system allows under a button; `fill` takes a door's own colour.
   ----------------------------------------------------------------------- */
type NbButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ghost" | "solid" | "fill" | "onstage";
  size?: "sm" | "md" | "lg";
  door?: string;
  tint?: string;
};

export function NbButton({ variant = "ghost", size = "md", door, tint, className = "", style, children, type = "button", ...rest }: NbButtonProps) {
  const classes = ["nb-btn"];
  if (variant === "solid") classes.push("nb-btn--solid");
  if (variant === "fill") classes.push("nb-btn--fill");
  if (variant === "onstage") classes.push("nb-btn--onstage");
  if (size === "sm") classes.push("nb-btn--sm");
  if (size === "lg") classes.push("nb-btn--lg");
  if (className) classes.push(className);
  return (
    <button type={type} className={classes.join(" ")} style={{ ...(door ? { "--nb-door": door } : null), ...(tint ? { "--nb-tint": tint } : null), ...style } as React.CSSProperties} {...rest}>
      {children}
    </button>
  );
}

export function NbPill({ tone = "plum", className = "", children, ...rest }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "plum" | "attention" | "flat" }) {
  return <span className={`nb-pill nb-pill--${tone}${className ? ` ${className}` : ""}`} {...rest}>{children}</span>;
}

export function NbChipRow({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`nb-chips${className ? ` ${className}` : ""}`} style={style}>{children}</div>;
}

export function NbChip({ current = false, className = "", children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { current?: boolean }) {
  return <button type="button" className={`nb-chip${current ? " nb-chip--current" : ""}${className ? ` ${className}` : ""}`} aria-pressed={current} {...rest}>{children}</button>;
}

export function NbTag({ children }: { children: React.ReactNode }) {
  return <span className="nb-tag">{children}</span>;
}

export function NbTagRow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="nb-tags" style={style}>{children}</div>;
}

export function NbAvatar({ small = false, className = "", style, children, ...rest }: React.HTMLAttributes<HTMLSpanElement> & { small?: boolean }) {
  return <span className={`nb-avatar${small ? " nb-avatar--sm" : ""}${className ? ` ${className}` : ""}`} style={style} {...rest}>{children}</span>;
}

/* Not a handoff specimen — a small utility for values a visitor is likely to
   retype elsewhere (a classroom link, an email, an address). Swaps to the
   existing `check` glyph for ~1.5s after a successful copy rather than adding
   a tenth icon to the set above. */
export function NbCopyButton({ value, label, className = "", style }: { value: string; label: string; className?: string; style?: React.CSSProperties }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`nb-copybtn${className ? ` ${className}` : ""}`}
      style={style}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* Clipboard permission denied or unavailable — nothing to recover, the button just won't confirm. */
        }
      }}
    >
      {copied ? (
        <NbIcon name="check" size={14} strokeWidth={2} />
      ) : (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block", flex: "0 0 auto" }}>
          <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" />
          <path d="M5.5 15.5V6.7A2.2 2.2 0 0 1 7.7 4.5h8.8" />
        </svg>
      )}
    </button>
  );
}

/* The search field is a <label> wrapping the input, so the whole capsule is
   the hit target. The ⌘ K hint is the only place the system uses Unicode as
   an icon. */
export function NbSearchField({ placeholder, value, onChange, inputRef, shortcut = "⌘ K", label, style }: {
  placeholder: string;
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  inputRef?: React.Ref<HTMLInputElement>;
  shortcut?: string | null;
  label?: string;
  style?: React.CSSProperties;
}) {
  return (
    <label className="nb-field" style={style}>
      <NbIcon name="search" size={19} />
      <input ref={inputRef} placeholder={placeholder} aria-label={label ?? placeholder} value={value} onChange={onChange} />
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </label>
  );
}

/* --------------------------------------------------------------------------
   The spectrum rail: the wall's light distilled into 2px, with a glow that
   takes no layout space so whatever follows is pulled up over it.
   ----------------------------------------------------------------------- */
export function NbSpectrumRail({ glow = true }: { glow?: boolean }) {
  return (
    <>
      <div className="nb-rail" aria-hidden="true" />
      {glow ? <div className="nb-railglow" aria-hidden="true" /> : null}
    </>
  );
}

export function NbSectionHeader({ title, count, action, onAction }: { title: string; count?: string; action?: string; onAction?: () => void }) {
  return (
    <header className="nb-sec__head">
      <h2>{title}</h2>
      {count ? <span className="nb-sec__count">{count}</span> : null}
      {action && onAction ? (
        <button type="button" onClick={onAction}>{action}<NbIcon name="arrow-right" size={13} /></button>
      ) : null}
    </header>
  );
}

export function NbSection({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <section className="nb-sec" style={style}>{children}</section>;
}

/* --------------------------------------------------------------------------
   ContentCard — the index card used across Explore. A 96px band of flat
   category colour with a tracked-out label stands in for the screenshot the
   system deliberately does not have.
   ----------------------------------------------------------------------- */
export function NbContentCard({ media, image, mediaLabel, title, sub, meta, price, onClick }: {
  media: string;
  image?: string | null;
  mediaLabel: string;
  title: string;
  sub?: string;
  meta?: React.ReactNode;
  price?: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="nb-card" style={{ "--nb-media": media } as React.CSSProperties} onClick={onClick}>
      <div className="nb-card__media" data-photo={image ? "" : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image ? <img src={image} alt="" loading="lazy" decoding="async" /> : null}
        <span>{mediaLabel}</span>
      </div>
      <div className="nb-card__body">
        <h3>{title}</h3>
        {sub ? <p className="nb-card__sub">{sub}</p> : null}
        {meta || price ? (
          <div className="nb-card__row">
            {meta}
            {price ? <span className="nb-card__price">{price}</span> : null}
          </div>
        ) : null}
      </div>
    </button>
  );
}

export function NbCardGrid({ children }: { children: React.ReactNode }) {
  return <div className="nb-cards">{children}</div>;
}

/* --------------------------------------------------------------------------
   TutorCard / TutorGrid. The handoff's card: avatar, standing line, rate,
   course tags, bio, then a footer carrying the next open
   hour and Book. `footLead` is the one extension point — the app has a saved
   affordance the prototype does not draw, and it goes there rather than
   forking the card.
   ----------------------------------------------------------------------- */
export function NbTutorCard({ name, initials, photoUrl, year, rate, courses = [], bio, nextFree, bookLabel = "Book", onBook, footLead }: {
  name: string;
  initials: string;
  photoUrl?: string | null;
  year?: string;
  rate: string;
  courses?: string[];
  bio?: string;
  nextFree?: string;
  bookLabel?: string;
  onBook?: () => void;
  footLead?: React.ReactNode;
}) {
  return (
    <article className="nb-tutor">
      <div className="nb-tutor__who">
        <NbAvatar>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photoUrl ? <img src={photoUrl} alt="" loading="lazy" decoding="async" /> : initials}
        </NbAvatar>
        <div>
          <h3>{name}</h3>
          {year && <p className="nb-tutor__year">{year}</p>}
        </div>
        <span className="nb-tutor__rate"><b>{rate}</b><span>per hour</span></span>
      </div>
      {courses.length > 0 && <NbTagRow>{courses.map((course) => <NbTag key={course}>{course}</NbTag>)}</NbTagRow>}
      {bio && <p className="nb-tutor__bio">{bio}</p>}
      <div className="nb-tutor__foot">
        {footLead}
        {nextFree && <span className="nb-tutor__next">{nextFree}</span>}
        <NbButton variant="solid" size="sm" onClick={onBook}>{bookLabel}</NbButton>
      </div>
    </article>
  );
}

export function NbTutorGrid({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="nb-tutors" style={style}>{children}</div>;
}

/* --------------------------------------------------------------------------
   DoorCard. Compact (132px, no blurb) is the variant Home and Explore use;
   the full one carries the blurb and is for the signed-out pitch.
   ----------------------------------------------------------------------- */
export function NbDoorCard({ icon, title, blurb, count, color, textColor, compact = false, onClick }: {
  icon: NbIconName;
  title: string;
  blurb?: string;
  count?: string;
  color: string;
  textColor: string;
  compact?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="nb-door"
      style={{ "--nb-door-color": color, "--nb-door-text": textColor, ...(compact ? { minHeight: 132 } : null) } as React.CSSProperties}
      onClick={onClick}
    >
      <span className="nb-door__glyph"><NbIcon name={icon} size={19} /></span>
      <h3>{title}</h3>
      {blurb && !compact ? <p>{blurb}</p> : null}
      {count ? <span className="nb-door__count">{count}<NbIcon name="arrow-right" size={13} /></span> : null}
    </button>
  );
}

export function NbDoorRow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="nb-doors" style={style}>{children}</div>;
}

export function NbFooter({ left, right, bare = false }: { left: React.ReactNode; right: React.ReactNode; bare?: boolean }) {
  return (
    <div className={`nb-foot${bare ? " nb-foot--bare" : ""}`}>
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

/* --------------------------------------------------------------------------
   RunPanel — the handoff's "run your own X" pitch panel: a door-coloured mark
   and kicker, a headline, a lede, numbered steps, then a door-filled button
   and a note. Clubs is the only screen that draws one.
   ----------------------------------------------------------------------- */
export function NbRunPanel({ icon, kicker, title, lede, steps, action, note, color, textColor, tint, onAction }: {
  icon: NbIconName;
  kicker: string;
  title: string;
  lede: string;
  steps: Array<{ title: string; body: string }>;
  action?: string;
  note?: string;
  color: string;
  textColor: string;
  tint: string;
  onAction?: () => void;
}) {
  return (
    <div className="nb-run" style={{ "--nb-door-color": color, "--nb-door-text": textColor, "--nb-tint": tint } as React.CSSProperties}>
      <div className="nb-run__head">
        <span className="nb-run__mark"><NbIcon name={icon} size={19} /></span>
        <span className="nb-run__kicker">{kicker}</span>
      </div>
      <h3>{title}</h3>
      <p className="nb-run__lede">{lede}</p>
      <ol>
        {steps.map((step, index) => (
          <li key={step.title}>
            <i>{index + 1}</i>
            <span><b>{step.title}</b><span>{step.body}</span></span>
          </li>
        ))}
      </ol>
      {action || note ? (
        <div className="nb-run__end">
          {action ? <NbButton variant="fill" door={color} tint={tint} onClick={onAction}>{action}</NbButton> : null}
          {note ? <small>{note}</small> : null}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Tabs and the agenda — the sessions screen.

   The handoff ships these as two React components (`TabBar` and `Agenda`),
   the second taking a flat `items` array of title/body/actions. The live
   screen's events are far richer than that array can carry — a reschedule
   picker, two confirm prompts and a file dock all open inside one event — so
   the agenda is ported as composition instead: the same markup and the same
   class names, with the event's contents passed as children.
   ----------------------------------------------------------------------- */
export function NbTabs({ label, tabs, end }: {
  label: string;
  tabs: Array<{ label: string; count?: number; current: boolean; onSelect: () => void }>;
  end?: React.ReactNode;
}) {
  return (
    <div className="nb-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.label}
          type="button"
          role="tab"
          aria-selected={tab.current}
          data-cur={tab.current ? "" : undefined}
          onClick={tab.onSelect}
        >
          {tab.label}{typeof tab.count === "number" ? <b>{tab.count}</b> : null}
        </button>
      ))}
      {end ? <div className="nb-tabs__end">{end}</div> : null}
    </div>
  );
}

/* `.nb-agenda` is a two-column grid and its time/event pairs are its direct
   children, so an item must not be wrapped in an element of its own. Render
   each pair inside a fragment. */
export function NbAgenda({ children }: { children: React.ReactNode }) {
  return <div className="nb-agenda">{children}</div>;
}

export function NbAgendaNow({ children }: { children: React.ReactNode }) {
  return <div className="nb-agenda__now">{children}</div>;
}

export function NbAgendaTime({ date, time, length }: { date: string; time: string; length: string }) {
  return (
    <div className="nb-agenda__time">
      <div className="d">{date}</div>
      <div className="h">{time}</div>
      <div className="l">{length}</div>
    </div>
  );
}

export function NbAgendaEvent({ id, status, statusTone = "flat", statusColor, context, title, focused = false, past = false, children }: {
  id?: string;
  status?: React.ReactNode;
  statusTone?: "plum" | "attention" | "flat";
  /* Paints the dot straddling the time rail. The stylesheet falls back to the
     accent when it is not set. */
  statusColor?: string;
  context: React.ReactNode;
  title: React.ReactNode;
  focused?: boolean;
  past?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      id={id}
      className="nb-agenda__ev"
      data-focused={focused ? "true" : undefined}
      data-past={past ? "true" : undefined}
      style={statusColor ? ({ "--nb-status": statusColor } as React.CSSProperties) : undefined}
    >
      {status ? <NbPill tone={statusTone} className="nb-agenda__status">{status}</NbPill> : null}
      <span className="nb-agenda__code">{context}</span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function NbAgendaActions({ children }: { children: React.ReactNode }) {
  return <div className="nb-agenda__acts">{children}</div>;
}

/* --------------------------------------------------------------------------
   The tutor-account set: the panels, photo block, labelled fields and
   label/value rows the "Become a tutor" application and the tutor's own card
   are built from. The prototype draws both screens with inline styles rather
   than DS classes, so these are the app's own wrappers over the class names
   added for them in `neighbrhood-ds.css`.
   ----------------------------------------------------------------------- */
export function NbPanel({ aside = false, className = "", children }: { aside?: boolean; className?: string; children: React.ReactNode }) {
  return <div className={`nb-panel${aside ? " nb-panel--aside" : ""}${className ? ` ${className}` : ""}`}>{children}</div>;
}

/* Two eyebrows on purpose: `tag` is the tighter .05em one the tutor card and
   the availability panel use, the default the wide .2em application one. */
export function NbPanelHead({ eyebrow, tag = false, muted = false, heading, gap = false }: {
  eyebrow: string;
  tag?: boolean;
  muted?: boolean;
  heading: React.ReactNode;
  gap?: boolean;
}) {
  return (
    <>
      <p className={tag ? `nb-panel__tag${muted ? " nb-panel__tag--muted" : ""}` : "nb-panel__eyebrow"}>{eyebrow}</p>
      <h2 className={gap ? "nb-panel__h2--gap" : undefined}>{heading}</h2>
    </>
  );
}

/* The 116px drop square plus its copy and buttons. The <img> is sized by
   `.nb-photo__drop img`, never inline — a percentage height on a replaced
   child of a `place-items: center` grid resolves against an indefinite area
   and falls back to the photo's own ratio, which spills over everything under
   it. Same rule as `.nb-avatar > img`. */
export function NbPhotoUpload({ photoUrl, stateLabel, blurb, disabled = false, onPick, onClear }: {
  photoUrl?: string;
  stateLabel: string;
  blurb: string;
  disabled?: boolean;
  onPick: (file: File) => void;
  onClear?: () => void;
}) {
  function take(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onPick(file);
  }

  return (
    <div className="nb-photo">
      <label className="nb-photo__drop">
        <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} disabled={disabled} onChange={take} />
        {photoUrl
          ? <NextImage unoptimized fill sizes="116px" src={photoUrl} alt="Your tutor profile photo" />
          : <span>{stateLabel}</span>}
      </label>
      <div className="nb-photo__body">
        <p className="nb-photo__name">Profile photo</p>
        <p className="nb-photo__blurb">{blurb}</p>
        <div className="nb-photo__acts">
          <label className="nb-btn nb-btn--sm" style={{ cursor: "pointer" }}>
            <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} disabled={disabled} onChange={take} />
            {photoUrl ? "Replace the photo" : "Upload a photo"}
          </label>
          {photoUrl && onClear ? <NbButton size="sm" onClick={onClear}>Remove</NbButton> : null}
        </div>
      </div>
    </div>
  );
}

/* A label over a `.nb-field` capsule. The control inside is chromeless because
   `globals.css` kills the border on every input/select/textarea with an
   `!important`; the outline and focus ring belong to the capsule. */
export function NbFieldset({ label, note, wide = false, top = false, children }: {
  label: string;
  note?: string;
  wide?: boolean;
  top?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`nb-fieldset${wide ? " nb-fieldset--wide" : ""}`}>
      <span className="nb-fieldset__label">{label}</span>
      <span className={`nb-field${top ? " nb-field--top" : ""}`}>{children}</span>
      {note ? <span className="nb-fieldset__note">{note}</span> : null}
    </label>
  );
}

export function NbFieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="nb-fieldgrid">{children}</div>;
}

/* `card` is the identity card's own spacing — 18px above the rule and 16px
   below it, which is not `--space-6`'s 14. Check the number, not the token. */
export function NbFigs({ divided = false, card = false, children }: { divided?: boolean; card?: boolean; children: React.ReactNode }) {
  return <div className={`nb-figs${divided ? " nb-figs--divided" : ""}${card ? " nb-figs--card" : ""}`}>{children}</div>;
}

export function NbFig({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="nb-fig"><span>{label}</span><span>{value}</span></div>;
}

/* --------------------------------------------------------------------------
   The account set: the handoff's `profile` screen. The app splits into two
   views — Profile and Settings — what the prototype draws as one screen with
   a left-hand switcher, so the switcher below is real navigation and both
   views render the same aside.
   ----------------------------------------------------------------------- */
export function NbSettingsLayout({ aside, children }: { aside: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="nb-settings">
      <aside className="nb-settings__aside">{aside}</aside>
      <main className="nb-panel">{children}</main>
    </div>
  );
}

export function NbIdentityCard({ initials, photoUrl, name, sub, pills, children }: {
  initials: string;
  photoUrl?: string;
  name: string;
  sub: string;
  pills?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="nb-id">
      <div className="nb-id__who">
        <NbAvatar style={{ background: "var(--category-tutor)" }}>
          {photoUrl ? <NextImage unoptimized fill sizes="56px" src={photoUrl} alt="" /> : initials}
        </NbAvatar>
        <div>
          <p className="nb-id__name">{name}</p>
          <p className="nb-id__sub">{sub}</p>
        </div>
      </div>
      {pills ? <div className="nb-id__pills">{pills}</div> : null}
      {children}
    </div>
  );
}

export function NbNavList({ items }: {
  items: Array<{ label: string; hint: string; current?: boolean; onSelect: () => void }>;
}) {
  return (
    <div className="nb-navlist">
      {items.map((item) => (
        <button key={item.label} type="button" data-cur={item.current ? "" : undefined} aria-current={item.current ? "page" : undefined} onClick={item.onSelect}>
          <span className="nb-navlist__label">{item.label}</span>
          <span className="nb-navlist__hint">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}

export function NbPanelBar({ title, note, action }: { title: string; note?: string; action?: React.ReactNode }) {
  return (
    <header className="nb-panelhead">
      <h2>{title}</h2>
      {note ? <span className="nb-sec__count">{note}</span> : null}
      {action}
    </header>
  );
}

export function NbSetRows({ children }: { children: React.ReactNode }) {
  return <div className="nb-setrows">{children}</div>;
}

export function NbSetRow({ title, body, action }: { title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="nb-setrow">
      <div>
        <p className="nb-setrow__title">{title}</p>
        {body ? <p className="nb-setrow__body">{body}</p> : null}
      </div>
      {action ?? <span />}
    </div>
  );
}

/* --------------------------------------------------------------------------
   The admin set: the handoff's `admin` screen. A 4-across stat row and one
   queue card whose rows are the things waiting on a reviewer.
   ----------------------------------------------------------------------- */
export function NbStats({ children }: { children: React.ReactNode }) {
  return <div className="nb-stats">{children}</div>;
}

export function NbStat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="nb-stat">
      <p className="nb-stat__label">{label}</p>
      <p className="nb-stat__value">{value}</p>
      {sub ? <p className="nb-stat__sub">{sub}</p> : null}
    </div>
  );
}

export function NbQueue({ children }: { children: React.ReactNode }) {
  return <div className="nb-queue">{children}</div>;
}

/* The prototype's queue row: a coloured mark, the title with its flag pill,
   two lines of context, then the reviewer's buttons. `more` is this app's own
   — the tutor review carries a checklist, private documents and notes the
   drawing has no row for, and dropping them would drop the review itself. */
export function NbQueueItem({ mark, markColor = "var(--category-verify)", title, flag, body, meta, actions, more }: {
  mark: React.ReactNode;
  markColor?: string;
  title: React.ReactNode;
  flag?: React.ReactNode;
  body?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  more?: React.ReactNode;
}) {
  return (
    <div className="nb-queue__item">
      <NbAvatar small style={{ background: markColor }}>{mark}</NbAvatar>
      <div className="nb-queue__body">
        <div className="nb-queue__top">
          <p className="nb-queue__title">{title}</p>
          {flag}
        </div>
        {body ? <p className="nb-queue__text">{body}</p> : null}
        {meta ? <p className="nb-queue__meta">{meta}</p> : null}
      </div>
      {actions ? <div className="nb-queue__acts">{actions}</div> : null}
      {more ? <div className="nb-queue__more">{more}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------------------
   The support set: the handoff's `policy` screen — the measure on the left, a
   standing aside on the right. `payment` is drawn on the same grid.
   ----------------------------------------------------------------------- */
export function NbSupportLayout({ aside, children }: { aside: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="nb-support">
      <main className="nb-panel">{children}</main>
      <aside className="nb-support__aside">{aside}</aside>
    </div>
  );
}
