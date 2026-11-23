"use client";

import { useState } from "react";
import type { Booking, ChatMessage, ChatThread, NotificationItem } from "@/app/components/page-types";
import type { NavigationTarget, ViewName } from "@/app/components/product-navigation";
import { NbAvatar, NbChip, NbChipRow, NbPill, NbTag } from "@/app/components/nb";

type ChatFilter = "all" | "tutoring" | "housing" | "event" | "unread";

const AVATAR_TONE: Record<ChatThread["contextType"], string> = {
  tutoring: "var(--category-tutor)",
  housing: "var(--door-house)",
  event: "var(--door-club)",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function countWord(value: number) {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][value] ?? String(value);
}

export function ChatView(props: {
  userEmail: string | null;
  currentUserId: string | null;
  threads: ChatThread[];
  selectedThreadId: string;
  setSelectedThreadId: (id: string) => void;
  messages: ChatMessage[];
  draft: string;
  setDraft: (value: string) => void;
  sendChatMessage: (event: React.FormEvent<HTMLFormElement>) => void;
  isSendingMessage: boolean;
  bookings: Booking[];
  notifications: NotificationItem[];
  goTo: (view: ViewName, target?: NavigationTarget) => void;
  onSelectThread: (threadId: string, bookingId?: string) => void;
}) {
  const [filter, setFilter] = useState<ChatFilter>("all");

  if (!props.userEmail) {
    return (
      <div className="nb-pad">
        <div className="nb-panel">
          <p className="nb-panel__title">Log in to use messages</p>
          <a href="/auth?mode=sign-in" className="nb-btn nb-btn--solid" style={{ marginTop: "18px" }}>Log in</a>
        </div>
      </div>
    );
  }

  const selectedThread = props.threads.find((thread) => thread.id === props.selectedThreadId);
  const selectedMessages = props.messages.filter((message) => message.threadId === selectedThread?.id);
  const chatTitle = (thread: ChatThread) => props.currentUserId === thread.tutorId ? thread.studentName : thread.tutorName;
  const chatContext = (thread: ChatThread) => thread.contextType === "tutoring" ? props.bookings.find((booking) => booking.id === thread.bookingId || (booking.studentId === thread.studentId && booking.tutorId === thread.tutorId)) : undefined;
  const contextLabel = (thread: ChatThread) => thread.contextType === "housing" ? `Housing · ${thread.contextTitle || "Listing inquiry"}` : thread.contextType === "event" ? `Event · ${thread.contextTitle || "Organizer question"}` : chatContext(thread) ? `${chatContext(thread)?.courseCode} · Tutoring` : thread.contextTitle || "Tutoring conversation";
  const isUnread = (thread: ChatThread) => props.notifications.some((notification) => notification.threadId === thread.id && !notification.readAt);

  const filteredThreads = props.threads.filter((thread) => {
    if (filter === "unread") return isUnread(thread);
    if (filter === "all") return true;
    return thread.contextType === filter;
  });
  const waitingCount = props.threads.filter(isUnread).length;
  const convoCountLabel = waitingCount > 0
    ? `${filteredThreads.length} of ${props.threads.length} conversations · ${countWord(waitingCount)} waiting on you`
    : `${filteredThreads.length} of ${props.threads.length} conversations`;

  return (
    <div className="nb-pad">
      <div className="nb-inbox__filters">
        <NbChipRow>
          <NbChip current={filter === "all"} onClick={() => setFilter("all")}>All</NbChip>
          <NbChip current={filter === "tutoring"} onClick={() => setFilter("tutoring")}>Tutoring</NbChip>
          <NbChip current={filter === "housing"} onClick={() => setFilter("housing")}>Housing</NbChip>
          <NbChip current={filter === "event"} onClick={() => setFilter("event")}>Event</NbChip>
          <NbChip current={filter === "unread"} onClick={() => setFilter("unread")}>Unread</NbChip>
        </NbChipRow>
        <span className="nb-sec__count" style={{ marginLeft: "auto" }}>{convoCountLabel}</span>
      </div>

      <div className="nb-inbox">
        <aside className="nb-inbox__list">
          {filteredThreads.length === 0 && (
            <p className="nb-inbox__note">
              {props.threads.length === 0 ? "No conversations yet. Message a tutor, a housing owner, or an event organizer from their page." : "Nothing in this filter."}
            </p>
          )}
          {filteredThreads.map((thread) => {
            const unread = isUnread(thread);
            return (
              <button
                key={thread.id}
                type="button"
                className="nb-convo"
                data-active={selectedThread?.id === thread.id ? "true" : undefined}
                onClick={() => { props.setSelectedThreadId(thread.id); props.onSelectThread(thread.id, thread.bookingId); }}
              >
                <span className="nb-convo__top">
                  <NbAvatar small style={{ background: AVATAR_TONE[thread.contextType], color: "#fff" }}>{initials(chatTitle(thread))}</NbAvatar>
                  <span className="nb-convo__body">
                    <span className="nb-convo__nameRow">
                      <b className="nb-convo__name">{chatTitle(thread)}</b>
                      <span className="nb-convo__when">{thread.updatedAt}</span>
                    </span>
                  </span>
                </span>
                <span className="nb-convo__foot">
                  <NbTag>{contextLabel(thread)}</NbTag>
                  {unread && <NbPill tone="attention">New</NbPill>}
                </span>
              </button>
            );
          })}
        </aside>

        <main className="nb-inbox__main">
          {selectedThread ? (
            <>
              <header className="nb-inbox__head">
                <NbAvatar small style={{ background: AVATAR_TONE[selectedThread.contextType], color: "#fff" }}>{initials(chatTitle(selectedThread))}</NbAvatar>
                <div className="nb-inbox__who">
                  <h2>{chatTitle(selectedThread)}</h2>
                  <p className="nb-inbox__meta">{contextLabel(selectedThread)}</p>
                </div>
                <div className="nb-inbox__actions">
                  {selectedThread.contextType === "tutoring" && selectedThread.bookingId && (
                    <button type="button" className="nb-btn nb-btn--sm" onClick={() => props.goTo("My Sessions", { bookingId: selectedThread.bookingId })}>Session</button>
                  )}
                </div>
              </header>

              <div className="nb-inbox__stream">
                {selectedMessages.length === 0 && (
                  <p className="nb-inbox__note">No messages yet. Send the first one below.</p>
                )}
                {selectedMessages.map((message) => {
                  const isMine = message.senderId === props.currentUserId;
                  return (
                    <div key={message.id} className={`nb-msg${isMine ? " nb-msg--mine" : ""}`}>
                      <div className="nb-msg__bubble">{message.body}</div>
                      <span className="nb-msg__stamp">{message.createdAt}</span>
                    </div>
                  );
                })}
              </div>

              <form onSubmit={props.sendChatMessage} className="nb-inbox__composer">
                <label className="nb-field">
                  <input
                    value={props.draft}
                    onChange={(event) => props.setDraft(event.target.value)}
                    placeholder={`Write to ${chatTitle(selectedThread)}…`}
                    aria-label="Message"
                  />
                </label>
                <button type="submit" className="nb-btn nb-btn--solid" disabled={props.isSendingMessage || !props.draft.trim()}>
                  {props.isSendingMessage ? "Sending…" : "Send"}
                </button>
              </form>
            </>
          ) : (
            <div className="nb-inbox__empty">Select a conversation to begin.</div>
          )}
        </main>
      </div>
    </div>
  );
}
