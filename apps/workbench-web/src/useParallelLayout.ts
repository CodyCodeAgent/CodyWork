import { onBeforeUnmount, ref } from 'vue'
import { api, type ParallelView } from './api'

export function useParallelLayout(workspaceId: string) {
  const view = ref<ParallelView>({ layout: 'columns', panels: [], revision: 0 })
  const loading = ref(true), saving = ref(false), dirty = ref(false), error = ref('')
  let disposed = false, changes = 0
  onBeforeUnmount(() => { disposed = true })
  async function load() {
    if (saving.value) return
    loading.value = true; error.value = ''
    try { const next = await api.getParallelView(workspaceId); if (!disposed) { view.value = next; dirty.value = false } }
    catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause) }
    finally { if (!disposed) loading.value = false }
  }
  function update(next: Pick<ParallelView, 'layout' | 'panels'>) {
    view.value = { ...next, revision: view.value.revision }
    changes += 1; dirty.value = true
    if (!error.value) void save()
  }
  async function save() {
    if (saving.value || loading.value || disposed) return
    saving.value = true; error.value = ''
    try {
      while (dirty.value && !disposed) {
        const version = changes
        const payload: ParallelView = { layout: view.value.layout, panels: view.value.panels.map(item => ({ ...item })), revision: view.value.revision }
        const saved = await api.saveParallelView(workspaceId, payload)
        if (disposed) return
        // A late acknowledgement may update the version, never the newer user selection.
        view.value.revision = saved.revision
        if (version === changes) dirty.value = false
      }
    } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause) }
    finally { if (!disposed) saving.value = false }
  }
  return { view, loading, saving, dirty, error, load, update, save }
}
