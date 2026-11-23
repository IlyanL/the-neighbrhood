"use client";

import { useEffect, useRef } from "react";
import { CaptureUpdateAction, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, DataURL, BinaryFileData } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";

export const CLASSROOM_FILE_ID_KEY = "classroomFileId" as const;
export const CLASSROOM_FILE_NAME_KEY = "classroomDisplayName" as const;
export const CLASSROOM_FILE_MIME_KEY = "classroomMimeType" as const;
// Present on pages 2..n of a placed PDF. Only used to tell them apart when reading a
// board back; hydration keys off the file id, so a page never needs special handling.
export const CLASSROOM_FILE_PAGE_KEY = "classroomPdfPage" as const;

const MAX_PDF_PAGES = 50;
const PDF_PAGE_GAP = 24;
const PDF_PAGE_WIDTH = 600;
const IMAGE_WIDTH = 560;
const IMAGE_HEIGHT = 400;

// Page 1 reuses the bare file id so boards saved before multi-page support still resolve.
function pdfPageFileId(fileId: string, pageNumber: number): FileId {
  return (pageNumber === 1 ? fileId : `${fileId}__p${pageNumber}`) as FileId;
}

export type ClassroomFileMeta = { id: string; display_name: string; mime_type: string };
export type PlacementResult = { pagesPlaced: number; skippedPages: number };

function appendElements(excalidrawAPI: ExcalidrawImperativeAPI, elements: readonly ExcalidrawElement[]) {
  excalidrawAPI.updateScene({
    elements: [...excalidrawAPI.getSceneElementsIncludingDeleted(), ...elements],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/**
 * Places a session file on the board. For a PDF this creates every page element up front,
 * in one scene write, on the one machine that placed it — the pages then travel to the
 * other participant as ordinary synced elements.
 *
 * The previous version placed a single element and let each client *derive* pages 2..n
 * later, while hydrating. That ran on every participant and on every reload, each time
 * against a scene that had only partially arrived over Yjs, so the "has this page already
 * been added?" check regularly looked at an empty board and added another full copy —
 * which is where the stacks of duplicate pages came from. Deriving shared state in a
 * side-effect that every peer runs independently cannot be made safe by tightening the
 * de-dupe; the fix is that exactly one client decides, once.
 */
export async function placeClassroomFile(params: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  file: ClassroomFileMeta;
  x: number;
  y: number;
  bookingId: string;
  accessToken: string;
}): Promise<PlacementResult> {
  const customData = {
    [CLASSROOM_FILE_ID_KEY]: params.file.id,
    [CLASSROOM_FILE_NAME_KEY]: params.file.display_name,
    [CLASSROOM_FILE_MIME_KEY]: params.file.mime_type,
  };

  if (params.file.mime_type !== "application/pdf") {
    const [element] = convertToExcalidrawElements([{
      type: "image",
      x: params.x,
      y: params.y,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      fileId: params.file.id as FileId,
      customData,
    }]);
    appendElements(params.excalidrawAPI, [element]);
    return { pagesPlaced: 1, skippedPages: 0 };
  }

  // Nothing goes on the board until the bytes are in hand, so there is no "Opening…"
  // placeholder to swap out later and no half-placed state for a peer to observe.
  const { pages, totalPages } = await loadPdf({
    fileId: params.file.id,
    bookingId: params.bookingId,
    accessToken: params.accessToken,
  });
  registerPdfPages(params.excalidrawAPI, params.file.id, pages);

  let top = params.y;
  const skeletons = pages.map((page, index) => {
    // Each page keeps its own true proportions, so a landscape or mixed-orientation
    // document is not squashed into a portrait box.
    const height = Math.round(PDF_PAGE_WIDTH * (page.height / page.width));
    const skeleton = {
      type: "image" as const,
      x: params.x,
      y: top,
      width: PDF_PAGE_WIDTH,
      height,
      fileId: pdfPageFileId(params.file.id, index + 1),
      customData: index === 0 ? customData : { ...customData, [CLASSROOM_FILE_PAGE_KEY]: index + 1 },
    };
    top += height + PDF_PAGE_GAP;
    return skeleton;
  });
  appendElements(params.excalidrawAPI, convertToExcalidrawElements(skeletons));
  return { pagesPlaced: pages.length, skippedPages: Math.max(0, totalPages - pages.length) };
}

/**
 * The demo classroom's version of placing a file: the bytes come straight from the
 * visitor's own disk and never leave the browser. Seeding the cache under a made-up id
 * means `placeClassroomFile` finds the PDF pages there and never calls the server.
 */
export async function placeLocalFile(params: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  file: File;
  x: number;
  y: number;
}): Promise<PlacementResult> {
  const id = `local-${crypto.randomUUID()}`;
  const primed = await prepareFileForCache(params.file);
  primeFileCache(id, primed);
  if (primed.kind === "image") {
    params.excalidrawAPI.addFiles([{ id: id as FileId, dataURL: primed.dataURL, mimeType: primed.mimeType, created: Date.now() }]);
  }
  return placeClassroomFile({
    excalidrawAPI: params.excalidrawAPI,
    file: { id, display_name: params.file.name, mime_type: params.file.type },
    x: params.x,
    y: params.y,
    bookingId: "",
    accessToken: "",
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetches this client's own signed URL for a classroom file — never synced through
 * Yjs, so each peer re-fetches independently using their own bearer token.
 */
export async function fetchClassroomFileUrl(params: { bookingId: string; accessToken: string; fileId: string }): Promise<string> {
  const response = await fetch(`/api/classrooms/${encodeURIComponent(params.bookingId)}/files/${encodeURIComponent(params.fileId)}`, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "This file is no longer available.");
  return data.url as string;
}

// Per-tab, in-memory only: never persisted across reloads and never synced to
// other participants. Each peer decrypts and caches its own signed-URL bytes,
// so a remount (tab switch, panel toggle) doesn't redo the fetch/rasterize work.
export type PdfPage = { dataURL: string; width: number; height: number };
export type CachedPdf = { pages: PdfPage[]; totalPages: number };
export type CachedFile =
  | { kind: "image"; dataURL: DataURL; mimeType: BinaryFileData["mimeType"] }
  | ({ kind: "pdf" } & CachedPdf);
const fileCache = new Map<string, CachedFile>();
// One rasterize per file even when several placements of it are requested in the same tick.
const pdfLoads = new Map<string, Promise<CachedPdf>>();

async function rasterizePdfPages(bytes: ArrayBuffer): Promise<CachedPdf> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const doc = await pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  }).promise;
  // Every page is held in memory as a PNG data URL, so the cap is a memory guard rather
  // than a page-count preference; the caller reports any pages left behind.
  const pageCount = Math.min(doc.numPages, MAX_PDF_PAGES);
  const pages: PdfPage[] = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    // 1.5x keeps pages legible at the board's placement size while cutting
    // render/encode time noticeably versus 2x, since cost scales with pixel count.
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot render a PDF preview.");
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    pages.push({ dataURL: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height });
  }
  return { pages, totalPages: doc.numPages };
}

/**
 * Rasterizes/encodes a just-selected file on the uploader's own machine, ahead of
 * the upload finishing, so it can seed the cache and skip the redundant
 * signed-url-fetch-then-download round trip that placement would otherwise do
 * immediately afterward for bytes the uploader already has.
 */
export async function prepareFileForCache(file: File): Promise<CachedFile> {
  if (file.type === "application/pdf") {
    const { pages, totalPages } = await rasterizePdfPages(await file.arrayBuffer());
    return { kind: "pdf", pages, totalPages };
  }
  const dataURL = await blobToDataUrl(file) as DataURL;
  return { kind: "image", dataURL, mimeType: (file.type || "image/png") as BinaryFileData["mimeType"] };
}

export function primeFileCache(fileId: string, primed: CachedFile) {
  fileCache.set(fileId, primed);
}

function loadPdf(params: { bookingId: string; accessToken: string; fileId: string }): Promise<CachedPdf> {
  const cached = fileCache.get(params.fileId);
  if (cached?.kind === "pdf") return Promise.resolve(cached);
  const inFlight = pdfLoads.get(params.fileId);
  if (inFlight) return inFlight;
  const load = (async () => {
    const url = await fetchClassroomFileUrl(params);
    const fileResponse = await fetch(url);
    const blob = await fileResponse.blob();
    const rasterized = await rasterizePdfPages(await blob.arrayBuffer());
    fileCache.set(params.fileId, { kind: "pdf", ...rasterized });
    return rasterized;
  })();
  pdfLoads.set(params.fileId, load);
  const forget = () => { pdfLoads.delete(params.fileId); };
  load.then(forget, forget);
  return load;
}

function registerPdfPages(excalidrawAPI: ExcalidrawImperativeAPI, fileId: string, pages: PdfPage[]) {
  excalidrawAPI.addFiles(pages.map((page, index) => ({
    id: pdfPageFileId(fileId, index + 1),
    dataURL: page.dataURL as DataURL,
    mimeType: "image/png" as BinaryFileData["mimeType"],
    created: Date.now(),
  })));
}

/**
 * Makes a placed file's bitmaps available to this Excalidraw instance.
 *
 * This deliberately never touches the scene. Every element a file needs already exists —
 * placed once by one participant and synced like any other element — so all a peer (or a
 * reload) has to do is load the bytes those elements point at.
 */
async function hydrateFile(params: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  fileId: string;
  isPdf: boolean;
  bookingId: string;
  accessToken: string;
}) {
  if (params.isPdf) {
    const { pages } = await loadPdf(params);
    registerPdfPages(params.excalidrawAPI, params.fileId, pages);
    return;
  }

  const cached = fileCache.get(params.fileId);
  let dataURL: DataURL;
  let mimeType: BinaryFileData["mimeType"];
  if (cached?.kind === "image") {
    dataURL = cached.dataURL;
    mimeType = cached.mimeType;
  } else {
    const url = await fetchClassroomFileUrl(params);
    const fileResponse = await fetch(url);
    const blob = await fileResponse.blob();
    dataURL = await blobToDataUrl(blob) as DataURL;
    mimeType = (blob.type || "image/png") as BinaryFileData["mimeType"];
    fileCache.set(params.fileId, { kind: "image", dataURL, mimeType });
  }
  params.excalidrawAPI.addFiles([{ id: params.fileId as FileId, dataURL, mimeType, created: Date.now() }]);
}

export function useClassroomFileHydration(params: {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  bookingId: string;
  accessToken: string;
}) {
  const { excalidrawAPI, bookingId, accessToken } = params;
  const attempted = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!excalidrawAPI) return;

    function scan() {
      const files = excalidrawAPI!.getFiles();
      excalidrawAPI!.getSceneElements().forEach((element) => {
        const customData = element.customData as Record<string, unknown> | undefined;
        const fileId = customData?.[CLASSROOM_FILE_ID_KEY];
        const mimeType = customData?.[CLASSROOM_FILE_MIME_KEY];
        if (typeof fileId !== "string" || typeof mimeType !== "string") return;
        // Keyed by file, not by element: a PDF's pages all point at the same source file,
        // and one load registers the bitmaps for every one of them. Any page element can
        // therefore trigger it, which keeps the rest working if page 1 has been deleted.
        if (attempted.current.has(fileId) || files[fileId]) return;
        attempted.current.add(fileId);

        // Deliberately not removed from `attempted` on failure: this scan() reruns on
        // every canvas change plus a 4s poll, so retrying a hard failure (e.g. a file
        // that was deleted) would hammer the API forever. A fresh mount gets a clean
        // retry instead.
        hydrateFile({
          excalidrawAPI: excalidrawAPI!,
          fileId,
          isPdf: mimeType === "application/pdf",
          bookingId,
          accessToken,
        }).catch((error) => {
          console.error("Classroom file hydration failed", error);
        });
      });
    }

    scan();
    const unsubscribe = excalidrawAPI.onChange(() => scan());
    const interval = window.setInterval(scan, 4000);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [excalidrawAPI, bookingId, accessToken]);
}
