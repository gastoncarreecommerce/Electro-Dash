import { NextRequest, NextResponse } from "next/server";
import { SELLER } from "@/lib/seller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const norm = (v: string) =>
  (v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const SELLER_NAME_NORM = norm(SELLER.name);

type AnyObj = Record<string, any>;
const toMoney = (cents: number) => Number((cents / 100).toFixed(2));

const memoryCache = new Map<string, { ts: number; data: any }>();
const CACHE_MS = 45_000;
const STOREFRONT_BASE = process.env.VTEX_STOREFRONT_URL || "https://www.carrefour.com.ar";

/** Primer día con datos a considerar en modo "historico" (todo el histórico del seller). */
const HISTORY_FROM = process.env.VTEX_HISTORY_FROM || "2023-01-01";

function pickSellerId(order: AnyObj): string | undefined {
  return order?.sellers?.[0]?.id || order?.sellerId || order?.items?.find((i: AnyObj) => i?.seller)?.seller;
}

function pickSellerName(order: AnyObj): string | undefined {
  return order?.sellers?.[0]?.name || order?.sellerName;
}

function isOurSeller(order: AnyObj) {
  const sid = String(pickSellerId(order) || "").trim();
  if (SELLER.id && sid && sid === SELLER.id) return true;

  const sname = norm(String(pickSellerName(order) || ""));
  if (sname && sname === SELLER_NAME_NORM) return true;

  return false;
}

function gmvFromOrder(order: AnyObj) {
  // GMV = SKU PRICE + Shipping
  const itemsSkuPrice = (order?.items ?? []).reduce((acc: number, i: AnyObj) => {
    const qty = Number(i?.quantity ?? 1);
    const unit = Number(i?.price ?? i?.sellingPrice ?? 0);
    return acc + qty * unit;
  }, 0);

  const shipping = Number((order?.totals ?? []).find((t: AnyObj) => t?.id === "Shipping")?.value ?? 0);

  const totalsItems = Number((order?.totals ?? []).find((t: AnyObj) => t?.id === "Items")?.value ?? 0);
  const itemsBase = itemsSkuPrice > 0 ? itemsSkuPrice : totalsItems;

  return toMoney(itemsBase + shipping);
}

function grossFromOrder(order: AnyObj) {
  const direct = Number(order?.value ?? order?.totalsValue ?? 0);
  if (Number.isFinite(direct) && direct > 0) return toMoney(direct);
  return gmvFromOrder(order);
}

function gmt3DateParts(base = new Date()) {
  const shifted = new Date(base.getTime() - 3 * 60 * 60 * 1000); // UTC-3 clock
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
  };
}

function toGmt3Day(isoStr: string | undefined): string {
  const shifted = new Date((isoStr ? new Date(isoStr) : new Date()).getTime() - 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function toGmt3Hour(isoStr: string | undefined): number {
  const shifted = new Date((isoStr ? new Date(isoStr) : new Date()).getTime() - 3 * 60 * 60 * 1000);
  return shifted.getUTCHours();
}

function dateRangeYesterdayClosedGMT3() {
  const { y, m, d } = gmt3DateParts();
  const yesterday = new Date(Date.UTC(y, m, d - 1));
  const yy = yesterday.getUTCFullYear();
  const mm = String(yesterday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(yesterday.getUTCDate()).padStart(2, "0");
  const from = `${yy}-${mm}-${dd}T03:00:00.000Z`;

  const next = new Date(Date.UTC(yy, yesterday.getUTCMonth(), yesterday.getUTCDate() + 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(next.getUTCDate()).padStart(2, "0");
  const to = `${ny}-${nm}-${nd}T02:59:59.999Z`;
  return { from, to };
}

function dateRangeTodayLiveGMT3() {
  const { y, m, d } = gmt3DateParts();
  const mm = String(m + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const from = `${y}-${mm}-${dd}T03:00:00.000Z`;
  return { from, to: new Date().toISOString() };
}

function dateRangeLast7Days() {
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return { from, to: now.toISOString() };
}

function dateRangeLast30Days() {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return { from, to: now.toISOString() };
}

function dateRangeHistorico() {
  return { from: `${HISTORY_FROM}T03:00:00.000Z`, to: new Date().toISOString() };
}

function dateRangeCustom(from?: string | null, to?: string | null) {
  if (!from || !to) return null;
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!m1 || !m2) return null;

  const fromIso = `${m1[1]}-${m1[2]}-${m1[3]}T03:00:00.000Z`;

  const y = Number(m2[1]);
  const mo = Number(m2[2]) - 1;
  const d = Number(m2[3]);
  const next = new Date(Date.UTC(y, mo, d + 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(next.getUTCDate()).padStart(2, "0");
  const toIso = `${ny}-${nm}-${nd}T02:59:59.999Z`;

  return { from: fromIso, to: toIso };
}

async function vtexFetch(path: string) {
  const account = process.env.VTEX_ACCOUNT;
  const key = process.env.VTEX_APP_KEY;
  const token = process.env.VTEX_APP_TOKEN;
  const base = process.env.VTEX_BASE_URL || (account ? `https://${account}.myvtex.com` : "");
  if (!account || !key || !token || !base) throw new Error("Missing VTEX env vars");

  const res = await fetch(`${base}${path}`, {
    headers: {
      "X-VTEX-API-AppKey": key,
      "X-VTEX-API-AppToken": token,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`VTEX ${res.status} ${body.slice(0, 120)}`);
  }
  return res.json();
}

async function fetchOrderIds(fromISO: string, toISO: string, maxPages: number) {
  const range = `creationDate:[${fromISO} TO ${toISO}]`;
  const ids = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({
      per_page: "100",
      page: String(page),
      f_creationDate: range,
      f_sellerNames: SELLER.name,
    });
    const data = await vtexFetch(`/api/oms/pvt/orders?${qs.toString()}`);
    const list = data?.list ?? data?.items ?? [];
    for (const o of list) if (o?.orderId) ids.add(o.orderId);
    if (!list.length || list.length < 100) break;
  }
  return Array.from(ids);
}

async function fetchOrderDetails(orderIds: string[], max: number) {
  const ids = orderIds.slice(0, max);
  const out: AnyObj[] = [];
  const chunkSize = 12;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const details = await Promise.allSettled(chunk.map((id) => vtexFetch(`/api/oms/pvt/orders/${id}`)));
    for (const d of details) if (d.status === "fulfilled") out.push(d.value);
  }
  return out;
}

function isPaid(utmMedium?: string, utmSource?: string) {
  const m = (utmMedium || "").toLowerCase();
  const s = (utmSource || "").toLowerCase();
  return /cpc|ppc|paid|ads|display|affiliate|social_paid/.test(m) || (/(google|meta|facebook|instagram|tiktok|bing)/.test(s) && !!m);
}

function classifyStatus(rawStatus: string) {
  const st = (rawStatus || "").toLowerCase();
  if (st.includes("cancel")) return "cancelados";
  if (st.includes("invoice") || st.includes("factur")) return "facturados";
  if (
    st.includes("creat") || st.includes("new") || st.includes("payment") || st.includes("approve") ||
    st.includes("ready") || st.includes("handling") || st.includes("seller") || st.includes("wait") ||
    st.includes("pack") || st.includes("pick") || st.includes("start") || st.includes("window")
  ) return "creados";
  return "otros";
}

function empty(error?: string) {
  return {
    kpis: { gmvTotal: 0, ordersTotal: 0, aov: 0 },
    gmvEvolution: [],
    ordersEvolution: [],
    topProducts: [],
    attribution: [{ label: "PAID", value: 0 }, { label: "ORGANIC", value: 0 }],
    utmBreakdown: [],
    funnel: [
      { status: "Creados", orders: 0, gmv: 0 },
      { status: "Facturados", orders: 0, gmv: 0 },
      { status: "Cancelados", orders: 0, gmv: 0 },
      { status: "Otros", orders: 0, gmv: 0 },
    ],
    paymentRanking: [],
    updatedAt: new Date().toISOString(),
    source: "vtex-live",
    seller: SELLER.name,
    ...(error ? { error } : {}),
  };
}

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const mode = (p.get("mode") || "today_live") as
      | "today_live" | "yesterday_closed" | "last7d" | "last30d" | "historico" | "custom";
    const strict = (p.get("strict") || "0") === "1";
    const fromParam = p.get("from");
    const toParam = p.get("to");

    const cacheKey = `${mode}|${strict}|${fromParam}|${toParam}`;
    const cached = memoryCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return NextResponse.json({ ...cached.data, cache: { hit: true, ageMs: Date.now() - cached.ts } });
    }

    const range =
      mode === "yesterday_closed" ? dateRangeYesterdayClosedGMT3() :
      mode === "last7d" ? dateRangeLast7Days() :
      mode === "last30d" ? dateRangeLast30Days() :
      mode === "historico" ? dateRangeHistorico() :
      mode === "custom" ? (dateRangeCustom(fromParam, toParam) || dateRangeLast7Days()) :
      dateRangeTodayLiveGMT3();

    // Un solo seller: se pueden pedir muchas más páginas sin saturar VTEX.
    const maxPages = mode === "historico" ? 200 : strict ? 40 : mode === "today_live" ? 5 : 20;
    const maxDetails = mode === "historico" ? 20000 : strict ? 4000 : mode === "today_live" ? 400 : 2000;

    const ids = await fetchOrderIds(range.from, range.to, maxPages);
    const raw = await fetchOrderDetails(ids, maxDetails);
    const orders = raw.filter((o) => isOurSeller(o));

    const byDay = new Map<string, { gmv: number; orders: number }>();
    const byDayOrders = new Map<string, { created: number; invoiced: number; gross: number }>();
    const byDayHour = new Map<string, number[]>();
    const byMonth = new Map<string, { gmv: number; orders: number; canceled: number }>();
    const byProduct = new Map<string, { name: string; refId: string; units: number; skuPrice: number; imageUrl?: string; link?: string }>();
    const byPayment = new Map<string, { amount: number; installments: Map<number, number> }>();
    const utmMap = new Map<string, { source: string; medium: string; campaign: string; orders: number; gmv: number }>();

    let gmvTotal = 0, grossTotal = 0;
    let paid = 0, organic = 0;
    let createdOrders = 0, createdGmv = 0, createdGross = 0;
    let invoicedOrders = 0, invoicedGmv = 0;
    let canceledOrders = 0, canceledGmv = 0;
    let otherOrders = 0, otherGmv = 0;
    const statusBreakdown = new Map<string, number>();

    for (const o of orders) {
      const gmv = gmvFromOrder(o);
      const gross = grossFromOrder(o);
      const rawStatus = String(o?.status ?? "unknown");
      statusBreakdown.set(rawStatus, (statusBreakdown.get(rawStatus) ?? 0) + 1);
      const bucket = classifyStatus(rawStatus);

      gmvTotal += gmv;
      grossTotal += gross;

      const cday = toGmt3Day(o?.creationDate);
      const d = byDay.get(cday) ?? { gmv: 0, orders: 0 };
      d.gmv += gmv;
      d.orders += 1;
      byDay.set(cday, d);

      const hour = toGmt3Hour(o?.creationDate);
      if (!byDayHour.has(cday)) byDayHour.set(cday, new Array(24).fill(0));
      byDayHour.get(cday)![hour] += 1;

      const cd = byDayOrders.get(cday) ?? { created: 0, invoiced: 0, gross: 0 };
      cd.created += 1;
      cd.gross += gross;
      byDayOrders.set(cday, cd);

      const monthKey = cday.slice(0, 7);
      const md = byMonth.get(monthKey) ?? { gmv: 0, orders: 0, canceled: 0 };
      createdOrders += 1;
      createdGmv += gmv;
      createdGross += gross;

      if (bucket === "facturados") {
        invoicedOrders += 1;
        invoicedGmv += gmv;
        md.gmv += gmv;
        md.orders += 1;
        const iday = toGmt3Day(o?.invoicedDate || o?.creationDate);
        const id = byDayOrders.get(iday) ?? { created: 0, invoiced: 0, gross: 0 };
        id.invoiced += 1;
        byDayOrders.set(iday, id);
      } else if (bucket === "cancelados") {
        canceledOrders += 1;
        canceledGmv += gmv;
        md.canceled += 1;
      } else if (bucket !== "creados") {
        otherOrders += 1;
        otherGmv += gmv;
      }
      byMonth.set(monthKey, md);

      for (const it of o?.items ?? []) {
        const key = String(it?.refId || it?.id || it?.name || "unknown");
        const qty = Number(it?.quantity ?? 1);
        const unit = toMoney(Number(it?.sellingPrice ?? it?.price ?? 0));
        const pr = byProduct.get(key) ?? {
          name: it?.name ?? "Sin nombre",
          refId: it?.refId ?? String(it?.id ?? "-"),
          units: 0,
          skuPrice: 0,
          imageUrl: it?.imageUrl,
          link: it?.detailUrl ? `${STOREFRONT_BASE}${it.detailUrl}` : undefined,
        };
        pr.units += qty;
        pr.skuPrice += unit * qty;
        pr.imageUrl = pr.imageUrl || it?.imageUrl;
        if (!pr.link && it?.detailUrl) pr.link = `${STOREFRONT_BASE}${it.detailUrl}`;
        byProduct.set(key, pr);
      }

      const txs = o?.paymentData?.transactions ?? [];
      for (const tx of txs) {
        for (const pay of tx?.payments ?? []) {
          const name = pay?.paymentSystemName || "Otro";
          const value = toMoney(Number(pay?.value ?? 0));
          const inst = Number(pay?.installments ?? 1);
          const curr = byPayment.get(name) ?? { amount: 0, installments: new Map<number, number>() };
          curr.amount += value;
          curr.installments.set(inst, (curr.installments.get(inst) ?? 0) + 1);
          byPayment.set(name, curr);
        }
      }

      const source = o?.marketingData?.utmSource || "(none)";
      const medium = o?.marketingData?.utmMedium || "(none)";
      const campaign = o?.marketingData?.utmCampaign || "(none)";
      const key = `${source}|${medium}|${campaign}`;
      const u = utmMap.get(key) ?? { source, medium, campaign, orders: 0, gmv: 0 };
      u.orders += 1;
      u.gmv += gmv;
      utmMap.set(key, u);

      if (isPaid(medium, source)) paid += 1;
      else organic += 1;
    }

    const evolution = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([bucket, v]) => ({ bucket, gmv: Math.round(v.gmv), orders: v.orders }));

    const monthlyEvolution = Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({ month, gmv: Math.round(v.gmv), orders: v.orders, canceled: v.canceled }));

    const topProducts = Array.from(byProduct.values())
      .sort((a, b) => b.units - a.units)
      .slice(0, 10)
      .map((x) => ({ ...x, skuPrice: Math.round(x.skuPrice) }));

    const paymentRanking = Array.from(byPayment.entries())
      .map(([paymentSystemName, v]) => {
        let topInstallments = 1;
        let best = 0;
        for (const [k, cnt] of v.installments.entries()) {
          if (cnt > best) { best = cnt; topInstallments = k; }
        }
        return { paymentSystemName, amount: Math.round(v.amount), topInstallments };
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 12);

    const utmBreakdown = Array.from(utmMap.values())
      .sort((a, b) => b.gmv - a.gmv)
      .slice(0, 25)
      .map((u) => ({ ...u, gmv: Math.round(u.gmv) }));

    const ordersTotal = orders.length;
    const effectiveOrders = mode === "yesterday_closed" ? createdOrders : ordersTotal;
    const effectiveGmv = mode === "yesterday_closed" ? createdGmv : gmvTotal;

    const response = {
      kpis: {
        gmvTotal: Math.round(effectiveGmv),
        grossTotal: Math.round(grossTotal),
        ordersTotal: effectiveOrders,
        createdOrders,
        invoicedOrders,
        aov: effectiveOrders ? Math.round(effectiveGmv / effectiveOrders) : 0,
      },
      hourlyHeatmap: Array.from(byDayHour.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, hours]) => ({ date, hours })),
      gmvEvolution: evolution.map((e) => ({ bucket: e.bucket, gmv: e.gmv })),
      ordersEvolution: Array.from(byDayOrders.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([bucket, v]) => ({ bucket, created: v.created, invoiced: v.invoiced, gross: Math.round(v.gross) })),
      monthlyEvolution,
      topProducts,
      attribution: [{ label: "PAID", value: paid }, { label: "ORGANIC", value: organic }],
      utmBreakdown,
      funnel: [
        { status: "Creados", orders: createdOrders, gmv: Math.round(createdGmv), gross: Math.round(createdGross) },
        { status: "Facturados", orders: invoicedOrders, gmv: Math.round(invoicedGmv) },
        { status: "Cancelados", orders: canceledOrders, gmv: Math.round(canceledGmv) },
        { status: "Otros", orders: otherOrders, gmv: Math.round(otherGmv) },
      ],
      paymentRanking,
      updatedAt: new Date().toISOString(),
      source: "vtex-live",
      seller: SELLER.name,
      debug: {
        mode,
        from: range.from,
        to: range.to,
        strict,
        orderIds: ids.length,
        ordersFetched: raw.length,
        ordersMatched: orders.length,
        statusBreakdown: Array.from(statusBreakdown.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12),
      },
    };

    memoryCache.set(cacheKey, { ts: Date.now(), data: response });
    return NextResponse.json({ ...response, cache: { hit: false, ttlMs: CACHE_MS } });
  } catch (e: any) {
    return NextResponse.json(empty(e?.message || "live_fetch_failed"));
  }
}
