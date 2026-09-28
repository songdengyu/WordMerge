import { useState } from 'react'
import { getEquipmentDismantleGold, type EquipmentConfig } from '../data/equipmentConfig'
import { useGameStore } from '../store/useGameStore'
import { EquipmentArt } from './EquipmentArt'
import styles from './EquipmentPickerPanel.module.css'

const TYPE_LABELS: Record<number, string> = { 1: '武器', 2: '副武器', 3: '头盔', 4: '衣服', 5: '腰带', 6: '鞋子', 7: '神器' }

function formatValue(value: number | null) {
  if (value === null) return null
  return value > 0 && value < 1 ? `${Math.round(value * 100)}%` : String(value)
}

function statRows(item: EquipmentConfig) {
  return [
    ['攻击', item.attack], ['攻击加成', item.attackBonus], ['暴击率', item.critRate],
    ['暴击伤害', item.critDamage], ['伤害加成', item.damageBonus],
    ['普攻伤害', item.normalAttackDamage], ['技能伤害', item.skillDamage], ['战斗力', item.power],
  ].filter((entry): entry is [string, number] => entry[1] !== null)
}

function EquipmentSummary({ item, label }: { item: EquipmentConfig | null; label: string }) {
  return (
    <div className={styles.compareItem}>
      <span className={styles.compareLabel}>{label}</span>
      {item ? <><EquipmentArt item={item} size="lg" /><strong>{item.name}</strong><small>{statRows(item).map(([key, value]) => `${key} ${formatValue(value)}`).join(' · ') || '属性待生效'}</small></> : <div className={styles.empty}>未装备</div>}
    </div>
  )
}

export function EquipmentPickerPanel() {
  const {
    state,
    closeSecondaryView,
    buyEquipment,
    selectEquipment,
    equipSelectedEquipment,
    dismantleSelectedEquipment,
    openEquipmentPicker,
  } = useGameStore()
  const [dismantlePrevious, setDismantlePrevious] = useState(false)
  const type = state.equipmentPickerType ?? 1
  const items = state.equipmentCatalog.filter((item) => item.type === type)
  const equipped = items.find((item) => item.id === state.equippedEquipment[type]) ?? null
  const selected = items.find((item) => item.id === state.selectedEquipmentId) ?? null
  const selectedOwned = selected ? (state.ownedEquipment[selected.id] ?? 0) > 0 : false
  const selectedPower = selected ? statRows(selected) : []
  const equippedPower = equipped ? statRows(equipped) : []

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <div><h2>{TYPE_LABELS[type]}军械库</h2><span>◆ {state.diamonds} 钻石</span></div>
          <button type="button" onClick={closeSecondaryView} aria-label="关闭">✕</button>
        </header>

        <section className={styles.compare}>
          <EquipmentSummary item={equipped} label="当前装备" />
          <div className={styles.vs}>VS</div>
          <EquipmentSummary item={selected} label={selected ? '选中装备' : '请选择装备'} />
        </section>

        <div className={styles.powerHintSlot} aria-live="polite">
          {selected && selectedOwned && equipped && selected.id !== equipped.id && (
            <div className={styles.powerHint}>
              {getDisplayPower(selectedPower) >= getDisplayPower(equippedPower) ? '该装备比当前装备更强' : '该装备比当前装备战斗力低'}
            </div>
          )}
        </div>

        <div className={styles.actions}>
          {selectedOwned ? (
            <button
              type="button"
              className={styles.dismantleBtn}
              disabled={selected?.id === equipped?.id}
              onClick={dismantleSelectedEquipment}
            >
              分解 · ● {selected ? getEquipmentDismantleGold(selected) : 0}
            </button>
          ) : selected ? (
            <button
              type="button"
              className={`${styles.buyBtn} ${selected.diamond !== null && state.diamonds >= selected.diamond ? styles.canBuy : ''}`}
              disabled={selected.diamond === null || state.diamonds < selected.diamond}
              onClick={() => buyEquipment(selected.id)}
            >
              {selected.diamond === null ? '仅合成产出' : `钻石解锁 · ◆ ${selected.diamond}`}
            </button>
          ) : <span />}
          <button type="button" className={styles.equipAction} disabled={!selectedOwned || selected?.id === equipped?.id} onClick={() => equipSelectedEquipment(dismantlePrevious)}>
            {selected?.id === equipped?.id ? '装备中' : '替换'}
          </button>
        </div>

        <label className={styles.autoDismantle}>
          <input type="checkbox" checked={dismantlePrevious} onChange={(event) => setDismantlePrevious(event.target.checked)} />
          <span>替换时分解原装备</span>
        </label>

        <div className={`${styles.inventory} scroll-touch`}>
          <div className={styles.grid}>
            {items.map((item) => {
              const quantity = state.ownedEquipment[item.id] ?? 0
              const owned = quantity > 0
              const isEquipped = equipped?.id === item.id
              const canBuy = !owned && item.diamond !== null && state.diamonds >= item.diamond
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.gridItem} ${state.selectedEquipmentId === item.id ? styles.selected : ''} ${!owned && !canBuy ? styles.locked : ''} ${canBuy ? styles.affordable : ''} ${isEquipped ? styles.equipped : ''}`}
                  onClick={() => selectEquipment(item.id)}
                >
                  <span className={styles.gridArt}><EquipmentArt item={item} size="md" /></span>
                  {state.newEquipmentIds.includes(item.id) && <i className={styles.itemRedDot} />}
                  <strong>{item.name}</strong>
                  <span>{isEquipped ? '装备中' : owned ? `持有 ×${quantity}` : canBuy ? `解锁 ◆ ${item.diamond}` : item.diamond === null ? '仅合成' : `◆ ${item.diamond}`}</span>
                </button>
              )
            })}
          </div>
        </div>
        <nav className={styles.typeTabs} aria-label="装备类型切换">
          {Object.entries(TYPE_LABELS).map(([id, label]) => (
            <button key={id} type="button" className={Number(id) === type ? styles.activeTab : ''} onClick={() => openEquipmentPicker(Number(id))}>{label}</button>
          ))}
        </nav>
      </div>
    </div>
  )
}

function getDisplayPower(stats: [string, number][]) {
  return stats.reduce((sum, [, value]) => sum + value, 0)
}
