"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NeighbrhoodLoader } from "@/app/components/brand";
import { GuestWorkspace } from "@/app/components/phase-two";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import { productUrl, readProductLocation, type NavigationTarget, type ViewName } from "@/app/components/product-navigation";

/**
 * Mounts a single guest-facing view (Courses/Housing/Clubs) on its own real
 * URL, so it's a distinct, indexable page instead of only reachable as
 * `/?view=Courses`. A signed-in visitor who lands here gets sent into the
 * full authenticated app at that same view — this component is guest-only,
 * mirroring `GuestWorkspace`'s own `userId={null}` — rather than duplicating
 * any of `Home()`'s auth/data logic.
 */
export function PublicViewRoute({ view: initialView }: { view: ViewName }) {
  const router = useRouter();
  const [checkedAuth, setCheckedAuth] = useState(!isSupabaseConfigured);
  const [activeView, setActiveView] = useState<ViewName>(initialView);
  const [navigationTarget, setNavigationTarget] = useState<NavigationTarget>({});

  useEffect(() => {
    function syncLocation() {
      setNavigationTarget(readProductLocation(window.location.search));
    }
    const locationTimer = window.setTimeout(syncLocation, 0);
    window.addEventListener("popstate", syncLocation);
    return () => {
      window.clearTimeout(locationTimer);
      window.removeEventListener("popstate", syncLocation);
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        router.replace(productUrl(initialView));
        return;
      }
      setCheckedAuth(true);
    });
  }, [initialView, router]);

  function goTo(view: ViewName, target: NavigationTarget = {}) {
    setActiveView(view);
    setNavigationTarget(target);
    window.history.pushState(null, "", productUrl(view, target));
  }

  if (!checkedAuth) {
    return <main className="auth-resolving"><NeighbrhoodLoader /></main>;
  }
  return <GuestWorkspace activeView={activeView} navigationTarget={navigationTarget} goTo={goTo} />;
}
