import { RuntimeRegistry, type RuntimeDescriptor } from '@codycodeagent/cody-web-core/runtime'
import type { CodyWorkRuntime, CodyWorkRuntimeCapabilities, RuntimeDescriptorView } from './protocol.js'

export type CodyWorkRuntimeRegistry = RuntimeRegistry<CodyWorkRuntime, void, CodyWorkRuntimeCapabilities>

export const RUNTIME_DEFINITIONS = Object.freeze({
  codex: {
    id: 'codex',
    label: 'Codex',
    description: '服务级共享 App Server；会话由原生 Thread 持久化。',
    capabilities: {},
  },
  trae: {
    id: 'trae',
    label: 'Trae ACP',
    description: '每个会话使用独立 ACP Session；本地回放缓存仅用于页面恢复。',
    capabilities: {
      cache: {
        kind: 'trae',
        label: '本地回放缓存',
        description: '缓存用于恢复页面过程；压缩或清理不会删除 Trae 原生 Session。',
      },
    },
  },
} satisfies Record<string, Omit<RuntimeDescriptor<CodyWorkRuntime, void, CodyWorkRuntimeCapabilities>, 'create'>>)

export function createCodyWorkRuntimeRegistry(
  defaultId: string,
  adapters: Record<string, CodyWorkRuntime>,
): CodyWorkRuntimeRegistry {
  const descriptors = Object.values(RUNTIME_DEFINITIONS)
    .filter(definition => adapters[definition.id])
    .map(definition => ({ ...definition, create: () => adapters[definition.id]! }))
  return new RuntimeRegistry({
    descriptors,
    defaultId: descriptors.some(descriptor => descriptor.id === defaultId) ? defaultId : descriptors[0]?.id ?? 'codex',
  })
}

export function runtimeDescriptorViews(runtimes: CodyWorkRuntimeRegistry): RuntimeDescriptorView[] {
  return runtimes.list().map(({ id, label, description, capabilities }) => ({ id, label, ...(description ? { description } : {}), ...(capabilities ? { capabilities } : {}) }))
}
