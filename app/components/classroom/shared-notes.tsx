"use client";

import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLiveblocksExtension } from "@liveblocks/react-tiptap";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Mathematics from "@tiptap/extension-mathematics";
import { common, createLowlight } from "lowlight";
// Scoped here rather than the root layout so these only ship on the classroom route.
import "@liveblocks/react-ui/styles.css";
import "@liveblocks/react-tiptap/styles.css";
import "katex/dist/katex.min.css";

const lowlight = createLowlight(common);

/**
 * Safety net only — the actual fix is AwarenessPrimer in collaboration-room.tsx, which
 * prevents Liveblocks' Tiptap collaboration-cursor extension from ever reading a null
 * local awareness state. If something else still throws here, show a manual retry
 * instead of auto-remounting: an unconditional timed retry previously turned a
 * deterministic crash into an infinite crash loop.
 */
class NotesErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="classroom-workspace-loading" role="status">
          <p>Shared notes hit a problem.</p>
          <button onClick={() => this.setState({ hasError: false })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ClassroomSharedNotes(props: { readOnly: boolean }) {
  return (
    <NotesErrorBoundary>
      <ClassroomSharedNotesEditor {...props} />
    </NotesErrorBoundary>
  );
}

function ClassroomSharedNotesEditor(props: { readOnly: boolean }) {
  const [mathMode, setMathMode] = useState<"inline" | "block" | null>(null);
  const [latex, setLatex] = useState(String.raw`\frac{a}{b}`);
  const liveblocks = useLiveblocksExtension({
    field: "shared-notes",
    comments: false,
    mentions: false,
    offlineSupport_experimental: true,
    initialContent: props.readOnly ? undefined : "<h2>Shared session notes</h2><p>Use this space for the ideas, examples, and next steps you want to keep.</p>",
  });
  const extensions = useMemo(() => [
    liveblocks,
    StarterKit.configure({ undoRedo: false, codeBlock: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit,
    CodeBlockLowlight.configure({ lowlight }),
    Mathematics.configure({ katexOptions: { throwOnError: false, trust: false } }),
  ], [liveblocks]);
  const editor = useEditor({ extensions, immediatelyRender: false, editable: !props.readOnly });

  useEffect(() => { editor?.setEditable(!props.readOnly); }, [editor, props.readOnly]);

  if (!editor) return <div className="classroom-workspace-loading"><p>Opening shared notes…</p></div>;

  function addLink() {
    const current = editor?.getAttributes("link").href || "";
    const href = window.prompt("Paste a secure link", current);
    if (href === null) return;
    if (!href) editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  function insertMath() {
    if (!editor || !mathMode || !latex.trim()) return;
    if (mathMode === "inline") editor.chain().focus().insertInlineMath({ latex: latex.trim() }).run();
    else editor.chain().focus().insertBlockMath({ latex: latex.trim() }).run();
    setMathMode(null);
  }

  function downloadNotes() {
    if (!editor) return;
    const blob = new Blob([editor.getText({ blockSeparator: "\n\n" })], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "classroom-notes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="classroom-notes" aria-label="Shared notes">
      {!props.readOnly && <div className="classroom-notes-toolbar" role="toolbar" aria-label="Notes formatting">
        <button data-active={editor.isActive("paragraph")} onClick={() => editor.chain().focus().setParagraph().run()}>Text</button>
        <button data-active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>Heading</button>
        <span className="classroom-toolbar-divider" aria-hidden="true" />
        <button data-active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong><span>Bold</span></button>
        <button data-active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em><span>Italic</span></button>
        <button data-active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u><span>Underline</span></button>
        <button data-active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}><code>&lt;/&gt;</code><span>Inline code</span></button>
        <button onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</button>
        <button onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</button>
        <button onClick={() => editor.chain().focus().toggleTaskList().run()}>Checklist</button>
        <button onClick={() => editor.chain().focus().toggleBlockquote().run()}>Quote</button>
        <button onClick={() => editor.chain().focus().toggleCodeBlock().run()}>Code block</button>
        <button onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Table</button>
        <button onClick={addLink}>Link</button>
        <button onClick={() => { setLatex(String.raw`\frac{a}{b}`); setMathMode("inline"); }}>Inline math</button>
        <button onClick={() => { setLatex(String.raw`\int_{a}^{b} f(x)\,dx`); setMathMode("block"); }}>Equation</button>
        <span className="classroom-toolbar-divider" aria-hidden="true" />
        <button onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>Undo</button>
        <button onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>Redo</button>
        <button className="classroom-notes-download" onClick={downloadNotes}>Download notes</button>
      </div>}
      <div className="classroom-notes-status"><span>{props.readOnly ? "Session notes · read only" : "Changes sync automatically"}</span><small>{props.readOnly ? "Review material from this session" : "Both participants can edit at the same time"}</small></div>
      <EditorContent editor={editor} className="classroom-notes-editor" />
      {mathMode && <div className="classroom-notes-math" role="dialog" aria-modal="true" aria-label="Insert math">
        <label>LaTeX<textarea autoFocus value={latex} onChange={(event) => setLatex(event.target.value)} /></label>
        <div><button onClick={() => setMathMode(null)}>Cancel</button><button onClick={insertMath}>Insert {mathMode === "inline" ? "inline math" : "equation"}</button></div>
      </div>}
    </section>
  );
}
