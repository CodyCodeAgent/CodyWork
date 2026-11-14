import { nextTick, type ObjectDirective } from 'vue'

type CloseModal = (() => void) | undefined
interface ModalScope {
  element: HTMLElement
  opener: HTMLElement | null
  close: CloseModal
  dispose: () => void
}
const scopes: ModalScope[] = []
const entries = new WeakMap<HTMLElement, ModalScope>()
const focusableSelector = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]'

function controls(element: HTMLElement): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>(focusableSelector)].filter(control =>
    control.tabIndex >= 0 && !control.matches(':disabled') && !control.closest('[inert], [hidden]') &&
    getComputedStyle(control).visibility !== 'hidden' && control.getClientRects().length > 0,
  )
}

/** Keyboard scope for product-owned, v-if mounted modal surfaces. Native dialogs manage their own focus. */
export const vModalFocus: ObjectDirective<HTMLElement, CloseModal> = {
  mounted(element, binding) {
    const originalTabIndex = element.getAttribute('tabindex')
    const scope: ModalScope = {
      element,
      opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      close: binding.value,
      dispose: () => {},
    }
    element.tabIndex = -1
    scopes.push(scope)
    entries.set(element, scope)
    const isTop = () => scopes.at(-1) === scope
    const keydown = (event: KeyboardEvent) => {
      if (!isTop() || event.defaultPrevented) return
      if (event.key === 'Escape' && scope.close) {
        event.preventDefault()
        event.stopPropagation()
        scope.close()
      } else if (event.key === 'Tab') {
        const items = controls(element)
        const first = items[0]
        const last = items.at(-1)
        const active = document.activeElement
        if (!first || !element.contains(active) || active === element || (event.shiftKey ? active === first : active === last)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first)?.focus()
          if (!first) element.focus()
        }
      }
    }
    const focusin = (event: FocusEvent) => {
      if (isTop() && event.target instanceof Node && !element.contains(event.target)) element.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', keydown)
    document.addEventListener('focusin', focusin)
    scope.dispose = () => {
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('focusin', focusin)
      if (originalTabIndex === null) element.removeAttribute('tabindex')
      else element.setAttribute('tabindex', originalTabIndex)
    }
    // Focus the labelled container, not a destructive action or a field that opens the mobile keyboard.
    element.focus({ preventScroll: true })
  },
  updated(element, binding) {
    const scope = entries.get(element)
    if (scope) scope.close = binding.value
  },
  beforeUnmount(element) {
    const scope = entries.get(element)
    if (!scope) return
    const wasTop = scopes.at(-1) === scope
    scopes.splice(scopes.indexOf(scope), 1)
    scope.dispose()
    entries.delete(element)
    if (wasTop) void nextTick(() => {
      const parent = scopes.at(-1)?.element
      if (scope.opener?.isConnected && (!parent || parent.contains(scope.opener))) scope.opener.focus({ preventScroll: true })
      else parent?.focus({ preventScroll: true })
    })
  },
}
