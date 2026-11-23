import Link from "next/link";
import { NeighbrhoodBrand } from "@/app/components/brand";
import { NbSpectrumRail } from "@/app/components/nb";
import { ScrollProgress } from "@/app/components/scroll-progress";

/* The five standing documents — /privacy, /terms, /guidelines, /safety and
   /contact. They render outside the app shell, so the page draws its own
   ground and its own spectrum rail rather than borrowing the stage's.
   Known gap: with no nav bar these routes still have no theme toggle. They
   follow the system setting and read correctly in both, but a visitor who has
   chosen a theme inside the app cannot change it from here. */
export function PolicyPage(props: { title: string; intro: string; updated?: string; children: React.ReactNode }) {
  return (
    <main className="nb-doc-page">
      <ScrollProgress />
      <NbSpectrumRail />
      <div className="nb-doc-page__inner">
        <Link href="/" className="nb-doc-page__brand"><NeighbrhoodBrand /></Link>
        <article className="nb-doc-page__body">
          <p className="nb-panel__eyebrow">The Neighbrhood</p>
          <h1>{props.title}</h1>
          <p className="nb-doc-page__lede">{props.intro}</p>
          {props.updated ? <p className="nb-doc-page__updated">Last updated {props.updated}</p> : null}
          <div className="nb-doc-page__sections">{props.children}</div>
          <nav className="nb-doc-page__foot" aria-label="Policy and support">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/guidelines">Guidelines</Link>
            <Link href="/safety">Safety</Link>
            <Link href="/contact">Contact</Link>
          </nav>
        </article>
      </div>
    </main>
  );
}

export function PolicySection(props: { title: string; children: React.ReactNode }) {
  return <section><h2>{props.title}</h2><div>{props.children}</div></section>;
}
