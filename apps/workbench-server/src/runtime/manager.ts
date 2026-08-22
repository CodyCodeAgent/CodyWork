import type { RuntimeAdapter, RuntimeManifest } from './protocol.js'

export type RuntimeRequirements = Partial<Pick<RuntimeManifest,
  'streaming' | 'resume' | 'fork' | 'interrupt' | 'approvals' | 'diffs' | 'subagents' | 'readPolicy' | 'writePolicy' | 'shellPolicy' | 'approval' | 'workspaceInitialize' | 'workspaceRepair'>>

/** Selects adapters by semantic capabilities before a conversation is created. */
export class RuntimeManager {
  private readonly adapters = new Map<string, RuntimeAdapter>()

  register(adapter: RuntimeAdapter): void {
    if (this.adapters.has(adapter.provider)) throw new Error(`runtime provider already registered: ${adapter.provider}`)
    this.adapters.set(adapter.provider, adapter)
  }

  get(provider: string): RuntimeAdapter | undefined {
    return this.adapters.get(provider)
  }

  async manifests(): Promise<RuntimeManifest[]> {
    return Promise.all([...this.adapters.values()].map(adapter => adapter.getManifest()))
  }

  async select(requirements: RuntimeRequirements = {}, provider?: string): Promise<RuntimeAdapter> {
    const candidates = provider ? [this.adapters.get(provider)].filter((adapter): adapter is RuntimeAdapter => adapter !== undefined) : [...this.adapters.values()]
    for (const adapter of candidates) {
      const manifest = await adapter.getManifest()
      if (Object.entries(requirements).every(([key, expected]) => manifest[key as keyof RuntimeManifest] === expected)) return adapter
    }
    throw new Error(provider ? `runtime provider cannot satisfy requirements: ${provider}` : 'no runtime adapter can satisfy requirements')
  }

  async close(): Promise<void> {
    await Promise.all([...this.adapters.values()].map(adapter => adapter.close()))
  }
}
