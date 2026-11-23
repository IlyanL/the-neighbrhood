"use client";

import { useState } from "react";
import NextImage from "next/image";
import { NbButton, NbFieldGrid, NbFieldset, NbPhotoUpload } from "@/app/components/nb";
import { majorOptions, yearOptions, type DeliveryMode, type PhotoCropDraft, type TutorProfileForm } from "@/app/components/page-types";

function cropPhotoFile(crop: PhotoCropDraft) {
  return new Promise<File>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const size = 600;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");

      if (!context) {
        reject(new Error("Photo crop failed. Please try a different image."));
        return;
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);

      const baseScale = Math.max(size / image.width, size / image.height);
      const scale = baseScale * crop.zoom;
      const width = image.width * scale;
      const height = image.height * scale;
      const previewSize = 224;
      const x = (size - width) / 2 + crop.offsetX * (size / previewSize);
      const y = (size - height) / 2 + crop.offsetY * (size / previewSize);

      context.drawImage(image, x, y, width, height);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Photo crop failed. Please try a different image."));
          return;
        }

        const fileName = crop.file.name.replace(/\.[^.]+$/, "") || "profile-photo";
        resolve(new File([blob], `${fileName}-cropped.jpg`, { type: "image/jpeg" }));
      }, "image/jpeg", 0.92);
    };
    image.onerror = () => reject(new Error("Photo could not be opened. Please choose a different image."));
    image.src = crop.previewUrl;
  });
}

/* The photo block the handoff draws — a 116px drop square beside its copy —
   plus the crop stage this app has always had and the drawing does not.
   `blurb` is the one thing that differs between the application and the tutor's
   own card; the block itself is deliberately the same on both. */
export function TutorPhotoBlock({
  profile,
  uploadTutorFile,
  isUploading,
  blurb,
}: {
  profile: TutorProfileForm;
  uploadTutorFile: (kind: "photo" | "resume" | "transcript", file: File) => void;
  isUploading: boolean;
  blurb: string;
}) {
  const [photoCrop, setPhotoCrop] = useState<PhotoCropDraft | null>(null);
  const [photoCropError, setPhotoCropError] = useState("");
  const [photoDrag, setPhotoDrag] = useState<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  function openCrop(file: File) {
    const previewUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setPhotoCrop((current) => {
        if (current) URL.revokeObjectURL(current.previewUrl);
        return { file, previewUrl, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, zoom: 1, offsetX: 0, offsetY: 0 };
      });
      setPhotoCropError("");
    };
    image.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      setPhotoCropError("Photo could not be opened. Please choose a different image.");
    };
    image.src = previewUrl;
  }

  async function uploadCroppedPhoto() {
    if (!photoCrop) return;

    setPhotoCropError("");
    try {
      const croppedFile = await cropPhotoFile(photoCrop);
      uploadTutorFile("photo", croppedFile);
      URL.revokeObjectURL(photoCrop.previewUrl);
      setPhotoCrop(null);
    } catch (error) {
      setPhotoCropError(error instanceof Error ? error.message : "Photo crop failed. Please try again.");
    }
  }

  return (
    <>
      <NbPhotoUpload
        photoUrl={profile.photoUrl || undefined}
        stateLabel="No photo yet"
        blurb={blurb}
        disabled={isUploading}
        onPick={openCrop}
      />
      {photoCropError && !photoCrop && <p className="nb-notice" style={{ marginTop: "var(--space-6)" }}>{photoCropError}</p>}
      {photoCrop && (
        <div className="nb-crop">
          <div
            className="nb-crop__stage"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setPhotoDrag({ startX: event.clientX, startY: event.clientY, originX: photoCrop.offsetX, originY: photoCrop.offsetY });
            }}
            onPointerMove={(event) => {
              if (!photoDrag) return;
              setPhotoCrop({ ...photoCrop, offsetX: photoDrag.originX + event.clientX - photoDrag.startX, offsetY: photoDrag.originY + event.clientY - photoDrag.startY });
            }}
            onPointerUp={() => setPhotoDrag(null)}
            onPointerCancel={() => setPhotoDrag(null)}
            onWheel={(event) => {
              const nextZoom = Math.min(3, Math.max(1, photoCrop.zoom + (event.deltaY < 0 ? 0.08 : -0.08)));
              setPhotoCrop({ ...photoCrop, zoom: Number(nextZoom.toFixed(2)) });
            }}
          >
            {(() => {
              const previewSize = 224;
              const baseScale = Math.max(previewSize / photoCrop.naturalWidth, previewSize / photoCrop.naturalHeight);
              const width = photoCrop.naturalWidth * baseScale * photoCrop.zoom;
              const height = photoCrop.naturalHeight * baseScale * photoCrop.zoom;
              return (
                <NextImage
                  unoptimized
                  width={photoCrop.naturalWidth}
                  height={photoCrop.naturalHeight}
                  src={photoCrop.previewUrl}
                  alt="Profile crop preview"
                  draggable={false}
                  style={{
                    width: `${width}px`,
                    height: `${height}px`,
                    left: `${(previewSize - width) / 2 + photoCrop.offsetX}px`,
                    top: `${(previewSize - height) / 2 + photoCrop.offsetY}px`,
                  }}
                />
              );
            })()}
          </div>
          <p className="nb-crop__hint">Drag the photo to position it. Scroll or pinch over the square to zoom.</p>
          <div className="nb-crop__acts">
            <NbButton size="sm" aria-label="Zoom out" onClick={() => setPhotoCrop({ ...photoCrop, zoom: Math.max(1, Number((photoCrop.zoom - 0.1).toFixed(2))) })}>Zoom out</NbButton>
            <NbButton size="sm" aria-label="Zoom in" onClick={() => setPhotoCrop({ ...photoCrop, zoom: Math.min(3, Number((photoCrop.zoom + 0.1).toFixed(2))) })}>Zoom in</NbButton>
          </div>
          {photoCropError && <p className="nb-notice">{photoCropError}</p>}
          <div className="nb-crop__acts">
            <NbButton variant="solid" size="sm" disabled={isUploading} onClick={uploadCroppedPhoto}>Use this photo</NbButton>
            <NbButton size="sm" onClick={() => { URL.revokeObjectURL(photoCrop.previewUrl); setPhotoCrop(null); setPhotoCropError(""); }}>Discard</NbButton>
          </div>
        </div>
      )}
    </>
  );
}

/* The two private uploads. The prototype's own copy says a transcript is
   "deleted" after review; it is not — a reviewer keeps it on the application —
   so that line is the app's, and true. */
const DOC_UPLOADS = [
  { kind: "transcript" as const, title: "Transcript", blurb: "Read by a reviewer for your course grades. It is never shown to a student.", accept: ".pdf,.jpg,.jpeg,.png", cta: "Upload transcript" },
  { kind: "resume" as const, title: "Resume", blurb: "One page. TA work, marking, and any teaching outside Western.", accept: ".pdf,.doc,.docx", cta: "Upload resume" },
];

export function TutorDocUploads({
  profile,
  uploadTutorFile,
  isUploading,
}: {
  profile: TutorProfileForm;
  uploadTutorFile: (kind: "photo" | "resume" | "transcript", file: File) => void;
  isUploading: boolean;
}) {
  return (
    <div className="nb-docs">
      {DOC_UPLOADS.map((doc) => {
        const fileName = doc.kind === "transcript" ? profile.transcriptFileName : profile.resumeFileName;
        return (
          <div key={doc.kind} className="nb-doc">
            <div className="nb-doc__body">
              <p className="nb-doc__name">{doc.title}</p>
              <p className="nb-doc__blurb">{doc.blurb}</p>
            </div>
            <span className="nb-doc__state">{fileName || "Nothing uploaded"}</span>
            <label className="nb-btn nb-btn--sm" style={{ cursor: "pointer" }}>
              <input
                type="file"
                accept={doc.accept}
                style={{ display: "none" }}
                disabled={isUploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) uploadTutorFile(doc.kind, file);
                }}
              />
              {fileName ? "Replace" : doc.cta}
            </label>
          </div>
        );
      })}
    </div>
  );
}

/* "The card students will see". The handoff draws six fields; this app stores
   thirteen, and dropping one to match the drawing would drop what a student
   reads before booking. They are laid out in the handoff's own two-up grid,
   with the long-form answers full width under it. */
export function TutorFields({
  profile,
  setProfile,
}: {
  profile: TutorProfileForm;
  setProfile: (profile: TutorProfileForm) => void;
}) {
  return (
    <>
      <NbFieldGrid>
        <NbFieldset label="Display name">
          <input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} placeholder="Parker Reid" aria-label="Display name" required />
        </NbFieldset>
        <NbFieldset label="University">
          <input value={profile.university} onChange={(event) => setProfile({ ...profile, university: event.target.value })} placeholder="Western University" aria-label="University" required />
        </NbFieldset>
        <NbFieldset label="Major">
          <select value={profile.major} onChange={(event) => setProfile({ ...profile, major: event.target.value })} aria-label="Major">
            {majorOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
        </NbFieldset>
        <NbFieldset label="Year of study">
          <select value={profile.year} onChange={(event) => setProfile({ ...profile, year: event.target.value })} aria-label="Year of study">
            {yearOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
        </NbFieldset>
        <NbFieldset label="Courses you want to teach">
          <input value={profile.courses} onChange={(event) => setProfile({ ...profile, courses: event.target.value })} placeholder="CALC 1000, CALC 1301" aria-label="Courses you want to teach" required />
        </NbFieldset>
        <NbFieldset label="Grade average, out of 100">
          <input type="number" value={profile.gpaPercent} onChange={(event) => setProfile({ ...profile, gpaPercent: event.target.value })} placeholder="88" aria-label="Grade average out of 100" required />
        </NbFieldset>
        <NbFieldset label="Intended rate, per hour" note="Students see this before they book, and you keep all of it.">
          <b>$</b>
          <input inputMode="numeric" type="number" value={profile.rate} onChange={(event) => setProfile({ ...profile, rate: event.target.value })} placeholder="30" aria-label="Intended rate per hour" required />
        </NbFieldset>
        <NbFieldset label="How you would meet">
          <select value={profile.teachingMode} onChange={(event) => setProfile({ ...profile, teachingMode: event.target.value as DeliveryMode })} aria-label="How you would meet">
            {["Any", "Online", "In person"].map((option) => <option key={option}>{option}</option>)}
          </select>
        </NbFieldset>
        <NbFieldset label="Where you would meet">
          <input value={profile.campusLocations} onChange={(event) => setProfile({ ...profile, campusLocations: event.target.value })} placeholder="Weldon 2nd floor, or the classroom" aria-label="Where you would meet" required />
        </NbFieldset>
        <NbFieldset label="Languages you can teach in">
          <input value={profile.languages} onChange={(event) => setProfile({ ...profile, languages: event.target.value })} placeholder="English, French" aria-label="Languages you can teach in" required />
        </NbFieldset>
      </NbFieldGrid>
      <NbFieldset wide label="One line students see first">
        <input value={profile.headline} onChange={(event) => setProfile({ ...profile, headline: event.target.value })} placeholder="Third year Health Sciences, TA'd CALC 1000 last winter" aria-label="One line students see first" required />
      </NbFieldset>
      <NbFieldset wide top label="Bio, first person">
        <textarea value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} placeholder="I took CALC 1000 with Dr. Reyes and TA'd it last winter. I work from your problem set, not a script." aria-label="Bio" required />
      </NbFieldset>
      <NbFieldset wide top label="How you run an hour">
        <textarea value={profile.teachingStyle} onChange={(event) => setProfile({ ...profile, teachingStyle: event.target.value })} placeholder="We start on the question you are stuck on and work outward from it." aria-label="How you run an hour" required />
      </NbFieldset>
    </>
  );
}
