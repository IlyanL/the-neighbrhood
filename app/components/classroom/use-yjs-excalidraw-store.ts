"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRoom } from "@liveblocks/react/suspense";
import { getYjsProviderForRoom } from "@liveblocks/yjs";
import * as Y from "yjs";
import { CaptureUpdateAction, reconcileElements, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, Collaborator, SocketId } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";

// "cursor" is a reserved awareness field name used by y-prosemirror's cursor plugin
// (the shared-notes editor) for a Yjs relative-position object. The notes editor and
// this whiteboard bind to the same underlying room awareness (getYjsProviderForRoom
// caches one instance per room), so writing the whiteboard's plain {x,y,tool} pointer
// under that same key crashes the notes editor's cursor rendering the moment anyone's
// pointer moves. Use a whiteboard-specific field name instead.
type AwarenessState = { user?: { name: string; color: string }; excalidrawPointer?: { x: number; y: number; tool: "pointer" | "laser" } };

export function useYjsExcalidrawSync(input: {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  user: { id: string; color: string; name: string };
  readOnly: boolean;
}) {
  const room = useRoom();
  const { excalidrawAPI, readOnly } = input;
  const userColor = input.user.color;
  const userName = input.user.name;

  const [status, setStatus] = useState<"loading" | "synced">("loading");
  const lastPushedVersion = useRef<Map<string, number>>(new Map());

  const { yDoc, yElements, yProvider } = useMemo(() => {
    const provider = getYjsProviderForRoom(room, { offlineSupport_experimental: true });
    const doc = provider.getYDoc();
    doc.gc = true;
    const elements = doc.getMap<ExcalidrawElement>("excalidraw_elements");
    return { yDoc: doc, yElements: elements, yProvider: provider };
  }, [room]);

  useEffect(() => {
    if (!excalidrawAPI) return;
    const cleanups: Array<() => void> = [];
    let didSynchronize = false;

    function synchronize() {
      if (didSynchronize || !excalidrawAPI) return;
      didSynchronize = true;

      if (yElements.size) {
        const remoteElements = Array.from(yElements.values());
        // restoreElements normalizes/migrates elements for a fresh scene, but does not
        // reliably carry our app-specific `customData` through — reattach it from the
        // raw synced record so classroom-file/equation elements survive a remount
        // (e.g. switching workspace tabs and back) instead of losing their identity.
        const restoredBase = restoreElements(remoteElements, null);
        const restored = restoredBase.map((element) => {
          const original = yElements.get(element.id);
          return original?.customData ? { ...element, customData: original.customData } : element;
        });
        restored.forEach((element) => lastPushedVersion.current.set(element.id, element.versionNonce));
        excalidrawAPI.updateScene({ elements: restored, captureUpdate: CaptureUpdateAction.NEVER });
      } else if (!readOnly) {
        const initial = excalidrawAPI.getSceneElements();
        initial.forEach((element) => lastPushedVersion.current.set(element.id, element.versionNonce));
        yDoc.transact(() => { initial.forEach((element) => yElements.set(element.id, element)); });
      }

      if (!readOnly) {
        cleanups.push(excalidrawAPI.onChange((elements) => {
          const changed: ExcalidrawElement[] = [];
          elements.forEach((element) => {
            if (lastPushedVersion.current.get(element.id) !== element.versionNonce) {
              changed.push(element);
              lastPushedVersion.current.set(element.id, element.versionNonce);
            }
          });
          if (!changed.length) return;
          yDoc.transact(() => { changed.forEach((element) => yElements.set(element.id, element)); });
        }));
      }

      const onRemoteChange = (_event: unknown, transaction: Y.Transaction) => {
        if (transaction.local) return;
        const remoteElements = Array.from(yElements.values()) as unknown as RemoteExcalidrawElement[];
        const reconciled = reconcileElements(
          excalidrawAPI.getSceneElementsIncludingDeleted(),
          remoteElements,
          excalidrawAPI.getAppState(),
        ).map((element) => {
          const original = yElements.get(element.id);
          return original?.customData ? { ...element, customData: original.customData } : element;
        });
        reconciled.forEach((element) => lastPushedVersion.current.set(element.id, element.versionNonce));
        excalidrawAPI.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
      };
      yElements.observe(onRemoteChange);
      cleanups.push(() => yElements.unobserve(onRemoteChange));

      if (!readOnly) yProvider.awareness.setLocalStateField("user", { name: userName, color: userColor });

      const localAwarenessId = yDoc.clientID;
      const onAwarenessChange = () => {
        const states = yProvider.awareness.getStates() as Map<number, AwarenessState>;
        const next = new Map<SocketId, Collaborator>();
        states.forEach((state, clientId) => {
          if (clientId === localAwarenessId || !state.user) return;
          next.set(String(clientId) as SocketId, {
            username: state.user.name,
            color: { background: state.user.color, stroke: state.user.color },
            pointer: state.excalidrawPointer,
            isCurrentUser: false,
          });
        });
        excalidrawAPI.updateScene({ collaborators: next, captureUpdate: CaptureUpdateAction.NEVER });
      };
      yProvider.awareness.on("change", onAwarenessChange);
      onAwarenessChange();
      cleanups.push(() => yProvider.awareness.off("change", onAwarenessChange));

      setStatus("synced");
    }

    if (yProvider.synced) {
      const initial = window.setTimeout(synchronize, 0);
      cleanups.push(() => window.clearTimeout(initial));
    } else {
      yProvider.on("synced", synchronize);
      cleanups.push(() => yProvider.off("synced", synchronize));
    }
    return () => cleanups.splice(0).forEach((cleanup) => cleanup());
  }, [excalidrawAPI, readOnly, room, userColor, userName, yDoc, yElements, yProvider]);

  function onPointerUpdate(payload: { pointer: { x: number; y: number; tool: "pointer" | "laser" } }) {
    if (readOnly) return;
    yProvider.awareness.setLocalStateField("excalidrawPointer", payload.pointer);
  }

  return { status, onPointerUpdate };
}
