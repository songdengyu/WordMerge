import { BossFailModal } from './components/BossFailModal'
import { BottomTabBar } from './components/BottomTabBar'
import { CombatView } from './components/CombatView'
import { GameDialog } from './components/GameDialog'
import { MainPanel } from './components/MainPanel'
import { MergeGameScreen } from './components/MergeGameScreen'
import { EquipmentPickerPanel } from './components/EquipmentPickerPanel'
import { Toast } from './components/Toast'
import { WeaponPickerPanel } from './components/WeaponPickerPanel'
import { useGameLoop } from './hooks/useGameLoop'
import { GameProvider, useGameStore } from './store/useGameStore'

function GameApp() {
  useGameLoop()
  const { state } = useGameStore()

  return (
    <div className="game-viewport">
      <div className="app">
        <div className="combat-section">
          <CombatView />
        </div>
        <div className="main-section">
          {state.tabPanelOpen && <MainPanel />}
          <BottomTabBar />
        </div>
        <BossFailModal />
        {state.secondaryView === 'weapon' && <WeaponPickerPanel />}
        {state.secondaryView === 'equipment' && <EquipmentPickerPanel />}
        {state.secondaryView === 'merge' && <MergeGameScreen />}
        <GameDialog />
        <Toast />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <GameProvider>
      <GameApp />
    </GameProvider>
  )
}
