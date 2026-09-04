import { NextRequest, NextResponse } from "next/server";
import { SELLER } from "@/lib/seller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type AnyObj = Record<string, unknown>;
type MonthAgg = { gmv: number; orders: number; canceled: number };

const toMoney = (cents: number) => Number((cents / 100).toFixed(2));

// Meses cerrados (siempre iguales) se cachean sin TTL; el mes en curso se
// recalcula cada 5 minutos.
const closedMonthsCache = new Map<string, MonthAgg>();
const CACHE_CURRENT_MS = 5 * 60_000;
let currentMonthCache: { key: string; ts: number; data: MonthAgg } | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function vtexFetch(path: string, attempt = 1): Promise<AnyObj> {
  const account = process.env.VTEX_ACCOUNT;
  const key = process.env.VTEX_APP_KEY;
  const token = process.env.VTEX_APP_TOKEN;
  const base = process.env.VTEX_BASE_URL || (account ? `https://${account}.myvtex.com` : "");
  if (!account || !key || !token || !base) throw new Error("Missing VTEX env vars");

  try {
    const res = await fetch(`${base}${path}`, {
      headers: { "X-VTEX-API-AppKey": key, "X-VTEX-API-AppToken": token, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await sleep(300 * attempt);
        return vtexFetch(path, attempt + 1);
      }
      const body = await res.text().catch(() => "");
      throw new Error(`VTEX ${res.status} ${body.slice(0, 120)}`);
    }
    return res.json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isNetworkError = !msg.startsWith("VTEX ") && msg !== "Missing VTEX env vars";
    if (isNetworkError && attempt < 4) {
      await sleep(300 * attempt);
      return vtexFetch(path, attempt + 1);
    }
    throw e;
  }
}

function monthRange(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const from = `${year}-${mm}-01T03:00:00.000Z`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nm = String(nextMonth).padStart(2, "0");
  const to = `${nextYear}-${nm}-01T02:59:59.999Z`;
  return { from, to };
}

function currentMonthGMT3() {
  const now = new Date();
  const shifted = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function isClosedMonth(year: number, month: number): boolean {
  const { year: cy, month: cm } = currentMonthGMT3();
  return year < cy || (year === cy && month < cm);
}

function parseOrderValue(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 100_000 ? toMoney(n) : n;
}

async function fetchMonthAgg(year: number, month: number, errors: string[]): Promise<MonthAgg> {
  const range = monthRange(year, month);
  let gmv = 0, orders = 0, canceled = 0;

  const passes: { status: string; dateField: string; dateAttr: string }[] = [
    { status: "invoiced", dateField: "f_invoicedDate", dateAttr: "invoicedDate" },
    { status: "canceled", dateField: "f_creationDate", dateAttr: "creationDate" },
  ];

  for (const pass of passes) {
    for (let page = 1; page <= 30; page++) {
      try {
        const qs = new URLSearchParams({
          per_page: "100",
          page: String(page),
          [pass.dateField]: `${pass.dateAttr}:[${range.from} TO ${range.to}]`,
          f_status: pass.status,
          f_sellerNames: SELLER.name,
        });
        const data = await vtexFetch(`/api/oms/pvt/orders?${qs.toString()}`);
        const list = (data?.list ?? data?.items ?? []) as AnyObj[];

        for (const o of list) {
          if (pass.status === "canceled") canceled += 1;
          else {
            gmv += parseOrderValue((o as any)?.value ?? (o as any)?.totalValue);
            orders += 1;
          }
        }

        if (!list.length || list.length < 100) break;
      } catch (e) {
        if (errors.length < 15) errors.push(`${year}-${month} (${pass.status} p${page}): ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
    }
  }

  return { gmv, orders, canceled };
}

async function fetchMonth(year: number, month: number, errors: string[]): Promise<MonthAgg> {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  if (isClosedMonth(year, month)) {
    const cached = closedMonthsCache.get(key);
    if (cached) return cached;
    const agg = await fetchMonthAgg(year, month, errors);
    closedMonthsCache.set(key, agg);
    return agg;
  }

  if (currentMonthCache && currentMonthCache.key === key && Date.now() - currentMonthCache.ts < CACHE_CURRENT_MS) {
    return currentMonthCache.data;
  }
  const agg = await fetchMonthAgg(year, month, errors);
  currentMonthCache = { key, ts: Date.now(), data: agg };
  return agg;
}

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const fromParam = p.get("from"); // YYYY-MM, opcional
    const { year: curYear, month: curMonth } = currentMonthGMT3();

    let startYear: number, startMonth: number;
    if (fromParam && /^\d{4}-\d{2}$/.test(fromParam)) {
      [startYear, startMonth] = fromParam.split("-").map(Number);
    } else {
      startYear = Number(process.env.VTEX_HISTORY_FROM_YEAR || curYear - 2);
      startMonth = Number(process.env.VTEX_HISTORY_FROM_MONTH || 1);
    }

    const months: { year: number; month: number }[] = [];
    let y = startYear, m = startMonth;
    while (y < curYear || (y === curYear && m <= curMonth)) {
      months.push({ year: y, month: m });
      m++;
      if (m > 12) { m = 1; y++; }
    }

    const fetchErrors: string[] = [];
    const monthlyTotals: { key: string; label: string; gmv: number; orders: number; canceled: number }[] = [];

    for (const { year, month } of months) {
      const agg = await fetchMonth(year, month, fetchErrors);
      const key = `${year}-${String(month).padStart(2, "0")}`;
      const label = new Date(year, month - 1).toLocaleString("es-AR", { month: "long", year: "numeric" });
      monthlyTotals.push({ key, label, gmv: Math.round(agg.gmv), orders: agg.orders, canceled: agg.canceled });
    }

    const totalGmv = monthlyTotals.reduce((a, m) => a + m.gmv, 0);
    const totalOrders = monthlyTotals.reduce((a, m) => a + m.orders, 0);
    const totalCanceled = monthlyTotals.reduce((a, m) => a + m.canceled, 0);
    const avgMonthlyGmv = monthlyTotals.length ? Math.round(totalGmv / monthlyTotals.length) : 0;
    const cancelRate = (totalOrders + totalCanceled) > 0 ? totalCanceled / (totalOrders + totalCanceled) : 0;

    const last3 = monthlyTotals.slice(-4, -1); // últimos 3 meses completos, excluye el actual
    const avg3MonthGmv = last3.length ? Math.round(last3.reduce((a, m) => a + m.gmv, 0) / last3.length) : 0;
    const curMonthEntry = monthlyTotals[monthlyTotals.length - 1];
    const trendPct = avg3MonthGmv > 0 && curMonthEntry ? (curMonthEntry.gmv - avg3MonthGmv) / avg3MonthGmv : 0;

    return NextResponse.json({
      seller: SELLER.name,
      monthlyTotals,
      summary: {
        totalGmv,
        totalOrders,
        totalCanceled,
        avgMonthlyGmv,
        avg3MonthGmv,
        cancelRate: Math.round(cancelRate * 10000) / 10000,
        trend: trendPct > 0.05 ? "up" : trendPct < -0.05 ? "down" : "stable",
        trendPct: Math.round(trendPct * 10000) / 10000,
      },
      updatedAt: new Date().toISOString(),
      fetchErrors,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "historico_fetch_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
