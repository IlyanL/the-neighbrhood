"use client";

import { useEffect, useState } from "react";

export function ScrollProgress() {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    function onScroll() {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      setPercent(scrollable > 0 ? (doc.scrollTop / scrollable) * 100 : 0);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="nb-scrollprogress" role="progressbar" aria-label="Reading progress" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div className="nb-scrollprogress__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}
