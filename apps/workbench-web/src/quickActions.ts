import type { ComposerOptions, QuickAction, QuickActionScene } from './api'

export function quickActionsForScene(actions: QuickAction[], scene: QuickActionScene): QuickAction[] {
  return actions
    .filter(action => action.enabled && action.scenes.includes(scene))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
}

export function resolveQuickActionSkills(
  action: QuickAction,
  runtimeSkills: ComposerOptions['skills'],
): { ids: string[]; missing: string[] } {
  const byId = new Map(runtimeSkills.map(skill => [skill.id, skill]))
  const ids: string[] = []
  const missing: string[] = []
  for (const configured of action.skills) {
    const runtime = byId.get(configured.id)
    if (!runtime || configured.status !== 'available') missing.push(configured.name)
    else ids.push(runtime.id)
  }
  return { ids: [...new Set(ids)], missing: [...new Set(missing)] }
}
