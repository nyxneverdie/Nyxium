import { useEffect } from 'react'
import { useStore } from '../state/store'

/** Global keybindings. Ignored while focus is in a text field, except for
 *  Escape-free combos that include a modifier plus a non-text key. */
export function useShortcuts(openPalette: (mode: 'commands' | 'search') => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const { openTab, closeTab, restoreTab, patchConfig } = useStore.getState()
      const s = useStore.getState()

      const handled = () => { e.preventDefault(); e.stopPropagation() }

      if (e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case 't': handled(); return restoreTab()
          case 's': handled(); return openTab('snippets')
          case 'a': handled(); return openTab('ai')
        }
        return
      }

      switch (e.key.toLowerCase()) {
        case 'k': handled(); return openPalette('commands')
        case 'p': handled(); return openPalette('search')
        case 'b': handled(); return void patchConfig({ sidebarCollapsed: !s.config.sidebarCollapsed })
        case 't': handled(); return openTab('projects')
        case 'w': handled(); return closeTab(s.activeTabId)
        case '`': handled(); return openTab('terminal')
        case ',': handled(); return openTab('settings')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPalette])
}
