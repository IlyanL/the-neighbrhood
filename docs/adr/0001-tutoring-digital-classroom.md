# ADR 0001: Tutoring digital classroom

> **Superseded in part (2026-09-04):** the whiteboard is **Excalidraw**, not
> tldraw. There is no licence key — `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` does not
> exist and is not a launch dependency. The rest of the decision stands.

- Status: Accepted for Phase 5 implementation
- Date: 2026-08-17

## Context

The Neighbrhood already owns verified identity, tutor capability, bookings, session state, messages, notifications, and private session files in Supabase. A confirmed one-to-one tutoring session now needs a focused classroom with media, a persistent shared board and notes, secure files, and the existing booking conversation. Building raw WebRTC signalling or a custom collaborative document protocol would add security, reliability, and operating work that is not core to the campus product.

## Decision

Managed providers supply realtime infrastructure while Supabase remains the authorization and durable application source of truth.

- **LiveKit** carries audio, video, screen share, track/device state, and media reconnection. A server route authenticates the Supabase access token, resolves the booking participants and opaque classroom room name, then issues a short-lived, room-scoped token. It never accepts an identity or room name from the browser.
- **Liveblocks** carries protected presence and durable collaborative state. A server route performs the same independent booking-participant check, provisions a room with no default access, grants only the student and tutor access, and issues an ID token. Its secret remains server-only.
- **tldraw** renders the whiteboard and stores its multiplayer records in the classroom Liveblocks room. Local development may run without a key; an appropriate domain-scoped `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` is a production launch dependency.
- **Tiptap** renders the shared notes document. `@liveblocks/react-tiptap` provides durable collaborative editing and cursors in a dedicated field of the same protected Liveblocks room. KaTeX renders inline and block LaTeX without an AI service.
- **Supabase** owns authentication, the booking and participant relationship, classroom lifecycle, opaque provider identifiers, artifact and file metadata, the existing booking-linked chat thread/messages, notifications, and a small audit trail. Classroom objects live in a private `classroom-files` bucket and are served only with participant-authorized short-lived URLs.

## Authorization and identifiers

The browser supplies only a booking or classroom identifier plus its current Supabase bearer token. Every classroom route resolves the current user with Supabase Auth and queries the booking under participant-only RLS. Eligibility requires a confirmed booking for live entry; completed bookings permit read-only materials; cancelled, declined, requested, and unrelated bookings do not permit entry. Approved tutors retain ordinary student behaviour when they are the booking student.

One `tutoring_classrooms` row is protected by a unique `booking_id`, so simultaneous provisioning converges on one room. LiveKit room names, Liveblocks room IDs, file object paths, and artifact references are random opaque values and contain no names, email addresses, courses, or provider secrets.

## Lifecycle and persistence

The join window opens ten minutes before the scheduled start. The lobby verifies browser support and lets a participant choose devices before connecting. The timer is informational and does not disconnect at the scheduled end. Leaving disconnects one participant; ending is a separate tutor-only lifecycle transition. Confirmed rooms move from `scheduled` to `live` on first entry and to `ended` explicitly. A booking cancellation makes its classroom non-joinable. Completed or ended classrooms expose whiteboard, notes, and files read-only from the session summary.

Liveblocks durably persists board and notes state; Supabase stores artifact references rather than high-frequency edits. Files and chat persist in Supabase. Refresh and temporary provider outages reconnect each subsystem independently. The UI reports “media” and “shared workspace” state without requiring users to diagnose provider brands.

## Failure behaviour

- Missing provider keys never create fake tokens or simulated participants. The lobby explains which capability is unavailable while materials and existing messages remain accessible where authorized.
- Media and collaboration failures are isolated: LiveKit loss does not discard notes/board state, and Liveblocks loss does not end media.
- Idempotent database provisioning prevents duplicate classrooms. Upload validation happens in the server route and at the private bucket limit; interrupted uploads leave no metadata row.
- Short-lived tokens are requested again after refresh or expiry. Provider secrets and tokens are never logged.

## Operations, accounts, licensing, and cost

Required launch setup is one LiveKit project (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`), one Liveblocks project (`LIVEBLOCKS_SECRET_KEY`), a production tldraw license (`NEXT_PUBLIC_TLDRAW_LICENSE_KEY`) covering every deployment hostname, and the existing Supabase project with `SUPABASE_SERVICE_ROLE_KEY` available only to server routes that genuinely need privileged storage operations.

Recurring cost is driven by LiveKit participant minutes and media egress, Liveblocks monthly active users/rooms/storage, Supabase database and private file storage/egress, and the chosen tldraw license. No recording or raw media storage is enabled. Production should add malware scanning before expanding the allowed file types.

## Deliberately deferred

Recording, snapshots of people, transcription/captions, AI notes, handwriting recognition, executable code, group rooms, guest links, breakout rooms, reactions, polls, public sharing, payments, and attention tracking remain out of scope. Admin support access to a live room also remains out of scope because it requires explicit participant consent and a separately audited design.

