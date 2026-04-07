"use client";

import * as React from "react";
import Papa from "papaparse";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandInput } from "@/components/ui/command";

export const dynamic = "force-dynamic"; // optional safety to avoid prerender

// ---------- Types ----------
type Supplier = { supplier_id: number; name: string };

type SupplierProduct = {
    supplier_product_id: number;
    supplier_id: number;
    supplier_sku: string | null;
    supplier_description: string | null;
    is_active: boolean;
    brand: string | null;
    mpn: string | null;
    price_ex_gst: number | null;
    effective_from: string | null;
};

// ---------- Helpers ----------
function normKey(x: string | null | undefined) {
    return String(x ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

type PagedResponse<T> = { data: T[] | null; error: unknown };
type BuildPage<T> = (from: number, to: number) => Promise<PagedResponse<T>>;

async function selectPaged<T>(
    build: BuildPage<T>,
    pageSize = 1000
): Promise<T[]> {
    const all: T[] = [];
    let from = 0;
    for (;;) {
        const to = from + pageSize - 1;
        const { data, error } = await build(from, to);
        if (error) throw error as Error;
        const batch = (data ?? []) as T[];
        all.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
    }
    return all;
}

function toISODate(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}


// Fallback headers (includes Group/Subgroups + the 6 you care about)
const FALLBACK_HEADERS = [
    "Group (Ignored for Updates)",
    "Subgroup 1 (Ignored for Updates)",
    "Subgroup 2 (Ignored for Updates)",
    "Subgroup 3 (Ignored for Updates)",
    "Part Number",
    "Description",
    "Trade Price",
    "Cost Price",
    "Split Cost Price",
    "Manufacturer",
];

// Headers we populate
const HEADER_KEYS = {
    description: "Description",
    trade: "Trade Price",
    cost: "Cost Price",
    splitCost: "Split Cost Price",
    manufacturer: "Manufacturer",
    partNumber: "Part Number",
    supplierPartNumber: "Supplier Part Number",

    group: ["Group (Ignored for Updates)", "Group"],
    subgroup1: ["Subgroup 1 (Ignored for Updates)", "Subgroup 1"],
    subgroup2: ["Subgroup 2 (Ignored for Updates)", "Subgroup 2"],
    subgroup3: ["Subgroup 3 (Ignored for Updates)", "Subgroup 3"],
};

function pickHeader(headers: string[], names: string | string[]) {
    const list = Array.isArray(names) ? names : [names];
    const lower = headers.map((h) => h.toLowerCase());
    for (const n of list) {
        const idx = lower.indexOf(String(n).toLowerCase());
        if (idx !== -1) return headers[idx];
    }
    return null;
}

export default function ExportPage() {
    // ---------------- State ----------------
    const [sb, setSb] = React.useState<SupabaseClient | null>(null);
    React.useEffect(() => {
        setSb(supabaseBrowser());
    }, []);
    const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
    const [supplierId, setSupplierId] = React.useState<number | null>(null);

    const [brands, setBrands] = React.useState<string[]>([]);
    const [brandOpen, setBrandOpen] = React.useState(false);
    const [selectedBrands, setSelectedBrands] = React.useState<string[]>([]);

    const [loading, setLoading] = React.useState(false);
    const [rows, setRows] = React.useState<SupplierProduct[]>([]);

    const [templateHeaders, setTemplateHeaders] = React.useState<string[] | null>(null);

    // ----- simPRO cross-reference state -----
    const [simproHeaders, setSimproHeaders] = React.useState<string[] | null>(null);
    type SimproRow = Record<string, string>; // dynamicTyping=false => strings
    const [simproRows, setSimproRows] = React.useState<SimproRow[]>([]);
    const [simproFileName, setSimproFileName] = React.useState<string>("");
    const [includeEOL, setIncludeEOL] = React.useState(true);

    // Build an index from simPRO: Part Number -> { group/subgroups, plus handy fields if needed }
    const simproIndex = React.useMemo(() => {
        const map = new Map<
            string,
            { group?: string; subgroup1?: string; subgroup2?: string; subgroup3?: string; manufacturer?: string; mpn?: string }
        >();
        if (!simproRows.length || !simproHeaders) return map;

        const spnH = pickHeader(simproHeaders, ["Supplier Part Number", "Part Number"]);
        if (!spnH) return map;

        const gH  = pickHeader(simproHeaders, ["Group (Ignored for Updates)", "Group"]);
        const s1H = pickHeader(simproHeaders, ["Subgroup 1 (Ignored for Updates)", "Subgroup 1"]);
        const s2H = pickHeader(simproHeaders, ["Subgroup 2 (Ignored for Updates)", "Subgroup 2"]);
        const s3H = pickHeader(simproHeaders, ["Subgroup 3 (Ignored for Updates)", "Subgroup 3"]);
        const manH = pickHeader(simproHeaders, "Manufacturer");
        const mpnH = pickHeader(simproHeaders, ["Universal Product Code", "UPC", "MPN"]);

        for (const r of simproRows) {
            const skuRaw = String(r[spnH] ?? "");
            const key = normKey(skuRaw);
            if (!key) continue;
            map.set(key, {
                group: gH ? String(r[gH] ?? "") : "",
                subgroup1: s1H ? String(r[s1H] ?? "") : "",
                subgroup2: s2H ? String(r[s2H] ?? "") : "",
                subgroup3: s3H ? String(r[s3H] ?? "") : "",
                manufacturer: manH ? String(r[manH] ?? "") : "",
                mpn: mpnH ? String(r[mpnH] ?? "") : "",
            });
        }

        return map;
    }, [simproRows, simproHeaders]);

    // Items in simPRO but missing from new export (EOL candidates)
    const eolCandidates = React.useMemo(() => {
        if (!simproRows.length || !simproHeaders) return [] as Array<{
            supplier_part: string; manufacturer: string; mpn: string; description: string;
        }>;

        const newKeySet = new Set(
            (rows || [])
                .map(r => normKey(r.mpn || r.supplier_sku))
                .filter(Boolean)
        );

        const spnH = pickHeader(simproHeaders, ["Supplier Part Number", "Part Number"]);
        const manH = pickHeader(simproHeaders, "Manufacturer");
        const mpnH = pickHeader(simproHeaders, ["Universal Product Code", "UPC", "MPN"]);
        const descH = pickHeader(simproHeaders, "Description");
        if (!spnH) return [];

        const out: Array<{ supplier_part: string; manufacturer: string; mpn: string; description: string; }> = [];
        for (const r of simproRows) {
            const partRaw = String(r[spnH] ?? "");
            const simproKey = normKey(partRaw);
            if (!simproKey) continue;
            if (!newKeySet.has(simproKey)) {
                out.push({
                    supplier_part: partRaw.trim(),
                    manufacturer: manH ? String(r[manH] ?? "") : "",
                    mpn: mpnH ? String(r[mpnH] ?? "") : "",
                    description: descH ? String(r[descH] ?? "") : "",
                });
            }
        }
        return out;
    }, [simproRows, simproHeaders, rows]);

    // ---------------- Effects ----------------
    React.useEffect(() => {
        if (!sb) return;
        (async () => {
            const { data, error } = await sb
                .from("supplier")
                .select("supplier_id, name")
                .eq("is_active", true)
                .order("name");
            if (!error && data) setSuppliers(data as Supplier[]);
        })();
    }, [sb]);

    // fetch brands for supplier
    React.useEffect(() => {
        if (!sb || !supplierId) return;
        (async () => {
            const { data } = await sb.rpc("distinct_brands_for_supplier", { p_supplier_id: supplierId });
            setBrands((data ?? []).map((r: { name: string }) => r.name));
            setSelectedBrands([]);
            setRows([]);
        })();
    }, [sb, supplierId]);

    // load CSV template headers from /public if present
    React.useEffect(() => {
        (async () => {
            try {
                const res = await fetch("/Catalogue-Import-Template-AU.csv", { cache: "no-store" });
                if (!res.ok) throw new Error("no template");
                const text = await res.text();
                const parsed = Papa.parse<string[]>(text, { header: false });
                const hdrs = (parsed.data?.[0] as string[])?.filter((h) => typeof h === "string");
                if (hdrs && hdrs.length) setTemplateHeaders(hdrs);
                else setTemplateHeaders(FALLBACK_HEADERS);
            } catch {
                setTemplateHeaders(FALLBACK_HEADERS);
            }
        })();
    }, []);

    // ---------------- Data fetch ----------------
    async function fetchData() {
        if (!sb || !supplierId) return;
        setLoading(true);
        try {
            const makeBase = () =>
                sb.from("supplier_product")
                    .select("supplier_product_id, supplier_id, supplier_sku, supplier_description, is_active, brand, mpn, price_ex_gst, effective_from")
                    .eq("supplier_id", supplierId)
                    .eq("is_active", true)
                    .order("supplier_product_id", { ascending: true });

            const products = await selectPaged<SupplierProduct>(async (from, to) => {
                let b = makeBase();
                if (selectedBrands.length) b = b.in("brand", selectedBrands);
                const { data, error } = await b.range(from, to);
                return { data: (data as SupplierProduct[] | null) ?? null, error };
            });

            setRows(products);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed to fetch data";
            alert(msg);
        } finally {
            setLoading(false);
        }
    }

    // ---------------- Export ----------------
    function makeCsv(): string {
        const hdrs = templateHeaders ?? FALLBACK_HEADERS;

        const H = {
            description: pickHeader(hdrs, HEADER_KEYS.description),
            trade: pickHeader(hdrs, HEADER_KEYS.trade),
            cost: pickHeader(hdrs, HEADER_KEYS.cost),
            splitCost: pickHeader(hdrs, HEADER_KEYS.splitCost),
            manufacturer: pickHeader(hdrs, HEADER_KEYS.manufacturer),
            partNumber: pickHeader(hdrs, HEADER_KEYS.partNumber),
            supplierPartNumber: pickHeader(hdrs, HEADER_KEYS.supplierPartNumber),

            group: pickHeader(hdrs, HEADER_KEYS.group),
            subgroup1: pickHeader(hdrs, HEADER_KEYS.subgroup1),
            subgroup2: pickHeader(hdrs, HEADER_KEYS.subgroup2),
            subgroup3: pickHeader(hdrs, HEADER_KEYS.subgroup3),
        } as const;

        // Build rows as object keyed by all template headers (others left blank)
        const output: Record<string, string | number | null>[] = [];

        // 1) Normal rows
        for (const r of rows) {
            const price = r.price_ex_gst ?? 0;
            const row: Record<string, string | number | null> = {};
            for (const h of hdrs) row[h] = "";

            // Part Number + Supplier Part Number (same value)
            if (H.partNumber) row[H.partNumber] = r.supplier_sku ?? "";
            if (H.supplierPartNumber) row[H.supplierPartNumber] = r.supplier_sku ?? "";

            // Description: Brand • MPN • Description
            if (H.description) {
                row[H.description] = [r.brand, r.mpn, r.supplier_description].filter(Boolean).join(" • ");
            }

            // Prices
            if (H.trade) row[H.trade] = price;
            if (H.cost) row[H.cost] = price;
            if (H.splitCost) row[H.splitCost] = price;

            // Manufacturer = brand
            if (H.manufacturer) row[H.manufacturer] = r.brand ?? "";

            // Copy Group/Subgroups from simPRO by Part Number (supplier_sku)
            const lookupKey = normKey(r.mpn || r.supplier_sku);
            const g = simproIndex.get(lookupKey);

            if (g) {
                if (H.group && g.group) row[H.group] = g.group;
                if (H.subgroup1 && g.subgroup1) row[H.subgroup1] = g.subgroup1;
                if (H.subgroup2 && g.subgroup2) row[H.subgroup2] = g.subgroup2;
                if (H.subgroup3 && g.subgroup3) row[H.subgroup3] = g.subgroup3;
            }

            output.push(row);
        }

        // 2) Append EOL items (present in simPRO but missing)
        if (includeEOL && eolCandidates.length) {
            for (const e of eolCandidates) {
                const row: Record<string, string | number | null> = {};
                for (const h of hdrs) row[h] = "";

                // Part Number → ***EOL***, Supplier Part Number → original SKU
                if (H.partNumber) row[H.partNumber] = "***EOL***";
                if (H.supplierPartNumber) row[H.supplierPartNumber] = e.supplier_part;

                // Description: keep original simPRO description
                if (H.description) row[H.description] = e.description;

                // Prices -> 0
                if (H.trade) row[H.trade] = 0;
                if (H.cost) row[H.cost] = 0;
                if (H.splitCost) row[H.splitCost] = 0;

                // Manufacturer = brand from simPRO
                if (H.manufacturer) row[H.manufacturer] = e.manufacturer ?? "";

                // Copy Group/Subgroups for EOL from simPRO by Part Number
                const g2 = simproIndex.get(normKey(e.supplier_part));

                if (g2) {
                    if (H.group && g2.group) row[H.group] = g2.group;
                    if (H.subgroup1 && g2.subgroup1) row[H.subgroup1] = g2.subgroup1;
                    if (H.subgroup2 && g2.subgroup2) row[H.subgroup2] = g2.subgroup2;
                    if (H.subgroup3 && g2.subgroup3) row[H.subgroup3] = g2.subgroup3;
                }

                output.push(row);
            }
        }

        // Serialize to CSV with headers in exact order
        const csvRows: string[] = [];
        csvRows.push(hdrs.map((h) => escapeCsv(h)).join(","));
        for (const r of output) {
            csvRows.push(hdrs.map((h) => escapeCsv(r[h] ?? "")).join(","));
        }
        return csvRows.join("\n");
    }

    function escapeCsv(val: string | number | null | undefined) {
        if (val == null) return "";
        const s = String(val);
        if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    function downloadCsv() {
        if (!rows.length && !(includeEOL && simproIndex.size)) {
            alert("No rows to export");
            return;
        }
        const csv = makeCsv();
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const supplier = suppliers.find((s) => s.supplier_id === supplierId)?.name?.replace(/[^A-Za-z0-9_-]+/g, "-") || "supplier";
        const dateStr = toISODate(new Date());
        a.download = `Catalogue-Export-${supplier}-${dateStr}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    // ---------------- UI ----------------
    return (
        /* Full-width like Items page (no max-w) */
        <div className="p-4 md:p-6 lg:p-8 space-y-4">
            {/* Removed breadcrumbs prop */}
            <PageHeader
                title="Export Catalogue"
                subtitle="Choose a supplier and brand(s), upload a simPRO export to detect EOL items, copy Group/Subgroups, and export."
            />

            <Card>
                <CardContent className="p-5 space-y-6">
                    {/* Supplier & Brands */}
                    <div className="grid gap-3 md:grid-cols-3 items-end">
                        <div className="space-y-1">
                            <Label>Supplier</Label>
                            <select
                                className="w-full h-10 rounded border px-3"
                                value={supplierId ?? ""}
                                onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}
                            >
                                <option value="">— Select supplier —</option>
                                {suppliers.map((s) => (
                                    <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Brand multi-select */}
                        <div className="space-y-1">
                            <Label>Brands (optional)</Label>
                            <Popover open={brandOpen} onOpenChange={setBrandOpen}>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full justify-between">
                                        {selectedBrands.length ? `${selectedBrands.length} selected` : "All brands"}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="bg-white text-foreground border" align="start">
                                    <Command>
                                        <CommandInput placeholder="Filter brands..." />
                                        <CommandGroup>
                                            {brands.map((b) => {
                                                const checked = selectedBrands.includes(b);
                                                return (
                                                    <CommandItem
                                                        key={b}
                                                        onSelect={() =>
                                                            setSelectedBrands((cur) =>
                                                                checked ? cur.filter((x) => x !== b) : [...cur, b]
                                                            )
                                                        }
                                                    >
                                                        <Checkbox checked={checked} className="mr-2" /> {b}
                                                    </CommandItem>
                                                );
                                            })}
                                        </CommandGroup>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        </div>

                        <div className="flex items-end gap-2">
                            <Button disabled={!supplierId || loading} onClick={fetchData}>
                                {loading ? "Loading…" : "Load"}
                            </Button>
                            <Button
                                variant="outline"
                                disabled={!rows.length && !(includeEOL && simproIndex.size)}
                                onClick={downloadCsv}
                            >
                                Export CSV
                            </Button>
                        </div>
                    </div>

                    {/* simPRO file upload & EOL controls */}
                    <div className="space-y-2">
                        <Label htmlFor="simpro">Current simPRO export (CSV)</Label>
                        <Input
                            id="simpro"
                            type="file"
                            accept=".csv,text/csv"
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                setSimproFileName(f.name);
                                Papa.parse<SimproRow>(f, {
                                    header: true,
                                    dynamicTyping: false,
                                    skipEmptyLines: true,
                                    complete: (res) => {
                                        const parsedRows = res.data.filter(r => r && Object.keys(r).length);
                                        const hdrs = res.meta.fields ?? Object.keys(parsedRows[0] ?? {});
                                        setSimproHeaders(hdrs);
                                        setSimproRows(parsedRows);
                                    },
                                    error: (err) => alert(`Failed to parse simPRO CSV: ${err.message}`)
                                });
                            }}
                        />
                        {simproFileName && (
                            <p className="text-sm text-muted-foreground">
                                Loaded: {simproFileName} · {simproRows.length.toLocaleString()} rows
                            </p>
                        )}
                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={includeEOL}
                                    onChange={(e) => setIncludeEOL(e.target.checked)}
                                />
                                Include EOL items (present in simPRO but missing in new export)
                            </label>
                            <span className="text-xs text-muted-foreground">
                                EOL to add: {eolCandidates.length.toLocaleString()}
                            </span>
                        </div>
                    </div>

                    {/* Template status */}
                    <p className="text-xs text-muted-foreground">
                        Template detected: {templateHeaders ? `${templateHeaders.length} headers` : "loading…"}.
                        Populating: Group, Subgroup 1–3, Part Number, Description, Trade Price, Cost Price, Split Cost Price, Manufacturer.
                    </p>

                    {/* Preview Table (full-width, larger) */}
                    {rows.length > 0 && (
                        <div className="rounded-xl border bg-card overflow-hidden">
                            <div className="overflow-x-auto">
                                <Table className="w-full min-w-[1100px] text-[15px] md:text-base">
                                    <TableHeader>
                                        <TableRow className="h-12">
                                            <TableHead className="px-4">Brand</TableHead>
                                            <TableHead className="px-4">MPN</TableHead>
                                            <TableHead className="px-4">Supplier SKU (Part Number)</TableHead>
                                            <TableHead className="px-4">Description</TableHead>
                                            <TableHead className="px-4 text-right">Price ex GST</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody className="[&>tr]:h-12 [&>tr>td]:py-3 [&>tr>td]:px-4 [&>tr>td]:whitespace-nowrap">
                                        {rows.map((r) => (
                                            <TableRow key={r.supplier_product_id}>
                                                <TableCell>{r.brand}</TableCell>
                                                <TableCell>{r.mpn}</TableCell>
                                                <TableCell>{r.supplier_sku}</TableCell>
                                                <TableCell className="max-w-[700px] truncate">
                                                    {[r.brand, r.mpn, r.supplier_description].filter(Boolean).join(" • ")}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {r.price_ex_gst ?? 0}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
