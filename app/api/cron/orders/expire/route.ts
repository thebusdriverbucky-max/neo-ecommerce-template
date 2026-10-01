import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { expirePendingOrders } from "@/lib/manual-order";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const expired = await expirePendingOrders(db);
    return NextResponse.json({ expired });
  } catch {
    console.error("Order expiration failed");
    return NextResponse.json({ error: "Order expiration failed" }, { status: 500 });
  }
}

// Vercel Cron invokes GET; both methods use the same bearer authorization.
export const GET = POST;
