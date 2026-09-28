import { useGameStore } from '../store/useGameStore'
import styles from './GameDialog.module.css'

export function GameDialog() {
  const { state, confirmDialog, cancelDialog } = useGameStore()

  if (!state.dialog) return null

  const { title, message, confirmText, cancelText } = state.dialog
  const isAlert = cancelText == null

  return (
    <div
      className={styles.overlay}
      onClick={isAlert ? confirmDialog : undefined}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.frame}>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.message}>{message}</p>
          <div className={styles.actions}>
            {cancelText && (
              <button type="button" className={styles.btnCancel} onClick={cancelDialog}>
                {cancelText}
              </button>
            )}
            <button type="button" className={styles.btnConfirm} onClick={confirmDialog}>
              {confirmText ?? '确定'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
