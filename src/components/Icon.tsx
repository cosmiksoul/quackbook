import type { ReactNode } from 'react'

type IconName =
  | 'logo' | 'explore' | 'report' | 'play' | 'pin' | 'save' | 'types' | 'profile' | 'chevron'

const PATHS: Record<IconName, ReactNode> = {
  // simple, recognizable stroke glyphs (Lucide-ish), 24x24 viewBox
  logo: <path d="M15 6a4 4 0 1 0-4 4h4l4 3v-5a5 5 0 0 0-5-5h-1M7 13c0 3 2 5 5 5h6" />,
  explore: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  report: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  play: <path d="M6 4l14 8-14 8z" />,
  pin: <path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3-1-7z" />,
  save: <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />,
  types: <path d="M3 21l3-1 11-11-2-2L4 18l-1 3zM14 6l4 4" />,
  profile: <><path d="M3 21h18" /><rect x="5" y="11" width="3" height="7" /><rect x="11" y="7" width="3" height="11" /><rect x="17" y="13" width="3" height="5" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
}

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: '0 0 auto' }}
    >
      {PATHS[name]}
    </svg>
  )
}
