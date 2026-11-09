import type { ComposerImage } from '@codycodeagent/cody-web-core/composer'

// Ephemeral composer inputs only, shared when moving between product views.
// Conversation ids are globally unique; no transcript or Turn data lives here.
export const conversationTextDrafts = new Map<string, string>()
export const conversationImageDrafts = new Map<string, ComposerImage[]>()
