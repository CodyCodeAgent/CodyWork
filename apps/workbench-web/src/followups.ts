/** Planned frontend contract. Origin is resolved/authorized by the server within the URL workspace. */
export interface FollowupInput {
  conversationId: string
  name: string
  prompt: string
  completionCondition: string
  deadlineAt: string
  intervalMinutes: number
  notification: { mode: 'every' | 'change' | 'terminal'; accountId: string; recipientOpenId: string; recipientEmail?: string; feishuEnabled?: boolean }
}
export interface FollowupTask extends FollowupInput {
  id: string
  workspaceId: string
  demandId: string | null
  backgroundConversationId?: string | null
  lastRun?: Pick<FollowupRun, 'id' | 'phase' | 'result' | 'outboxId'> | null
  revision: number
  status: 'active' | 'paused' | 'running' | 'needs_attention' | 'completed' | 'cancelled' | 'expired'
  nextRunAt?: string | null
}
export interface FollowupRun {
  notificationId?: string
  id: string
  phase?: 'executing' | 'notifying' | 'finished' | 'interrupted' | 'deferred'
  result?: { status: string; summary?: string } | null
  outboxId?: string | null
  status: string
  startedAt: string
  finishedAt?: string | null
  summary?: string
  error?: string
  deliveryStatus: string
  deliveryError?: string
}
export type FollowupAction = 'pause' | 'resume' | 'cancel' | 'run-now' | 'retry-notification'

