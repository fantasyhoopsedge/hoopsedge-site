"use client";

/**
 * Hand-rolled inline SVG icons, matching the house style already used
 * throughout the app (app-sidebar.tsx nav icons, search-pill.tsx): 24×24
 * viewBox, stroke-width 1.85, round caps/joins, no fill. No icon library is
 * installed anywhere in the repo — Ash confirmed (2026-08-10) to keep
 * hand-rolling rather than add lucide-react, to avoid a visual seam.
 */
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.85,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconClose({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M18 6 6 18" /><path d="M6 6l12 12" />
    </svg>
  );
}

export function IconChevronLeft({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function IconChevronDown({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function IconHome({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
    </svg>
  );
}

export function IconList({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" />
      <path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" />
    </svg>
  );
}

export function IconSun({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
export function IconMoon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

export function IconUsers({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconTrophy({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M8 21h8" /><path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M17 5h3a2 2 0 0 1-2 4h-1" /><path d="M7 5H4a2 2 0 0 0 2 4h1" />
    </svg>
  );
}

export function IconGear({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function IconTarget({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" />
    </svg>
  );
}

export function IconBell({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export function IconChat({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function IconArrowRight({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconLink({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

export function IconSliders({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M4 21v-7" /><path d="M4 10V3" /><path d="M12 21v-9" /><path d="M12 8V3" />
      <path d="M20 21v-5" /><path d="M20 12V3" />
      <path d="M1 14h6" /><path d="M9 8h6" /><path d="M17 16h6" />
    </svg>
  );
}

export function IconDollar({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <circle cx="12" cy="12" r="9" /><path d="M12 7v10" />
      <path d="M9 9.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5-1.3 2-3 2-3 .8-3 2.5 1.3 2.5 3 2.5 3-1.1 3-2.5" />
    </svg>
  );
}

export function IconLineChart({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M3 3v18h18" /><path d="M7 14l3-3 3 3 5-5" />
    </svg>
  );
}
