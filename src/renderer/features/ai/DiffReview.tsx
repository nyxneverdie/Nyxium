import { useMemo } from 'react'
import { Check, X } from 'lucide-react'
import { nyx } from '../../palette/PaletteProvider'
import { NyxButton } from '../../components/nyx'

export interface PendingEdit { id: string; path: string; before: string; after: string }

interface Row { kind: 'same' | 'add' | 'del'; text: string; a: number | null; b: number | null }

/** Line-level LCS diff. Small by design: the agent edits one file at a time,
 *  and a real diff algorithm is not worth a dependency here. */
function diffLines(before: string, after: string): Row[] {
  const A = before.length ? before.split('\n') : []
  const B = after.length ? after.split('\n') : []

  // Guard: a very large file gets a coarse whole-file replacement view instead
  // of an O(n·m) table that would stall the renderer.
  if (A.length * B.length > 4_000_000) {
    return [
      ...A.map((text, i) => ({ kind: 'del' as const, text, a: i + 1, b: null })),
      ...B.map((text, i) => ({ kind: 'add' as const, text, a: null, b: i + 1 })),
    ]
  }

  const lcs: number[][] = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0))
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const rows: Row[] = []
  let i = 0
  let j = 0
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { rows.push({ kind: 'same', text: A[i], a: i + 1, b: j + 1 }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { rows.push({ kind: 'del', text: A[i], a: i + 1, b: null }); i++ }
    else { rows.push({ kind: 'add', text: B[j], a: null, b: j + 1 }); j++ }
  }
  while (i < A.length) { rows.push({ kind: 'del', text: A[i], a: i + 1, b: null }); i++ }
  while (j < B.length) { rows.push({ kind: 'add', text: B[j], a: null, b: j + 1 }); j++ }
  return rows
}

/** Collapse long runs of unchanged lines, keeping context around each hunk. */
function withContext(rows: Row[], context = 3): Array<Row | { kind: 'gap'; count: number }> {
  const keep = new Set<number>()
  rows.forEach((r, i) => {
    if (r.kind === 'same') return
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep.add(k)
  })
  const out: Array<Row | { kind: 'gap'; count: number }> = []
  let skipped = 0
  rows.forEach((r, i) => {
    if (keep.has(i)) {
      if (skipped) { out.push({ kind: 'gap', count: skipped }); skipped = 0 }
      out.push(r)
    } else skipped++
  })
  if (skipped) out.push({ kind: 'gap', count: skipped })
  return out
}

export function DiffReview({
  edits, onApply, onReject, onApplyAll, onRejectAll,
}: {
  edits: PendingEdit[]
  onApply: (e: PendingEdit) => void
  onReject: (e: PendingEdit) => void
  onApplyAll: () => void
  onRejectAll: () => void
}) {
  if (!edits.length) return null
  return (
    <div
      style={{ background: nyx('surface'), borderColor: nyx('outline') }}
      className="flex max-h-[52%] shrink-0 flex-col overflow-hidden border-t"
    >
      <div
        style={{ borderColor: nyx('outlineVariant') }}
        className="flex h-10 shrink-0 items-center gap-2 border-b px-4"
      >
        <span style={{ color: nyx('textPrimary') }} className="text-xs font-semibold">
          The agent wants to modify {edits.length} file{edits.length > 1 ? 's' : ''}
        </span>
        <div className="ml-auto flex gap-1.5">
          <NyxButton size="sm" variant="ghost" icon={<X size={12} />} onClick={onRejectAll}>Reject All</NyxButton>
          <NyxButton size="sm" variant="filled" icon={<Check size={12} />} onClick={onApplyAll}>Apply All</NyxButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {edits.map((e) => <EditBlock key={e.id} edit={e} onApply={onApply} onReject={onReject} />)}
      </div>
    </div>
  )
}

function EditBlock({
  edit, onApply, onReject,
}: { edit: PendingEdit; onApply: (e: PendingEdit) => void; onReject: (e: PendingEdit) => void }) {
  const rows = useMemo(() => withContext(diffLines(edit.before, edit.after)), [edit])
  const added = rows.filter((r) => r.kind === 'add').length
  const removed = rows.filter((r) => r.kind === 'del').length

  return (
    <div style={{ borderColor: nyx('outlineVariant') }} className="border-b last:border-b-0">
      <div className="flex h-9 items-center gap-2 px-4">
        <span style={{ color: nyx('textPrimary') }} className="truncate font-mono text-[11px]">{edit.path}</span>
        <span style={{ color: nyx('success') }} className="font-mono text-[10px]">+{added}</span>
        <span style={{ color: nyx('error') }} className="font-mono text-[10px]">−{removed}</span>
        {edit.before === '' ? (
          <span style={{ color: nyx('info') }} className="text-[10px]">new file</span>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <NyxButton size="sm" variant="ghost" onClick={() => onReject(edit)}>Reject</NyxButton>
          <NyxButton size="sm" variant="tonal" onClick={() => onApply(edit)}>Apply</NyxButton>
        </div>
      </div>
      <div
        style={{ background: nyx('codeBackground') }}
        className="max-h-64 overflow-auto font-mono text-[11px] leading-[1.55]"
      >
        {rows.map((r, i) =>
          r.kind === 'gap' ? (
            <div key={i} style={{ color: nyx('textMuted') }} className="px-4 py-0.5 text-[10px]">
              ⋯ {r.count} unchanged line{r.count > 1 ? 's' : ''}
            </div>
          ) : (
            <div
              key={i}
              style={{
                color: r.kind === 'add' ? nyx('success') : r.kind === 'del' ? nyx('error') : nyx('codeForeground'),
                background: r.kind === 'same' ? undefined : nyx('selection'),
              }}
              className="flex px-2 whitespace-pre-wrap"
            >
              <span style={{ color: nyx('textMuted') }} className="w-10 shrink-0 text-right select-none">
                {r.a ?? ''}
              </span>
              <span style={{ color: nyx('textMuted') }} className="w-10 shrink-0 pr-2 text-right select-none">
                {r.b ?? ''}
              </span>
              <span className="w-3 shrink-0 select-none">
                {r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}
              </span>
              <span className="min-w-0">{r.text || ' '}</span>
            </div>
          ))}
      </div>
    </div>
  )
}
