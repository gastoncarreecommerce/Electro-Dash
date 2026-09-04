import { NextRequest, NextResponse } from "next/server";
import { SELLER } from "@/lib/seller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint de diagnóstico: trae un pedido puntual de VTEX por su orderId
 * (o sequence) y muestra qué sellerId/sellerName trae, comparado contra
 * SELLER en src/lib/seller.ts — para confirmar que el nombre configurado
 * matchea exactamente antes de confiar en /api/dashboard/overview.
 *
 * Uso: /api/dashboard/order-debug?id=<orderId>
 */
export async function GET(req: NextRequest) {
  const account = process.env.VTEX_ACCOUNT;
  const key = process.env.VTEX_APP_KEY;
  const token = process.env.VTEX_APP_TOKEN;
  const base = process.env.VTEX_BASE_URL || (account ? `https://${account}.myvtex.com` : "");

  if (!account || !key || !token || !base) {
    return NextResponse.json({ error: "Missing VTEX env vars" }, { status: 500 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Falta ?id=<orderId o sequence>" }, { status: 400 });
  }

  try {
    const res = await fetch(`${base}/api/oms/pvt/orders/${encodeURIComponent(id)}`, {
      headers: {
        "X-VTEX-API-AppKey": key,
        "X-VTEX-API-AppToken": token,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json({ error: `VTEX ${res.status} ${body.slice(0, 300)}` }, { status: 502 });
    }
    const o: any = await res.json();

    const topSellerId = o?.sellers?.[0]?.id ?? null;
    const topSellerName = o?.sellers?.[0]?.name ?? null;
    const itemSellers = (o?.items ?? []).map((it: any) => ({ seller: it?.seller, sellerName: it?.sellerName }));

    const norm = (v: string) =>
      (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

    const matchesConfiguredName = norm(topSellerName || "") === norm(SELLER.name);
    const matchesConfiguredId = !!SELLER.id && topSellerId === SELLER.id;

    return NextResponse.json({
      orderId: o?.orderId,
      sequence: o?.sequence,
      status: o?.status,
      creationDate: o?.creationDate,
      topSellerId,
      topSellerName,
      itemSellers,
      configuredSeller: SELLER,
      matchesConfiguredName,
      matchesConfiguredId,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "order_fetch_failed" }, { status: 500 });
  }
}
