// supabase/functions/ingest-upload/index.ts
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const REST = `${SUPABASE_URL}/rest/v1`;
const STORAGE = `${SUPABASE_URL}/storage/v1`;

function authHeaders(extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    apikey: SERVICE_ROLE
  };
}

function parseDDMMYYYY(s) {
  if (!s) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function normalizeKey(x) {
  if (x == null) return "";
  let s = String(x).trim();
  if (!s) return "";
  s = s.replace(/&/g, ",").replace(/\s*,\s*/g, ",").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^[-,]+|[-,]+$/g, "");
  return s;
}

function toPriceOrZero(x) {
  if (x === null || x === undefined || String(x).trim() === "") return 0;
  const raw = String(x).trim();
  const poaNorm = raw.replace(/[\s.\-_/\\]+/g, "").toUpperCase();
  if (poaNorm === "POA") return 0;
  const cleaned = raw.replace(/[$,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function chunks<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let field = "", rec: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { rec.push(field); field = ""; }
      else if (c === "\r") { /* ignore */ }
      else if (c === "\n") { rec.push(field); rows.push(rec); rec = []; field = ""; }
      else field += c;
    }
  }
  rec.push(field);
  rows.push(rec);
  while (rows.length && rows[rows.length - 1].every((x) => x === "")) rows.pop();
  if (!rows.length) return { headers: [], rows: [] as string[][] };
  const headers = rows.shift() ?? [];
  return { headers, rows };
}

async function selMany(table: string, q: string, sel = "*") {
  const url = `${REST}/${table}?${q}&select=${encodeURIComponent(sel)}`;
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`select ${table} ${r.status} ${await r.text()}`);
  return await r.json();
}

async function insMany(table: string, rows: any[]) {
  const r = await fetch(`${REST}/${table}`, {
    method: "POST",
    headers: authHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal,resolution=ignore-duplicates"
    }),
    body: JSON.stringify(rows)
  });
  if (r.ok) return;
  const text = await r.text();
  // Duplicate key within the batch — fall back to row-by-row, skipping dupes
  if (r.status === 409) {
    for (const row of rows) {
      const r2 = await fetch(`${REST}/${table}`, {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
          Prefer: "return=minimal,resolution=ignore-duplicates"
        }),
        body: JSON.stringify([row])
      });
      if (!r2.ok && r2.status !== 409) {
        throw new Error(`insert ${table} ${r2.status} ${await r2.text()}`);
      }
    }
    return;
  }
  throw new Error(`insert ${table} ${r.status} ${text}`);
}

async function upd(table: string, q: string, body: any) {
  const r = await fetch(`${REST}/${table}?${q}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`update ${table} ${r.status} ${await r.text()}`);
}

async function del(table: string, q: string) {
  const r = await fetch(`${REST}/${table}?${q}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  if (!r.ok) throw new Error(`delete ${table} ${r.status} ${await r.text()}`);
}

async function storageDownload(bucket: string, path: string) {
  const url = `${STORAGE}/object/${bucket}/${encodeURIComponent(path)}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`storageDownload ${res.status} ${await res.text()}`);
  return await res.text();
}

const REQUIRED_CANONICALS = ["supplier_sku", "price_ex_gst", "description"];

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { upload_id, effective_date_ddmmyyyy, offset = 0, limit = 1000, mapping } = body;

    if (!upload_id) {
      return new Response(JSON.stringify({ error: "upload_id is required" }), { status: 400 });
    }
    const isoDate = parseDDMMYYYY(effective_date_ddmmyyyy);
    if (!isoDate) {
      return new Response(JSON.stringify({ error: "effective_date_ddmmyyyy invalid (dd-mm-yyyy)" }), { status: 400 });
    }
    if (!mapping || typeof mapping !== "object") {
      return new Response(JSON.stringify({ error: "mapping is required (canonical -> CSV header)" }), { status: 400 });
    }
    const missing = REQUIRED_CANONICALS.filter((c) => !mapping[c] || String(mapping[c]).trim() === "");
    if (missing.length) {
      return new Response(JSON.stringify({ error: `Missing mappings for: ${missing.join(", ")}` }), { status: 400 });
    }

    // Fetch upload & supplier
    const upload = (await selMany("upload", `upload_id=eq.${upload_id}`, "upload_id,supplier_id,sha256,row_count"))[0];
    if (!upload) return new Response(JSON.stringify({ error: "Upload not found" }), { status: 404 });
    const supplier = (await selMany("supplier", `supplier_id=eq.${upload.supplier_id}`, "name"))[0];
    const supplierName = supplier?.name ?? "UNKNOWN";

    // Download CSV
    const key = `${upload.supplier_id}/${upload.sha256}.csv`;
    let csvText: string;
    try {
      csvText = await storageDownload("price_uploads", key);
    } catch {
      csvText = await storageDownload("price_uploads", `price_uploads/${key}`);
    }
    const { headers, rows } = parseCsv(csvText);
    const totalRows = rows.length;

    if (!upload.row_count) {
      await upd("upload", `upload_id=eq.${upload_id}`, { row_count: totalRows, parsed_ok: false });
    }

    // Validate mapped headers exist
    const headerSet = new Set(headers.map((h) => String(h)));
    const bad = Object.entries(mapping)
      .filter(([_, csv]) => csv != null && !headerSet.has(String(csv)))
      .map(([canon, csv]) => `${canon} -> "${csv}"`);
    if (bad.length) {
      return new Response(JSON.stringify({ error: `Mapped header(s) not found: ${bad.join("; ")}` }), { status: 400 });
    }

    // Build header index -> canonicals
    const headerToCanon = new Map<string, string[]>();
    for (const [canon, csvHeader] of Object.entries(mapping)) {
      if (!csvHeader) continue;
      const arr = headerToCanon.get(csvHeader as string) ?? [];
      arr.push(canon);
      headerToCanon.set(csvHeader as string, arr);
    }
    const idx2canon = new Map<number, string[]>();
    headers.forEach((h, i) => {
      const arr = headerToCanon.get(h);
      if (arr && arr.length) idx2canon.set(i, arr);
    });

    // Window
    const start = Math.max(0, Number(offset || 0));
    const end = Math.min(totalRows, start + Math.max(1, Number(limit || 1000)));

    // On first batch: delete all existing supplier_product rows for this supplier
    if (start === 0) {
      await del("supplier_product", `supplier_id=eq.${upload.supplier_id}`);
    }

    // Parse rows in this window
    const spPayload: any[] = [];
    let errCount = 0;

    for (let rowIndex = start; rowIndex < end; rowIndex++) {
      const rec = rows[rowIndex];
      const normRow: any = {};
      headers.forEach((_, i) => {
        const canons = idx2canon.get(i);
        if (!canons) return;
        const val = rec[i] ?? null;
        for (const canon of canons) {
          if (canon === "price_ex_gst") normRow[canon] = toPriceOrZero(val);
          else normRow[canon] = val !== null ? String(val) : null;
        }
      });

      // Normalize keys and defaults
      const mpnNorm = normalizeKey(normRow.mpn);
      normRow.mpn = mpnNorm || null;
      if ((!normRow.supplier_sku || String(normRow.supplier_sku).trim() === "") && mpnNorm) {
        normRow.supplier_sku = mpnNorm;
      }
      const skuNorm = normalizeKey(normRow.supplier_sku);
      normRow.supplier_sku = skuNorm ? skuNorm.toUpperCase() : null;
      if (!normRow.brand || String(normRow.brand).trim() === "") normRow.brand = supplierName;

      const sku = (normRow.supplier_sku ?? "").trim();
      if (!sku) {
        errCount++;
        continue;
      }

      spPayload.push({
        supplier_id: upload.supplier_id,
        supplier_sku: sku,
        supplier_description: normRow.description ? String(normRow.description).toUpperCase() : null,
        brand: normRow.brand ? String(normRow.brand) : null,
        mpn: normRow.mpn ? String(normRow.mpn) : null,
        price_ex_gst: Number(normRow.price_ex_gst ?? 0),
        effective_from: isoDate,
        is_active: true
      });
    }

    // Insert supplier_product rows — if a batch hits a duplicate key error,
    // falls back to row-by-row and silently skips any duplicate SKUs
    for (const ch of chunks(spPayload, 1000)) {
      if (ch.length) await insMany("supplier_product", ch);
    }

    const okCount = spPayload.length;
    const done = end >= totalRows;

    await upd("upload", `upload_id=eq.${upload_id}`, {
      parsed_ok: done ? errCount === 0 : false,
      errors: { ok: okCount, errors: errCount, lastOffset: end }
    });

    return new Response(
      JSON.stringify({
        ok: true,
        processed: end - start,
        nextOffset: done ? null : end,
        totalRows,
        done,
        okCount,
        errCount
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = (e as any)?.message ?? "Internal error";
    console.error("ingest-upload error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
