import type { MergeItemConfig } from '../data/mergeConfig'
import { ArtIcon, type ArtSheet } from './ArtIcon'
import styles from './MergePiece.module.css'

interface MergePieceProps {
  item: MergeItemConfig
  selected?: boolean
  shaking?: boolean
  compact?: boolean
}

export function MergePiece({ item, selected = false, shaking = false, compact = false }: MergePieceProps) {
  const sheet = item.icon.replace(/\.svg$/, '')
  const validSheet = sheet === 'weapons' || sheet === 'heroes' || sheet === 'ui' || sheet === 'monsters' || sheet === 'items'
  return (
    <span
      className={`${styles.piece} ${styles[`chain${item.chain}`]} ${styles[item.itemType]} ${selected ? styles.selected : ''} ${shaking ? styles.shaking : ''} ${compact ? styles.compact : ''}`}
      title={`${item.name} Lv.${item.level}`}
    >
      {validSheet ? (
        <ArtIcon
          sheet={sheet as ArtSheet}
          name={item.iconName}
          viewBox={sheet === 'ui' ? '0 0 64 64' : sheet === 'monsters' ? '0 0 120 120' : '0 0 96 96'}
          className={styles.icon}
        />
      ) : <span className={styles.questionMark} aria-hidden>?</span>}
    </span>
  )
}
