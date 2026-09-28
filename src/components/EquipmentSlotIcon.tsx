const ICONS: Record<number, string> = {
  1: 'M32 6v34M24 38h16M32 40v14M27 56h10',
  2: 'M14 16l18-8 18 8v16c0 13-10 21-18 24-8-3-18-11-18-24zM32 20v22',
  3: 'M16 30q0-16 16-22 16 6 16 22v6H16zM20 36v8q6 8 12 8t12-8v-8M26 36h12',
  4: 'M20 12l12-6 12 6 8 10-8 3v25H20V25l-8-3zM20 25h24',
  5: 'M10 30h44v10H10zM30 30v10M18 24v6M46 24v6M22 35h8',
  6: 'M24 8h14l4 24 10 6v10H18V38l6-6zM18 48h34',
  7: 'M32 6l10 16H22zM22 22h20L32 54z',
}

export function EquipmentSlotIcon({ type, className }: { type: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <path
        d={ICONS[type] ?? ICONS[1]}
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
