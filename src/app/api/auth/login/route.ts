import { NextRequest, NextResponse } from "next/server";
import { SESSION_VERSION } from "@/lib/session-version";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  const expected = process.env.DASHBOARD_PASSWORD;

  if (!expected || password !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  const maxAge = 60 * 60 * 12;
  res.cookies.set("he_auth", "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge });
  res.cookies.set("he_session_version", SESSION_VERSION, { httpOnly: true, sameSite: "lax", path: "/", maxAge });
  return res;
}
