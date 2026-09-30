import { describe, expect, it } from 'vitest'
import { splitDiffRows, trimDiffContext } from './filePreviewDiff'

const DIFF = [
  'diff --git a/demo.go b/demo.go',
  'index 1111111..2222222 100644',
  '--- a/demo.go',
  '+++ b/demo.go',
  '@@ -10,7 +10,7 @@ func Demo() {',
  ' before-one',
  ' before-two',
  '-  oldValue()',
  '+  newValue()',
  ' after-one',
  ' after-two',
].join('\n')

describe('file preview diff presentation', () => {
  it('retains independently selected before and after context around a hunk', () => {
    const trimmed = trimDiffContext(DIFF, 1, 2)
    expect(trimmed).not.toContain('before-one')
    expect(trimmed).toContain('before-two')
    expect(trimmed).toContain('after-one')
    expect(trimmed).toContain('after-two')
    expect(trimmed).toContain('@@ -11,4 +11,4 @@ func Demo() {')
  })

  it('pairs replacements and keeps unmatched additions/removals in split rows', () => {
    const rows = splitDiffRows(trimDiffContext(DIFF, 1, 1))
    expect(rows.find(row => row.kind === 'changed')).toMatchObject({ oldText: '  oldValue()', newText: '  newValue()' })
    expect(rows.find(row => row.kind === 'context')).toMatchObject({ oldText: 'before-two', newText: 'before-two' })
  })
})
