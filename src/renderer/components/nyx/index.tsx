import {
  forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes,
  type InputHTMLAttributes, type ReactNode,
} from 'react'
import { Check, Loader2, Search, X } from 'lucide-react'
import { nyx } from '../../palette/PaletteProvider'

/* Every component below draws colour exclusively from semantic tokens. */

type Variant = 'filled' | 'tonal' | 'outline' | 'ghost' | 'danger'

const BUTTON_STYLE: Record<Variant, React.CSSProperties> = {
  filled: { background: nyx('primary'), color: nyx('onPrimary') },
  tonal: { background: nyx('primaryContainer'), color: nyx('onPrimaryContainer') },
  outline: { background: 'transparent', color: nyx('textPrimary'), borderWidth: 1, borderColor: nyx('outline') },
  ghost: { background: 'transparent', color: nyx('textSecondary') },
  danger: { background: nyx('errorContainer'), color: nyx('error') },
}

export interface NyxButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: ReactNode
  loading?: boolean
}

export const NyxButton = forwardRef<HTMLButtonElement, NyxButtonProps>(function NyxButton(
  { variant = 'tonal', size = 'md', icon, loading, children, style, disabled, className = '', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      style={{ ...BUTTON_STYLE[variant], ...style }}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
        'transition-[filter,opacity] duration-150 hover:brightness-110',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? <Loader2 size={size === 'sm' ? 13 : 15} className="animate-spin" /> : icon}
      {children}
    </button>
  )
})

export function NyxIconButton({
  label, icon, active, className = '', ...rest
}: { label: string; icon: ReactNode; active?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label={label}
      title={label}
      style={{
        background: active ? nyx('primaryContainer') : 'transparent',
        color: active ? nyx('onPrimaryContainer') : nyx('textSecondary'),
      }}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors
                  duration-150 hover:brightness-125 disabled:opacity-40 ${className}`}
      {...rest}
    >
      {icon}
    </button>
  )
}

export function NyxCard({
  children, className = '', elevated, ...rest
}: { children: ReactNode; className?: string; elevated?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      style={{
        background: elevated ? nyx('surfaceElevated') : nyx('surface'),
        borderColor: nyx('outlineVariant'),
      }}
      className={`rounded-xl border ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}

export function NyxCardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div
      style={{ borderColor: nyx('outlineVariant') }}
      className="flex h-10 items-center justify-between border-b px-3.5"
    >
      <h2 style={{ color: nyx('textSecondary') }} className="text-[11px] font-semibold tracking-wider uppercase">
        {title}
      </h2>
      {action}
    </div>
  )
}

export function NyxListItem({
  leading, title, subtitle, trailing, onClick, selected,
}: {
  leading?: ReactNode; title: ReactNode; subtitle?: ReactNode
  trailing?: ReactNode; onClick?: () => void; selected?: boolean
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      style={{ background: selected ? nyx('selection') : 'transparent' }}
      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors
                  duration-150 ${onClick ? 'hover:brightness-125' : ''}`}
    >
      {leading ? <div style={{ color: nyx('textMuted') }} className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div style={{ color: nyx('textPrimary') }} className="truncate text-sm">{title}</div>
        {subtitle ? (
          <div style={{ color: nyx('textMuted') }} className="truncate text-xs">{subtitle}</div>
        ) : null}
      </div>
      {trailing}
    </Tag>
  )
}

export function NyxChip({
  children, tone = 'neutral', onRemove,
}: { children: ReactNode; tone?: 'neutral' | 'accent'; onRemove?: () => void }) {
  return (
    <span
      style={{
        background: tone === 'accent' ? nyx('primaryContainer') : nyx('surfaceVariant'),
        color: tone === 'accent' ? nyx('onPrimaryContainer') : nyx('textSecondary'),
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px]"
    >
      {children}
      {onRemove ? (
        <button onClick={onRemove} aria-label="Remove" className="opacity-60 hover:opacity-100">
          <X size={10} />
        </button>
      ) : null}
    </span>
  )
}

type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'idle'

export function NyxStatus({ tone, children }: { tone: StatusTone; children?: ReactNode }) {
  const color = tone === 'idle' ? nyx('textMuted') : nyx(tone)
  return (
    <span style={{ color }} className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <span
        aria-hidden
        style={{ background: tone === 'idle' ? 'transparent' : color, borderColor: color }}
        className="size-[7px] rounded-full border"
      />
      {children}
    </span>
  )
}

export function NyxTextField({
  label, hint, ...rest
}: { label?: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <label htmlFor={id} style={{ color: nyx('textSecondary') }} className="text-xs font-medium">
          {label}
        </label>
      ) : null}
      <input
        id={id}
        style={{ background: nyx('surfaceVariant'), color: nyx('textPrimary'), borderColor: nyx('outlineVariant') }}
        className="h-9 rounded-lg border px-2.5 text-sm outline-none
                   focus:border-[var(--nyx-primary)] placeholder:text-[var(--nyx-textMuted)]"
        {...rest}
      />
      {hint ? <span style={{ color: nyx('textMuted') }} className="text-[11px]">{hint}</span> : null}
    </div>
  )
}

export function NyxSearch({
  value, onValueChange, placeholder = 'Search…', autoFocus,
}: { value: string; onValueChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div
      style={{ background: nyx('surfaceVariant'), borderColor: nyx('outlineVariant') }}
      className="flex h-9 items-center gap-2 rounded-lg border px-2.5"
    >
      <Search size={14} style={{ color: nyx('textMuted') }} />
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        style={{ color: nyx('textPrimary') }}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--nyx-textMuted)]"
      />
      {value ? (
        <button onClick={() => onValueChange('')} aria-label="Clear search">
          <X size={13} style={{ color: nyx('textMuted') }} />
        </button>
      ) : null}
    </div>
  )
}

export function NyxDialog({
  open, title, children, onClose, footer,
}: { open: boolean; title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgb(0 0 0 / 0.5)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        style={{ background: nyx('surfaceElevated'), borderColor: nyx('outline') }}
        className="nyx-enter w-full max-w-md rounded-2xl border shadow-2xl outline-none"
      >
        <div
          style={{ borderColor: nyx('outlineVariant') }}
          className="flex h-11 items-center justify-between border-b px-4"
        >
          <h2 style={{ color: nyx('textPrimary') }} className="text-sm font-semibold">{title}</h2>
          <NyxIconButton label="Close dialog" icon={<X size={15} />} onClick={onClose} />
        </div>
        <div className="p-4">{children}</div>
        {footer ? (
          <div
            style={{ borderColor: nyx('outlineVariant') }}
            className="flex justify-end gap-2 border-t px-4 py-3"
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function NyxTab({
  active, children, onClick, onClose,
}: { active?: boolean; children: ReactNode; onClick?: () => void; onClose?: () => void }) {
  return (
    <div
      style={{
        background: active ? nyx('surfaceElevated') : 'transparent',
        color: active ? nyx('textPrimary') : nyx('textMuted'),
        borderColor: active ? nyx('outlineVariant') : 'transparent',
      }}
      className="group flex h-8 max-w-52 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-xs"
    >
      <button onClick={onClick} className="min-w-0 flex-1 truncate text-left">{children}</button>
      {onClose ? (
        <button
          onClick={onClose}
          aria-label="Close tab"
          className="opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100"
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  )
}

export function NyxProgress({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <div className="flex justify-between text-[11px]">
          <span style={{ color: nyx('textSecondary') }}>{label}</span>
          <span style={{ color: nyx('textMuted') }} className="font-mono">{pct.toFixed(0)}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ background: nyx('surfaceVariant') }}
        className="h-1.5 overflow-hidden rounded-full"
      >
        <div style={{ width: `${pct}%`, background: nyx('primary') }} className="h-full rounded-full transition-[width]" />
      </div>
    </div>
  )
}

export function NyxCodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <pre
      style={{ background: nyx('codeBackground'), color: nyx('codeForeground'), borderColor: nyx('outlineVariant') }}
      className="overflow-auto rounded-lg border p-3 font-mono text-xs leading-relaxed"
    >
      {lang ? <div style={{ color: nyx('textMuted') }} className="mb-1.5 text-[10px] uppercase">{lang}</div> : null}
      <code>{code}</code>
    </pre>
  )
}

export function NyxDropdown<T extends string>({
  value, options, onChange, label,
}: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label?: string }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <label htmlFor={id} style={{ color: nyx('textSecondary') }} className="text-xs font-medium">{label}</label>
      ) : null}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        style={{ background: nyx('surfaceVariant'), color: nyx('textPrimary'), borderColor: nyx('outlineVariant') }}
        className="h-9 rounded-lg border px-2 text-sm outline-none focus:border-[var(--nyx-primary)]"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export function NyxSwitch({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{ background: checked ? nyx('primary') : nyx('surfaceVariant'), borderColor: nyx('outline') }}
      className="relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-150"
    >
      <span
        style={{ background: checked ? nyx('onPrimary') : nyx('textMuted') }}
        className={`absolute top-[3px] size-4 rounded-full transition-[left] duration-150
                    ${checked ? 'left-[23px]' : 'left-[3px]'}`}
      />
    </button>
  )
}

export function NyxSettingRow({
  title, description, children,
}: { title: string; description?: string; children: ReactNode }) {
  return (
    <div
      style={{ borderColor: nyx('outlineVariant') }}
      className="flex items-center justify-between gap-6 border-b py-3 last:border-b-0"
    >
      <div className="min-w-0">
        <div style={{ color: nyx('textPrimary') }} className="text-sm">{title}</div>
        {description ? (
          <div style={{ color: nyx('textMuted') }} className="mt-0.5 text-xs">{description}</div>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function NyxEmptyState({
  icon, title, description, actions,
}: { icon: ReactNode; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-16 text-center">
      <div style={{ color: nyx('textMuted') }}>{icon}</div>
      <div>
        <h3 style={{ color: nyx('textPrimary') }} className="text-sm font-medium">{title}</h3>
        {description ? (
          <p style={{ color: nyx('textMuted') }} className="mt-1 max-w-sm text-xs leading-relaxed">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="mt-1 flex gap-2">{actions}</div> : null}
    </div>
  )
}

/** Confirmation gate for destructive work. Phase 1 uses it for project removal;
 *  later phases reuse it for AI tool calls, cloud deletes and Git resets. */
export function NyxPermissionDialog({
  open, title, detail, danger, onConfirm, onCancel, confirmLabel = 'Allow',
}: {
  open: boolean; title: string; detail: ReactNode; danger?: boolean
  onConfirm: () => void; onCancel: () => void; confirmLabel?: string
}) {
  return (
    <NyxDialog
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <NyxButton variant="ghost" onClick={onCancel}>Cancel</NyxButton>
          <NyxButton
            variant={danger ? 'danger' : 'filled'}
            icon={<Check size={14} />}
            onClick={onConfirm}
          >
            {confirmLabel}
          </NyxButton>
        </>
      }
    >
      <div style={{ color: nyx('textSecondary') }} className="text-sm leading-relaxed">{detail}</div>
    </NyxDialog>
  )
}

export function NyxTooltip({ text, children }: { text: string; children: ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show ? (
        <span
          role="tooltip"
          style={{ background: nyx('surfaceElevated'), color: nyx('textPrimary'), borderColor: nyx('outline') }}
          className="pointer-events-none absolute top-1/2 left-full z-50 ml-2 -translate-y-1/2 rounded-md
                     border px-2 py-1 text-xs whitespace-nowrap shadow-lg"
        >
          {text}
        </span>
      ) : null}
    </span>
  )
}
