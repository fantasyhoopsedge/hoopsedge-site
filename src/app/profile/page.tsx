"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { PlatformSidebarNav } from "@/components/platform-sidebar-nav";
import { containsProfanity } from "@/lib/profanity";

const MAX_NAME_LEN = 12;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// padding-left offsets the fixed-position left sidebar (PlatformSidebarNav
// desktop rail, 236px) — same convention as .dr-rankings-shell /
// .draft-board-shell in globals.css. Reverts to 0 under the sidebar's own
// 1023px breakpoint, where it falls back to the top SiteNav instead.
const PROFILE_SHELL_STYLES = `
  .profile-main { padding-left: 236px; }
  @media (max-width: 1023px) {
    .profile-main { padding-left: 0; }
  }
`;

function validateDisplayName(v: string): string | null {
  const t = v.trim();
  if (!t) return "Display name cannot be empty.";
  if (t.length > MAX_NAME_LEN) return `Max ${MAX_NAME_LEN} characters.`;
  if (containsProfanity(t)) return "That name isn't allowed — please choose another.";
  return null;
}

function InitialsAvatar({ name, size = 80 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "linear-gradient(135deg, var(--blueprint) 0%, var(--edge-orange) 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Oswald', sans-serif", fontWeight: 700,
      fontSize: Math.round(size * 0.35), color: "#fff", flexShrink: 0,
    }}>
      {name.trim().slice(0, 2).toUpperCase() || "?"}
    </div>
  );
}

// ── Avatar positioner ─────────────────────────────────────────────────────────
const VIEWPORT = 200;

interface AvatarPositionerProps {
  dataUrl: string;
  naturalW: number;
  naturalH: number;
  onApply: (blob: Blob) => void;
  onCancel: () => void;
}

function AvatarPositioner({ dataUrl, naturalW, naturalH, onApply, onCancel }: AvatarPositionerProps) {
  // fillScale = image exactly fills the circle. minScale is 10% above that so
  // the image always overflows the viewport on every axis → drag always works,
  // even at the leftmost slider position. Default = slider midpoint.
  const fillScale = Math.max(VIEWPORT / naturalW, VIEWPORT / naturalH);
  const minScale = fillScale * 1.1;
  const maxScale = fillScale * 3;
  const defaultScale = minScale + (maxScale - minScale) / 2;

  const [scale, setScale] = useState(defaultScale);
  const [offset, setOffset] = useState(() => ({
    x: (VIEWPORT - naturalW * defaultScale) / 2,
    y: (VIEWPORT - naturalH * defaultScale) / 2,
  }));
  const [dragging, setDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  const clamp = (ox: number, oy: number, s: number) => ({
    x: Math.min(0, Math.max(VIEWPORT - naturalW * s, ox)),
    y: Math.min(0, Math.max(VIEWPORT - naturalH * s, oy)),
  });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    viewportRef.current?.setPointerCapture(e.pointerId);
    dragOrigin.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOrigin.current) return;
    setOffset(clamp(
      dragOrigin.current.ox + (e.clientX - dragOrigin.current.px),
      dragOrigin.current.oy + (e.clientY - dragOrigin.current.py),
      scale,
    ));
  };

  const onPointerUp = () => { dragOrigin.current = null; setDragging(false); };

  const onZoom = (e: React.ChangeEvent<HTMLInputElement>) => {
    const s = parseFloat(e.target.value);
    setScale(s);
    // Re-clamp current offset so image stays inside the circle after zoom
    setOffset(prev => clamp(prev.x, prev.y, s));
  };

  const handleApply = () => {
    const OUT = 400;
    const ratio = OUT / VIEWPORT;
    const canvas = document.createElement("canvas");
    canvas.width = OUT; canvas.height = OUT;
    const ctx = canvas.getContext("2d")!;
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      ctx.drawImage(img, offset.x * ratio, offset.y * ratio, naturalW * scale * ratio, naturalH * scale * ratio);
      canvas.toBlob((blob) => { if (blob) onApply(blob); }, "image/png");
    };
  };

  return (
    <div className="positioner-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="positioner-box">
        <h3 className="positioner-title">Position your avatar</h3>
        <p className="positioner-hint">Drag to reposition · slider to zoom</p>

        <div
          ref={viewportRef}
          className="positioner-viewport"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dataUrl}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              width: naturalW * scale,
              height: naturalH * scale,
              left: offset.x,
              top: offset.y,
              userSelect: "none",
              pointerEvents: "none",
            }}
          />
        </div>

        <div className="positioner-zoom-row">
          <span className="positioner-zoom-icon">🔍</span>
          <input
            type="range"
            min={minScale}
            max={maxScale}
            step={(maxScale - minScale) / 100}
            value={scale}
            onChange={onZoom}
            className="positioner-slider"
          />
          <span className="positioner-zoom-icon">🔎</span>
        </div>

        <div className="positioner-actions">
          <button type="button" className="nav-cta" onClick={handleApply}>Apply</button>
          <button type="button" className="positioner-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Profile page ──────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const { user, profile, supabase, updateProfile, refreshProfile, openSignUp } = useAuth();

  const [nameVal, setNameVal] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  // The image data kept in memory for the positioner (survives Apply so pencil can re-open it)
  const [posDataUrl, setPosDataUrl] = useState<string | null>(null);
  const [posNatural, setPosNatural] = useState<{ w: number; h: number } | null>(null);
  const [showPositioner, setShowPositioner] = useState(false);
  const [loadingImg, setLoadingImg] = useState(false);

  // Cropped blob ready to upload
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) setNameVal(profile.username ?? "");
  }, [profile]);

  // Load an image URL into a data URL so the positioner can work with it
  const loadUrlIntoPositioner = useCallback((url: string) => {
    setLoadingImg(true);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d")!.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        setPosDataUrl(dataUrl);
        setPosNatural({ w: img.naturalWidth, h: img.naturalHeight });
        setShowPositioner(true);
      } catch {
        // CORS/tainted canvas — fall back to file picker
        fileRef.current?.click();
      }
      setLoadingImg(false);
    };
    img.onerror = () => {
      setLoadingImg(false);
      fileRef.current?.click();
    };
    img.src = url;
  }, []);

  // Pencil click: reopen positioner if we already have data, else load current avatar, else file picker
  const handlePencilClick = () => {
    if (posDataUrl) {
      setShowPositioner(true);
      return;
    }
    const currentUrl = avatarPreview ?? profile?.avatar_url ?? null;
    if (currentUrl) {
      loadUrlIntoPositioner(currentUrl);
    } else {
      fileRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileError(null);
    if (!ALLOWED_MIME.includes(file.type)) { setFileError("Please upload a JPEG, PNG, WebP, or GIF image."); return; }
    if (file.size > MAX_AVATAR_BYTES) { setFileError("Image must be under 2 MB."); return; }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new Image();
      img.src = dataUrl;
      img.onload = () => {
        setPosDataUrl(dataUrl);
        setPosNatural({ w: img.naturalWidth, h: img.naturalHeight });
        setShowPositioner(true);
      };
    };
    reader.readAsDataURL(file);
  };

  const handlePositionerApply = (blob: Blob) => {
    setCroppedBlob(blob);
    setAvatarPreview(URL.createObjectURL(blob));
    setShowPositioner(false); // keep posDataUrl alive so pencil can reopen
  };

  const handlePositionerCancel = () => {
    setShowPositioner(false); // keep posDataUrl alive
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameMsg(null); setAvatarMsg(null); setSaveError(null);

    const nameErr = validateDisplayName(nameVal);
    if (nameErr) { setNameError(nameErr); return; }

    setSaving(true);
    let anyError: string | null = null;

    // 1. Save display name if changed
    const trimmed = nameVal.trim();
    if (trimmed !== (profile?.username ?? "")) {
      const err = await updateProfile({ username: trimmed });
      if (err) anyError = err;
      else setNameMsg("Saved!");
    }

    // 2. Upload avatar blob if ready
    if (croppedBlob && supabase && user) {
      const path = `${user.id}/avatar.png`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, croppedBlob, { upsert: true, contentType: "image/png" });

      if (upErr) {
        anyError = (anyError ? anyError + " · " : "") + `Avatar upload failed: ${upErr.message}`;
      } else {
        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
        const newUrl = `${urlData.publicUrl}?t=${Date.now()}`;
        const err2 = await updateProfile({ avatar_url: newUrl });
        if (err2) anyError = (anyError ? anyError + " · " : "") + err2;
        else { setAvatarMsg("Saved!"); setCroppedBlob(null); }
      }
    }

    if (anyError) setSaveError(anyError);
    await refreshProfile();
    setSaving(false);
  };

  if (!user) {
    return (
      <>
        <PlatformSidebarNav active="profile" />
        <main className="profile-main" style={{ minHeight: "100vh", background: "var(--bg-body)", display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 80 }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ color: "var(--text-secondary)", marginBottom: 20 }}>Sign in to view your profile.</p>
            <button className="nav-cta" onClick={() => openSignUp("/profile")}>Sign In</button>
          </div>
        </main>
        <style>{PROFILE_SHELL_STYLES}</style>
      </>
    );
  }

  const currentAvatar = avatarPreview ?? profile?.avatar_url ?? null;
  const displayName = profile?.username ?? user.email ?? "";

  return (
    <>
      <PlatformSidebarNav active="profile" />

      {showPositioner && posDataUrl && posNatural && (
        <AvatarPositioner
          dataUrl={posDataUrl}
          naturalW={posNatural.w}
          naturalH={posNatural.h}
          onApply={handlePositionerApply}
          onCancel={handlePositionerCancel}
        />
      )}

      <main className="profile-main" style={{ minHeight: "100vh", background: "var(--bg-body)", paddingTop: 80, paddingBottom: 60 }}>
        <div className="profile-wrap">
          <Link href="/" className="profile-close" aria-label="Close and return home" title="Close">✕</Link>

          {/* ── Header ── */}
          <div className="profile-header">
            <div className="profile-avatar-large">
              {currentAvatar
                ? <img src={currentAvatar} alt={displayName} />
                : <InitialsAvatar name={displayName} size={96} />}
              <button
                type="button"
                className="profile-avatar-change"
                onClick={handlePencilClick}
                title="Reposition or change avatar"
                disabled={loadingImg}
              >
                {loadingImg ? "…" : "✎"}
              </button>
            </div>
            <div>
              <h1 className="profile-username">{displayName}</h1>
              <p className="profile-email">{user.email}</p>
            </div>
          </div>

          {/* ── Edit form ── */}
          <section className="profile-card">
            <h2 className="profile-section-title">Edit Profile</h2>
            <form onSubmit={handleSave} noValidate>
              <label className="profile-label" htmlFor="display-name">
                Display Name
                <span className="profile-label-hint">(max {MAX_NAME_LEN} chars)</span>
              </label>
              <input
                id="display-name"
                className="profile-input"
                type="text"
                maxLength={MAX_NAME_LEN}
                value={nameVal}
                onChange={(e) => { setNameVal(e.target.value); setNameError(null); setNameMsg(null); }}
                placeholder="Your display name"
                autoComplete="off"
              />
              <div className="profile-char-count">{nameVal.trim().length}/{MAX_NAME_LEN}</div>
              {nameError && <p className="profile-field-error">{nameError}</p>}
              {nameMsg && <p className="profile-field-ok">{nameMsg}</p>}

              <label className="profile-label" style={{ marginTop: 20 }}>
                Avatar
                <span className="profile-label-hint">(JPEG, PNG, WebP, GIF · max 2 MB)</span>
              </label>
              <div className="profile-avatar-row">
                {currentAvatar
                  ? <img className="profile-avatar-preview" src={currentAvatar} alt="preview" />
                  : <InitialsAvatar name={displayName} size={48} />}
                <button type="button" className="profile-upload-btn" onClick={() => fileRef.current?.click()}>
                  Choose image
                </button>
                {posDataUrl && !croppedBlob && (
                  <button type="button" className="profile-upload-btn" onClick={() => setShowPositioner(true)}>
                    Reposition ↗
                  </button>
                )}
                {croppedBlob && <span className="profile-filename">Ready to upload ✓</span>}
              </div>
              {fileError && <p className="profile-field-error">{fileError}</p>}
              {avatarMsg && <p className="profile-field-ok">{avatarMsg}</p>}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />

              <div className="profile-actions">
                <button type="submit" className="nav-cta" disabled={saving} style={{ opacity: saving ? 0.6 : 1 }}>
                  {saving ? "Saving…" : "Save changes"}
                </button>
                {saveError && <span className="profile-field-error">{saveError}</span>}
              </div>
            </form>
          </section>

          {/* ── Subscriptions ── */}
          <section className="profile-card" style={{ marginTop: 24 }}>
            <h2 className="profile-section-title">Subscriptions</h2>
            <div className="profile-subs-empty">
              <span className="profile-subs-icon">🔒</span>
              <p>No current subscriptions available.</p>
              <p className="profile-subs-hint">Premium tiers coming soon — check back here to manage your plan.</p>
            </div>
          </section>
        </div>

        <style>{PROFILE_SHELL_STYLES}</style>
        <style>{`
          .profile-wrap { max-width: 560px; margin: 0 auto; padding: 0 20px; position: relative; }
          .profile-close {
            position: absolute; top: 0; right: 20px; width: 32px; height: 32px;
            border-radius: 50%; border: 1px solid var(--border-main);
            background: var(--bg-card); color: var(--text-secondary);
            display: flex; align-items: center; justify-content: center;
            font-size: 14px; text-decoration: none; transition: border-color 0.2s, color 0.2s;
          }
          .profile-close:hover { border-color: var(--edge-orange); color: var(--text-primary); }
          .profile-header { display: flex; align-items: center; gap: 20px; margin-bottom: 28px; }
          .profile-avatar-large { position: relative; flex-shrink: 0; }
          .profile-avatar-large img { width: 96px; height: 96px; border-radius: 50%; object-fit: cover; border: 2px solid var(--border-main); }
          .profile-avatar-change {
            position: absolute; bottom: 0; right: 0; width: 28px; height: 28px;
            border-radius: 50%; background: var(--edge-orange); border: none; cursor: pointer;
            font-size: 14px; color: #fff; display: flex; align-items: center; justify-content: center;
          }
          .profile-avatar-change:disabled { opacity: 0.6; cursor: wait; }
          .profile-username { font-family: 'Oswald', sans-serif; font-size: 24px; font-weight: 700; color: var(--text-primary); margin: 0 0 4px; letter-spacing: 1px; }
          .profile-email { font-size: 13px; color: var(--text-secondary); margin: 0; }
          .profile-card { background: var(--bg-card); border: 1px solid var(--border-main); border-radius: 16px; padding: 28px; }
          .profile-section-title { font-family: 'Oswald', sans-serif; font-size: 16px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: var(--text-primary); margin: 0 0 20px; }
          .profile-label { display: block; font-family: 'Oswald', sans-serif; font-size: 12px; font-weight: 500; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 8px; }
          .profile-label-hint { margin-left: 6px; font-size: 11px; color: var(--text-muted); text-transform: none; letter-spacing: 0; font-family: 'Source Sans 3', sans-serif; font-weight: 400; }
          .profile-input { width: 100%; background: var(--modal-input-bg, #111114); border: 1px solid var(--modal-input-border, #2a2a32); border-radius: 10px; padding: 12px 14px; font-family: 'Source Sans 3', sans-serif; font-size: 15px; color: var(--text-primary); outline: none; box-sizing: border-box; transition: border-color 0.2s; }
          .profile-input:focus { border-color: var(--blueprint); }
          .profile-char-count { text-align: right; font-size: 11px; color: var(--text-muted); margin-top: 4px; }
          .profile-field-error { font-size: 12px; color: var(--red-severe); margin: 6px 0 0; }
          .profile-field-ok { font-size: 12px; color: var(--green-elite); margin: 6px 0 0; }
          .profile-avatar-row { display: flex; align-items: center; gap: 12px; margin-top: 4px; flex-wrap: wrap; }
          .profile-avatar-preview { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-main); }
          .profile-upload-btn { background: var(--bg-surface); border: 1px solid var(--border-main); border-radius: 8px; padding: 9px 16px; font-family: 'Oswald', sans-serif; font-size: 12px; font-weight: 500; letter-spacing: 1px; text-transform: uppercase; color: var(--text-secondary); cursor: pointer; transition: border-color 0.2s, color 0.2s; }
          .profile-upload-btn:hover { border-color: var(--blueprint); color: var(--text-primary); }
          .profile-filename { font-size: 12px; color: var(--green-elite); }
          .profile-actions { margin-top: 24px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
          .profile-subs-empty { text-align: center; padding: 20px 0; color: var(--text-secondary); }
          .profile-subs-icon { font-size: 32px; display: block; margin-bottom: 12px; }
          .profile-subs-empty p { margin: 0 0 6px; font-size: 15px; }
          .profile-subs-hint { font-size: 12px; color: var(--text-muted) !important; }

          /* ── Positioner overlay ── */
          .positioner-overlay {
            position: fixed; inset: 0; z-index: 1000;
            background: rgba(0,0,0,0.75); backdrop-filter: blur(4px);
            display: flex; align-items: center; justify-content: center; padding: 20px;
          }
          .positioner-box {
            background: var(--bg-surface); border: 1px solid var(--border-main);
            border-radius: 20px; padding: 28px; max-width: 320px; width: 100%;
            display: flex; flex-direction: column; align-items: center; gap: 16px;
          }
          .positioner-title { font-family: 'Oswald', sans-serif; font-size: 18px; font-weight: 600; letter-spacing: 1px; color: var(--text-primary); margin: 0; }
          .positioner-hint { font-size: 12px; color: var(--text-muted); margin: 0; text-align: center; }
          .positioner-viewport {
            width: ${VIEWPORT}px; height: ${VIEWPORT}px; border-radius: 50%;
            overflow: hidden; position: relative; flex-shrink: 0;
            border: 2px solid var(--border-main);
            box-shadow: 0 0 0 4px rgba(37,99,235,0.2);
          }
          .positioner-zoom-row { display: flex; align-items: center; gap: 8px; width: 100%; }
          .positioner-zoom-icon { font-size: 14px; flex-shrink: 0; }
          .positioner-slider { flex: 1; accent-color: var(--blueprint); cursor: pointer; height: 4px; }
          .positioner-actions { display: flex; gap: 10px; width: 100%; }
          .positioner-actions .nav-cta { flex: 1; text-align: center; }
          .positioner-cancel { flex: 1; background: var(--bg-card); border: 1px solid var(--border-main); border-radius: 8px; padding: 10px 0; font-family: 'Oswald', sans-serif; font-size: 12px; font-weight: 500; letter-spacing: 1px; text-transform: uppercase; color: var(--text-secondary); cursor: pointer; transition: border-color 0.2s; }
          .positioner-cancel:hover { border-color: var(--text-secondary); }
        `}</style>
      </main>
    </>
  );
}
