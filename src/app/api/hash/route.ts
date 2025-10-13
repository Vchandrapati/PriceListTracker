// src/app/api/hash/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export const runtime = "nodejs";       // important: Node runtime, not Edge
export const dynamic = "force-dynamic"; // avoid caching

export async function POST(req: NextRequest) {
    try {
        const form = await req.formData();
        const file = form.get("file") as File | null;
        if (!file) {
            return NextResponse.json({ error: "file required" }, { status: 400 });
        }

        const hash = createHash("sha256");
        const reader = file.stream().getReader();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) hash.update(value); // value is a Uint8Array; Buffer.from not required
        }

        const hex = hash.digest("hex");
        return NextResponse.json({ hex });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "hash failed";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function OPTIONS() {
    return NextResponse.json({}, { status: 204 });
}
