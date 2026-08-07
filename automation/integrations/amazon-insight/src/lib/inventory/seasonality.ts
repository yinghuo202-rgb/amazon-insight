export type MonthlySalesPoint = { month: string; units: number };

export type SeasonalityBand = "peak" | "steady" | "low" | "insufficient";

export type SeasonalityProfile = {
  evidenceMonths: number;
  currentMonth: number;
  currentFactor: number | null;
  nextQuarterFactor: number | null;
  band: SeasonalityBand;
  peakMonths: number[];
  calendarMonths: Array<{ month: number; averageUnits: number; factor: number | null }>;
};

export function latestMonthlyUnits(history: MonthlySalesPoint[], latestMonth?: string | null) {
  if (!history.length) return 0;
  if (latestMonth) return history.find((point) => point.month === latestMonth)?.units ?? 0;
  return history.at(-1)?.units ?? 0;
}

export function trailingAverage(history: MonthlySalesPoint[], months: number) {
  if (!history.length || months <= 0) return 0;
  const sample = history.slice(-months);
  return sample.reduce((sum, point) => sum + point.units, 0) / sample.length;
}

export function salesTrendPercent(history: MonthlySalesPoint[], windowMonths = 3) {
  if (history.length < windowMonths * 2) return null;
  const recent = trailingAverage(history, windowMonths);
  const previous = trailingAverage(history.slice(0, -windowMonths), windowMonths);
  return previous > 0 ? (recent - previous) / previous * 100 : null;
}

export function buildSeasonalityProfile(history: MonthlySalesPoint[], currentMonth: number): SeasonalityProfile {
  const normalizedMonth = Math.min(12, Math.max(1, Math.round(currentMonth)));
  const buckets = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }));
  for (const point of history) {
    const month = Number(point.month.slice(5, 7));
    if (month >= 1 && month <= 12) {
      buckets[month - 1].total += Math.max(0, point.units);
      buckets[month - 1].count += 1;
    }
  }
  const overallAverage = history.length
    ? history.reduce((sum, point) => sum + Math.max(0, point.units), 0) / history.length
    : 0;
  const calendarMonths = buckets.map((bucket, index) => {
    const averageUnits = bucket.count ? bucket.total / bucket.count : 0;
    return {
      month: index + 1,
      averageUnits: Number(averageUnits.toFixed(1)),
      factor: overallAverage > 0 && bucket.count ? Number((averageUnits / overallAverage).toFixed(2)) : null,
    };
  });
  const currentFactor = calendarMonths[normalizedMonth - 1].factor;
  const nextFactors = [1, 2, 3]
    .map((offset) => calendarMonths[(normalizedMonth - 1 + offset) % 12].factor)
    .filter((factor): factor is number => factor !== null);
  const nextQuarterFactor = nextFactors.length
    ? Number((nextFactors.reduce((sum, factor) => sum + factor, 0) / nextFactors.length).toFixed(2))
    : null;
  const peakMonths = calendarMonths
    .filter((point) => point.factor !== null)
    .sort((a, b) => (b.factor ?? 0) - (a.factor ?? 0))
    .slice(0, 3)
    .map((point) => point.month);
  let band: SeasonalityBand = "insufficient";
  if (history.length >= 12 && currentFactor !== null) {
    band = currentFactor >= 1.2 ? "peak" : currentFactor <= 0.8 ? "low" : "steady";
  }
  return {
    evidenceMonths: history.length,
    currentMonth: normalizedMonth,
    currentFactor,
    nextQuarterFactor,
    band,
    peakMonths,
    calendarMonths,
  };
}

export function aggregateCalendarSeasonality(histories: MonthlySalesPoint[][]) {
  const byPeriod = new Map<string, number>();
  for (const history of histories) {
    for (const point of history) byPeriod.set(point.month, (byPeriod.get(point.month) ?? 0) + point.units);
  }
  return [...byPeriod.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, units]) => ({ month, units }));
}
