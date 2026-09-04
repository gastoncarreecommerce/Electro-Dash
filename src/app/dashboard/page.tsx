"use client";

import { useMemo, useState, useCallback } from "react";
import useSWR from "swr";
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ComposedChart, Line, Bar,
} from "recharts";

/* ─────────────────── Constants ─────────────────── */

const fetcher = (u: string) => fetch(u).then((r) => r.json());

const CHART_COLORS = {
  primary: "#2563eb",
  secondary: "#0891b2",
};

const PIE_PALETTE = ["#2563eb", "#0891b2", "#7c3aed", "#d97706", "#16a34a", "#dc2626", "#db2777", "#ea580c"];

type Mode = "today_live" | "yesterday_closed" | "last7d" | "last30d" | "historico" | "custom";

const MODE_CONFIG: Record<Mode, { label: string; icon: string }> = {
  today_live: { label: "Hoy en vivo", icon: "⚡" },
  yesterday_closed: { label: "Ayer cerrado", icon: "📅" },
  last7d: { label: "7 días", icon: "📊" },
  last30d: { label: "30 días", icon: "📈" },
  historico: { label: "Histórico", icon: "🗂️" },
  custom: { label: "Personalizado", icon: "🔧" },
};

/* ─────────────────── Formatters ─────────────────── */

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

function saludoSegunHora() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Buenos días";
  if (h >= 12 && h < 20) return "Buenas tardes";
  return "Buenas noches";
}

function timeAgo(isoString: string) {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `hace ${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins}m`;
  return `hace ${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/* ─────────────────── Main Component ─────────────────── */

export default function DashboardPage() {
  const [mode, setMode] = useState<Mode>("today_live");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "products" | "marketing">("overview");

  const handleApplyCustom = useCallback(() => {
    if (customFrom && customTo) {
      setAppliedFrom(customFrom);
      setAppliedTo(customTo);
    }
  }, [customFrom, customTo]);

  const endpoint = useMemo(() => {
    if (mode === "custom" && appliedFrom && appliedTo) {
      return `/api/dashboard/overview?mode=custom&from=${encodeURIComponent(appliedFrom)}&to=${encodeURIComponent(appliedTo)}`;
    }
    if (mode === "custom") return null;
    return `/api/dashboard/overview?mode=${mode}`;
  }, [mode, appliedFrom, appliedTo]);

  const { data, isLoading } = useSWR(endpoint, endpoint ? fetcher : null, {
    refreshInterval: mode === "today_live" ? 15000 : 60000,
    revalidateOnFocus: true,
  });

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }, []);

  const waitingCustom = mode === "custom" && !appliedFrom;

  /* ─── Loading / Waiting State ─── */
  if (waitingCustom || isLoading || !data) {
    return (
      <Shell mode={mode} onModeChange={setMode} onLogout={handleLogout} updatedAt={null}>
        {mode === "custom" && (
          <DateRangeBar customFrom={customFrom} customTo={customTo} onFromChange={setCustomFrom} onToChange={setCustomTo} onApply={handleApplyCustom} appliedFrom={appliedFrom} appliedTo={appliedTo} />
        )}
        {waitingCustom ? (
          <div className="py-20 text-center">
            <p className="text-lg font-semibold text-slate-400">Seleccioná un rango de fechas y presioná &quot;Aplicar&quot;</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="skeleton h-80 rounded-2xl" />
              <div className="skeleton h-80 rounded-2xl" />
            </div>
          </div>
        )}
      </Shell>
    );
  }

  /* ─── Derived data ─── */
  const kpis = data.kpis;
  const conversionRate = kpis.createdOrders > 0 ? kpis.invoicedOrders / kpis.createdOrders : 0;
  const cancelRate = kpis.createdOrders > 0 ? (data.funnel?.find((f: any) => f.status === "Cancelados")?.orders ?? 0) / kpis.createdOrders : 0;
  const GRID = "#e2e8f0";
  const TICK = { fontSize: 11, fill: "#64748b" };

  return (
    <Shell mode={mode} onModeChange={setMode} onLogout={handleLogout} updatedAt={data.updatedAt}>
      {/* Custom date range */}
      {mode === "custom" && (
        <DateRangeBar customFrom={customFrom} customTo={customTo} onFromChange={setCustomFrom} onToChange={setCustomTo} onApply={handleApplyCustom} appliedFrom={appliedFrom} appliedTo={appliedTo} />
      )}

      {/* ─── KPI Cards ─── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="GMV Total" value={moneyCompact(kpis.gmvTotal)} subtitle={money(kpis.gmvTotal)} icon={<DollarIcon />} color="blue" className="animate-fade-in" tooltip="SKU Price + Envío" />
        <KpiCard title={mode === "yesterday_closed" ? "Pedidos Creados" : "Pedidos Totales"} value={num(kpis.ordersTotal)} icon={<CartIcon />} color="cyan" className="animate-fade-in-delay-1" />
        <KpiCard title="Ticket Promedio" value={moneyCompact(kpis.aov)} subtitle={money(kpis.aov)} icon={<TicketIcon />} color="violet" className="animate-fade-in-delay-2" />
        <KpiCard title="Tasa Facturación" value={pct(conversionRate)} subtitle={`${num(kpis.invoicedOrders)} facturados`} icon={<CheckIcon />} color="emerald" className="animate-fade-in-delay-3" />
      </div>

      {/* ─── Tab Navigation ─── */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {([
          { key: "overview", label: "Vista General", icon: "📊" },
          { key: "products", label: "Productos", icon: "📦" },
          { key: "marketing", label: "Marketing", icon: "📣" },
        ] as { key: typeof activeTab; label: string; icon: string }[]).map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex-1 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${activeTab === tab.key ? "bg-blue-50 text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"}`}>
            <span className="mr-1.5">{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>

      {/* ─── Tab: Overview ─── */}
      {activeTab === "overview" && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartPanel title="Evolución GMV" subtitle="SKU Price + Envío por día">
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={data.gmvEvolution}>
                  <defs>
                    <linearGradient id="gmvGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.15} />
                      <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="bucket" tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} tickFormatter={(v) => moneyCompact(v)} />
                  <Tooltip content={<CustomTooltip formatter={money} />} />
                  <Area type="monotone" dataKey="gmv" stroke={CHART_COLORS.primary} strokeWidth={2.5} fill="url(#gmvGrad)" name="GMV" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel title="Volumen de Pedidos" subtitle="Creados vs facturados por día">
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={data.ordersEvolution}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="bucket" tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="created" name="Creados" fill={CHART_COLORS.secondary} radius={[4, 4, 0, 0]} opacity={0.6} />
                  <Line type="monotone" dataKey="invoiced" name="Facturados" stroke={CHART_COLORS.primary} strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartPanel>
          </div>

          {/* Funnel + Attribution */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <ChartPanel title="Embudo de Estados" subtitle="Flujo de órdenes desde creación">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {data.funnel.map((f: any, i: number) => {
                    const colors = [
                      { bg: "bg-blue-50", text: "text-blue-700", bar: "bg-blue-500", border: "border-blue-200" },
                      { bg: "bg-emerald-50", text: "text-emerald-700", bar: "bg-emerald-500", border: "border-emerald-200" },
                      { bg: "bg-red-50", text: "text-red-700", bar: "bg-red-500", border: "border-red-200" },
                      { bg: "bg-slate-50", text: "text-slate-600", bar: "bg-slate-400", border: "border-slate-200" },
                    ];
                    const c = colors[i] || colors[3];
                    const maxGmv = Math.max(...data.funnel.map((x: any) => x.gmv), 1);
                    const barWidth = (f.gmv / maxGmv) * 100;
                    return (
                      <div key={f.status} className={`rounded-xl ${c.bg} border ${c.border} p-4 transition-all hover:scale-[1.02]`}>
                        <p className={`text-xs font-semibold uppercase tracking-wider ${c.text}`}>{f.status}</p>
                        <p className="mt-2 text-2xl font-bold text-slate-900">{num(f.orders)}</p>
                        <p className="text-xs text-slate-500">{money(f.gmv)}</p>
                        <div className="mt-3 h-1.5 w-full rounded-full bg-slate-200">
                          <div className={`h-full rounded-full ${c.bar} animate-progress`} style={{ width: `${barWidth}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ChartPanel>
            </div>

            <ChartPanel title="Atribución" subtitle="Orgánico vs Pauta">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={data.attribution} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={55} outerRadius={85} strokeWidth={0} paddingAngle={4}>
                    {data.attribution.map((_: unknown, i: number) => <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 flex justify-center gap-6">
                {data.attribution.map((a: any, i: number) => (
                  <div key={a.label} className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full" style={{ background: PIE_PALETTE[i] }} />
                    <span className="text-xs text-slate-600">{a.label === "PAID" ? "Pauta" : "Orgánico"}: <b className="text-slate-900">{num(a.value)}</b></span>
                  </div>
                ))}
              </div>
            </ChartPanel>
          </div>

          {/* Payment Methods */}
          <ChartPanel title="Medios de Pago" subtitle="Ranking por monto total">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {data.paymentRanking.map((p: any, i: number) => {
                const maxPay = Math.max(...data.paymentRanking.map((x: any) => x.amount), 1);
                const pctWidth = (p.amount / maxPay) * 100;
                return (
                  <div key={p.paymentSystemName} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 hover:border-slate-200 transition-all">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-100 text-xs font-bold text-violet-700">{i + 1}</span>
                        <span className="text-sm font-medium text-slate-700">{p.paymentSystemName}</span>
                      </div>
                      <span className="text-sm font-semibold text-slate-900">{money(p.amount)}</span>
                    </div>
                    <div className="mt-2 h-1 w-full rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400 animate-progress" style={{ width: `${pctWidth}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">Cuotas más elegidas: {p.topInstallments}</p>
                  </div>
                );
              })}
            </div>
          </ChartPanel>

          {/* Hourly Heatmap */}
          {(data.hourlyHeatmap?.length ?? 0) > 0 && (
            <ChartPanel title="Mapa de Calor · Pedidos por Hora" subtitle="Intensidad de pedidos por franja horaria (GMT-3) · Hover para ver cantidad exacta">
              <HourlyHeatmap rows={data.hourlyHeatmap} />
            </ChartPanel>
          )}
        </div>
      )}

      {/* ─── Tab: Products ─── */}
      {activeTab === "products" && (
        <div className="space-y-6 animate-fade-in">
          <ChartPanel title="Top 10 Productos Más Populares" subtitle="Productos más vendidos por unidades">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(data.topProducts ?? []).slice(0, 10).map((p: any, idx: number) => {
                const medalColors = ["from-amber-400 to-yellow-500", "from-slate-300 to-slate-400", "from-orange-400 to-amber-500"];
                return (
                  <article key={`${p.refId}-${idx}`} className="group rounded-xl border border-slate-200 bg-white p-4 transition-all hover:shadow-md hover:border-slate-300">
                    <div className="flex items-start gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${idx < 3 ? medalColors[idx] : "from-slate-200 to-slate-300"} text-sm font-black ${idx < 3 ? "text-white" : "text-slate-600"}`}>{idx + 1}</div>
                      <img src={p.imageUrl || "https://placehold.co/64x64/f1f5f9/94a3b8?text=SKU"} alt={p.name} className="h-16 w-16 rounded-lg object-cover bg-slate-100 ring-1 ring-slate-200" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">{p.name}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">REF: {p.refId}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                      <div>
                        <p className="text-[11px] text-slate-400">Unidades</p>
                        <p className="text-sm font-bold text-slate-900">{num(p.units)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-slate-400">Revenue</p>
                        <p className="text-sm font-bold text-emerald-600">{money(p.skuPrice)}</p>
                      </div>
                    </div>
                    {p.link ? (
                      <a href={p.link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition">
                        Ver en tienda <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      </a>
                    ) : (
                      <span className="mt-2 inline-block text-[11px] text-slate-400">Sin link público</span>
                    )}
                  </article>
                );
              })}
            </div>
          </ChartPanel>
        </div>
      )}

      {/* ─── Tab: Marketing ─── */}
      {activeTab === "marketing" && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartPanel title="Atribución de Tráfico" subtitle="Distribución orgánico vs pauta">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={data.attribution} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={60} outerRadius={90} strokeWidth={0} paddingAngle={5}>
                    {data.attribution.map((_: unknown, i: number) => <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-6">
                {data.attribution.map((a: any, i: number) => {
                  const total = data.attribution.reduce((acc: number, x: any) => acc + x.value, 0);
                  const share = total > 0 ? a.value / total : 0;
                  return (
                    <div key={a.label} className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_PALETTE[i] }} />
                        <span className="text-sm font-medium text-slate-600">{a.label === "PAID" ? "Pauta" : "Orgánico"}</span>
                      </div>
                      <p className="mt-1 text-lg font-bold text-slate-900">{num(a.value)}</p>
                      <p className="text-[11px] text-slate-400">{pct(share)}</p>
                    </div>
                  );
                })}
              </div>
            </ChartPanel>

            <div className="lg:col-span-2">
              <ChartPanel title="Desglose UTM" subtitle="Detalle de fuentes de tráfico y campañas">
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-slate-100 text-left">
                        <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Source</th>
                        <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Medium</th>
                        <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Campaign</th>
                        <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Pedidos</th>
                        <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">GMV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.utmBreakdown ?? []).map((u: any, i: number) => (
                        <tr key={i} className="border-b border-slate-50 table-row-hover">
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${u.source === "(none)" ? "bg-slate-100 text-slate-500" : "bg-blue-50 text-blue-700"}`}>{u.source}</span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">{u.medium}</td>
                          <td className="px-3 py-2.5 text-slate-600 max-w-[200px] truncate">{u.campaign}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-slate-900">{num(u.orders)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-emerald-600">{money(u.gmv)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartPanel>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 pt-4 pb-8 text-center">
        <p className="text-xs text-slate-400">Hogar&amp;Electro · Datos en tiempo real de VTEX OMS · GMV = SKU Price + Envío</p>
      </footer>
    </Shell>
  );
}

/* ═══════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════ */

function Shell({ mode, onModeChange, onLogout, updatedAt, children }: {
  mode: Mode; onModeChange: (m: Mode) => void; onLogout: () => void; updatedAt: string | null; children: React.ReactNode;
}) {
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
              <h1 className="text-base font-bold text-slate-900 tracking-tight">Hogar&amp;Electro Dashboard</h1>
              <p className="text-[11px] text-slate-400">VTEX OMS · Seller único</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {mode === "today_live" && (
              <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 border border-emerald-200">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-live-pulse" />
                <span className="text-xs font-semibold text-emerald-700">EN VIVO</span>
              </div>
            )}
            {updatedAt && <div className="hidden md:block text-right text-[11px] text-slate-400">{timeAgo(updatedAt)}</div>}
            <a href="/historico" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-600 hover:bg-violet-50 transition-all shadow-sm">Histórico</a>
            <button onClick={onLogout} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-all shadow-sm">Salir</button>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6 space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between animate-fade-in">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">
              {saludoSegunHora()}, <span className="gradient-text">equipo</span>
            </h2>
            <p className="mt-1 text-sm text-slate-500">Performance de Hogar&amp;Electro · {MODE_CONFIG[mode].label}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(Object.entries(MODE_CONFIG) as [Mode, { label: string; icon: string }][]).map(([key, cfg]) => (
              <button key={key} onClick={() => onModeChange(key)}
                className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all ${mode === key ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200 shadow-sm" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"}`}>
                <span className="text-xs">{cfg.icon}</span>{cfg.label}
              </button>
            ))}
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

function DateRangeBar({ customFrom, customTo, onFromChange, onToChange, onApply, appliedFrom, appliedTo }: {
  customFrom: string; customTo: string; onFromChange: (v: string) => void; onToChange: (v: string) => void; onApply: () => void; appliedFrom: string; appliedTo: string;
}) {
  return (
    <div className="animate-fade-in flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <span className="text-sm font-medium text-slate-600">Desde</span>
      <input type="date" value={customFrom} onChange={(e) => onFromChange(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition shadow-sm" />
      <span className="text-sm font-medium text-slate-600">hasta</span>
      <input type="date" value={customTo} onChange={(e) => onToChange(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition shadow-sm" />
      <button onClick={onApply} disabled={!customFrom || !customTo}
        className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-blue-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
        Aplicar
      </button>
      {appliedFrom && appliedTo && (
        <span className="ml-2 text-xs text-slate-400">Mostrando: {appliedFrom} a {appliedTo}</span>
      )}
      {!appliedFrom && customFrom && customTo && (
        <span className="text-xs text-amber-600 font-medium">Presioná &quot;Aplicar&quot; para consultar</span>
      )}
    </div>
  );
}

function KpiCard({ title, value, subtitle, icon, color, className = "", tooltip }: {
  title: string; value: string; subtitle?: string; icon: React.ReactNode;
  color: "blue" | "cyan" | "violet" | "amber" | "emerald" | "rose"; className?: string; tooltip?: string;
}) {
  const colorMap = {
    blue: { bg: "bg-blue-50", text: "text-blue-600", ring: "ring-blue-200" },
    cyan: { bg: "bg-cyan-50", text: "text-cyan-600", ring: "ring-cyan-200" },
    violet: { bg: "bg-violet-50", text: "text-violet-600", ring: "ring-violet-200" },
    amber: { bg: "bg-amber-50", text: "text-amber-600", ring: "ring-amber-200" },
    emerald: { bg: "bg-emerald-50", text: "text-emerald-600", ring: "ring-emerald-200" },
    rose: { bg: "bg-rose-50", text: "text-rose-600", ring: "ring-rose-200" },
  };
  const c = colorMap[color];
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 transition-all hover:shadow-md hover:border-slate-300 ${className}`} title={tooltip}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{title}</p>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${c.bg} ring-1 ${c.ring}`}>
          <div className={c.text}>{icon}</div>
        </div>
      </div>
      <p className="mt-3 text-2xl font-bold text-slate-900">{value}</p>
      {subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>}
    </div>
  );
}

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function HourlyHeatmap({ rows }: { rows: { date: string; hours: number[] }[] }) {
  const display = rows.slice(-14);
  if (!display.length) return <p className="py-6 text-center text-sm text-slate-400">Sin datos para el período seleccionado.</p>;

  const maxVal = Math.max(...display.flatMap((r) => r.hours), 1);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

  function rowLabel(date: string) {
    if (date === today) return "Hoy";
    if (date === yesterday) return "Ayer";
    const d = new Date(date + "T12:00:00Z");
    return `${DAY_NAMES[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function cellColor(val: number): string {
    if (val === 0) return "rgba(241,245,249,1)";
    const intensity = 0.12 + (val / maxVal) * 0.88;
    return `rgba(37,99,235,${intensity.toFixed(2)})`;
  }

  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="mb-1 flex">
          <div className="w-20 shrink-0" />
          {HOURS.map((h) => (
            <div key={h} className="flex-1 text-center text-[10px] font-medium text-slate-400">
              {h % 3 === 0 ? `${h}h` : ""}
            </div>
          ))}
        </div>

        <div className="space-y-1">
          {display.map((row) => (
            <div key={row.date} className="flex items-center gap-0">
              <div className="w-20 shrink-0 pr-2 text-right text-[11px] font-medium text-slate-500">
                {rowLabel(row.date)}
              </div>
              {row.hours.map((val, h) => (
                <div
                  key={h}
                  className="flex-1 mx-[1px] h-7 rounded-sm cursor-default transition-opacity hover:opacity-75"
                  style={{ backgroundColor: cellColor(val) }}
                  title={val > 0 ? `${rowLabel(row.date)} · ${h}:00 — ${val} pedido${val !== 1 ? "s" : ""}` : undefined}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="text-[10px] text-slate-400">0</span>
          {[0.12, 0.35, 0.58, 0.80, 1].map((op) => (
            <div key={op} className="h-3 w-5 rounded-sm" style={{ backgroundColor: `rgba(37,99,235,${op})` }} />
          ))}
          <span className="text-[10px] text-slate-400">{maxVal} pedidos</span>
        </div>
      </div>
    </div>
  );
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function CustomTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
      <p className="mb-1.5 text-xs font-semibold text-slate-500">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-xs text-slate-500">{entry.name}:</span>
          <span className="text-xs font-semibold text-slate-900">{formatter ? formatter(entry.value) : num(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Icons ─── */
function DollarIcon() { return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>; }
function CartIcon() { return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" /></svg>; }
function TicketIcon() { return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>; }
function CheckIcon() { return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>; }
