import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkbenchDb } from '../src/db/index.js'
import { AiCodeReportService, patchLineStats } from '../src/services/aiCodeReports.js'

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'codywork-ai-report-'))
  const codexHome = join(root, '.codex')
  const reportHome = join(root, '.ai-code-report')
  const repository = join(root, 'repo')
  mkdirSync(join(codexHome, 'sessions'), { recursive: true })
  mkdirSync(reportHome, { recursive: true })
  mkdirSync(repository, { recursive: true })
  execFileSync('git', ['init', '-q', repository])
  writeFileSync(join(repository, 'feature.ts'), 'const old = true\n')
  execFileSync('git', ['-C', repository, 'add', 'feature.ts'])
  execFileSync('git', ['-C', repository, '-c', 'user.name=CodyWork', '-c', 'user.email=codywork@example.com', 'commit', '-qm', 'baseline'])
  const baseCommit = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  writeFileSync(join(repository, 'feature.ts'), 'const old = false\nconst added = true\n')

  const db = new WorkbenchDb(':memory:')
  const now = '2026-09-28T08:00:00.000Z'
  db.db.prepare('INSERT INTO workspaces (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run('workspace', 'AI Hub', root, now, now)
  db.db.prepare('INSERT INTO repositories (id, workspace_id, name, baseline_path, sync_status, dirty, present, inspected_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?)')
    .run('repository', 'workspace', 'repo', repository, 'ok', now)
  db.db.prepare('INSERT INTO demands (id, workspace_id, name, branch_name, worktree_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('demand', 'workspace', 'AI 上报', 'feat/report', 'report', 'in_progress', now, now)
  db.db.prepare('INSERT INTO demand_repositories (demand_id, repository_id, branch_name, worktree_path, base_ref, base_commit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('demand', 'repository', 'feat/report', repository, 'main', baseCommit, now)
  db.db.prepare(`INSERT INTO conversations (
    id, scope, demand_id, workspace_id, native_id, title, created_via, status, permission_mode, policy_hash, instruction_hash, created_at, updated_at
  ) VALUES (?, 'demand', ?, ?, ?, ?, 'browser', 'completed', 'yolo', 'policy', 'instructions', ?, ?)`).run('conversation', 'demand', 'workspace', 'session-123', '实现上报', now, now)
  const workspace = db.db.prepare('SELECT * FROM workspaces WHERE id = ?').get('workspace') as never
  return { root, codexHome, reportHome, repository, db, workspace }
}

function executable(path: string): string {
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
  return path
}

describe('AI code report receipts', () => {
  it('counts unified patch lines without treating diff headers as code', () => {
    expect(patchLineStats('--- a/a.ts\n+++ b/a.ts\n-old\n+new\n+\n context')).toMatchObject({ additions: 2, deletions: 1 })
    expect(patchLineStats('--- a/a.ts\n+++ b/a.ts\n-old\n+new\n+\n context').addedLineHashes).toHaveLength(1)
  })

  it('degrades cleanly when the reporter is not installed', () => {
    const fixture = createFixture()
    const service = new AiCodeReportService(fixture.db, { home: fixture.root, codexHome: fixture.codexHome, reportHome: fixture.reportHome })
    const summary = service.summary(fixture.workspace, 'demand')
    expect(summary).toMatchObject({ state: 'not_installed', acceptedEvents: 0, additions: 0, effectiveLines: 0 })
    expect(summary.capability).toMatchObject({ state: 'not_installed', exportAvailable: false, retryAvailable: false })
    fixture.db.close()
  })

  it('indexes TEA acknowledgements, deduplicates delivery ids, and derives surviving AI lines without storing raw code', () => {
    const fixture = createFixture()
    const binDir = join(fixture.root, 'bin')
    mkdirSync(binDir)
    const exportBin = executable(join(binDir, 'ai-report-export'))
    const pendingBin = executable(join(binDir, 'ai-report-pending'))
    const outboxBin = executable(join(binDir, 'ai-report-outbox'))
    writeFileSync(join(fixture.codexHome, 'hooks.json'), JSON.stringify({ hooks: Object.fromEntries(
      ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop'].map(name => [name, [{ hooks: [{ command: `${exportBin} ai-report-hook ${name}` }] }]]),
    ) }))
    const patch = '*** Begin Patch\n*** Update File: feature.ts\n@@\n-const old = true\n+const old = false\n+const added = true\n*** End Patch'
    const rows = [
      { delivery_id: 'delivery-code', session_id: 'session-123', event: 'dev_agent_tool_call', name: 'apply_patch', source: 'codex', model: 'gpt-test', user_unique_id: 'tester', file_path: 'feature.ts', patch, report_status: 'ok', phase: 'report_result', event_time: '2026-09-28T08:01:00.000Z', ts: '2026-09-28T08:01:01.000Z' },
      { delivery_id: 'delivery-token', session_id: 'session-123', event: 'dev_agent_tokens_collect', source: 'codex', model_name: 'gpt-test', report_status: 'ok', phase: 'report_result', event_time: '2026-09-28T08:02:00.000Z', ts: '2026-09-28T08:02:01.000Z' },
      // A repeated acknowledgement must update the same durable receipt.
      { delivery_id: 'delivery-code', session_id: 'session-123', event: 'dev_agent_tool_call', name: 'apply_patch', source: 'codex', model: 'gpt-test', user_unique_id: 'tester', file_path: 'feature.ts', patch, report_status: 'ok', phase: 'report_result', event_time: '2026-09-28T08:01:00.000Z', ts: '2026-09-28T08:03:01.000Z' },
    ]
    writeFileSync(join(fixture.reportHome, 'tea-reporter-events-2026-09-28.log'), rows.map(row => `[2026-09-28] event=${row.event} | ${JSON.stringify(row)}`).join('\n') + '\n')
    const service = new AiCodeReportService(fixture.db, { home: fixture.root, codexHome: fixture.codexHome, reportHome: fixture.reportHome, exportBin, pendingBin, outboxBin })

    const summary = service.summary(fixture.workspace, 'demand')
    expect(summary.capability).toMatchObject({ state: 'ready', exportAvailable: true, retryAvailable: true })
    expect(summary).toMatchObject({ state: 'healthy', acceptedEvents: 2, acceptedCodeEvents: 1, additions: 2, deletions: 1, netLines: 1, effectiveLines: 2 })
    expect(summary.conversations[0]).toMatchObject({ title: '实现上报', acceptedEvents: 2, acceptedCodeEvents: 1, additions: 2, deletions: 1 })
    expect(summary.recent.find(item => item.deliveryId === 'delivery-code')).toMatchObject({ filePath: 'feature.ts', additions: 2, deletions: 1 })
    expect(JSON.stringify(summary)).not.toContain('const added')
    expect((fixture.db.db.prepare('SELECT COUNT(*) AS count FROM ai_report_receipts').get() as { count: number }).count).toBe(2)

    expect(service.summary(fixture.workspace, 'demand').acceptedEvents).toBe(2)
    fixture.db.close()
  })
})
