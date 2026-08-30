import { describe, expect, it } from 'vitest'
import type { AvailableNativeThread, Conversation, Demand } from './api'
import {
  canDeleteConversation,
  conversationStatusAfterEvent,
  dashboardCacheLabel,
  dashboardNeedsRefresh,
  deleteConversationTitle,
  filterNativeThreads,
  formatThreadTime,
  groupThreadProjects,
  matchDemandRoute,
  parseWorkbenchRoute,
  threadTitle,
  workbenchUrl,
} from './workbenchUi'

const conversation = (status: Conversation['status']): Conversation => ({
  id: 'conversation', demandId: 'demand', nativeId: 'native', title: 'Session', status,
  permissionMode: 'workspace-write', policyHash: '', instructionHash: '', createdAt: '', updatedAt: '',
})

const demand = (id: string, branchName = id): Demand => ({
  id, name: id, branchName, worktreeKey: `key-${id}`, path: `/worktrees/${id}`, status: 'in_progress', createdAt: '', updatedAt: '', repositories: [],
})

const thread = (nativeId: string, cwd: string, preview = nativeId): AvailableNativeThread => ({ nativeId, cwd, preview, bound: false })

describe('workbench UI rules', () => {
  it('protects active and last remaining conversations from deletion', () => {
    expect(canDeleteConversation(conversation('running'), 3)).toBe(false)
    expect(deleteConversationTitle(conversation('awaiting_approval'), 3)).toContain('不能删除')
    expect(canDeleteConversation(conversation('completed'), 1)).toBe(false)
    expect(canDeleteConversation(conversation('completed'), 2)).toBe(true)
  })

  it('groups related Codex projects first and filters their threads', () => {
    const threads = [thread('a', '/repo/other'), thread('b', '/workspace/worktree'), thread('c', '/workspace/worktree', 'Fix API')]
    expect(groupThreadProjects(threads, ['/workspace/worktree'])).toMatchObject([
      { cwd: '/workspace/worktree', count: 2, relatedToDemand: true },
      { cwd: '/repo/other', count: 1, relatedToDemand: false },
    ])
    expect(filterNativeThreads(threads, '/workspace/worktree', 'fix').map(item => item.nativeId)).toEqual(['c'])
  })

  it('normalizes thread labels and relative time deterministically', () => {
    expect(threadTitle(thread('019ff043-116d', '/repo', '  inspect   code  '))).toBe('inspect code')
    expect(formatThreadTime('2026-08-29T00:00:00.000Z', Date.parse('2026-08-29T02:00:00.000Z'))).toBe('2 小时前')
  })

  it('round-trips stable Workspace and Demand deep links', () => {
    const url = workbenchUrl('http://localhost:3001/?workspace=old&debug=1', 'ws-1', 'demand-1')
    expect(url.toString()).toBe('http://localhost:3001/?workspace=ws-1&debug=1&demand=demand-1')
    expect(parseWorkbenchRoute(url.search)).toEqual({ workspaceId: 'ws-1', demandId: 'demand-1' })
    const demands = [demand('demand-1', 'feat/one')]
    expect(matchDemandRoute(demands, 'feat/one')?.id).toBe('demand-1')
  })

  it('maps runtime lifecycle events without disturbing unrelated state', () => {
    expect(conversationStatusAfterEvent('idle', 'turn.started')).toBe('running')
    expect(conversationStatusAfterEvent('running', 'approval.requested')).toBe('awaiting_approval')
    expect(conversationStatusAfterEvent('completed', 'assistant.delta')).toBe('completed')
  })

  it('surfaces dashboard refresh failures instead of presenting stale data as current', () => {
    expect(dashboardCacheLabel({ state: 'stale', generatedAt: '', ageSeconds: 1, lastError: 'failed' })).toBe('刷新失败，可重试')
    expect(dashboardNeedsRefresh({ state: 'refreshing', generatedAt: null, ageSeconds: null, lastError: null })).toBe(true)
    expect(dashboardNeedsRefresh({ state: 'fresh', generatedAt: '', ageSeconds: 1, lastError: null })).toBe(false)
  })
})
