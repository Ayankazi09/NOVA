// Automatic reading after a pause. At most one recognition in flight and one latest pending region.
// idle -> dirty -> waiting_for_pause -> recognizing -> (reading stored by caller) | failed

export type ReadPhase = 'dirty' | 'waiting_for_pause' | 'recognizing' | 'failed'

export interface SchedulerOptions {
  pauseMs?: number
  cooldownMs?: number
  sessionCap?: number
  run: (regionId: string, auto: boolean) => Promise<void>
  onPhase: (regionId: string, phase: ReadPhase | null, error?: string) => void
  onCapReached?: () => void
  now?: () => number
}

export class RecognitionScheduler {
  assist = false
  autoCount = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private timerRegion: string | null = null
  private inflight: { regionId: string; promise: Promise<void> } | null = null
  private pending: string | null = null
  private lastAutoAt = -Infinity
  private readonly o: Required<Omit<SchedulerOptions, 'onCapReached'>> & Pick<SchedulerOptions, 'onCapReached'>

  constructor(opts: SchedulerOptions) {
    this.o = { pauseMs: 2000, cooldownMs: 3000, sessionCap: 60, now: () => Date.now(), ...opts }
  }

  /** A stroke was committed into (or removed from) a region. */
  contentChanged(regionId: string) {
    this.o.onPhase(regionId, 'dirty')
    if (!this.assist) return
    this.clearTimer()
    this.timerRegion = regionId
    this.o.onPhase(regionId, 'waiting_for_pause')
    this.timer = setTimeout(() => this.fireAuto(regionId), this.o.pauseMs)
  }

  /** New pen contact cancels the pause timer; the region remains dirty. */
  penDown() {
    if (this.timer && this.timerRegion) this.o.onPhase(this.timerRegion, 'dirty')
    this.clearTimer()
  }

  /** Re-arm after pen up if a region is still waiting (e.g. a tap that produced no stroke). */
  penUp(lastRegionId: string | null) {
    if (this.assist && lastRegionId && !this.timer && !this.inflight) this.contentChanged(lastRegionId)
  }

  /** Explicit Read now / Ask flush: bypasses pause, cooldown and the automatic cap. */
  async readNow(regionId: string): Promise<void> {
    if (this.timerRegion === regionId) this.clearTimer()
    if (this.pending === regionId) this.pending = null
    while (this.inflight) {
      if (this.inflight.regionId === regionId) return this.inflight.promise
      await this.inflight.promise.catch(() => undefined)
    }
    return this.start(regionId, false)
  }

  isBusy() {
    return this.inflight !== null
  }

  dispose() {
    this.clearTimer()
    this.pending = null
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.timerRegion = null
  }

  private fireAuto(regionId: string) {
    this.timer = null
    this.timerRegion = null
    if (!this.assist) return
    if (this.autoCount >= this.o.sessionCap) {
      this.o.onPhase(regionId, 'dirty')
      this.o.onCapReached?.()
      return
    }
    if (this.inflight) {
      this.pending = regionId // keep only the latest
      return
    }
    const wait = this.lastAutoAt + this.o.cooldownMs - this.o.now()
    if (wait > 0) {
      this.timerRegion = regionId
      this.timer = setTimeout(() => this.fireAuto(regionId), wait)
      return
    }
    this.lastAutoAt = this.o.now()
    this.autoCount++
    void this.start(regionId, true).catch(() => undefined)
  }

  private start(regionId: string, auto: boolean): Promise<void> {
    this.o.onPhase(regionId, 'recognizing')
    const promise = this.o
      .run(regionId, auto)
      .then(() => this.o.onPhase(regionId, null))
      .catch((e: unknown) => {
        this.o.onPhase(regionId, 'failed', (e as Error)?.message ?? 'Reading failed')
        throw e
      })
      .finally(() => {
        this.inflight = null
        const next = this.pending
        this.pending = null
        if (next && this.assist && !this.timer) this.fireAuto(next)
      })
    this.inflight = { regionId, promise }
    return promise
  }
}
