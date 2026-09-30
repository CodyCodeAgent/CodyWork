import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { getWorkspaceFilePreview } from '../src/services/workspaceFilePreview.js'
import type { WorkspaceRow } from '../src/db/index.js'

describe('workspace file preview', () => {
  it('reads supported text documents inside a workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-preview-'))
    mkdirSync(join(root, 'worktrees', 'demo'), { recursive: true })
    writeFileSync(join(root, 'worktrees', 'demo', 'report.md'), '# Report\n')

    const preview = getWorkspaceFilePreview({ path: root } as WorkspaceRow, join(root, 'worktrees', 'demo', 'report.md'))
    expect(preview).toMatchObject({ name: 'report.md', relativePath: 'worktrees/demo/report.md', extension: 'md', content: '# Report\n' })
    rmSync(root, { recursive: true, force: true })
  })

  it('reads code files and exposes a read-only Git diff against HEAD', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-preview-'))
    execFileSync('git', ['init', '-q', root])
    execFileSync('git', ['-C', root, 'config', 'user.email', 'preview@example.test'])
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Preview Test'])
    writeFileSync(join(root, 'service.go'), 'package service\n\nfunc Name() string { return "before" }\n')
    execFileSync('git', ['-C', root, 'add', 'service.go'])
    execFileSync('git', ['-C', root, 'commit', '-qm', 'baseline'])
    writeFileSync(join(root, 'service.go'), 'package service\n\nfunc Name() string { return "after" }\n')

    const preview = getWorkspaceFilePreview({ path: root } as WorkspaceRow, 'service.go')

    expect(preview).toMatchObject({ extension: 'go', content: expect.stringContaining('after'), diff: { available: true, base: 'HEAD' } })
    expect(preview.diff.content).toContain('-func Name() string { return "before" }')
    expect(preview.diff.content).toContain('+func Name() string { return "after" }')
    const noContext = getWorkspaceFilePreview({ path: root } as WorkspaceRow, 'service.go', { diffContext: 0 })
    expect(noContext.diff.content).not.toContain('\n package service')
    const expandedContext = getWorkspaceFilePreview({ path: root } as WorkspaceRow, 'service.go', { diffContext: 100 })
    expect(expandedContext.diff.content).toContain('\n package service')
    rmSync(root, { recursive: true, force: true })
  })

  it('resolves repository-relative files in the active Demand worktree before the Workspace root', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-preview-'))
    const repository = join(root, 'worktrees', 'feature-demo', 'services', 'market-admin')
    mkdirSync(join(repository, 'src'), { recursive: true })
    writeFileSync(join(repository, 'src', 'settings.ts'), 'export const source = "demand worktree"\n')
    // A similarly named baseline file proves that the Demand copy is preferred.
    mkdirSync(join(root, 'services', 'market-admin', 'src'), { recursive: true })
    writeFileSync(join(root, 'services', 'market-admin', 'src', 'settings.ts'), 'export const source = "workspace baseline"\n')
    const workspace = { path: root } as WorkspaceRow
    const demandRepositories = [{ name: 'market-admin', worktreePath: repository }]

    const qualified = getWorkspaceFilePreview(workspace, 'market-admin/src/settings.ts', { demandRepositories })
    const servicesQualified = getWorkspaceFilePreview(workspace, 'services/market-admin/src/settings.ts', { demandRepositories })
    const direct = getWorkspaceFilePreview(workspace, 'src/settings.ts', { demandRepositories })

    expect(qualified.content).toContain('demand worktree')
    expect(servicesQualified.content).toContain('demand worktree')
    expect(direct.content).toContain('demand worktree')
    rmSync(root, { recursive: true, force: true })
  })

  it('requires a repository-qualified path when multiple Demand repositories match', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-preview-'))
    const first = join(root, 'worktrees', 'feature-demo', 'services', 'first-service')
    const second = join(root, 'worktrees', 'feature-demo', 'services', 'second-service')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    writeFileSync(join(first, 'README.md'), '# First\n')
    writeFileSync(join(second, 'README.md'), '# Second\n')
    const workspace = { path: root } as WorkspaceRow
    const demandRepositories = [
      { name: 'first-service', worktreePath: first },
      { name: 'second-service', worktreePath: second },
    ]

    expect(() => getWorkspaceFilePreview(workspace, 'README.md', { demandRepositories })).toThrow('预览文件路径不明确')
    expect(getWorkspaceFilePreview(workspace, 'first-service/README.md', { demandRepositories }).content).toContain('First')
    rmSync(root, { recursive: true, force: true })
  })

  it('rejects parent escapes, symlink escapes, unsupported files, and oversized files', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-preview-'))
    const outside = mkdtempSync(join(tmpdir(), 'workspace-preview-outside-'))
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'binary.bin'), 'no')
    writeFileSync(join(outside, 'private.md'), 'private')
    symlinkSync(join(outside, 'private.md'), join(root, 'docs', 'linked.md'))
    writeFileSync(join(root, 'docs', 'large.md'), 'x'.repeat(1024 * 1024 + 1))
    const workspace = { path: root } as WorkspaceRow

    expect(() => getWorkspaceFilePreview(workspace, '../outside.md')).toThrow('预览文件不存在')
    expect(() => getWorkspaceFilePreview(workspace, 'docs/linked.md')).toThrow('只能预览当前 Workspace 内')
    expect(() => getWorkspaceFilePreview(workspace, 'docs/binary.bin')).toThrow('不支持预览')
    expect(() => getWorkspaceFilePreview(workspace, 'docs/large.md')).toThrow('文件过大')
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })
})
