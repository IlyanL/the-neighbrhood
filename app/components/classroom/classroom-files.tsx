"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

type ClassroomFile = {
  id: string;
  uploader_id: string;
  display_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export function ClassroomFiles(props: { bookingId: string; accessToken: string; userId: string; readOnly: boolean; compact?: boolean }) {
  const [files, setFiles] = useState<ClassroomFile[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ file: ClassroomFile; url: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    const response = await fetch(`/api/classrooms/${encodeURIComponent(props.bookingId)}/files`, {
      headers: { Authorization: `Bearer ${props.accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) { setState("error"); return; }
    const data = await response.json();
    setFiles(data.files || []);
    setState("ready");
  }, [props.accessToken, props.bookingId]);

  useEffect(() => { const initial = window.setTimeout(() => void loadFiles(), 0); return () => window.clearTimeout(initial); }, [loadFiles]);

  function upload(file: File) {
    if (props.readOnly) return;
    setNotice("");
    setProgress(0);
    const form = new FormData();
    form.append("file", file);
    const request = new XMLHttpRequest();
    request.open("POST", `/api/classrooms/${encodeURIComponent(props.bookingId)}/files`);
    request.setRequestHeader("Authorization", `Bearer ${props.accessToken}`);
    request.upload.onprogress = (event) => event.lengthComputable && setProgress(Math.round((event.loaded / event.total) * 100));
    request.onerror = () => { setProgress(null); setNotice("The upload was interrupted. Try again when your connection is stable."); };
    request.onload = () => {
      setProgress(null);
      const data = JSON.parse(request.responseText || "{}");
      if (request.status < 200 || request.status >= 300) setNotice(data.error || "The file could not be uploaded.");
      else { setNotice("File added to this session and its tutoring conversation."); void loadFiles(); }
    };
    request.send(form);
  }

  async function openFile(file: ClassroomFile) {
    setNotice("");
    const response = await fetch(`/api/classrooms/${encodeURIComponent(props.bookingId)}/files/${file.id}`, {
      headers: { Authorization: `Bearer ${props.accessToken}` },
    });
    const data = await response.json();
    if (!response.ok) { setNotice(data.error || "The file could not be opened."); return; }
    if (file.mime_type.startsWith("image/") || file.mime_type === "application/pdf" || file.mime_type.startsWith("text/")) {
      setPreview({ file, url: data.url });
    } else window.open(data.url, "_blank", "noopener,noreferrer");
  }

  async function removeFile(file: ClassroomFile) {
    if (!window.confirm(`Remove ${file.display_name} from this classroom?`)) return;
    const response = await fetch(`/api/classrooms/${encodeURIComponent(props.bookingId)}/files/${file.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${props.accessToken}` },
    });
    const data = await response.json();
    if (!response.ok) setNotice(data.error || "The file could not be removed.");
    else { setNotice("File removed."); void loadFiles(); }
  }

  const fileInput = <input ref={inputRef} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp,text/plain,text/markdown,.md" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.currentTarget.value = ""; }} />;

  /* In the room's 308px side panel the drop zone, the section heading and the
     40px type marks have no room, so files are the drawing's own list: name,
     right-aligned meta, one "Add a file" button under them. The preview dialog
     and every request below are shared with the full-width view. */
  if (props.compact) return (
    <div className="nb-roomfiles">
      {state === "loading" && <p className="nb-roomfiles__note">Loading files…</p>}
      {state === "error" && <p className="nb-roomfiles__note">Files could not load. <button className="nb-roomfiles__drop nb-roomfiles__name" onClick={loadFiles}>Try again</button></p>}
      {state === "ready" && files.length === 0 && <p className="nb-roomfiles__note">Nothing shared yet. Worksheets and reference files added here stay with this session.</p>}
      {files.map((file) => <div className="nb-roomfiles__row" key={file.id}>
        <button className="nb-roomfiles__name" onClick={() => openFile(file)}>{file.display_name}</button>
        <span className="nb-roomfiles__meta">{formatBytes(file.size_bytes)}</span>
        {file.uploader_id === props.userId && <button className="nb-roomfiles__name" onClick={() => removeFile(file)} aria-label={`Remove ${file.display_name}`}>Remove</button>}
      </div>)}
      {notice && <p className="nb-roomfiles__note" role="status">{notice}</p>}
      {progress !== null && <div className="classroom-upload-progress" role="progressbar" aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>}
      {!props.readOnly && <>
        <button className="nb-btn nb-btn--sm" style={{ alignSelf: "flex-start", marginTop: 4 }} onClick={() => inputRef.current?.click()} disabled={progress !== null}>{progress === null ? "Add a file" : "Uploading…"}</button>
        {fileInput}
      </>}
      {preview && <div className="classroom-preview-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-label={preview.file.display_name}><header><strong>{preview.file.display_name}</strong><div><a href={preview.url} target="_blank" rel="noreferrer">Download</a><button onClick={() => setPreview(null)} aria-label="Close preview">×</button></div></header>{preview.file.mime_type.startsWith("image/") ? <Image src={preview.url} alt={preview.file.display_name} width={1200} height={900} unoptimized /> : <iframe src={preview.url} title={preview.file.display_name} />}</section></div>}
    </div>
  );

  return (
    <section className="classroom-files" aria-labelledby="classroom-files-title">
      <div className="classroom-section-heading"><div><p>Session materials</p><h2 id="classroom-files-title">Files</h2></div>{!props.readOnly && <button onClick={() => inputRef.current?.click()}>Upload file</button>}</div>
      {!props.readOnly && <div
        className="classroom-file-drop"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) upload(file); }}
      >
        <strong>Drop a file here</strong><p>PDF, PNG, JPEG, WebP, text, or Markdown · 20 MB maximum</p>
        <input ref={inputRef} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp,text/plain,text/markdown,.md" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.currentTarget.value = ""; }} />
        {progress !== null && <div className="classroom-upload-progress" role="progressbar" aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>}
      </div>}
      {notice && <p className="classroom-inline-notice" role="status">{notice}</p>}
      {state === "loading" && <p className="classroom-empty">Loading files…</p>}
      {state === "error" && <div className="classroom-empty"><strong>Files could not load</strong><button onClick={loadFiles}>Try again</button></div>}
      {state === "ready" && files.length === 0 && <div className="classroom-empty"><strong>No files yet</strong><p>Shared worksheets and reference files will stay with this session.</p></div>}
      <div className="classroom-file-list">{files.map((file) => <article key={file.id}>
        <button className="classroom-file-open" onClick={() => openFile(file)}><span>{file.mime_type === "application/pdf" ? "PDF" : file.mime_type.startsWith("image/") ? "IMG" : "TXT"}</span><div><strong>{file.display_name}</strong><small>{formatBytes(file.size_bytes)} · {new Date(file.created_at).toLocaleString()}</small></div></button>
        {file.uploader_id === props.userId && <button className="classroom-file-delete" onClick={() => removeFile(file)} aria-label={`Remove ${file.display_name}`}>Remove</button>}
      </article>)}</div>
      {preview && <div className="classroom-preview-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-label={preview.file.display_name}><header><strong>{preview.file.display_name}</strong><div><a href={preview.url} target="_blank" rel="noreferrer">Download</a><button onClick={() => setPreview(null)} aria-label="Close preview">×</button></div></header>{preview.file.mime_type.startsWith("image/") ? <Image src={preview.url} alt={preview.file.display_name} width={1200} height={900} unoptimized /> : <iframe src={preview.url} title={preview.file.display_name} />}</section></div>}
    </section>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
