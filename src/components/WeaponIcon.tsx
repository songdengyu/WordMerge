import type { BulletStyle, WeaponQuality } from '../data/weapons'
import { QUALITY_COLORS } from '../data/weapons'
import { ArtIcon } from './ArtIcon'
import styles from './WeaponIcon.module.css'

interface WeaponIconProps {
  bulletStyle: BulletStyle
  weaponId?: string
  quality: WeaponQuality
  size?: 'sm' | 'md' | 'lg'
}

export function WeaponIcon({ bulletStyle, weaponId, quality, size = 'md' }: WeaponIconProps) {
  const borderColor = QUALITY_COLORS[quality]

  return (
    <div
      className={`${styles.icon} ${styles[size]}`}
      style={{ borderColor, boxShadow: `0 0 8px ${borderColor}40` }}
    >
      <ArtIcon sheet="weapons" name={WEAPON_ART[weaponId ?? ''] ?? BULLET_ART[bulletStyle]} viewBox="0 0 96 96" className={styles.svg} />
    </div>
  )
}

const WEAPON_ART: Record<string, string> = {
  iron_sword: 'iron-sword', wood_sword: 'wood-sword', battle_axe: 'battle-axe',
  magic_staff: 'magic-staff', elf_bow: 'elf-bow', flame_blade: 'flame-blade',
}

const BULLET_ART: Record<BulletStyle, string> = {
  bolt: 'iron-sword', slash: 'flame-blade', axe: 'battle-axe', arrow: 'elf-bow', orb: 'magic-staff',
}
