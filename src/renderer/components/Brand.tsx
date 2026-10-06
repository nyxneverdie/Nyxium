import { nyx } from '../palette/PaletteProvider'

/** The Nyxium mark: diamond outline with a solid core. Shape is fixed;
 *  only the colour follows the palette, so branding stays recognisable. */
export function NyxiumMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" fill="none" stroke={nyx('primary')} strokeWidth={1.7} />
      <path d="M12 7.6 16.4 12 12 16.4 7.6 12Z" fill={nyx('primary')} />
    </svg>
  )
}

export function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex h-12 items-center gap-2.5 px-3.5" title="Nyxium">
      <NyxiumMark />
      {collapsed ? null : (
        <span style={{ color: nyx('textPrimary') }} className="text-[15px] font-semibold tracking-tight">
          Nyxium
        </span>
      )}
    </div>
  )
}
