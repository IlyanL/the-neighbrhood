import { ImageResponse } from "next/og";

// The picture that shows up when someone pastes theneighbrhood.ca into
// iMessage, Discord, or an Instagram DM. Colors match the brand accent
// gradient in neighbrhood-ds.css (--nb-accent -> --nb-accent-deep). No custom
// font is loaded — ImageResponse's default sans is legible enough for a
// share-card preview, and pulling in the Sora/Manrope files just for this
// would be a lot of weight for something most viewers glance at for a second.
export const alt = "The Neighbrhood — Know what matters at Western";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "80px 96px",
          background: "linear-gradient(135deg, #6b2b78, #48173f)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 96,
            height: 96,
            borderRadius: 24,
            background: "rgba(255,255,255,0.12)",
            marginBottom: 40,
          }}
        >
          {/* Same path data as the "neighbrhood-mark" SVG in components/brand.tsx, in white for a dark ground. */}
          <svg width="52" height="52" viewBox="0 0 48 48" fill="#fbf6f8">
            <path d="M8 32.5c8.4-1.2 13.8-5.7 16.3-13.5 3.8 2.8 8.6 3.4 15.7 1.9-3.9 3.3-6.1 7.3-6.7 12-6.8-2.7-13.9-2.8-21.2-.2L8 32.5Z" />
            <path d="M11.5 27.5C19.3 22.6 24.1 17 26 10c3.7 4.2 8.1 6.1 13.2 5.9-5.6 2.7-9.1 6.5-10.4 11.4-5.5-2.1-11.3-2-17.3.2Z" opacity={0.65} />
          </svg>
        </div>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700, color: "#fbf6f8" }}>
          The Neighbrhood
        </div>
        <div style={{ display: "flex", fontSize: 34, color: "#e0c7e5", marginTop: 20 }}>
          Know what matters at Western
        </div>
      </div>
    ),
    { ...size }
  );
}
