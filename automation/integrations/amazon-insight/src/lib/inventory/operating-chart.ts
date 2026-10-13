export type OperatingChartPoint = { month: string; revenue: number | null; profit: number | null; complete: boolean; mtd: boolean; asOf: string | null };

/** A missing calendar month is a gap, never an adjacent observation or zero. */
export function fillOperatingChartMonths(input: OperatingChartPoint[], throughMonth?: string): OperatingChartPoint[] {
  const points = input.filter(point => /^\d{4}-(0[1-9]|1[0-2])$/.test(point.month)).sort((a, b) => a.month.localeCompare(b.month));
  if (!points.length) return [];
  const end = throughMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(throughMonth) ? throughMonth : points.at(-1)!.month;
  const byMonth = new Map(points.map(point => [point.month, point]));
  const cursor = new Date(`${end}-01T00:00:00Z`);
  const output: OperatingChartPoint[] = [];
  while (output.length < 6 && cursor.toISOString().slice(0, 7) >= points[0].month) {
    const month = cursor.toISOString().slice(0, 7);
    output.unshift(byMonth.get(month) ?? { month, revenue: null, profit: null, complete: false, mtd: false, asOf: null });
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return output;
}
