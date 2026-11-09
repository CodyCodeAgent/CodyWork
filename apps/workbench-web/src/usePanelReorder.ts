import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** Moves panel identities only. Session instances remain keyed by demand id. */
export function usePanelReorder(board: Ref<HTMLElement | null>, ids: () => string[], move: (source: string, target: string) => void) {
  const dragging = ref(''), over = ref(''), pointer = ref({ x: 0, y: 0 })
  let pending: { id: string; pointerId: number; handle: HTMLElement; x: number; y: number } | null = null
  let frame: number | null = null

  function targetAtPointer() {
    const root = board.value
    const panel = document.elementsFromPoint(pointer.value.x, pointer.value.y)
      .map(element => element.closest<HTMLElement>('[data-demand-id]'))
      .find(element => element && root?.contains(element))
    const id = panel?.dataset.demandId ?? ''
    over.value = ids().includes(id) ? id : ''
  }
  function tick() {
    if (!dragging.value) return
    const root = board.value
    if (root) {
      const rect = root.getBoundingClientRect(), { x, y } = pointer.value
      if (x >= rect.left && x <= rect.right) {
        const delta = y < rect.top + 40 ? -16 : y > rect.bottom - 40 ? 16 : 0
        if (delta) root.scrollTop += delta
      }
      targetAtPointer()
    }
    frame = requestAnimationFrame(tick)
  }
  function cancel() {
    const previous = pending
    pending = null; dragging.value = ''; over.value = ''
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    if (previous?.handle.hasPointerCapture?.(previous.pointerId)) previous.handle.releasePointerCapture(previous.pointerId)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('blur', cancel)
  }
  function begin(id: string, event: PointerEvent) {
    if (pending || event.button !== 0 || event.isPrimary === false || ids().length < 2 || !ids().includes(id) || !(event.currentTarget instanceof HTMLElement)) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.focus({ preventScroll: true })
    pending = { id, handle, pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    pointer.value = { x: event.clientX, y: event.clientY }
    handle.setPointerCapture?.(event.pointerId)
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', cancel)
  }
  function onMove(event: PointerEvent) {
    if (!pending || event.pointerId !== pending.pointerId) return
    pointer.value = { x: event.clientX, y: event.clientY }
    if (!dragging.value && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 6) return
    event.preventDefault()
    if (!dragging.value) { dragging.value = pending.id; frame = requestAnimationFrame(tick) }
    targetAtPointer()
  }
  function onUp(event: PointerEvent) {
    if (!pending || event.pointerId !== pending.pointerId) return
    if (dragging.value) { pointer.value = { x: event.clientX, y: event.clientY }; targetAtPointer() }
    const source = dragging.value, target = over.value
    cancel()
    if (source && target && source !== target) move(source, target)
  }
  function onCancel(event: PointerEvent) { if (event.pointerId === pending?.pointerId) cancel() }
  function onKey(event: KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); cancel() } }
  watch(() => ids().join('\0'), cancel)
  onBeforeUnmount(cancel)
  return { dragging, over, pointer, begin, cancel }
}
