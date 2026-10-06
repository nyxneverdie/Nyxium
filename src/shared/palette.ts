/** Semantic palette contract. The UI only ever reads these names — never a provider. */
export const SEMANTIC_KEYS = [
  'background', 'surface', 'surfaceVariant', 'surfaceElevated',
  'textPrimary', 'textSecondary', 'textMuted',
  'accent', 'accentContainer',
  'success', 'warning', 'error', 'info',
  'border', 'divider', 'selection',
  'terminalBackground', 'terminalForeground',
  'codeBackground', 'codeForeground',
  // Material-like roles
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'tertiary', 'onTertiary',
  'onBackground', 'onSurface', 'onSurfaceVariant',
  'outline', 'outlineVariant',
  'onError', 'errorContainer',
] as const

export type SemanticKey = (typeof SEMANTIC_KEYS)[number]
export type Palette = Record<SemanticKey, string>

export type PaletteProviderId = 'matugen' | 'pywal' | 'wallust' | 'end4' | 'manual'

export interface PaletteSnapshot {
  provider: PaletteProviderId
  /** Human label for the source, e.g. the file it was read from. */
  source: string
  mode: 'dark' | 'light'
  colors: Palette
}

export interface DetectedProvider {
  id: PaletteProviderId
  available: boolean
  path: string | null
}
