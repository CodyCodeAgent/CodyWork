export type FilePreviewDiffLayout = 'unified' | 'split'

export interface FilePreviewDiffRow {
  key: string
  kind: 'meta' | 'hunk' | 'context' | 'changed' | 'added' | 'removed'
  label?: string
  oldLine?: number
  oldText?: string
  newLine?: number
  newText?: string
}

interface ParsedHunkHeader {
  oldStart: number
  newStart: number
  suffix: string
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/u

function parseHunkHeader(line: string): ParsedHunkHeader | null {
  const match = HUNK_HEADER.exec(line)
  if (!match) return null
  return { oldStart: Number(match[1]), newStart: Number(match[2]), suffix: match[3] ?? '' }
}

function hunkHeader(oldStart: number, oldCount: number, newStart: number, newCount: number, suffix: string): string {
  const oldRange = oldCount === 1 ? String(oldStart) : `${oldStart},${oldCount}`
  const newRange = newCount === 1 ? String(newStart) : `${newStart},${newCount}`
  return `@@ -${oldRange} +${newRange} @@${suffix}`
}

function lineCounts(lines: string[]): { old: number; next: number } {
  return {
    old: lines.filter(line => !line.startsWith('+')).length,
    next: lines.filter(line => !line.startsWith('-')).length,
  }
}

/**
 * Retains a configurable amount of unchanged context for every hunk. The API
 * requests a bounded 100-line raw context; this is only a client-side view
 * transform and never reads more of the Workspace.
 */
export function trimDiffContext(content: string, before: number, after: number): string {
  const lines = content.replace(/\n$/u, '').split('\n')
  const output: string[] = []
  const normalizedBefore = Math.max(0, Math.min(100, Math.trunc(before)))
  const normalizedAfter = Math.max(0, Math.min(100, Math.trunc(after)))

  for (let index = 0; index < lines.length;) {
    const header = parseHunkHeader(lines[index] ?? '')
    if (!header) {
      output.push(lines[index] ?? '')
      index += 1
      continue
    }

    index += 1
    const body: string[] = []
    while (index < lines.length && !parseHunkHeader(lines[index] ?? '')) {
      body.push(lines[index] ?? '')
      index += 1
    }
    const firstChange = body.findIndex(line => !line.startsWith(' '))
    const lastChange = body.length - 1 - [...body].reverse().findIndex(line => !line.startsWith(' '))
    if (firstChange < 0 || lastChange < firstChange) {
      output.push(hunkHeader(header.oldStart, lineCounts(body).old, header.newStart, lineCounts(body).next, header.suffix), ...body)
      continue
    }

    const shownLeadingStart = Math.max(0, firstChange - normalizedBefore)
    const shownTrailingEnd = Math.min(body.length, lastChange + 1 + normalizedAfter)
    const displayed = body.slice(shownLeadingStart, shownTrailingEnd)
    const counts = lineCounts(displayed)
    const skippedLeading = shownLeadingStart
    output.push(hunkHeader(header.oldStart + skippedLeading, counts.old, header.newStart + skippedLeading, counts.next, header.suffix), ...displayed)
  }
  return output.join('\n')
}

/** Builds aligned old/new rows from a unified patch for the side-by-side view. */
export function splitDiffRows(content: string): FilePreviewDiffRow[] {
  const rows: FilePreviewDiffRow[] = []
  const lines = content.replace(/\n$/u, '').split('\n')
  let oldLine = 0
  let newLine = 0
  let sequence = 0

  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? ''
    const header = parseHunkHeader(line)
    if (header) {
      oldLine = header.oldStart
      newLine = header.newStart
      rows.push({ key: `hunk-${sequence++}`, kind: 'hunk', label: line })
      index += 1
      continue
    }
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
      rows.push({ key: `meta-${sequence++}`, kind: 'meta', label: line })
      index += 1
      continue
    }
    if (line.startsWith(' ')) {
      rows.push({ key: `context-${sequence++}`, kind: 'context', oldLine, oldText: line.slice(1), newLine, newText: line.slice(1) })
      oldLine += 1
      newLine += 1
      index += 1
      continue
    }

    const removed: Array<{ line: number; text: string }> = []
    const added: Array<{ line: number; text: string }> = []
    while (index < lines.length && !parseHunkHeader(lines[index] ?? '') && !lines[index]?.startsWith(' ')) {
      const changed = lines[index] ?? ''
      if (changed.startsWith('-') && !changed.startsWith('---')) removed.push({ line: oldLine++, text: changed.slice(1) })
      else if (changed.startsWith('+') && !changed.startsWith('+++')) added.push({ line: newLine++, text: changed.slice(1) })
      else rows.push({ key: `meta-${sequence++}`, kind: 'meta', label: changed })
      index += 1
    }
    for (let pair = 0; pair < Math.max(removed.length, added.length); pair += 1) {
      const oldValue = removed[pair]
      const newValue = added[pair]
      rows.push({
        key: `change-${sequence++}`,
        kind: oldValue && newValue ? 'changed' : oldValue ? 'removed' : 'added',
        ...(oldValue ? { oldLine: oldValue.line, oldText: oldValue.text } : {}),
        ...(newValue ? { newLine: newValue.line, newText: newValue.text } : {}),
      })
    }
  }
  return rows
}
