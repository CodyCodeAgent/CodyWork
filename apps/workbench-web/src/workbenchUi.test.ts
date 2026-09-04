import { describe, expect, it } from 'vitest'
import { createConversationState, reduceConversationEvent, type CodexEvent } from '@codycodeagent/cody-web-core/conversation'
import type { AvailableNativeThread, Conversation, Demand, WorkspaceSkill } from './api'
import {
  canDeleteConversation,
  conversationStatusFromState,
  dashboardCacheLabel,
  dashboardNeedsRefresh,
  deleteConversationTitle,
  filterNativeThreads,
  filterSkills,
  formatThreadTime,
  groupThreadProjects,
  matchDemandRoute,
  parseWorkbenchRoute,
  sameNameSkills,
  skillIdentityDescription,
  threadTitle,
  skillSearchSummary,
  skillSourceLabel,
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

  it('searches the unified Skill catalog across metadata, path and source', () => {
    const skill = (patch: Partial<WorkspaceSkill>): WorkspaceSkill => ({
      id: '/skills/review/SKILL.md', name: 'review', displayName: 'Review', description: 'Review code',
      path: '/skills/review/SKILL.md', source: 'user', scope: 'user', status: 'available',
      modelInvocable: true, content: '', updatedAt: '', ...patch,
    })
    const skills = [
      skill({ name: 'review', source: 'user', scope: 'user' }),
      skill({ id: '/workspace/.agents/skills/release/SKILL.md', name: 'release', displayName: '发布检查', path: '/workspace/.agents/skills/release/SKILL.md', source: 'workspace', scope: 'repo' }),
      skill({ id: '/system/research/SKILL.md', name: 'research', path: '/system/research/SKILL.md', source: 'system', scope: 'system' }),
    ]
    expect(filterSkills(skills, '发布').map(item => item.name)).toEqual(['release'])
    expect(filterSkills(skills, 'codex 全局').map(item => item.name)).toEqual(['review'])
    expect(filterSkills(skills, '/system/').map(item => item.name)).toEqual(['research'])
    expect(skillSearchSummary(412, 1, 'release')).toBe('匹配 1 / 412')
    expect(skillSourceLabel('system')).toBe('Codex 内置')
  })

  it('keeps same-name Skills distinct by their Runtime path', () => {
    const workspace = { id: '/workspace/review/SKILL.md', name: 'review' }
    const global = { id: '/user/review/SKILL.md', name: 'review' }
    const catalog = [workspace, global, { id: '/system/research/SKILL.md', name: 'research' }]
    expect(sameNameSkills(catalog, workspace)).toEqual([global])
    expect(skillIdentityDescription(catalog, workspace)).toBe('同名 Skill 按完整路径精确区分')
    expect(skillIdentityDescription(catalog, catalog[2]!)).toBe('')
  })

  it('normalizes thread labels and relative time deterministically', () => {
    expect(threadTitle(thread('019ff043-116d', '/repo', '  inspect   code  '))).toBe('inspect code')
    expect(formatThreadTime('2026-08-29T00:00:00.000Z', Date.parse('2026-08-29T02:00:00.000Z'))).toBe('2 小时前')
  })

  it('round-trips stable Workspace and Demand deep links', () => {
    const url = workbenchUrl('http://localhost:3001/?workspace=old&debug=1', 'ws-1', 'demand-1')
    expect(url.toString()).toBe('http://localhost:3001/?workspace=ws-1&debug=1&demand=demand-1')
    expect(parseWorkbenchRoute(url.search)).toEqual({ workspaceId: 'ws-1', demandId: 'demand-1', page: 'dashboard', settingsSection: 'overview' })
    const demands = [demand('demand-1', 'feat/one')]
    expect(matchDemandRoute(demands, 'feat/one')?.id).toBe('demand-1')
  })

  it('round-trips settings subpages without leaking them into Demand links', () => {
    const settings = workbenchUrl('http://localhost:3001/?debug=1', 'ws-1', null, { page: 'settings', settingsSection: 'quick-actions' })
    expect(settings.toString()).toBe('http://localhost:3001/?debug=1&workspace=ws-1&view=settings&settings=quick-actions')
    expect(parseWorkbenchRoute(settings.search).settingsSection).toBe('quick-actions')
    expect(workbenchUrl(settings.toString(), 'ws-1', 'demand-1').searchParams.has('settings')).toBe(false)
  })

  it('derives execution status from the complete Core ConversationState', () => {
    const event = (id: string, type: CodexEvent['type'], data: Record<string, unknown> = {}): CodexEvent => ({
      id, type, threadId: 'thread', turnId: 'turn', atIso: `2026-08-29T00:00:0${id.length}.000Z`, data,
    })
    let state = createConversationState('thread')
    state = reduceConversationEvent(state, event('start', 'turn.started'))
    expect(conversationStatusFromState('idle', state)).toBe('running')
    state = reduceConversationEvent(state, event('approval', 'approval.requested', { approvalId: 'approval-1' }))
    expect(conversationStatusFromState('idle', state)).toBe('awaiting_approval')
    state = reduceConversationEvent(state, event('resolved', 'approval.resolved', { approvalId: 'approval-1' }))
    state = reduceConversationEvent(state, event('done', 'turn.completed'))
    expect(conversationStatusFromState('idle', state)).toBe('completed')
  })

  it('surfaces dashboard refresh failures instead of presenting stale data as current', () => {
    expect(dashboardCacheLabel({ state: 'stale', generatedAt: '', ageSeconds: 1, lastError: 'failed' })).toBe('刷新失败，可重试')
    expect(dashboardNeedsRefresh({ state: 'refreshing', generatedAt: null, ageSeconds: null, lastError: null })).toBe(true)
    expect(dashboardNeedsRefresh({ state: 'fresh', generatedAt: '', ageSeconds: 1, lastError: null })).toBe(false)
  })
})
