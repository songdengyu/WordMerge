import {
  QUALITY_LABELS,
  WEAPON_CATALOG,
  getWeaponAttack,
  getWeaponUpgradeCost,
  type Weapon,
} from '../data/weapons'
import { useGameStore } from '../store/useGameStore'
import { WeaponIcon } from './WeaponIcon'
import styles from './WeaponPickerPanel.module.css'

const SUB_TABS = ['武器', '盾', '头盔', '衣']

function WeaponStats({ weapon, label }: { weapon: Weapon; label: string }) {
  return (
    <div className={styles.statsBlock}>
      <div className={styles.statsHeader}>{label}</div>
      <div className={styles.statsName}>{weapon.name} · Lv.{weapon.level}</div>
      <div className={styles.statsRow}>
        <span>攻击 {getWeaponAttack(weapon)}</span>
        <span>攻速 {weapon.attackSpeed.toFixed(1)}x</span>
      </div>
    </div>
  )
}

export function WeaponPickerPanel() {
  const {
    state,
    equippedWeapon,
    closeSecondaryView,
    selectWeaponInPicker,
    tryEquipWeapon,
    upgradeWeapon,
  } = useGameStore()

  const ownedWeapons = [equippedWeapon, ...state.weaponInventory]
  const selectedDefinition = state.selectedWeaponId
    ? WEAPON_CATALOG.find((weapon) => weapon.id === state.selectedWeaponId)
    : null
  const selected = selectedDefinition
    ? ownedWeapons.find((weapon) => weapon.id === selectedDefinition.id) ?? selectedDefinition
    : null
  const selectedOwned = selected ? selected.level > 0 : false
  const selectedCost = selected ? getWeaponUpgradeCost(selected) : 0

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>武器军械库</h2>
            <span className={styles.goldBalance}>● {state.gold} 金币</span>
          </div>
          <button type="button" className={styles.closeBtn} onClick={closeSecondaryView} aria-label="关闭">✕</button>
        </div>

        <div className={styles.compare}>
          <div className={styles.compareCol}>
            <WeaponStats weapon={equippedWeapon} label="当前装备" />
            <WeaponIcon weaponId={equippedWeapon.id} bulletStyle={equippedWeapon.bulletStyle} quality={equippedWeapon.quality} size="md" />
          </div>
          <div className={styles.vs}>VS</div>
          <div className={styles.compareCol}>
            {selected ? (
              <>
                <WeaponStats weapon={selected} label={selectedOwned ? '选中武器' : '尚未解锁'} />
                <WeaponIcon weaponId={selected.id} bulletStyle={selected.bulletStyle} quality={selected.quality} size="md" />
              </>
            ) : <div className={styles.emptySelect}><p>从下方选择武器</p></div>}
          </div>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btnDismantle} ${selected && !selectedOwned && state.gold >= selectedCost ? styles.unlockReady : ''}`}
            disabled={!selected || state.gold < selectedCost}
            onClick={() => selected && upgradeWeapon(selected.id)}
          >
            {selectedOwned ? '升级' : '解锁'} · ● {selectedCost}
          </button>
          <button
            type="button"
            className={styles.btnEquip}
            disabled={!selectedOwned || selected?.id === equippedWeapon.id}
            onClick={tryEquipWeapon}
          >
            {selected?.id === equippedWeapon.id ? '装备中' : '装备'}
          </button>
        </div>

        <div className={`${styles.inventory} scroll-touch`}>
          <div className={styles.grid}>
            {WEAPON_CATALOG.map((definition) => {
              const owned = ownedWeapons.find((weapon) => weapon.id === definition.id)
              const weapon = owned ?? definition
              const canUnlock = !owned && state.gold >= weapon.unlockCost
              return (
                <button
                  key={weapon.id}
                  type="button"
                  className={`${styles.gridItem} ${state.selectedWeaponId === weapon.id ? styles.selected : ''} ${!owned ? styles.locked : ''}`}
                  onClick={() => selectWeaponInPicker(weapon.id)}
                >
                  <WeaponIcon weaponId={weapon.id} bulletStyle={weapon.bulletStyle} quality={weapon.quality} size="sm" />
                  <span className={styles.gridName}>{weapon.name}</span>
                  <span className={`${styles.gridQuality} ${canUnlock ? styles.unlockText : ''}`}>
                    {owned ? `Lv.${weapon.level}` : `解锁 ● ${weapon.unlockCost}`}
                  </span>
                  <span className={styles.gridQuality}>{QUALITY_LABELS[weapon.quality]}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className={styles.subTabs}>
          {SUB_TABS.map((tab, index) => (
            <button key={tab} type="button" className={`${styles.subTab} ${index === 0 ? styles.subTabActive : styles.subTabDisabled}`} disabled={index !== 0}>{tab}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
