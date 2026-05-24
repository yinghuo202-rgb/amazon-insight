"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { TrendPoint } from "@/lib/contracts";

export default function TrendAreaChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(23,52,45,.08)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={12} />
        <YAxis tickLine={false} axisLine={false} width={56} />
        <Tooltip
          contentStyle={{
            borderRadius: 18,
            border: "1px solid rgba(23,52,45,.08)",
            backgroundColor: "rgba(255,253,249,.96)",
            boxShadow: "0 20px 40px rgba(25,42,35,.08)",
          }}
        />
        <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2.2} fill="url(#trendFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
