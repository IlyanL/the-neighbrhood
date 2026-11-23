"use client";

import type { ComponentProps, ReactNode } from "react";
import { ClientSideSuspense, LiveblocksProvider, RoomProvider, useRoom } from "@liveblocks/react/suspense";
import { getYjsProviderForRoom } from "@liveblocks/yjs";

export function ClassroomCollaborationRoom(props: {
  roomId: string;
  accessToken: string;
  children: ReactNode;
}) {
  return (
    <LiveblocksProvider
      authEndpoint={(room) => authorize(room, props.accessToken)}
    >
      <RoomProvider id={props.roomId} initialPresence={{ cursor: null }}>
        <ClientSideSuspense fallback={<WorkspaceLoading />}>
          <div className="classroom-collaboration-room">
            <AwarenessPrimer />
            {props.children}
          </div>
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  );
}

// Liveblocks abandons an auth attempt after 10s but does not cancel the request behind it,
// so a slow patch used to leave orphaned work running on the server while the next attempt
// was already on its way — each one re-running the same queries and each one counting
// against the endpoint's rate limit. Both effects are cut off here: one attempt in flight
// at a time, and it is aborted just before Liveblocks stops waiting for it.
const AUTH_ABORT_MS = 9_000;
// Liveblocks does not export these, so they are read back off the provider's own props.
type AuthEndpointFn = Exclude<NonNullable<ComponentProps<typeof LiveblocksProvider>["authEndpoint"]>, string>;
type AuthResult = Awaited<ReturnType<AuthEndpointFn>>;
const inFlight = new Map<string, Promise<AuthResult>>();

function authorize(room: string | undefined, accessToken: string): Promise<AuthResult> {
  const key = room ?? "";
  const existing = inFlight.get(key);
  if (existing) return existing;

  const attempt = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUTH_ABORT_MS);
    try {
      const response = await fetch("/api/liveblocks-auth", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ room }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Shared workspace authorization failed.");
      return await response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("The shared workspace took too long to authorize. Retrying…");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  })();

  inFlight.set(key, attempt);
  const forget = () => { if (inFlight.get(key) === attempt) inFlight.delete(key); };
  attempt.then(forget, forget);
  return attempt;
}

/**
 * The whiteboard and the shared-notes editor both bind to this same room's underlying
 * Yjs awareness (getYjsProviderForRoom caches one provider per room). Liveblocks' own
 * Tiptap collaboration-cursor extension reads that awareness's local state synchronously
 * on mount and crashes if it's still null (no local state has ever been set yet) — a real
 * bug in @liveblocks/react-tiptap (still present as of 3.24.1, verified against upstream).
 * Render this before any workspace tab so the awareness always has non-null local state
 * by the time either consumer mounts, regardless of which tab loads first.
 */
function AwarenessPrimer() {
  const room = useRoom();
  const provider = getYjsProviderForRoom(room, { offlineSupport_experimental: true });
  if (!provider.awareness.getLocalState()) provider.awareness.setLocalState({});
  return null;
}

function WorkspaceLoading() {
  return <div className="classroom-workspace-loading" role="status"><span /><p>Connecting the shared workspace…</p></div>;
}
