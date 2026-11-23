"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DemoWhiteboard } from "@/app/components/classroom/whiteboard";
import { NbButton, NbChip } from "@/app/components/nb";

type ChatMessage = { id: string; from: "you" | "tutor"; body: string; at: number };

const TUTOR_REPLIES = [
  "Nice — try circling the part you're stuck on and I'll walk through it.",
  "Good instinct. Want me to sketch the next step, or do you want to try it?",
  "That's the idea. In a real session I'd see your board update live right here.",
  "Try the text tool on the board too — typed notes travel with the drawing.",
];

/**
 * A public, sign-in-free stand-in for the real tutoring classroom
 * (`classroom-client.tsx`), built from the exact same CSS classes and
 * whiteboard library so a visitor can see and use the real thing before
 * making an account. Nothing here calls a server, saves anywhere, or
 * connects to a second person — the camera preview is only ever this
 * visitor's own camera, and the "tutor" is a scripted chat partner.
 */
export function ClassroomDemo() {
  const [board] = useState<"whiteboard">("whiteboard");
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { id: "intro", from: "tutor", body: "This is a demo classroom — try drawing on the board, or send me a message.", at: Date.now() },
  ]);
  const [draft, setDraft] = useState("");
  const [tutorTyping, setTutorTyping] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const replyIndexRef = useRef(0);

  useEffect(() => {
    return () => { streamRef.current?.getTracks().forEach((track) => track.stop()); };
  }, []);

  // The <video> only mounts once cameraOn is true, so the stream is attached
  // here, after that render, rather than in toggleCamera (where the ref is still empty).
  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [cameraOn]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages, tutorTyping]);

  async function toggleCamera() {
    setCameraError("");
    if (cameraOn) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraOn(false);
      setMicOn(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      setCameraOn(true);
      setMicOn(true);
    } catch {
      setCameraError("Camera or microphone access was denied. Allow access in your browser settings and try again.");
    }
  }

  function toggleMic() {
    if (!streamRef.current) return;
    const next = !micOn;
    streamRef.current.getAudioTracks().forEach((track) => { track.enabled = next; });
    setMicOn(next);
  }

  function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setMessages((current) => [...current, { id: `${Date.now()}`, from: "you", body, at: Date.now() }]);
    setDraft("");
    setTutorTyping(true);
    window.setTimeout(() => {
      const reply = TUTOR_REPLIES[replyIndexRef.current % TUTOR_REPLIES.length];
      replyIndexRef.current += 1;
      setTutorTyping(false);
      setMessages((current) => [...current, { id: `${Date.now()}-tutor`, from: "tutor", body: reply, at: Date.now() }]);
    }, 1100);
  }

  return (
    <main className="classroom-demo-root nb-room" data-panel="open" data-board={board}>
      <section className="nb-room__board" aria-label="Shared workspace">
        <div className="nb-room__pane" data-active="true">
          <DemoWhiteboard />
        </div>
      </section>

      <div className="nb-room__scrim" aria-hidden="true" />
      <header className="nb-room__head">
        <Link href="/" className="nb-nav__brand" aria-label="Back to The Neighbrhood"><i className="nb-nav__mark" /><span>The Neighbrhood</span></Link>
        <span className="nb-room__title">Demo classroom</span>
        <span className="nb-room__note">nothing here is saved</span>
        <div className="nb-room__acts">
          <Link href="/auth?mode=sign-up" className="nb-btn nb-btn--onstage nb-btn--sm">Book a real session</Link>
          <Link href="/" className="nb-btn nb-btn--onstage nb-btn--sm">Exit demo</Link>
        </div>
      </header>

      {cameraError ? (
        <div className="nb-room__notice" role="alert">
          {cameraError}
          <button onClick={() => setCameraError("")}>Dismiss</button>
        </div>
      ) : bannerOpen && (
        <div className="nb-room__notice" role="status">
          This is a demo — the whiteboard, camera and chat are all local to your browser and nothing is sent to anyone.
          <button onClick={() => setBannerOpen(false)}>Dismiss</button>
        </div>
      )}

      <div className="nb-room__bar">
        <NbChip current={micOn} onClick={toggleMic} disabled={!cameraOn}>{micOn ? "Mic on" : "Mic off"}</NbChip>
        <NbChip current={cameraOn} onClick={() => void toggleCamera()}>{cameraOn ? "Camera on" : "Camera off"}</NbChip>
      </div>

      <aside className="nb-room__side" aria-label="Participants and chat">
        <div className="nb-room__people">
          <div className="nb-room__tile" data-empty="true">
            <span className="nb-room__initials" aria-hidden="true">DT</span>
            <span className="nb-room__tilelabel">Demo tutor</span>
          </div>
          <div className="nb-room__tile nb-room__tile--self" data-empty={!cameraOn}>
            {cameraOn
              ? <video ref={videoRef} autoPlay playsInline muted className="classroom-demo-video" />
              : <span className="nb-room__initials" aria-hidden="true">Y</span>}
            <span className="nb-room__tilelabel">You</span>
          </div>
        </div>

        <div className="nb-room__panel">
          <header className="nb-room__panelhead"><NbButton size="sm" variant="ghost" disabled>Chat</NbButton></header>
          <div className="nb-roomchat">
            <div className="nb-roomchat__list" aria-live="polite">
              {messages.map((message) => (
                <div key={message.id}>
                  <p className="nb-roomchat__who">{message.from === "you" ? "You" : "Demo tutor"} <time>{new Date(message.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></p>
                  <p className="nb-roomchat__body">{message.body}</p>
                </div>
              ))}
              {tutorTyping && <p className="nb-roomchat__body">Demo tutor is typing…</p>}
              <div ref={endRef} />
            </div>
            <form className="nb-roomchat__composer" onSubmit={send}>
              <span className="nb-field">
                <textarea value={draft} maxLength={4000} rows={1} placeholder="Message the room" aria-label="Message the room" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
              </span>
              <button type="submit" className="nb-btn nb-btn--sm" disabled={!draft.trim()}>Send</button>
            </form>
          </div>
        </div>
      </aside>
    </main>
  );
}
