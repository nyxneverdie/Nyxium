import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { DetectedProvider, PaletteSnapshot } from '../../shared/palette'
import { SEMANTIC_KEYS } from '../../shared/palette'

interface PaletteCtx {
  snapshot: PaletteSnapshot | null
  providers: DetectedProvider[]
  reload: () => Promise<void>
}

const Ctx = createContext<PaletteCtx>({ snapshot: null, providers: [], reload: async () => {} })

/** Writes the active palette onto :root as --nyx-* variables. Components read
 *  only those variables, so no component ever knows which provider is active. */
function applyPalette(p: PaletteSnapshot) {
  const root = document.documentElement
  for (const key of SEMANTIC_KEYS) {
    const value = p.colors[key]
    if (value) root.style.setProperty(`--nyx-${key}`, value)
  }
  root.style.colorScheme = p.mode
}

export function PaletteProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<PaletteSnapshot | null>(null)
  const [providers, setProviders] = useState<DetectedProvider[]>([])

  const accept = useCallback((p: PaletteSnapshot) => {
    applyPalette(p)
    setSnapshot(p)
  }, [])

  useEffect(() => {
    void window.nyx.palette.current().then(accept)
    void window.nyx.palette.detect().then(setProviders)
    return window.nyx.palette.onChange((p) => {
      accept(p)
      void window.nyx.palette.detect().then(setProviders)
    })
  }, [accept])

  const reload = useCallback(async () => {
    accept(await window.nyx.palette.reload())
    setProviders(await window.nyx.palette.detect())
  }, [accept])

  const value = useMemo(() => ({ snapshot, providers, reload }), [snapshot, providers, reload])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const usePalette = () => useContext(Ctx)

/** `nyx('surface')` → a CSS value referencing the live token. */
export const nyx = (key: (typeof SEMANTIC_KEYS)[number]) => `var(--nyx-${key})`
