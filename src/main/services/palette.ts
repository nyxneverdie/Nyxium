import { readFile } from 'node:fs/promises'
import { watch, existsSync, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type {
  DetectedProvider, Palette, PaletteProviderId, PaletteSnapshot,
} from '../../shared/palette.js'

const H = homedir()

/** Candidate files per provider. First existing one wins; a user path overrides all. */
const CANDIDATES: Record<Exclude<PaletteProviderId, 'manual'>, string[]> = {
  matugen: [
    join(H, '.cache/matugen/colors.json'),
    join(H, '.config/matugen/colors.json'),
    join(H, '.local/state/matugen/colors.json'),
  ],
  pywal: [join(H, '.cache/wal/colors.json'), join(H, '.cache/wal/colors')],
  wallust: [
    join(H, '.cache/wallust/colors.json'),
    join(H, '.cache/wallust/sequences.json'),
    join(H, '.config/wallust/colors.json'),
  ],
  end4: [
    join(H, '.local/state/quickshell/user/generated/colors.json'),
    join(H, '.cache/ags/user/colors.json'),
    join(H, '.local/state/ags/user/colors.json'),
  ],
}

/** Nyxium's own dark palette — used when no provider is available or dynamic color is off. */
export const FALLBACK: Palette = {
  background: '#0d0f14', surface: '#141821', surfaceVariant: '#1b2030', surfaceElevated: '#1f2535',
  textPrimary: '#e6e9f0', textSecondary: '#a8b0c2', textMuted: '#6b7488',
  accent: '#7aa2f7', accentContainer: '#263455',
  success: '#9ece6a', warning: '#e0af68', error: '#f7768e', info: '#7dcfff',
  border: '#232838', divider: '#1c2130', selection: '#2b3650',
  terminalBackground: '#0d0f14', terminalForeground: '#e6e9f0',
  codeBackground: '#11151e', codeForeground: '#dce1ec',
  primary: '#7aa2f7', onPrimary: '#0b1120', primaryContainer: '#263455', onPrimaryContainer: '#cddcff',
  secondary: '#9aa5c4', onSecondary: '#11151e', secondaryContainer: '#242a3b', onSecondaryContainer: '#dde3f3',
  tertiary: '#bb9af7', onTertiary: '#150f22',
  onBackground: '#e6e9f0', onSurface: '#e6e9f0', onSurfaceVariant: '#a8b0c2',
  outline: '#3a4255', outlineVariant: '#242a3b',
  onError: '#2a0d14', errorContainer: '#4a1c26',
}

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i

function norm(c: unknown): string | null {
  if (typeof c !== 'string') return null
  const m = c.trim().match(HEX)
  if (!m) return null
  const h = m[1]
  return `#${h.length === 3 ? h.split('').map((x) => x + x).join('') : h}`.toLowerCase()
}

interface RawColors { background?: string; foreground?: string; cursor?: string; colors: string[] }

/** Pull a background/foreground/color0..15 set out of whatever shape the provider wrote. */
function parseRaw(text: string): RawColors | null {
  const out: RawColors = { colors: [] }
  try {
    const json = JSON.parse(text) as Record<string, unknown>
    const special = (json.special ?? {}) as Record<string, unknown>
    const colorsObj = (json.colors ?? json) as Record<string, unknown>
    out.background = norm(special.background ?? colorsObj.background ?? (json as Record<string, unknown>).background) ?? undefined
    out.foreground = norm(special.foreground ?? colorsObj.foreground ?? (json as Record<string, unknown>).foreground) ?? undefined
    out.cursor = norm(special.cursor) ?? undefined
    for (let i = 0; i < 16; i++) {
      const v = norm(colorsObj[`color${i}`]) ?? norm((json as Record<string, unknown>)[`color${i}`])
      if (v) out.colors[i] = v
    }
    // Material-style keys (matugen / end-4) take priority when present.
    const mat: Record<string, unknown> = (json.dark as Record<string, unknown>) ?? colorsObj
    const prim = norm(mat.primary) ?? norm(mat.accent) ?? norm((json as Record<string, unknown>).primary)
    if (prim) out.colors[4] = prim
    const surf = norm(mat.surface)
    if (surf && !out.background) out.background = surf
    if (out.colors.filter(Boolean).length || out.background) return out
  } catch {
    // pywal plain `colors` file: one hex per line.
    const lines = text.split('\n').map(norm).filter((x): x is string => !!x)
    if (lines.length >= 8) {
      out.colors = lines.slice(0, 16)
      out.background = lines[0]
      out.foreground = lines[7]
      return out
    }
  }
  return null
}

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const mix = (a: string, b: string, t: number) => {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (sh: number) => {
    const x = Math.round((((pa >> sh) & 255) * (1 - t)) + (((pb >> sh) & 255) * t))
    return Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')
  }
  return `#${ch(16)}${ch(8)}${ch(0)}`
}

/** Map raw terminal/material colors onto Nyxium's semantic tokens. */
export function derive(raw: RawColors): PaletteSnapshot['colors'] & { mode: 'dark' | 'light' } {
  const c = raw.colors
  const bg = raw.background ?? c[0] ?? FALLBACK.background
  const fg = raw.foreground ?? c[15] ?? c[7] ?? FALLBACK.textPrimary
  const mode: 'dark' | 'light' = lum(bg) < 0.5 ? 'dark' : 'light'
  const up = mode === 'dark' ? fg : bg
  const accent = c[4] ?? c[12] ?? FALLBACK.accent
  const lift = (t: number) => mix(bg, up, t)

  return {
    mode,
    background: bg,
    surface: lift(0.05),
    surfaceVariant: lift(0.1),
    surfaceElevated: lift(0.14),
    textPrimary: fg,
    textSecondary: mix(fg, bg, 0.3),
    textMuted: mix(fg, bg, 0.55),
    accent,
    accentContainer: mix(bg, accent, 0.22),
    success: c[2] ?? FALLBACK.success,
    warning: c[3] ?? FALLBACK.warning,
    error: c[1] ?? FALLBACK.error,
    info: c[6] ?? FALLBACK.info,
    border: lift(0.16),
    divider: lift(0.1),
    selection: mix(bg, accent, 0.3),
    terminalBackground: bg,
    terminalForeground: fg,
    codeBackground: lift(0.03),
    codeForeground: mix(fg, bg, 0.1),
    primary: accent,
    onPrimary: lum(accent) > 0.5 ? '#0b0d12' : '#ffffff',
    primaryContainer: mix(bg, accent, 0.22),
    onPrimaryContainer: mix(accent, up, 0.45),
    secondary: c[5] ?? mix(accent, fg, 0.4),
    onSecondary: bg,
    secondaryContainer: lift(0.12),
    onSecondaryContainer: fg,
    tertiary: c[13] ?? c[5] ?? FALLBACK.tertiary,
    onTertiary: bg,
    onBackground: fg,
    onSurface: fg,
    onSurfaceVariant: mix(fg, bg, 0.35),
    outline: lift(0.28),
    outlineVariant: lift(0.14),
    onError: bg,
    errorContainer: mix(bg, c[1] ?? FALLBACK.error, 0.25),
  }
}

export function detect(custom: Partial<Record<string, string>> = {}): DetectedProvider[] {
  return (Object.keys(CANDIDATES) as Array<keyof typeof CANDIDATES>).map((id) => {
    const list = [custom[id], ...CANDIDATES[id]].filter((p): p is string => !!p)
    const path = list.find((p) => existsSync(p)) ?? null
    return { id, available: !!path, path }
  })
}

export async function load(
  source: 'auto' | PaletteProviderId,
  custom: Partial<Record<string, string>> = {},
  manual: Record<string, string> = {},
): Promise<PaletteSnapshot> {
  if (source === 'manual') {
    return {
      provider: 'manual', source: 'manual', mode: 'dark',
      colors: { ...FALLBACK, ...manual } as Palette,
    }
  }
  const found = detect(custom).filter((p) => p.available)
  const pick = source === 'auto' ? found[0] : found.find((p) => p.id === source)
  if (pick?.path) {
    try {
      const raw = parseRaw(await readFile(pick.path, 'utf8'))
      if (raw) {
        const { mode, ...colors } = derive(raw)
        return { provider: pick.id, source: pick.path, mode, colors }
      }
    } catch {
      /* fall through to the built-in palette */
    }
  }
  return { provider: 'manual', source: 'built-in', mode: 'dark', colors: FALLBACK }
}

/** Watch every detected palette file; debounced so a rewrite fires one event. */
export function watchPalettes(custom: Partial<Record<string, string>>, onChange: () => void) {
  const watchers: FSWatcher[] = []
  let timer: NodeJS.Timeout | null = null
  for (const p of detect(custom)) {
    if (!p.path) continue
    try {
      const w = watch(p.path, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(onChange, 150)
      })
      watchers.push(w)
    } catch {
      /* unwatchable path — ignore */
    }
  }
  return () => {
    if (timer) clearTimeout(timer)
    watchers.forEach((w) => w.close())
  }
}
