"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ConnectionStateToast,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  PreJoin,
  RoomAudioRenderer,
  StartAudio,
  useLocalParticipant,
  useMediaDeviceSelect,
  useRemoteParticipants,
  useRoomContext,
  useTracks,
  type PreJoinProps,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { supabase } from "@/lib/supabase/client";
import { NeighbrhoodBrand, NeighbrhoodLoader } from "@/app/components/brand";
import { NbButton, NbChip, NbChipRow, NbPill } from "@/app/components/nb";
import { CLASSROOM_JOIN_WINDOW_MINUTES } from "@/lib/classroom/policy";
import { ClassroomCollaborationRoom } from "@/app/components/classroom/collaboration-room";
import { ClassroomWhiteboard } from "@/app/components/classroom/whiteboard";
import { ClassroomSharedNotes } from "@/app/components/classroom/shared-notes";
import { ClassroomFiles } from "@/app/components/classroom/classroom-files";
import { ClassroomChat } from "@/app/components/classroom/classroom-chat";
// Scoped here rather than the root layout so it only ships on the classroom route.
import "@livekit/components-styles";

type JoinChoices = Parameters<NonNullable<PreJoinProps["onSubmit"]>>[0];
type Workspace = "whiteboard" | "notes" | "files";
/* The room's stage carries the board and the shared notes; Files moved into the
   side panel beside Chat, where the redesign puts it. */
type Board = "whiteboard" | "notes";
/* `@livekit/components-core` is a transitive dependency, not one this app
   declares, so the track-reference type is read back off the hook instead of
   imported from a package package.json does not name. */
type RoomTrack = ReturnType<typeof useTracks>[number];
type SidePanel = "chat" | "files" | null;

type ClassroomPayload = {
  classroom: null | {
    id: string;
    booking_id: string;
    liveblocks_room_id: string;
    status: "scheduled" | "live" | "ended" | "cancelled";
  };
  booking: {
    id: string;
    courseCode: string;
    deliveryMode: string;
    topic: string | null;
    status: string;
    requestedStart: string;
    requestedEnd: string | null;
    durationMinutes: number;
    participantRole: "student" | "tutor";
    studentName: string;
    tutorName: string;
    currentName: string;
  };
  join: {
    access: "interactive" | "read-only" | "unavailable";
    canJoin: boolean;
    opensAt: string;
    scheduledStart: string;
    scheduledEnd: string;
    isBeforeWindow: boolean;
    isLate: boolean;
  };
  providers: {
    media: { configured: boolean };
    collaboration: { configured: boolean };
  };
};

export function ClassroomClient(props: { bookingId: string; summary?: boolean }) {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState("");
  const [userId, setUserId] = useState("");
  const [payload, setPayload] = useState<ClassroomPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [choices, setChoices] = useState<JoinChoices | null>(null);
  const [media, setMedia] = useState<{ token: string; url: string } | null>(null);
  const [entered, setEntered] = useState(false);

  const load = useCallback(async (token: string, provision = true) => {
    const response = await fetch(`/api/classrooms/${encodeURIComponent(props.bookingId)}`, {
      method: provision ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: provision ? JSON.stringify({ action: "provision" }) : undefined,
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "This classroom could not be opened.");
    setPayload(data);
    setState("ready");
    return data as ClassroomPayload;
  }, [props.bookingId]);

  useEffect(() => {
    let active = true;
    async function boot() {
      const session = await supabase?.auth.getSession();
      const token = session?.data.session?.access_token || "";
      const id = session?.data.session?.user.id || "";
      if (!token || !id) { router.push("/auth?mode=sign-in"); return; }
      setAccessToken(token); setUserId(id);
      try { if (active) await load(token, true); }
      catch (error) { if (active) { setNotice(error instanceof Error ? error.message : "This classroom is unavailable."); setState("error"); } }
    }
    void boot();
    return () => { active = false; };
  }, [load, router]);

  useEffect(() => {
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) setAccessToken(session.access_token);
    });
    return () => subscription?.data.subscription.unsubscribe();
  }, []);

  // While waiting to join, a booking/classroom status change (cancelled, tutor started the
  // room, …) arrives instantly over this realtime subscription (Postgres pushing the row
  // change over a WebSocket) instead of waiting up to 10s for a poll to notice it. The join
  // window itself (`join.opensAt`) is just wall-clock time, not something the database can
  // push a change for, so the 60s timer below stays as a lightweight safety net for that —
  // and for the realtime connection itself ever silently dropping.
  useEffect(() => {
    const client = supabase;
    if (!accessToken || entered || props.summary || !client) return;
    const channel = client
      .channel(`classroom-status-${props.bookingId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${props.bookingId}` },
        () => void load(accessToken, false).catch(() => undefined),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tutoring_classrooms", filter: `booking_id=eq.${props.bookingId}` },
        () => void load(accessToken, false).catch(() => undefined),
      )
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [accessToken, entered, load, props.bookingId, props.summary]);

  useEffect(() => {
    if (!accessToken || entered || props.summary) return;
    const timer = window.setInterval(() => void load(accessToken, false).catch(() => undefined), 60_000);
    return () => window.clearInterval(timer);
  }, [accessToken, entered, load, props.summary]);

  useEffect(() => {
    if (!entered) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [entered]);

  async function enterClassroom(values: JoinChoices) {
    if (!accessToken || !payload) return;
    setNotice("");
    if (!payload.join.canJoin) { setNotice(`The classroom opens ${new Date(payload.join.opensAt).toLocaleString()}.`); return; }
    const response = await fetch(`/api/classrooms/${encodeURIComponent(props.bookingId)}/livekit-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json();
    if (!response.ok) { setNotice(data.error || "Media could not connect."); return; }
    const started = await fetch(`/api/classrooms/${encodeURIComponent(props.bookingId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    if (!started.ok) { const error = await started.json(); setNotice(error.error || "The classroom could not start."); return; }
    setChoices(values); setMedia({ token: data.token, url: data.url }); setEntered(true);
  }

  if (state === "loading") return <ClassroomLoading />;
  if (state === "error" || !payload || !payload.classroom) return <ClassroomUnavailable message={notice || "This classroom is unavailable."} />;
  if (props.summary || payload.join.access === "read-only" || payload.classroom.status === "ended") {
    return <ClassroomSummary payload={payload} accessToken={accessToken} userId={userId} />;
  }
  if (payload.join.access === "unavailable") return <ClassroomUnavailable message={bookingUnavailableMessage(payload.booking.status)} />;
  if (!payload.providers.media.configured) return <ClassroomUnavailable message="Live classroom media is not configured yet. Your booking and existing tutoring conversation are still safe." setup />;

  if (!entered || !choices || !media) {
    return <ClassroomLobby payload={payload} notice={notice} onEnter={enterClassroom} />;
  }

  return (
    <LiveKitRoom
      token={media.token}
      serverUrl={media.url}
      connect
      audio={choices.audioEnabled ? { deviceId: choices.audioDeviceId } : false}
      video={choices.videoEnabled ? { deviceId: choices.videoDeviceId } : false}
      onConnected={() => void audit(accessToken, props.bookingId, "joined")}
      onDisconnected={() => { void audit(accessToken, props.bookingId, "left"); setEntered(false); setMedia(null); }}
      onError={(error) => setNotice(readableMediaError(error))}
      onMediaDeviceFailure={() => setNotice("A camera or microphone became unavailable. Check your browser permissions and device connection.")}
      className="classroom-livekit-root"
      data-lk-theme="default"
    >
      <LayoutContextProvider>
        <LiveClassroom payload={payload} accessToken={accessToken} userId={userId} notice={notice} setNotice={setNotice} />
      </LayoutContextProvider>
      <RoomAudioRenderer />
      <StartAudio label="Tap to enable classroom audio" />
      <ConnectionStateToast />
    </LiveKitRoom>
  );
}

function ClassroomLobby(props: { payload: ClassroomPayload; notice: string; onEnter: (values: JoinChoices) => void }) {
  const booking = props.payload.booking;
  const support = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  const live = props.payload.classroom?.status === "live";
  const other = booking.participantRole === "tutor" ? booking.studentName : booking.tutorName;
  const otherRole = booking.participantRole === "tutor" ? "your student" : "your tutor";
  return <main className="nb-lobby">
    {/* The prototype drew this bar as a hairline-bordered white strip, the one
        place in the app the nav does not sit under the scrim. It does here now.
        No spectrum rail below it: the scrim's own fade is the separator, and a
        rail at the nav's 64px would sit mid-gradient and read as mud. */}
    <div className="nb-stage nb-lobby__stage">
      <div className="nb-nav nb-nav--onstage nb-lobby__nav">
        <Link href="/" className="nb-nav__brand" aria-label="The Neighbrhood home"><i className="nb-nav__mark" />The Neighbrhood</Link>
        <div className="nb-nav__actions">
          <NbPill tone="flat">{booking.courseCode} · {booking.deliveryMode}</NbPill>
          <Link href="/?view=My%20Sessions" className="nb-btn nb-btn--onstage nb-btn--sm">Back to sessions</Link>
        </div>
      </div>
    </div>

    <div className="nb-pad nb-lobby__body">
      <div className="nb-lobby__grid">
        <div className="nb-lobby__main">
          <p className="nb-lobby__eyebrow">Tutoring · Classroom</p>
          <h1>Check your camera and microphone.</h1>
          <p className="nb-lobby__lede">The classroom opens ten minutes before the booked hour. Nothing is recorded, and the whiteboard is saved to the session for both of you.</p>

          <dl className="nb-lobby__facts">
            <div className="nb-lobby__fact"><dt>When</dt><dd>{formatSessionWindow(props.payload.join.scheduledStart, props.payload.join.scheduledEnd)}</dd></div>
            <div className="nb-lobby__fact"><dt>Who</dt><dd>{other}, {otherRole}</dd></div>
            {booking.topic && <div className="nb-lobby__fact"><dt>Focus</dt><dd>{booking.topic}</dd></div>}
            <div className="nb-lobby__fact"><dt>Delivery</dt><dd>{booking.deliveryMode} · {booking.durationMinutes} minutes</dd></div>
          </dl>

          <p className="nb-lobby__presence" data-live={live}>
            <i className="nb-lobby__dot" />
            {live ? `${other} is already in the classroom. You can go in.` : `${other} has not entered yet.`}
          </p>
          <p className="nb-lobby__fine">Leaving the classroom early does not end the booked hour — the room stays open for {other} until the scheduled time is up.</p>

          {!support && <p className="nb-lobby__note" data-alert="true" role="alert">This browser cannot access classroom media. Try a current version of Chrome, Safari, Firefox, or Edge.</p>}
          {props.notice && <p className="nb-lobby__note" data-alert="true" role="alert">{props.notice}</p>}
          {props.payload.join.isBeforeWindow && <p className="nb-lobby__note">Join opens {formatClock(props.payload.join.opensAt)}.</p>}
        </div>

        <div className="nb-lobby__card">
          {/* LiveKit's PreJoin already renders the drawing's four rows in the
              drawing's order — preview, the two device buttons, the display-name
              field, then the join button — so the card restyles it rather than
              rebuilding it. Rebuilding would have dropped device *selection*,
              which the picture has no room for but this app has always had. */}
          {/* `--prejoin-initials` is the camera-off preview's monogram. It has to travel
              as a custom property because the element that shows it is LiveKit's, not
              ours — see .lk-camera-off-note in globals.css. The quotes are part of the
              value: it lands in a CSS `content`. */}
          <div className="classroom-prejoin" aria-label="Device preview" style={{ "--prejoin-initials": `"${initials(booking.currentName)}"` } as CSSProperties}>
            <PreJoin defaults={{ username: booking.currentName, audioEnabled: true, videoEnabled: true }} joinLabel={props.payload.join.canJoin ? "Join classroom" : "Classroom not open yet"} userLabel="How your name shows in the room" micLabel="Microphone" camLabel="Camera" persistUserChoices onValidate={() => props.payload.join.canJoin && support} onSubmit={props.onEnter} onError={(error) => console.warn("Device preview failed", error.message)} />
          </div>
          <p className="nb-lobby__foot">Camera and microphone are used for this hour only.</p>
        </div>
      </div>
    </div>
  </main>;
}

function LiveClassroom(props: { payload: ClassroomPayload; accessToken: string; userId: string; notice: string; setNotice: (value: string) => void }) {
  const [board, setBoard] = useState<Board>("whiteboard");
  const [panel, setPanel] = useState<SidePanel>("chat");
  const [helpOpen, setHelpOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const room = useRoomContext();
  const remoteParticipants = useRemoteParticipants();
  const booking = props.payload.booking;
  const endingRef = useRef(false);
  const warnedRef = useRef(false);

  const scheduledEndMs = new Date(booking.requestedStart).getTime() + booking.durationMinutes * 60_000;
  const autoEndMs = scheduledEndMs + CLASSROOM_JOIN_WINDOW_MINUTES * 60_000;
  const timeIsUp = now >= scheduledEndMs;
  const bothPresent = remoteParticipants.length > 0;

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(timer); }, []);

  async function leave() {
    if (!window.confirm("Leave the classroom? The session will stay open for the other participant.")) return;
    await room.disconnect();
  }
  async function end(auto = false) {
    if (endingRef.current) return;
    if (!auto && !window.confirm("End this tutoring session for both participants? Session materials will become read-only.")) return;
    endingRef.current = true;
    setEnding(true);
    const response = await fetch(`/api/classrooms/${encodeURIComponent(booking.id)}`, { method: "POST", headers: { Authorization: `Bearer ${props.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "end" }) });
    const data = await response.json();
    if (!response.ok) { endingRef.current = false; setEnding(false); props.setNotice(data.error || "The session could not be ended."); return; }
    await room.disconnect();
    window.location.href = data.summaryUrl;
  }

  useEffect(() => {
    if (!bothPresent || !timeIsUp || warnedRef.current) return;
    warnedRef.current = true;
    props.setNotice(`Your scheduled hour is up. This session will end automatically in ${CLASSROOM_JOIN_WINDOW_MINUTES} minutes.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bothPresent, timeIsUp]);

  useEffect(() => {
    if (!bothPresent || ending || now < autoEndMs) return;
    const timer = window.setTimeout(() => void end(true), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bothPresent, ending, now, autoEndMs]);

  const other = booking.participantRole === "tutor" ? booking.studentName : booking.tutorName;

  /* `data-board` is here only so the scrim can tell the two boards apart: the
     whiteboard runs Excalidraw's light canvas under it in both themes, the text
     editor starts below the scrim and leaves the page ground there instead. */
  return <main className="nb-room" data-panel={panel ? "open" : "closed"} data-board={board}>
    <section className="nb-room__board" aria-label="Shared workspace">
      {/* Both panes stay mounted for the life of the session; switching only flips
          `data-active`, which hides the inactive one in CSS. Unmounting instead would
          tear down the Liveblocks room, the Yjs doc, and the Excalidraw canvas on every
          switch, forcing a fresh auth handshake and a blank board each time. */}
      {props.payload.providers.collaboration.configured ? <ClassroomCollaborationRoom roomId={props.payload.classroom!.liveblocks_room_id} accessToken={props.accessToken}>
        <div className="nb-room__pane" data-active={board === "whiteboard"} aria-hidden={board !== "whiteboard"}><ClassroomWhiteboard user={{ id: props.userId, name: booking.currentName, color: booking.participantRole === "tutor" ? "#6e2b74" : "#256f5b" }} bookingId={booking.id} accessToken={props.accessToken} readOnly={false} /></div>
        <div className="nb-room__pane nb-room__pane--notes" data-active={board === "notes"} aria-hidden={board !== "notes"}><ClassroomSharedNotes readOnly={false} /></div>
      </ClassroomCollaborationRoom> : <div className="nb-room__pane" data-active="true"><ProviderSetup title="Shared workspace setup required" body="Whiteboard and shared notes will appear after the Liveblocks project key is configured." /></div>}
    </section>

    <div className="nb-room__scrim" aria-hidden="true" />
    <header className="nb-room__head">
      <Link href="/?view=My%20Sessions" className="nb-nav__brand" aria-label="Back to sessions"><i className="nb-nav__mark" /><span>The Neighbrhood</span></Link>
      <span className="nb-room__title">{booking.courseCode}{booking.topic ? ` · ${booking.topic}` : ""} · with {other}</span>
      <span className="nb-room__note">recording off</span>
      <div className="nb-room__acts">
        <RoomClock start={booking.requestedStart} duration={booking.durationMinutes} />
        <NbButton variant="onstage" size="sm" onClick={() => setHelpOpen(true)}>Help</NbButton>
        {booking.participantRole === "tutor" && timeIsUp && <NbButton variant="onstage" size="sm" onClick={() => end(false)} disabled={ending}>{ending ? "Ending…" : "End session"}</NbButton>}
        <NbButton variant="onstage" size="sm" onClick={() => setPanel(panel ? null : "chat")}>{panel ? "Hide chat" : "Chat and files"}</NbButton>
        <NbButton variant="onstage" size="sm" onClick={leave}>Leave classroom</NbButton>
      </div>
    </header>

    {props.notice && <div className="nb-room__notice" role="status">{props.notice}<button onClick={() => props.setNotice("")}>Dismiss</button></div>}
    <RoomControls board={board} onBoard={setBoard} />

    <aside className="nb-room__side" aria-label="Participants, chat and files">
      <RoomPeople other={other} you={booking.currentName} />
      {panel && <div className="nb-room__panel">
        <header className="nb-room__panelhead">
          <NbChipRow>
            <NbChip current={panel === "chat"} onClick={() => setPanel("chat")}>Chat</NbChip>
            <NbChip current={panel === "files"} onClick={() => setPanel("files")}>Files</NbChip>
          </NbChipRow>
          <button className="nb-room__panelclose" aria-label="Close panel" onClick={() => setPanel(null)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        {panel === "chat"
          ? <ClassroomChat bookingId={booking.id} accessToken={props.accessToken} userId={props.userId} />
          : <div className="nb-room__panelbody"><ClassroomFiles bookingId={booking.id} accessToken={props.accessToken} userId={props.userId} readOnly={false} compact /></div>}
      </div>}
    </aside>

    {helpOpen && <ClassroomHelp onClose={() => setHelpOpen(false)} />}
  </main>;
}

/* The drawing's bottom bar. Its Undo and Clear board belong to the prototype's
   own bare canvas; Excalidraw owns both here, so the pair the app does need —
   which surface the board shows — takes that half of the bar instead. */
function RoomControls(props: { board: Board; onBoard: (value: Board) => void }) {
  const [devicesOpen, setDevicesOpen] = useState(false);
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled, localParticipant } = useLocalParticipant();
  return <>
    {devicesOpen && <DeviceSettings />}
    <div className="nb-room__bar">
      <NbChip current={props.board === "whiteboard"} onClick={() => props.onBoard("whiteboard")}>Whiteboard</NbChip>
      <NbChip current={props.board === "notes"} onClick={() => props.onBoard("notes")}>Text editor</NbChip>
      <i className="nb-room__bardiv" />
      <NbChip current={isMicrophoneEnabled} onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}>{isMicrophoneEnabled ? "Mic on" : "Mic off"}</NbChip>
      <NbChip current={isCameraEnabled} onClick={() => void localParticipant.setCameraEnabled(!isCameraEnabled)}>{isCameraEnabled ? "Camera on" : "Camera off"}</NbChip>
      <NbChip current={isScreenShareEnabled} onClick={() => void localParticipant.setScreenShareEnabled(!isScreenShareEnabled)}>{isScreenShareEnabled ? "Sharing screen" : "Share screen"}</NbChip>
      <NbChip current={devicesOpen} aria-expanded={devicesOpen} onClick={() => setDevicesOpen((value) => !value)}>Devices</NbChip>
    </div>
  </>;
}

/* The drawing's two 4:3 tiles, and always two: the other person's slot is drawn
   whether or not they have joined, so a tutor waiting alone gets the pair the
   drawing shows rather than one tile stretched across the column. A screen
   share is a third, wider tile above them rather than something that takes the
   board — the board is where the lesson is. */
function RoomPeople(props: { other: string; you: string }) {
  const tracks = useTracks([
    { source: Track.Source.ScreenShare, withPlaceholder: false },
    { source: Track.Source.Camera, withPlaceholder: true },
  ], { onlySubscribed: false });
  const screen = tracks.find((track) => track.source === Track.Source.ScreenShare);
  const cameras = tracks.filter((track) => track.source === Track.Source.Camera);
  const mine = cameras.find((track) => track.participant.isLocal);
  const theirs = cameras.find((track) => !track.participant.isLocal);
  return <>
    {screen && <div className="nb-room__tile nb-room__tile--wide">
      <ParticipantTile trackRef={screen} />
      <span className="nb-room__tilelabel">{screen.participant.isLocal ? "You are sharing" : `${props.other} is sharing`}</span>
    </div>}
    <div className="nb-room__people">
      <RoomTile track={theirs} name={props.other} label={theirs ? props.other : `${props.other} · not here yet`} />
      <RoomTile track={mine} name={props.you} label="You" self />
    </div>
  </>;
}

function RoomTile(props: { track?: RoomTrack; name: string; label: string; self?: boolean }) {
  return <div className={`nb-room__tile${props.self ? " nb-room__tile--self" : ""}`} data-empty={!props.track}>
    <span className="nb-room__initials" aria-hidden="true">{initials(props.name)}</span>
    {props.track && <ParticipantTile trackRef={props.track} />}
    <span className="nb-room__tilelabel">{props.label}</span>
  </div>;
}

function DeviceSettings() {
  // setSinkId (choosing an output device) is Chromium-only, so the speaker row is hidden
  // where picking one would throw. Probed lazily rather than on every render.
  const [canChooseSpeaker] = useState(() => typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype);
  return <div className="nb-room__devices" role="group" aria-label="Device settings">
    <DevicePicker kind="videoinput" label="Camera" />
    <DevicePicker kind="audioinput" label="Microphone" />
    {canChooseSpeaker && <DevicePicker kind="audiooutput" label="Speaker" />}
  </div>;
}

function DevicePicker(props: { kind: MediaDeviceKind; label: string }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind: props.kind });
  const [error, setError] = useState("");
  const selectId = `classroom-device-${props.kind}`;
  // A device the browser has not named yet (or an id we have not seen) must not be fed to a
  // controlled <select>, or React silently drops the selection back to the first option.
  const selected = devices.some((device) => device.deviceId === activeDeviceId) ? activeDeviceId : "";
  return <label htmlFor={selectId}>
    <span>{props.label}</span>
    <select id={selectId} value={selected} disabled={!devices.length} onChange={(event) => {
      setError("");
      void setActiveMediaDevice(event.target.value).catch(() => setError(`${props.label} could not be switched.`));
    }}>
      {!devices.length && <option value="">No {props.label.toLowerCase()} found</option>}
      {!selected && devices.length > 0 && <option value="">System default</option>}
      {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${props.label} ${index + 1}`}</option>)}
    </select>
    {error && <small role="alert">{error}</small>}
  </label>;
}

function ClassroomHelp({ onClose }: { onClose: () => void }) {
  return <div className="classroom-equation-backdrop" role="presentation"><section className="classroom-help-dialog" role="dialog" aria-modal="true" aria-labelledby="classroom-help-title"><header><div><p>Classroom guide</p><h2 id="classroom-help-title">Teach without leaving the room.</h2></div><button onClick={onClose} aria-label="Close help">×</button></header><div className="classroom-help-grid"><article><strong>Whiteboard</strong><p>Use the standard drawing toolbar for pen, highlighter, shapes, arrows, text, sticky notes, pages, undo, and export.</p></article><article><strong>Math & files</strong><p>Session tools add editable LaTeX equations and secure images or PDFs directly to the shared board.</p></article><article><strong>Text editor</strong><p>Build shared notes, checklists, tables, links, math, and non-executable code blocks together.</p></article><article><strong>Media</strong><p>Use the dock to manage microphone, camera, screen sharing, and devices. Focus expands shared content without covering your work.</p></article></div><footer><p>Nothing is recorded. Materials remain private to the student and tutor.</p><button onClick={onClose}>Got it</button></footer></section></div>;
}

/* `38:12 of 60:00`, the drawing's own reading. It is its own component so the
   one-second tick re-renders the clock and nothing else in the header. */
function RoomClock(props: { start: string; duration: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const start = new Date(props.start).getTime();
  const elapsed = Math.max(0, Math.floor((now - start) / 1000));
  const booked = props.duration * 60;
  const over = elapsed >= booked;
  return <span className="nb-room__clock" data-over={over} role="timer" aria-label={over ? "The scheduled hour is up" : `${clock(elapsed)} of ${clock(booked)} elapsed`}>
    {over ? "Scheduled time is up" : <>{clock(elapsed)} <span>of {clock(booked)}</span></>}
  </span>;
}

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/* `Thu Sep 3 · 4:30 p.m. to 5:30 p.m.` — the handoff's date and time voice,
   which toLocaleString's own "PM" would break. */
function formatSessionWindow(start: string, end: string) {
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime())) return start;
  const day = from.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }).replace(/,/g, "");
  return Number.isNaN(to.getTime()) ? `${day} · ${clockLabel(from)}` : `${day} · ${clockLabel(from)} to ${clockLabel(to)}`;
}

function formatClock(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const day = parsed.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }).replace(/,/g, "");
  return `${day} at ${clockLabel(parsed)}`;
}

function clockLabel(date: Date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s*AM$/, " a.m.").replace(/\s*PM$/, " p.m.");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function ClassroomSummary(props: { payload: ClassroomPayload; accessToken: string; userId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const booking = props.payload.booking;
  return <main className="nb-lobby classroom-summary"><div className="nb-stage nb-lobby__stage"><div className="nb-nav nb-nav--onstage nb-lobby__nav"><Link href="/" className="nb-nav__brand" aria-label="The Neighbrhood home"><i className="nb-nav__mark" />The Neighbrhood</Link><div className="nb-nav__actions"><Link href="/?view=My%20Sessions&sessionTab=past" className="nb-btn nb-btn--onstage nb-btn--sm">Back to sessions</Link></div></div></div><section className="classroom-summary-intro nb-lobby__main"><p className="nb-lobby__eyebrow">{booking.courseCode} · Session materials</p><h1>Everything from class, in one place.</h1><p className="nb-lobby__lede">The board, shared notes, files, and tutoring conversation remain private to {booking.studentName} and {booking.tutorName}.</p></section><nav className="classroom-summary-links"><button onClick={() => setWorkspace("whiteboard")}><span>01</span><strong>Whiteboard</strong><small>Review the shared board</small></button><button onClick={() => setWorkspace("notes")}><span>02</span><strong>Shared notes</strong><small>Read the session notes</small></button><button onClick={() => setWorkspace("files")}><span>03</span><strong>Files</strong><small>Preview and download materials</small></button><Link href={`/?view=Chat&booking=${encodeURIComponent(booking.id)}`}><span>04</span><strong>Messages</strong><small>Continue in Tutoring</small></Link></nav>{workspace && <section className="classroom-summary-material"><header><h2>{workspace === "whiteboard" ? "Whiteboard" : workspace === "notes" ? "Shared notes" : "Files"}</h2><button onClick={() => setWorkspace(null)}>Close</button></header>{workspace === "files" ? <ClassroomFiles bookingId={booking.id} accessToken={props.accessToken} userId={props.userId} readOnly /> : props.payload.providers.collaboration.configured && props.payload.classroom ? <ClassroomCollaborationRoom roomId={props.payload.classroom.liveblocks_room_id} accessToken={props.accessToken}>{workspace === "whiteboard" ? <ClassroomWhiteboard user={{ id: props.userId, name: booking.currentName, color: booking.participantRole === "tutor" ? "#6e2b74" : "#256f5b" }} bookingId={booking.id} accessToken={props.accessToken} readOnly /> : <ClassroomSharedNotes readOnly />}</ClassroomCollaborationRoom> : <ProviderSetup title="Shared materials unavailable" body="The collaboration provider must be configured to open this saved artifact." />}</section>}</main>;
}

function ProviderSetup(props: { title: string; body: string }) { return <div className="classroom-provider-setup"><span>Setup required</span><h2>{props.title}</h2><p>{props.body}</p></div>; }
function ClassroomLoading() { return <main className="classroom-loading"><div><NeighbrhoodLoader label="Preparing your classroom" /><h1>Preparing your classroom…</h1><p>Checking the booking and private session materials.</p></div></main>; }
function ClassroomUnavailable(props: { message: string; setup?: boolean }) { return <main className="classroom-unavailable"><NeighbrhoodBrand compact /><section><span>{props.setup ? "Provider setup" : "Classroom unavailable"}</span><h1>This room cannot open yet.</h1><p>{props.message}</p><Link href="/?view=My%20Sessions">Back to sessions</Link></section></main>; }
function bookingUnavailableMessage(status: string) { if (status === "cancelled") return "This session was cancelled, so its classroom is closed."; if (status === "requested" || status === "time_change_requested") return "The tutor must confirm the session before a classroom is created."; return "This booking is not eligible for a live classroom."; }
function readableMediaError(error: Error) { if (/permission|denied|notallowed/i.test(error.message)) return "Camera or microphone access was denied. Allow access in your browser settings and try again."; return "The media connection was interrupted. The classroom will keep trying to reconnect."; }
async function audit(token: string, bookingId: string, eventType: "joined" | "left") { await fetch(`/api/classrooms/${encodeURIComponent(bookingId)}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "audit", eventType }), keepalive: true }).catch(() => undefined); }

