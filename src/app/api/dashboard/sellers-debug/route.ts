import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint de diagnóstico: lista los sellers tal como están registrados en
 * VTEX (id + name exactos), para poder comparar contra src/lib/seller.ts
 * cuando el filtrado por nombre no matchea ninguna orden.
 *
 * Pagina todo el catálogo (VTEX cappea _per_page a 100 por más que se pida
 * más), y por default solo devuelve los que matchean "hogar" o "electro"
 * para no volcar acá cientos de sellers. ?all=1 devuelve el listado completo.
 */
export async function GET(req: NextRequest) {
  const account = process.env.VTEX_ACCOUNT;
  const key = process.env.VTEX_APP_KEY;
  const token = process.env.VTEX_APP_TOKEN;
  const base = process.env.VTEX_BASE_URL || (account ? `https://${account}.myvtex.com` : "");

  if (!account || !key || !token || !base) {
    return NextResponse.json({ error: "Missing VTEX env vars" }, { status: 500 });
  }

  const showAll = req.nextUrl.searchParams.get("all") === "1";

  try {
    const all: any[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await fetch(`${base}/api/seller-register/pvt/sellers?_page=${page}&_per_page=100`, {
        headers: {
          "X-VTEX-API-AppKey": key,
          "X-VTEX-API-AppToken": token,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return NextResponse.json({ error: `VTEX ${res.status} ${body.slice(0, 300)}`, sellersLoadedSoFar: all.length }, { status: 502 });
      }
      const data = await res.json();
      const list = data?.items ?? data ?? [];
      if (!Array.isArray(list) || list.length === 0) break;
      all.push(...list);
      if (list.length < 100) break;
    }

    const sellers = all.map((s: any) => ({
      id: s?.SellerId ?? s?.id ?? s?.sellerId ?? null,
      name: s?.Name ?? s?.name ?? null,
      isActive: s?.IsActive ?? s?.isActive ?? null,
      matches: /hogar|electro/i.test(String(s?.Name ?? s?.name ?? "")),
    }));

    const matches = sellers.filter((s) => s.matches);

    return NextResponse.json({
      totalSellers: sellers.length,
      matchesCount: matches.length,
      matches,
      ...(showAll ? { allSellers: sellers } : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "sellers_fetch_failed" }, { status: 500 });
  }
}
