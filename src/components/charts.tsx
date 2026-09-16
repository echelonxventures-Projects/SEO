"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMoney } from "@/lib/format";

const AXIS = { fontSize: 11, fill: "rgb(161 161 170)" };
const GRID = "rgb(228 228 231)";

function moneyTick(v: number, symbol: string) {
  if (Math.abs(v) >= 100000) return `${symbol}${(v / 100000).toFixed(0)}L`;
  if (Math.abs(v) >= 1000) return `${symbol}${(v / 1000).toFixed(0)}k`;
  return `${symbol}${v}`;
}

export function RevenueArea({
  data,
  symbol,
}: {
  data: Array<{ month: string; amount: number }>;
  symbol: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => moneyTick(v, symbol)} width={54} />
        <Tooltip
          formatter={((v: unknown) => [fmtMoney(Number(v) * 100, symbol), "Collected"] as [string, string])}
          contentStyle={{ borderRadius: 12, border: "1px solid rgb(228 228 231)", fontSize: 12 }}
        />
        <Area type="monotone" dataKey="amount" stroke="rgb(99 102 241)" strokeWidth={2} fill="url(#rev)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CampaignBars({
  data,
  symbol,
}: {
  data: Array<{ month: string; cost: number; revenue: number }>;
  symbol: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => moneyTick(v, symbol)} width={54} />
        <Tooltip
          formatter={((v: unknown, n: unknown) => [fmtMoney(Number(v) * 100, symbol), n === "cost" ? "Spend" : "Revenue"] as [string, string])}
          contentStyle={{ borderRadius: 12, border: "1px solid rgb(228 228 231)", fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="cost" fill="rgb(244 114 182)" radius={[4, 4, 0, 0]} maxBarSize={26} />
        <Bar dataKey="revenue" fill="rgb(16 185 129)" radius={[4, 4, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RankLine({ data }: { data: Array<{ date: string; position: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(d) => d.slice(5)} />
        <YAxis reversed tick={AXIS} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          formatter={((v: unknown) => [`#${v}`, "Position"] as [string, string])}
          labelFormatter={(d) => `${d}`}
          contentStyle={{ borderRadius: 12, border: "1px solid rgb(228 228 231)", fontSize: 12 }}
        />
        <Line type="monotone" dataKey="position" stroke="rgb(59 130 246)" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TimeBars({ data }: { data: Array<{ name: string; minutes: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 40, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={90} />
        <Tooltip formatter={((v: unknown) => [`${v} min`, "Billable"] as [string, string])} contentStyle={{ borderRadius: 12, border: "1px solid rgb(228 228 231)", fontSize: 12 }} />
        <Bar dataKey="minutes" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((_, i) => (
            <Cell key={i} fill={i % 2 ? "rgb(139 92 246)" : "rgb(99 102 241)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
