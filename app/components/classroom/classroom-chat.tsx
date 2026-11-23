"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Message = {
  id: string;
  sender_id: string;
  senderName: string;
  body: string;
  created_at: string;
  classroom_file_id?: string | null;
};

export function ClassroomChat(props: { bookingId: string; accessToken: string; userId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [classroomId, setClassroomId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Timestamp of the newest message this client has seen. Held in a ref rather than state
  // so updating it never triggers a render or re-runs the effects below.
  const newestRef = useRef<string | null>(null);

  const loadMessages = useCallback(async () => {
    // Asking only for messages newer than the last one we hold means a catch-up fetch —
    // after a realtime notification or a reconnect — returns just what changed, not the
    // whole conversation.
    const since = newestRef.current;
    const url = `/api/classrooms/${encodeURIComponent(props.bookingId)}/messages${since ? `?since=${encodeURIComponent(since)}` : ""}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${props.accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return;
    const data = await response.json();
    if (data.classroomId) setClassroomId(data.classroomId);
    const incoming: Message[] = data.messages || [];
    if (incoming.length === 0) return;

    setMessages((current) => {
      // De-duplicate by id: `since` is exclusive on time, but two messages can share a
      // timestamp, and a resend after a failed request could otherwise double up.
      const byId = new Map(current.map((message) => [message.id, message]));
      incoming.forEach((message) => byId.set(message.id, message));
      return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
    });

    const newest = incoming[incoming.length - 1]?.created_at;
    if (newest && (!newestRef.current || newest > newestRef.current)) newestRef.current = newest;
  }, [props.accessToken, props.bookingId]);

  useEffect(() => { void loadMessages(); }, [loadMessages]);

  // Realtime (Postgres pushing row changes over a WebSocket, instead of this client asking
  // "anything new?" on a timer) replaces the old 4s poll. The event only carries the raw
  // inserted row, not the joined sender name, so it just triggers the same `since`-scoped
  // fetch above rather than duplicating that name lookup client-side. `SUBSCRIBED` also
  // fires after a dropped connection reconnects, so that catch-up fetch also covers anything
  // sent while this client was briefly offline.
  useEffect(() => {
    const client = supabase;
    if (!classroomId || !client) return;
    const channel = client
      .channel(`classroom-messages-${classroomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "classroom_messages", filter: `classroom_id=eq.${classroomId}` },
        () => void loadMessages(),
      )
      .subscribe((status) => { if (status === "SUBSCRIBED") void loadMessages(); });
    return () => { void client.removeChannel(channel); };
  }, [classroomId, loadMessages]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setNotice("");
    const response = await fetch(`/api/classrooms/${encodeURIComponent(props.bookingId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${props.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const data = await response.json();
    setSending(false);
    if (!response.ok) setNotice(data.error || "Message not sent.");
    else {
      setDraft("");
      setMessages((current) => [...current, data.message]);
      const sentAt = data.message?.created_at;
      if (sentAt && (!newestRef.current || sentAt > newestRef.current)) newestRef.current = sentAt;
    }
  }

  /* The room's side panel already names this surface and carries the close
     button, so the chat has no header of its own. It replaced a fixed drawer;
     the polling, de-duplication and send above are unchanged from it. */
  return <div className="nb-roomchat">
    <div className="nb-roomchat__list" aria-live="polite">
      {messages.length === 0 && <p className="nb-roomchat__empty">Nothing said yet. This conversation stays inside this classroom.</p>}
      {messages.map((message) => <div key={message.id}>
        <p className="nb-roomchat__who">{message.sender_id === props.userId ? "You" : message.senderName} <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></p>
        <p className="nb-roomchat__body">{message.body}</p>
        {message.classroom_file_id && <small className="nb-roomchat__file">Secure classroom file</small>}
      </div>)}
      <div ref={endRef} />
    </div>
    {notice && <p className="nb-roomchat__alert" role="status">{notice}</p>}
    <form className="nb-roomchat__composer" onSubmit={send}>
      <span className="nb-field">
        <textarea value={draft} maxLength={4000} rows={1} placeholder="Message the room" aria-label="Message the room" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
      </span>
      <button type="submit" className="nb-btn nb-btn--sm" disabled={!draft.trim() || sending}>{sending ? "Sending…" : "Send"}</button>
    </form>
  </div>;
}
