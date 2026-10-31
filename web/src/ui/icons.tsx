// 20px line icons, 1.6 stroke, currentColor.
import type { ReactNode } from 'react'

function I({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const Icon = {
  pen: () => <I><path d="M4 20l1.2-4.4L15.8 5a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.4 18.8 4 20z" /><path d="M14 7l3 3" /></I>,
  eraser: () => <I><path d="M8.5 19.5h11" /><path d="M5.2 15.3l8.9-8.9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8l-7.8 7.8a1 1 0 0 1-.7.3H8.8a1 1 0 0 1-.7-.3l-2.9-2.9a.7.7 0 0 1 0-1z" /><path d="M9.5 11l4.8 4.8" /></I>,
  select: () => <I><path d="M4 7V5a1 1 0 0 1 1-1h2M11 4h2M17 4h2a1 1 0 0 1 1 1v2M20 11v2M4 11v2M4 17v2a1 1 0 0 0 1 1h2M11 20h2" /><path d="M15 14l5 2-2 1-1 2-2-5z" /></I>,
  pan: () => <I><path d="M12 3v18M3 12h18" /><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></I>,
  undo: () => <I><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></I>,
  redo: () => <I><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></I>,
  back: () => <I><path d="M15 18l-6-6 6-6" /></I>,
  more: () => <I><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></I>,
  pages: () => <I><rect x="4" y="3" width="11" height="14" rx="1.5" /><path d="M9 21h9.5a1.5 1.5 0 0 0 1.5-1.5V8" /></I>,
  history: () => <I><path d="M4 5h16v11H9l-5 4V5z" /></I>,
  ask: () => <I><path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4L12 3z" /><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></I>,
  search: () => <I><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.2-4.2" /></I>,
  upload: () => <I><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" /><path d="M5 15v4h14v-4" /></I>,
  mic: () => <I><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></I>,
  micOff: () => <I><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 10V6a3 3 0 0 0-5.7-1.3" /><path d="M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.4 2.3M12 18v3M3 3l18 18" /></I>,
  plus: () => <I><path d="M12 5v14M5 12h14" /></I>,
  close: () => <I><path d="M6 6l12 12M18 6L6 18" /></I>,
  check: () => <I><path d="M5 12.5l4.5 4.5L19 7.5" /></I>,
  play: () => <I><path d="M7 5l12 7-12 7V5z" /></I>,
  stop: () => <I><rect x="6" y="6" width="12" height="12" rx="1.5" /></I>,
  image: () => <I><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></I>,
  graph: () => <I><path d="M4 4v16h16" /><path d="M7 16l4-5 3 3 5-7" /></I>,
  send: () => <I><path d="M4 12l16-8-6 16-2.5-6.5L4 12z" /></I>,
  settings: () => <I><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></I>,
  focus: () => <I><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></I>,
  fit: () => <I><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" /></I>,
  read: () => <I><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></I>,
  notebook: () => <I><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 3v18M12 8h4M12 12h4" /></I>,
  trash: () => <I><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></I>,
}
