# Tutoring classroom setup and operations

The classroom code is production-oriented but deliberately setup-gated. It does not create demo rooms, provider tokens, or fake participants when a provider is missing.

## 1. Provider accounts

Create one LiveKit Cloud project for audio, video, screen sharing, device handling, and media reconnection. Add its WebSocket URL, API key, and API secret to the server environment.

Create one Liveblocks project for the persistent Excalidraw board, Tiptap notes, presence, cursors, and reconnectable collaborative state. Add its secret key to the server environment. The server creates each room with empty default access and explicitly grants only the booking student and tutor.

The whiteboard is Excalidraw, which needs no licence key or service account. KaTeX equation rendering does not either.

## 2. Environment variables

Copy the safe names in `.env.example` into the deployment environment:

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEBLOCKS_SECRET_KEY=...
CLASSROOM_FILE_MAX_BYTES=20971520
```

`LIVEKIT_API_SECRET` and `LIVEBLOCKS_SECRET_KEY` are server-only. Never expose them with a `NEXT_PUBLIC_` prefix. The optional file limit can lower, but not exceed, the private bucket's hard 20 MB limit.

## 3. Supabase

Apply `supabase/migrations/20260817150557_tutoring_digital_classroom.sql`. It adds:

- a canonical booking duration;
- one opaque classroom per booking;
- durable artifact, private-file, and audit metadata;
- participant-only RLS and tutor-only end enforcement;
- the private `classroom-files` bucket and MIME/size policies;
- a file reference on the existing booking-linked tutoring chat.

Provider rooms never replace Supabase authorization. Every token, upload, download, message, and lifecycle request resolves the Supabase user and booking participants again. Admin status alone does not grant classroom access.

## 4. Launch verification

Use two isolated browser profiles with authorized fixture accounts: the assigned student and tutor for one confirmed booking. Schedule the fixture so the join window is open.

1. Open the session from Tutoring → Sessions in both profiles.
2. Verify camera/microphone denial, device switching, join, reconnect, screen share, and participant presence.
3. Draw simultaneously, add and edit a LaTeX equation, and edit notes concurrently.
4. Refresh each client and confirm board, notes, chat, and files persist.
5. Upload each allowed file type, verify progress and private preview, then reject an executable and an oversize file.
6. Confirm only the uploader can remove a file and only the tutor can end the room.
7. End the session and confirm the board, notes, and files are read-only from session materials.
8. Attempt the classroom/API/storage URLs from a third authenticated account and confirm no booking or artifact data is returned.
9. Run `pnpm test`, `pnpm lint`, `pnpm build`, then the Supabase security and performance advisors.

## 5. Failure and support expectations

Media and collaboration are intentionally independent. If LiveKit reconnects, the board and notes remain available. If Liveblocks reconnects, the call remains active. Refresh obtains new short-lived credentials. Leaving disconnects one user; it does not end the session. The tutor must explicitly end for both participants.

No classroom is recorded. No transcription, AI notes, handwriting recognition, guest access, group room, payment, or public sharing is enabled.

## 6. Cost and deferred hardening

Watch LiveKit participant minutes and egress, Liveblocks active users/rooms/storage, and Supabase database/storage/egress. Private files are restricted by allowlist and size, but launch at broader scale should add asynchronous malware scanning and quarantine before adding Office archives or other complex formats.
