import { onBeforeUnmount, onMounted, ref } from 'vue'
import { readPanelCollapsed, writePanelCollapsed } from './panelState'

const key = 'codywork:panel:conversation-composer'
function read(): boolean {
  try { return readPanelCollapsed(window.localStorage, 'conversation-composer') } catch { return false }
}
const compact = ref(typeof window !== 'undefined' && read())
export function useComposerLayout() {
  const sync = (event: StorageEvent) => { if (event.key === key || event.key === null) compact.value = read() }
  onMounted(() => window.addEventListener('storage', sync))
  onBeforeUnmount(() => window.removeEventListener('storage', sync))
  function setCompact(value: boolean) {
    compact.value = value
    try { writePanelCollapsed(window.localStorage, 'conversation-composer', value) } catch { /* Still works when storage is unavailable. */ }
  }
  return { compact, setCompact }
}
