"use client";

import { useState } from "react";
import useSWR from "swr";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

const money = (v: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v || 0);
const moneyCompact = (v: number) => {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return money(v);
};
const num = (v: number) => new Intl.NumberFormat("es-AR").format(v || 0);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function HistoricoPage() {
  const [from, setFrom] = useState("");
  const endpoint = from ? `/api/dashboard/historico?from=${from}` : "/api/dashboard/historico";
  const { data, isLoading } = useSWR(endpoint, fetcher, { refreshInterval: 5 * 60_000 });

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <main className="min-h-screen bg-[#f8fafc]">
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-xl shadow-sm">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 shadow-md shadow-blue-500/20">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h7v7H3V3zm11 0h7v7h-7V3zm0 11h7v7h-7v-7zM3 14h7v7H3v-7z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 tracking-tight">Hogar&amp;Electro</h1>
              <p className="text-[11px] text-slate-400">Histórico mensual</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all shadow-sm">Dashboard</a>
            <button onClick={handleLogout} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-all shadow-sm">Salir</button>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6 space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Performance histórica</h2>
            <p className="mt-1 text-sm text-slate-500">GMV, pedidos y cancelaciones por mes, consultado en vivo contra la API de VTEX.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-500">Desde</label>
            <input type="month" value={from} onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition shadow-sm" />
          </div>
        </div>

        {isLoading || !data ? (
          <div className="skeleton h-96 rounded-2xl" />
        ) : data.error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{data.error}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard title="GMV Total (histórico)" value={moneyCompact(data.summary.totalGmv)} subtitle={money(data.summary.totalGmv)} />
              <StatCard title="Pedidos Facturados" value={num(data.summary.totalOrders)} />
              <StatCard title="GMV Promedio Mensual" value={moneyCompact(data.summary.avgMonthlyGmv)} />
              <StatCard title="Tasa de Cancelación" value={pct(data.summary.cancelRate)} subtitle={`${num(data.summary.totalCanceled)} cancelados`} />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 text-base font-semibold text-slate-900">Evolución mensual de GMV</h3>
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={data.monthlyTotals}>
                  <defs>
                    <linearGradient id="gmvGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="key" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(v) => moneyCompact(v)} />
                  <Tooltip formatter={(v: any) => money(Number(v))} />
                  <Area type="monotone" dataKey="gmv" stroke="#2563eb" strokeWidth={2.5} fill="url(#gmvGrad)" name="GMV" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left">
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Mes</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">GMV</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Pedidos</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Cancelados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.monthlyTotals.map((m: any) => (
                      <tr key={m.key} className="border-b border-slate-50 table-row-hover">
                        <td className="px-4 py-3 font-medium text-slate-900 capitalize">{m.label}</td>
                        <td className="px-4 py-3 font-semibold text-emerald-600">{money(m.gmv)}</td>
                        <td className="px-4 py-3 text-slate-700">{num(m.orders)}</td>
                        <td className="px-4 py-3 text-slate-500">{num(m.canceled)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {data.fetchErrors?.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-700">
                {data.fetchErrors.length} error(es) consultando VTEX. Los datos mostrados pueden estar incompletos.
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function StatCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{title}</p>
      <p className="mt-3 text-2xl font-bold text-slate-900">{value}</p>
      {subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>}
    </div>
  );
}
