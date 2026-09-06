import { ReliableChannelOutbox, type ChannelOutboxItem } from '@codycodeagent/cody-web-core/channel'

type EnqueueInput = Parameters<ReliableChannelOutbox['enqueue']>[0]

/**
 * Owns one channel account's reliable delivery loop. Provider connection
 * health belongs to the provider; this worker only serializes durable Outbox
 * delivery and runs a convergence hook after each successful flush.
 */
export class ChannelDeliveryWorker {
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<void> | null = null

  constructor(
    private readonly outbox: ReliableChannelOutbox,
    private readonly options: {
      intervalMs?: number
      afterFlush: () => Promise<void>
      onBackgroundError: (error: unknown) => void
    },
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.flush().catch(this.options.onBackgroundError)
    }, this.options.intervalMs ?? 2_000)
    this.timer.unref?.()
  }

  async enqueue(input: EnqueueInput): Promise<ChannelOutboxItem> {
    const item = await this.outbox.enqueue(input)
    await this.flush()
    return item
  }

  /** Queue during the post-flush convergence hook without recursively
   * waiting on the same flush. The next cycle delivers the new item. */
  async queue(input: EnqueueInput): Promise<ChannelOutboxItem> {
    return this.outbox.enqueue(input)
  }

  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight
    const task = this.run().finally(() => {
      if (this.inFlight === task) this.inFlight = null
    })
    this.inFlight = task
    return task
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.inFlight?.catch(() => undefined)
  }

  private async run(): Promise<void> {
    await this.outbox.flush()
    await this.options.afterFlush()
  }
}
