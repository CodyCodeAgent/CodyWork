export interface DocumentationMaintenancePromptInput {
  demandName: string
  branchName: string
  conversationTitle: string
}

/** A visible, deliberate turn that turns verified session context into durable Demand documentation. */
export function buildDocumentationMaintenancePrompt(input: DocumentationMaintenancePromptInput): string {
  return [
    '# CodyWork demand documentation maintenance',
    '',
    'This is an explicit documentation-maintenance request, not an implementation request.',
    `Demand: ${input.demandName}`,
    `Branch: ${input.branchName}`,
    `Source session: ${input.conversationTitle}`,
    '',
    'First read the current `docs/` directory, including `docs/context.md` when present. Review this conversation, the current Worktree/Git state, and only facts you can verify.',
    'Update the existing document that owns each confirmed fact (for example context, progress, decisions, design, runbook, or verification) with the smallest targeted edit. Preserve existing headings, rules, examples, and project terminology; do not replace a document wholesale or modify unrelated documentation.',
    'If no existing document is a suitable home, create a concise `docs/progress.md`. Do not create a dedicated handover document just for this action.',
    'Do not copy the entire transcript or invent facts. Finish with the paths updated or created, the facts recorded, and any open questions.',
  ].join('\n')
}
