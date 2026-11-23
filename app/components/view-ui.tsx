"use client";

import { icon } from "@/app/components/phase-two";

export type IconName = Parameters<typeof icon>[0];

/* Shared design-system primitives extracted from Home/Explore: single-tint icon chip (--accent on --surface-soft), stat card, 2-column detail tile, and the eyebrow/title section header. Reuse these instead of hand-rolling new card markup so tutoring pages stay in sync with the rest of the site. */
export function IconTile({ name, size = "md" }: { name: IconName; size?: "sm" | "md" }) {
  const box = size === "sm" ? "size-7" : "size-9";
  const svg = size === "sm" ? "[&>svg]:size-3.5" : "[&>svg]:size-4";
  return <span className={`grid shrink-0 place-items-center rounded-[9px] bg-surface-soft text-brand-text ${box} ${svg}`}>{icon(name)}</span>;
}

export function StatCard({ icon: iconName, value, label }: { icon: IconName; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <IconTile name={iconName} />
      <div className="min-w-0">
        <strong className="block truncate text-lg font-bold leading-tight tracking-tight text-foreground">{value}</strong>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

export function DetailTile({ icon: iconName, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[9px] border border-border bg-card p-3.5">
      <IconTile name={iconName} size="sm" />
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{title}</p>
        <div className="mt-1 text-sm font-semibold leading-snug text-foreground">{children}</div>
      </div>
    </div>
  );
}

export function DetailTag({ children }: { children: React.ReactNode }) {
  return <span className="mr-1 mt-1 inline-block rounded-full border border-border bg-surface-lilac px-2 py-0.5 text-[11px] font-semibold text-foreground">{children}</span>;
}

export function SectionHeader({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <div>
        <p className="text-[15px] font-bold text-foreground">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

