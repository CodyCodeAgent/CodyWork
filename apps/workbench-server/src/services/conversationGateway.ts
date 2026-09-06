import type { ConversationPermissionMode } from '../db/index.js'

/** The source that admitted a command into the shared native Codex Thread. */
export type ConversationCommandOrigin =
  | { kind: 'browser' }
  | {
      kind: 'channel'
      provider: 'feishu'
      accountId: string
      bindingId: string
      messageId: string
      conversationKey: string
    }

/**
 * Turn-scoped execution settings. The conversation scope remains the immutable
 * security ceiling; a source default can only make one command more restrictive.
 */
export type ConversationExecutionProfile = {
  permissionMode: ConversationPermissionMode
}

export type ConversationCommandSettings = {
  model?: string
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  collaborationMode?: 'default' | 'plan'
  skills?: string[]
}

export type ConversationCommand = {
  id?: string
  workspaceId: string
  conversationId: string
  origin: ConversationCommandOrigin
  prompt: string
  submitMode?: 'queue' | 'steer'
  executionProfile?: ConversationExecutionProfile
  settings?: ConversationCommandSettings
  localImages?: Array<{ path: string }>
}

export type ConversationCommandReceipt = { accepted: true; commandId: string }

type ConversationActionBase = {
  workspaceId: string
  conversationId: string
  origin: ConversationCommandOrigin
}

export type ConversationAction = ConversationActionBase & (
  | { kind: 'interrupt' }
  | { kind: 'approval.resolve'; requestId: string; outcome: 'allowed-once' | 'rejected' }
  | { kind: 'question.resolve'; requestId: string; answer: unknown }
)

export type ConversationActionResult =
  | { kind: 'interrupt'; supported: boolean }
  | { kind: 'resolved' }

export interface ConversationCommandGateway {
  submitCommand(command: ConversationCommand): Promise<ConversationCommandReceipt>
  executeAction(action: ConversationAction): Promise<ConversationActionResult>
}
