import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("he_auth", "", { path: "/", maxAge: 0 });
  res.cookies.set("he_session_version", "", { path: "/", maxAge: 0 });
  return res;
}
