import { compress, group, MARKETPLACES, merge, type BubbleEventType, type GroupedBubbleEvent, type SalesBubbleEvent } from "./engine";

export const Phase = Object.freeze({
  IDLE: "IDLE",
  UP: "AMOUNT_INCREASING",
  DOWN: "AMOUNT_DECREASING",
} as const);

export type PresentationPhase = (typeof Phase)[keyof typeof Phase];

export const TIMING = Object.freeze({
  merge: 3000,
  event: 2000,
  review: 4000,
  amount: 600,
  color: 1000,
  return: 300,
  rest: 250,
});

export type PresentationClock = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout> | null) => void;
};

const nativeClock: PresentationClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => {
    if (id !== null) clearTimeout(id);
  },
};

export type PresentationSnapshot = {
  phase: PresentationPhase;
  total: number;
  displayTotal: number;
  previousTotal: number;
  active: GroupedBubbleEvent | null;
  content: "total" | "event";
  queue: number;
  pending: number;
  revision: number;
  transitionId: number;
};

export class Presentation {
  total: number;
  displayTotal: number;
  previousTotal: number;
  onChange: (snapshot: PresentationSnapshot) => void;
  onDisplay: (event: GroupedBubbleEvent) => void;
  clock: PresentationClock;
  timing: typeof TIMING;
  phase: PresentationPhase = Phase.IDLE;
  queue: GroupedBubbleEvent[] = [];
  pending: SalesBubbleEvent[] = [];
  recent: Array<{ type: BubbleEventType; marketplace: string; id: string; at: number }> = [];
  active: GroupedBubbleEvent | null = null;
  content: "total" | "event" = "total";
  revision = 0;
  transitionId = 0;
  timer: ReturnType<typeof setTimeout> | null = null;
  colorTimer: ReturnType<typeof setTimeout> | null = null;
  mergeTimer: ReturnType<typeof setTimeout> | null = null;
  disposed = false;

  constructor({
    total = 0,
    onChange = () => {},
    onDisplay = () => {},
    clock = nativeClock,
    timing = {},
  }: {
    total?: number;
    onChange?: (snapshot: PresentationSnapshot) => void;
    onDisplay?: (event: GroupedBubbleEvent) => void;
    clock?: PresentationClock;
    timing?: Partial<typeof TIMING>;
  } = {}) {
    this.total = total;
    this.displayTotal = total;
    this.previousTotal = total;
    this.onChange = onChange;
    this.onDisplay = onDisplay;
    this.clock = clock;
    this.timing = { ...TIMING, ...timing };
  }

  snapshot(): PresentationSnapshot {
    return {
      phase: this.phase,
      total: this.total,
      displayTotal: this.displayTotal,
      previousTotal: this.previousTotal,
      active: this.active,
      content: this.content,
      queue: this.queue.length,
      pending: this.pending.length,
      revision: this.revision,
      transitionId: this.transitionId,
    };
  }

  emit() {
    if (!this.disposed) {
      this.revision += 1;
      this.onChange(this.snapshot());
    }
  }

  ingest(events: SalesBubbleEvent[], total: number) {
    if (this.disposed) return;
    const correction = total - this.total - events.reduce((sum, event) => sum + (event.salesDelta || 0), 0);
    this.total = total;
    this.displayTotal += correction;
    this.previousTotal += correction;
    this.pending.push(...events);
    const now = this.clock.now();
    this.recent = this.recent.filter((event) => now - event.at < 10_000);
    this.recent.push(
      ...events.map((event) => ({
        type: event.type,
        marketplace: event.marketplace,
        id: event.transactionId || event.orderId || event.id,
        at: now,
      })),
    );
    if (this.pending.length && !this.mergeTimer) {
      this.mergeTimer = this.clock.setTimeout(() => this.flush(), this.timing.merge);
    }
    this.emit();
  }

  flush() {
    this.mergeTimer = null;
    const now = this.clock.now();
    this.recent = this.recent.filter((event) => now - event.at <= 10_000);
    const high: Partial<Record<BubbleEventType, boolean>> = {};
    for (const type of ["ORDER", "REFUND"] as const) {
      high[type] =
        new Set(this.recent.filter((event) => event.type === type).map((event) => event.marketplace + event.id)).size >= 5;
    }
    let waiting = [...this.queue, ...merge(this.pending, high)];
    this.pending = [];
    for (const type of ["ORDER", "REFUND"] as const) {
      if (high[type]) {
        for (const market of Object.keys(MARKETPLACES)) {
          const same = waiting.filter((event) => event.type === type && event.marketplace === market);
          if (same.length > 1) {
            waiting = [
              ...waiting.filter((event) => !(event.type === type && event.marketplace === market)),
              group(same, "batch"),
            ];
          }
        }
      }
    }
    this.queue = compress(waiting);
    if (!this.active && !this.timer) this.next();
    else this.emit();
  }

  next() {
    this.timer = null;
    this.active = this.queue.shift() || null;
    if (!this.active) {
      this.content = "total";
      this.phase = Phase.IDLE;
      if (!this.pending.length) this.displayTotal = this.total;
      this.emit();
      return;
    }
    this.content = "event";
    this.onDisplay(this.active);
    this.phase = Phase.IDLE;
    this.emit();
    const dwell = this.active.type === "REVIEW" ? this.timing.review : this.timing.event;
    this.timer = this.clock.setTimeout(() => this.beginTotal(), dwell);
  }

  beginTotal() {
    this.timer = null;
    if (!this.active) return;
    this.content = "total";
    const delta = this.active.salesDelta || 0;
    if (delta) {
      this.previousTotal = this.displayTotal;
      this.displayTotal += delta;
      this.phase = delta > 0 ? Phase.UP : Phase.DOWN;
      this.transitionId += 1;
      const duration = this.timing.amount + this.timing.color + this.timing.return;
      this.colorTimer = this.clock.setTimeout(() => {
        this.phase = Phase.IDLE;
        this.emit();
      }, duration);
      this.emit();
      this.timer = this.clock.setTimeout(() => this.finish(), duration);
    } else {
      this.phase = Phase.IDLE;
      this.emit();
      this.timer = this.clock.setTimeout(() => this.finish(), this.timing.return);
    }
  }

  finish() {
    this.timer = null;
    this.active = null;
    this.content = "total";
    this.phase = Phase.IDLE;
    if (!this.pending.length && !this.queue.length) {
      this.displayTotal = this.total;
    }
    this.emit();
    this.timer = this.clock.setTimeout(() => this.next(), this.timing.rest);
  }

  reset(total: number) {
    this.clock.clearTimeout(this.timer);
    this.clock.clearTimeout(this.colorTimer);
    this.clock.clearTimeout(this.mergeTimer);
    this.timer = null;
    this.mergeTimer = null;
    this.colorTimer = null;
    this.pending = [];
    this.queue = [];
    this.recent = [];
    this.active = null;
    this.content = "total";
    this.total = total;
    this.displayTotal = total;
    this.previousTotal = total;
    this.phase = Phase.IDLE;
    this.emit();
  }

  dispose() {
    this.clock.clearTimeout(this.timer);
    this.clock.clearTimeout(this.colorTimer);
    this.clock.clearTimeout(this.mergeTimer);
    this.disposed = true;
  }
}
