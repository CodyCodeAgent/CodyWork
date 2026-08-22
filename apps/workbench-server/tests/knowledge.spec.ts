import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getKnowledgeDocument, listKnowledgeDocuments } from '../src/services/knowledge.js'
import type { WorkspaceRow } from '../src/db/index.js'

describe('workspace knowledge documents', () => {
  it('lists docs recursively, reads content, and rejects paths outside docs', () => {
    const root = mkdtempSync(join(tmpdir(), 'knowledge-'))
    mkdirSync(join(root, 'docs', 'guides'), { recursive: true })
    writeFileSync(join(root, 'docs', 'guides', 'intro.md'), '# Intro\n\nKnowledge.\n')
    writeFileSync(join(root, 'not-a-doc.md'), 'private')
    const workspace = { path: root } as WorkspaceRow
    const documents = listKnowledgeDocuments(workspace)
    expect(documents).toHaveLength(1)
    expect(documents[0]?.relativePath).toBe('guides/intro.md')
    expect(getKnowledgeDocument(workspace, 'guides/intro.md').content).toContain('Knowledge.')
    expect(() => getKnowledgeDocument(workspace, '../not-a-doc.md')).toThrow('路径无效')
    rmSync(root, { recursive: true, force: true })
  })
})
