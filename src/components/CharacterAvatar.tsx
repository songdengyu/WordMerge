import type { HeroRole } from '../data/heroes'
import { ArtIcon } from './ArtIcon'
import styles from './CharacterAvatar.module.css'

interface CharacterAvatarProps {
  role: HeroRole
  size?: 'sm' | 'md' | 'lg'
  className?: string
}
export function CharacterAvatar({ role, size = 'md', className }: CharacterAvatarProps) {
  return (
    <div className={`${styles.avatar} ${styles[size]} ${styles[role]} ${className ?? ''}`}>
      <ArtIcon sheet="heroes" name={role} viewBox="0 0 96 96" className={styles.svg} />
    </div>
  )
}
