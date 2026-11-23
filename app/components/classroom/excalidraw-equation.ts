"use client";

import katex from "katex";
import { toPng } from "html-to-image";
import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, DataURL } from "@excalidraw/excalidraw/types";
import type { ExcalidrawImageElement, FileId } from "@excalidraw/excalidraw/element/types";

export const CLASSROOM_EQUATION_KEY = "classroomEquationLatex" as const;

async function rasterizeLatex(latex: string): Promise<{ dataURL: string; width: number; height: number }> {
  // html-to-image clones the captured node's own inline styles into an isolated
  // SVG foreignObject. If the captured node itself carries `position: fixed;
  // left: -9999px`, that offset re-applies inside that isolated context too,
  // pushing the rendered content outside the capture bounds — a blank image.
  // Keep the off-screen positioning on a wrapper instead, so the captured node
  // stays normally (statically) positioned.
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "0";
  wrapper.style.top = "0";
  wrapper.style.width = "0";
  wrapper.style.height = "0";
  wrapper.style.overflow = "hidden";
  wrapper.style.pointerEvents = "none";

  const host = document.createElement("div");
  host.style.padding = "14px 18px";
  host.style.background = "#ffffff";
  host.style.color = "#211b23";
  host.style.fontSize = "22px";
  host.innerHTML = katex.renderToString(latex, { displayMode: true, throwOnError: false, strict: "warn", trust: false });
  wrapper.appendChild(host);
  document.body.appendChild(wrapper);
  try {
    // Force layout so KaTeX's web fonts actually get requested, then wait for
    // them — otherwise html-to-image can snapshot before the glyphs paint,
    // producing a blank white image.
    void host.offsetHeight;
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = host.getBoundingClientRect();
    const dataURL = await toPng(host, { pixelRatio: 2, backgroundColor: "#ffffff" });
    return { dataURL, width: Math.max(60, Math.round(rect.width)), height: Math.max(40, Math.round(rect.height)) };
  } finally {
    wrapper.remove();
  }
}

export async function placeEquation(params: { excalidrawAPI: ExcalidrawImperativeAPI; latex: string; x: number; y: number }) {
  const { dataURL, width, height } = await rasterizeLatex(params.latex);
  const fileId = crypto.randomUUID() as FileId;
  params.excalidrawAPI.addFiles([{ id: fileId, dataURL: dataURL as DataURL, mimeType: "image/png", created: Date.now() }]);
  const [element] = convertToExcalidrawElements([{
    type: "image",
    x: params.x,
    y: params.y,
    width,
    height,
    fileId,
    customData: { [CLASSROOM_EQUATION_KEY]: params.latex },
  }]);
  params.excalidrawAPI.updateScene({
    elements: [...params.excalidrawAPI.getSceneElementsIncludingDeleted(), element],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

export async function updateEquation(params: { excalidrawAPI: ExcalidrawImperativeAPI; elementId: string; latex: string }) {
  const existing = params.excalidrawAPI
    .getSceneElementsIncludingDeleted()
    .find((element) => element.id === params.elementId) as ExcalidrawImageElement | undefined;
  if (!existing) return;
  const { dataURL, width, height } = await rasterizeLatex(params.latex);
  const fileId = crypto.randomUUID() as FileId;
  params.excalidrawAPI.addFiles([{ id: fileId, dataURL: dataURL as DataURL, mimeType: "image/png", created: Date.now() }]);
  const centerX = existing.x + existing.width / 2;
  const centerY = existing.y + existing.height / 2;
  const updated = newElementWith(existing, {
    fileId,
    width,
    height,
    x: centerX - width / 2,
    y: centerY - height / 2,
    customData: { [CLASSROOM_EQUATION_KEY]: params.latex },
  });
  const elements = params.excalidrawAPI.getSceneElementsIncludingDeleted().map((element) => (element.id === updated.id ? updated : element));
  params.excalidrawAPI.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
}

export function readEquationLatex(element: { customData?: Record<string, unknown> } | null | undefined): string | null {
  const value = element?.customData?.[CLASSROOM_EQUATION_KEY];
  return typeof value === "string" ? value : null;
}
