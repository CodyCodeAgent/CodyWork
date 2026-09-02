export type WorkbenchPanel = 'workspace-sidebar' | 'conversation-sidebar'

const storageKey = (panel: WorkbenchPanel): string => `codywork:panel:${panel}`

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function readPanelCollapsed(storage: StorageLike | null | undefined, panel: WorkbenchPanel): boolean {
  return storage?.getItem(storageKey(panel)) === 'collapsed'
}

export function writePanelCollapsed(storage: StorageLike | null | undefined, panel: WorkbenchPanel, collapsed: boolean): void {
  storage?.setItem(storageKey(panel), collapsed ? 'collapsed' : 'expanded')
}
