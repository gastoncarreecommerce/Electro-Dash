import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Endpoint de diagnóstico: en vez de confiar en el catálogo de
 * seller-register (que para esta cuenta devuelve siempre la misma página,
 * sin importar `_page` — o sea, capado a ~100 sellers y sin llegar a
 * Hogar&Electro), este endpoint mira ÓRDENES REALES recientes y extrae los
 * pares sellerId/sellerName tal como aparecen ahí — que es justo lo que
 * importa para el filtro de overview/historico (f_sellerNames).
 *
 * ?days=90 (default 30) controla la ventana de creationDate a inspeccionar.
 * ?q=carrefourar filtra el resultado a ids/nombres que contengan ese texto
 * (case-insensitive). Sin ?q devuelve todos los sellers vistos, ordenados
 * por cantidad de órdenes.
 */
export async function GET(req: NextRequest) {
  const account = process.env.VTEX_ACCOUNT;
  const key = process.env.VTEX_APP_KEY;
  const token = process.env.VTEX_APP_TOKEN;
  const base = process.env.VTEX_BASE_URL || (account ? `https://${account}.myvtex.com` : "");

  if (!account || !key || !token || !base) {
    return NextResponse.json({ error: "Missing VTEX env vars" }, { status: 500 });
  }

  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const q = (req.nextUrl.searchParams.get("q") || "").toLowerCase();
  const maxPages = Number(req.nextUrl.searchParams.get("maxPages") || 30);

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const range = `creationDate:[${from.toISOString()} TO ${to.toISOString()}]`;

  const counts = new Map<string, { id: string; name: string; orders: number }>();

  try {
    for (let page = 1; page <= maxPages; page++) {
      const qs = new URLSearchParams({ per_page: "100", page: String(page), f_creationDate: range });
      const res = await fetch(`${base}/api/oms/pvt/orders?${qs.toString()}`, {
        headers: {
          "X-VTEX-API-AppKey": key,
          "X-VTEX-API-AppToken": token,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return NextResponse.json({ error: `VTEX ${res.status} ${body.slice(0, 300)}`, ordersScannedSoFar: [...counts.values()].reduce((a, s) => a + s.orders, 0) }, { status: 502 });
      }
      const data = await res.json();
      const list = data?.list ?? data?.items ?? [];
      if (!Array.isArray(list) || list.length === 0) break;

      for (const o of list) {
        const items = Array.isArray(o?.items) ? o.items : [];
        const first = items[0] || {};
        const id = String(o?.sellerId || first?.seller || first?.sellerId || "").trim();
        const name = String(o?.sellerNames || o?.sellerName || o?.seller || first?.sellerName || "").trim();
        const key2 = id || name || "(desconocido)";
        const entry = counts.get(key2) ?? { id, name, orders: 0 };
        entry.orders += 1;
        if (!entry.name && name) entry.name = name;
        if (!entry.id && id) entry.id = id;
        counts.set(key2, entry);
      }

      if (list.length < 100) break;
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "orders_fetch_failed" }, { status: 500 });
  }

  let sellers = Array.from(counts.values()).sort((a, b) => b.orders - a.orders);
  if (q) sellers = sellers.filter((s) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));

  return NextResponse.json({
    windowDays: days,
    from: from.toISOString(),
    to: to.toISOString(),
    distinctSellersSeen: sellers.length,
    sellers,
  });
}
