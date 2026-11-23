/* eslint-disable @next/next/no-img-element -- a 192px static logo; next/image adds nothing here */
type BrandProps = {
  compact?: boolean;
  inverse?: boolean;
};

/* The logo (public/logo-mark.png — transparent, so it sits on light and dark
   grounds alike). `inverse` is kept for callers on a dark ground; the logo
   needs no change there. */
export function NeighbrhoodMark({ inverse = false }: Pick<BrandProps, "inverse">) {
  return (
    <span className={`neighbrhood-mark${inverse ? " neighbrhood-mark-inverse" : ""}`} aria-hidden="true">
      <img src="/logo-mark.png" alt="" width={192} height={192} decoding="async" />
    </span>
  );
}

export function NeighbrhoodBrand({ compact = false, inverse = false }: BrandProps) {
  return (
    <span className={`neighbrhood-brand${compact ? " neighbrhood-brand-compact" : ""}${inverse ? " neighbrhood-brand-inverse" : ""}`}>
      <NeighbrhoodMark inverse={inverse} />
      <span className="neighbrhood-wordmark">
        <strong>The Neighbrhood</strong>
        {!compact && <small>Know what matters at Western</small>}
      </span>
    </span>
  );
}

/* Full-screen loading state: the logo draws itself in from the bottom-left
   corner to the top-right behind a moving, soft-edged diagonal mask, holds,
   fades, and repeats. CSS lives under "Logo mark + logo loader" in
   globals.css. */
export function NeighbrhoodLoader(props: { label?: string }) {
  return (
    <span className="nb-logo-loader" role="img" aria-label={props.label ?? "Loading The Neighbrhood"}>
      <img src="/logo-mark.png" alt="" width={192} height={192} />
    </span>
  );
}
