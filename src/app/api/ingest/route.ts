// src/app/api/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 204 });
}

export async function POST(req: NextRequest) {
  const payload = await req.json();
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ingest-upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  const ct = r.headers.get("content-type");
  return new NextResponse(text, { status: r.status, headers: ct ? { "content-type": ct } : {} });
}
