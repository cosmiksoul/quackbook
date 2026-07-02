import type { ReactNode } from 'react'

type IconName =
  | 'logo' | 'explore' | 'report' | 'play' | 'pin' | 'types' | 'profile' | 'table'

// logo is rendered separately (filled duck-head mark); these are stroke glyphs.
const PATHS: Record<Exclude<IconName, 'logo'>, ReactNode> = {
  // simple, recognizable stroke glyphs (Lucide-ish), 24x24 viewBox
  explore: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  report: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  play: <path d="M6 4l14 8-14 8z" />,
  pin: <path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3-1-7z" />,
  types: <path d="M3 21l3-1 11-11-2-2L4 18l-1 3zM14 6l4 4" />,
  profile: <><path d="M3 21h18" /><rect x="5" y="11" width="3" height="7" /><rect x="11" y="7" width="3" height="11" /><rect x="17" y="13" width="3" height="5" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9h18M10 9v11" /></>,
}

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  if (name === 'logo') {
    // Filled duck-head in profile: round head, blunt rounded beak right, amber
    // eye. Sits on the amber tile, so currentColor is the dark tile foreground;
    // the eye is painted back in --accent to read as a knockout.
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: '0 0 auto' }}>
        <circle cx="11" cy="12" r="6.7" fill="currentColor" />
        <rect x="15" y="10.4" width="8.4" height="3.4" rx="1.7" fill="currentColor" />
        <circle cx="12.6" cy="10" r="1.2" style={{ fill: 'var(--accent)' }} />
      </svg>
    )
  }
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
