"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import katex from "katex";
import { Excalidraw, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
// Scoped here rather than the root layout so it is only shipped on the classroom route.
import "@excalidraw/excalidraw/index.css";
import "katex/dist/katex.min.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { placeEquation, updateEquation, readEquationLatex } from "@/app/components/classroom/excalidraw-equation";
import {
  placeClassroomFile,
  placeLocalFile,
  prepareFileForCache,
  primeFileCache,
  useClassroomFileHydration,
  type ClassroomFileMeta,
} from "@/app/components/classroom/excalidraw-file-element";
import { useYjsExcalidrawSync } from "@/app/components/classroom/use-yjs-excalidraw-store";
import { reportSilentFailure } from "@/lib/report";

const structures = [
  ["Fraction", String.raw`\frac{a}{b}`], ["Exponent", "x^{2}"], ["Square root", String.raw`\sqrt{x}`],
  ["Integral", String.raw`\int_{a}^{b} f(x)\,dx`], ["Sum", String.raw`\sum_{i=1}^{n} i`],
  ["Limit", String.raw`\lim_{x \to 0}`], ["Vector", String.raw`\vec{v}`],
  ["Matrix", String.raw`\begin{bmatrix}a & b \\ c & d\end{bmatrix}`], ["Greek", String.raw`\alpha + \beta`],
] as const;

const BoardAccessContext = createContext<{ bookingId: string; accessToken: string } | null>(null);

export function ClassroomWhiteboard(props: {
  user: { id: string; name: string; color: string };
  bookingId: string;
  accessToken: string;
  readOnly: boolean;
}) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const { onPointerUpdate } = useYjsExcalidrawSync({ excalidrawAPI, user: props.user, readOnly: props.readOnly });
  useClassroomFileHydration({ excalidrawAPI, bookingId: props.bookingId, accessToken: props.accessToken });
  const access = { bookingId: props.bookingId, accessToken: props.accessToken };

  return (
    <BoardAccessContext.Provider value={access}>
      <div className="classroom-board" aria-label="Shared whiteboard">
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          viewModeEnabled={props.readOnly}
          onPointerUpdate={onPointerUpdate}
          isCollaborating
        />
        {!props.readOnly && excalidrawAPI && <ClassroomBoardTools excalidrawAPI={excalidrawAPI} />}
        {props.readOnly && <div className="classroom-readonly-badge">Session materials · read only</div>}
      </div>
    </BoardAccessContext.Provider>
  );
}

/**
 * The sign-in-free demo's board: the same Excalidraw canvas and the same Math and
 * File buttons as a real session, with nothing synced or uploaded — a placed file
 * is read from the visitor's own disk and stays in their browser.
 */
export function DemoWhiteboard() {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  return (
    <div className="classroom-board" aria-label="Demo whiteboard">
      <Excalidraw excalidrawAPI={(api) => setExcalidrawAPI(api)} />
      {excalidrawAPI && <ClassroomBoardTools excalidrawAPI={excalidrawAPI} demo />}
    </div>
  );
}

function ClassroomBoardTools({ excalidrawAPI, demo = false }: { excalidrawAPI: ExcalidrawImperativeAPI; demo?: boolean }) {
  const access = useContext(BoardAccessContext);
  const [equationOpen, setEquationOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [latex, setLatex] = useState(String.raw`\frac{a}{b}`);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const preview = katex.renderToString(latex || "?", { displayMode: true, throwOnError: false, trust: false });

  function viewportCenter() {
    const state = excalidrawAPI.getAppState();
    const rect = document.querySelector(".classroom-board .excalidraw")?.getBoundingClientRect();
    const clientX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const clientY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    return viewportCoordsToSceneCoords({ clientX, clientY }, state);
  }

  function openComposer() {
    const state = excalidrawAPI.getAppState();
    const selectedIds = Object.keys(state.selectedElementIds);
    const selected = selectedIds.length === 1 ? excalidrawAPI.getSceneElements().find((element) => element.id === selectedIds[0]) : null;
    const existingLatex = selected ? readEquationLatex(selected as unknown as { customData?: Record<string, unknown> }) : null;
    if (selected && existingLatex) {
      setEditingId(selected.id);
      setLatex(existingLatex);
    } else {
      setEditingId(null);
      setLatex(String.raw`\frac{a}{b}`);
    }
    setEquationOpen(true);
  }

  async function saveEquation() {
    if (!latex.trim() || saving) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateEquation({ excalidrawAPI, elementId: editingId, latex: latex.trim() });
      } else {
        const center = viewportCenter();
        await placeEquation({ excalidrawAPI, latex: latex.trim(), x: center.x - 130, y: center.y - 50 });
      }
      setEquationOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="classroom-board-tools" role="toolbar" aria-label="Tutoring whiteboard tools">
        <button onClick={openComposer} title="Insert or edit a LaTeX equation"><BoardIcon name="math" />Math</button>
        <button onClick={() => setFilesOpen(true)} disabled={!access && !demo} title={demo ? "Place an image or PDF from your computer" : "Upload or place a secure session file"}><BoardIcon name="file" />File</button>
      </div>
      {equationOpen && (
        <EquationDialog
          latex={latex}
          setLatex={setLatex}
          preview={preview}
          saving={saving}
          onSave={saveEquation}
          onClose={() => setEquationOpen(false)}
        />
      )}
      {filesOpen && demo && (
        <DemoFileDialog
          onPlace={async (file) => {
            const center = viewportCenter();
            const width = file.type === "application/pdf" ? 600 : 560;
            const result = await placeLocalFile({ excalidrawAPI, file, x: center.x - width / 2, y: center.y - 200 });
            setFilesOpen(false);
            return result.skippedPages
              ? `Placed the first ${result.pagesPlaced} pages. The remaining ${result.skippedPages} were left out to keep the board responsive.`
              : null;
          }}
          onClose={() => setFilesOpen(false)}
        />
      )}
      {filesOpen && !demo && access && (
        <BoardFileDialog
          access={access}
          onPlace={async (file) => {
            const center = viewportCenter();
            const width = file.mime_type === "application/pdf" ? 600 : 560;
            // The board is left exactly where the user had it. A PDF's pages stack
            // downwards from here, so later pages sit below the fold until they scroll —
            // which is the tradeoff they asked for over having the view move on its own.
            const result = await placeClassroomFile({
              excalidrawAPI,
              file,
              x: center.x - width / 2,
              y: center.y - 200,
              bookingId: access!.bookingId,
              accessToken: access!.accessToken,
            });
            setFilesOpen(false);
            return result.skippedPages
              ? `Placed the first ${result.pagesPlaced} pages. The remaining ${result.skippedPages} were left out to keep the board responsive.`
              : null;
          }}
          onClose={() => setFilesOpen(false)}
        />
      )}
    </>
  );
}

function BoardFileDialog(props: {
  access: { bookingId: string; accessToken: string };
  onPlace: (file: ClassroomFileMeta) => Promise<string | null>;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<(ClassroomFileMeta & { size_bytes: number; created_at: string })[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [placing, setPlacing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setState("loading");
    const response = await fetch(`/api/classrooms/${encodeURIComponent(props.access.bookingId)}/files`, {
      headers: { Authorization: `Bearer ${props.access.accessToken}` }, cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) { setNotice(data.error || "Session files could not load."); setState("error"); return; }
    setFiles((data.files || []).filter((file: ClassroomFileMeta) => file.mime_type === "application/pdf" || file.mime_type.startsWith("image/")));
    setState("ready");
  }, [props.access.accessToken, props.access.bookingId]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  async function uploadAndPlace(file: File) {
    setUploading(true); setNotice("");
    const form = new FormData(); form.append("file", file);
    // Rasterize/encode locally while the upload is in flight — the uploader already
    // has these bytes, so there's no need to wait and re-download them afterward.
    const [uploadResult, primed] = await Promise.all([
      fetch(`/api/classrooms/${encodeURIComponent(props.access.bookingId)}/files`, {
        method: "POST", headers: { Authorization: `Bearer ${props.access.accessToken}` }, body: form,
      }).then(async (response) => ({ response, data: await response.json() })),
      prepareFileForCache(file).catch(() => null),
    ]);
    setUploading(false);
    const { response, data } = uploadResult;
    if (!response.ok) { setNotice(data.error || "The file could not be uploaded."); return; }
    if (primed) primeFileCache(data.file.id, primed);
    await placeFile(data.file);
  }

  async function placeFile(file: ClassroomFileMeta) {
    if (placing) return;
    setPlacing(true);
    setNotice("");
    try {
      const warning = await props.onPlace(file);
      if (warning) setNotice(warning);
    } catch (error) {
      // This is the path that was quietly failing while multi-page PDFs misbehaved: the
      // user saw a polite notice and the actual cause was thrown away.
      reportSilentFailure("placeClassroomFile", error, { fileId: file.id, mimeType: file.mime_type });
      setNotice("The file is safely stored in Session files, but could not be placed on the board.");
    } finally {
      setPlacing(false);
    }
  }

  return createPortal(
    <div className="classroom-equation-backdrop" role="presentation" onMouseDown={(event) => event.stopPropagation()}>
      <section className="classroom-board-file-dialog" role="dialog" aria-modal="true" aria-labelledby="board-file-title">
        <header><div><p>Whiteboard material</p><h2 id="board-file-title">Place a file on the board</h2></div><button onClick={props.onClose} aria-label="Close file picker">×</button></header>
        <p>Upload an image or PDF, or choose a file already shared in this session. It stays private to both participants.</p>
        <button className="classroom-board-upload" onClick={() => inputRef.current?.click()} disabled={uploading || placing}>{uploading ? "Uploading securely…" : placing ? "Opening…" : "Upload and place a file"}</button>
        <input ref={inputRef} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAndPlace(file); event.currentTarget.value = ""; }} />
        {notice && <p className="classroom-inline-error" role="alert">{notice}</p>}
        <div className="classroom-board-file-list">
          {state === "loading" && <p>Loading session files…</p>}
          {state === "error" && <button onClick={load}>Try loading files again</button>}
          {state === "ready" && files.length === 0 && <p>No board-ready files yet. Upload an image or PDF to begin.</p>}
          {files.map((file) => <button key={file.id} onClick={() => void placeFile(file)} disabled={placing}><span>{file.mime_type === "application/pdf" ? "PDF" : "IMG"}</span><div><strong>{file.display_name}</strong><small>{formatBytes(file.size_bytes)} · {new Date(file.created_at).toLocaleDateString()}</small></div><b>{placing ? "Opening…" : "Place"}</b></button>)}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function DemoFileDialog(props: { onPlace: (file: File) => Promise<string | null>; onClose: () => void }) {
  const [notice, setNotice] = useState("");
  const [placing, setPlacing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function place(file: File) {
    setPlacing(true);
    setNotice("");
    try {
      const warning = await props.onPlace(file);
      if (warning) setNotice(warning);
    } catch {
      setNotice("That file could not be opened. Try a PNG, JPEG, WebP image or a PDF.");
    } finally {
      setPlacing(false);
    }
  }

  return createPortal(
    <div className="classroom-equation-backdrop" role="presentation" onMouseDown={(event) => event.stopPropagation()}>
      <section className="classroom-board-file-dialog" role="dialog" aria-modal="true" aria-labelledby="board-file-title">
        <header><div><p>Whiteboard material</p><h2 id="board-file-title">Place a file on the board</h2></div><button onClick={props.onClose} aria-label="Close file picker">×</button></header>
        <p>Pick an image or PDF from your computer. In this demo it stays in your browser and is never uploaded. In a real session it is stored privately for you and your tutor.</p>
        <button className="classroom-board-upload" onClick={() => inputRef.current?.click()} disabled={placing}>{placing ? "Opening…" : "Choose a file to place"}</button>
        <input ref={inputRef} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void place(file); event.currentTarget.value = ""; }} />
        {notice && <p className="classroom-inline-error" role="alert">{notice}</p>}
      </section>
    </div>,
    document.body,
  );
}

function EquationDialog(props: { latex: string; setLatex: (value: string) => void; preview: string; saving: boolean; onSave: () => void; onClose: () => void; }) {
  return createPortal(
    <div className="classroom-equation-backdrop" role="presentation" onMouseDown={(event) => event.stopPropagation()}>
      <section className="classroom-equation-dialog" role="dialog" aria-modal="true" aria-labelledby="equation-title">
        <div><p>Math tool</p><h2 id="equation-title">Insert an equation</h2></div>
        <label>LaTeX<textarea autoFocus value={props.latex} onChange={(event) => props.setLatex(event.target.value)} /></label>
        <div className="classroom-equation-palette">{structures.map(([label, value]) => <button key={label} onClick={() => props.setLatex(value)}>{label}</button>)}</div>
        <div className="classroom-equation-preview" aria-live="polite" dangerouslySetInnerHTML={{ __html: props.preview }} />
        <div className="classroom-equation-actions"><button onClick={props.onClose}>Cancel</button><button onClick={props.onSave} disabled={props.saving}>{props.saving ? "Placing…" : "Place on board"}</button></div>
      </section>
    </div>,
    document.body,
  );
}

function BoardIcon({ name }: { name: "math" | "file" }) {
  if (name === "math") return <span aria-hidden="true">ƒx</span>;
  return <span aria-hidden="true">＋</span>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
