import type { EquipmentConfig } from '../data/equipmentConfig'
import { ArtIcon, type ArtSheet } from './ArtIcon'
import styles from './EquipmentArt.module.css'

interface EquipmentArtProps {
  item: EquipmentConfig
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

export function EquipmentArt({ item, size = 'md' }: EquipmentArtProps) {
  const sheet = item.icon.replace(/\.svg$/, '')
  const validSheet = sheet === 'weapons' || sheet === 'heroes' || sheet === 'ui'
  return (
    <span className={`${styles.art} ${styles[size]} ${styles[`type${item.type}`]}`}>
      {validSheet ? (
        <ArtIcon
          sheet={sheet as ArtSheet}
          name={item.iconName}
          viewBox={sheet === 'weapons' || sheet === 'heroes' ? '0 0 96 96' : '0 0 64 64'}
          className={styles.icon}
        />
      ) : <span className={styles.fallback}>?</span>}
    </span>
  )
}
