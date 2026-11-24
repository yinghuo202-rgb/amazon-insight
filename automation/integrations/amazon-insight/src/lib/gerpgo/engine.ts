export type MarketplaceSpec = {
  id: string;
  name: string;
  currency: string;
  zone: string;
  region: "na" | "eu" | "fe";
};

export const MARKETPLACES: Record<string, MarketplaceSpec> = {
  CA: { id: "A2EUQ1WTGCTBG2", name: "Canada", currency: "CAD", zone: "America/Los_Angeles", region: "na" },
  MX: { id: "A1AM78C64UM0Y8", name: "Mexico", currency: "MXN", zone: "America/Mexico_City", region: "na" },
  US: { id: "ATVPDKIKX0DER", name: "United States", currency: "USD", zone: "America/Los_Angeles", region: "na" },
  UK: { id: "A1F83G8C2ARO7P", name: "United Kingdom", currency: "GBP", zone: "Europe/London", region: "eu" },
  DE: { id: "A1PA6795UKMFR9", name: "Germany", currency: "EUR", zone: "Europe/Berlin", region: "eu" },
  FR: { id: "A13V1IB3VIYZZH", name: "France", currency: "EUR", zone: "Europe/Paris", region: "eu" },
  AU: { id: "A39IBJ37TRP1C6", name: "Australia", currency: "AUD", zone: "Australia/Sydney", region: "fe" },
  JP: { id: "A1VC38T7YXB528", name: "Japan", currency: "JPY", zone: "Asia/Tokyo", region: "fe" },
};

export type BubbleEventType = "ORDER" | "REFUND" | "REVIEW";
export type BubbleGroupStyle = "single" | "summary" | "batch" | "more";

export type SalesBubbleEvent = {
  id: string;
  type: BubbleEventType;
  storeId?: string;
  orderId?: string;
  refundId?: string;
  transactionId?: string;
  itemId?: string;
  marketplace: string;
  msku: string;
  asin?: string;
  quantity: number;
  amount: number;
  currency?: string;
  baseAmount?: number;
  salesDelta?: number;
  rating?: number;
  content?: string;
  status?: string;
  timestamp: string;
  silent?: boolean;
};

export type GroupedBubbleEvent = SalesBubbleEvent & {
  ids: string[];
  entityIds: string[];
  count: number;
  negativeCount: number;
  mskus: string[];
  maxRating: number;
  style: BubbleGroupStyle;
};

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

export function day(timestamp: string | number | Date, zone: string) {
  let formatter = dateFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(zone, formatter);
  }
  return formatter.format(new Date(timestamp));
}

export function priority(event: Pick<SalesBubbleEvent, "type" | "rating">) {
  return event.type === "REFUND"
    ? 0
    : event.type === "REVIEW"
      ? (event.rating ?? 5) <= 2
        ? 1
        : (event.rating ?? 5) === 3
          ? 2
          : 4
      : 3;
}

export function group(events: Array<SalesBubbleEvent | GroupedBubbleEvent>, style: BubbleGroupStyle): GroupedBubbleEvent {
  const first = events[0];
  const entityIds = [
    ...new Set(
      events.flatMap((event) =>
        "entityIds" in event && Array.isArray(event.entityIds)
          ? event.entityIds
          : [event.transactionId || event.orderId || event.id],
      ),
    ),
  ];
  return {
    ...first,
    ids: events.flatMap((event) => ("ids" in event && Array.isArray(event.ids) ? event.ids : [event.id])),
    entityIds,
    count: entityIds.length,
    quantity: events.reduce((sum, event) => sum + (event.quantity || 0), 0),
    amount: events.reduce((sum, event) => sum + (event.amount || 0), 0),
    baseAmount: events.reduce((sum, event) => sum + (event.baseAmount || 0), 0),
    salesDelta: events.reduce((sum, event) => sum + (event.salesDelta || 0), 0),
    negativeCount: events.reduce(
      (sum, event) =>
        sum +
        ("negativeCount" in event && typeof event.negativeCount === "number"
          ? event.negativeCount
          : event.type === "REVIEW" && (event.rating ?? 5) <= 2
            ? 1
            : 0),
      0,
    ),
    mskus: [...new Set(events.flatMap((event) => ("mskus" in event && Array.isArray(event.mskus) ? event.mskus : [event.msku])))],
    rating: Math.min(...events.map((event) => event.rating || 5)),
    maxRating: Math.max(...events.map((event) => ("maxRating" in event ? event.maxRating : event.rating) || 5)),
    style,
  };
}

export function merge(events: SalesBubbleEvent[], high: Partial<Record<BubbleEventType, boolean>> = {}): GroupedBubbleEvent[] {
  const out: GroupedBubbleEvent[] = [];
  for (const type of ["ORDER", "REFUND", "REVIEW"] as const) {
    const keys = [
      ...new Set(
        events
          .filter((event) => event.type === type)
          .map((event) => `${event.marketplace}|${event.currency || MARKETPLACES[event.marketplace]?.currency}`),
      ),
    ];
    for (const key of keys) {
      const list = events.filter(
        (event) =>
          event.type === type &&
          `${event.marketplace}|${event.currency || MARKETPLACES[event.marketplace]?.currency}` === key,
      );
      if (!list.length) continue;
      if (type === "REVIEW") {
        list.sort((left, right) => priority(left) - priority(right) || left.timestamp.localeCompare(right.timestamp));
        if (list.length < 3) {
          out.push(...list.map((event) => group([event], "single")));
        } else if ((list[0].rating ?? 5) <= 2) {
          out.push(group([list[0]], "single"), group(list.slice(1), "summary"));
        } else {
          out.push(group(list, "summary"));
        }
      } else if (high[type]) {
        out.push(group(list, "batch"));
      } else if (new Set(list.map((event) => event.msku)).size > 1 && list.length >= 3) {
        out.push(group(list, type === "REFUND" ? "batch" : "summary"));
      } else {
        const bySku = new Map<string, SalesBubbleEvent[]>();
        for (const event of list) {
          const existing = bySku.get(event.msku);
          if (existing) existing.push(event);
          else bySku.set(event.msku, [event]);
        }
        out.push(...[...bySku.values()].map((items) => group(items, "single")));
      }
    }
  }
  return out.sort((left, right) => priority(left) - priority(right) || left.timestamp.localeCompare(right.timestamp));
}

export function compress(queue: GroupedBubbleEvent[]): GroupedBubbleEvent[] {
  let result = [...queue];
  while (result.length > 5) {
    const counts: Record<string, number> = {};
    const bucket = (event: GroupedBubbleEvent) =>
      `${event.type}|${event.marketplace}|${event.currency || MARKETPLACES[event.marketplace]?.currency}`;
    for (const event of result) {
      const key = bucket(event);
      counts[key] = (counts[key] || 0) + 1;
    }
    const topType = Object.keys(counts).sort((left, right) => counts[right] - counts[left])[0];
    if (!topType || counts[topType] < 2) break;
    const indices = result
      .map((event, index) => (bucket(event) === topType ? index : -1))
      .filter((index) => index >= 0)
      .slice(-2);
    const combined = group(
      indices.map((index) => result[index]),
      "more",
    );
    result = result.filter((_, index) => !indices.includes(index));
    result.push(combined);
  }
  return result.sort((left, right) => priority(left) - priority(right) || left.timestamp.localeCompare(right.timestamp));
}

export function validate(event: SalesBubbleEvent): SalesBubbleEvent {
  if (
    !event ||
    !["ORDER", "REFUND", "REVIEW"].includes(event.type) ||
    typeof event.id !== "string" ||
    !event.id ||
    !MARKETPLACES[event.marketplace] ||
    !Number.isFinite(Date.parse(event.timestamp)) ||
    typeof event.msku !== "string" ||
    !event.msku
  ) {
    throw new Error("Invalid event");
  }
  if (event.currency && event.currency !== MARKETPLACES[event.marketplace].currency) {
    throw new Error("Currency does not match marketplace");
  }
  if (event.type === "REVIEW") {
    if (!Number.isInteger(event.rating) || (event.rating ?? 0) < 1 || (event.rating ?? 0) > 5 || typeof event.content !== "string") {
      throw new Error("Invalid review");
    }
  } else if (!Number.isSafeInteger(event.amount) || event.amount < 0 || !Number.isInteger(event.quantity) || event.quantity < 1) {
    throw new Error("Invalid money or quantity");
  }
  return event;
}
