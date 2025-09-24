"use client";

import * as React from "react";
import Papa from "papaparse";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Popover,
    PopoverTrigger,
    PopoverContent,
} from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandInput } from "@/components/ui/command";
import { cn } from "@/lib/utils";

// ---------- Types ----------
type Supplier = { supplier_id: number; name: string };

type SupplierProduct = {
    supplier_product_id: number;
    supplier_id: number;
    supplier_sku: string | null;
    supplier_description: string | null;
    is_active: boolean;
    uom: string;
    pack_size: number;
    brand: string | null;
    mpn: string | null;
};

type PriceRow = {
    price_id: number;
    supplier_product_id: number;
    price_ex_gst: number;
    effective: string; // daterange text
    start_date: string; // generated via default lower(effective)
};

// ---------- Helpers ----------
function toISODate(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
function addDays(date: Date, days: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}
function chunk<T>(arr: T[], n = 500) {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

// We will try to fetch the real template headers from /Catalogue-Import-Template-AU.csv at runtime.
// If not found, we fall back to this minimal list (your real importer likely needs the exact names).
const FALLBACK_HEADERS = [
    "Group (Ignored for Updates)",
    "Subgroup 1 (Ignored for Updates)",
    "Subgroup 2 (Ignored for Updates)",
    "Subgroup 3 (Ignored for Updates)",
    "Part Number",
    "Description",
    "Universal Product Code",
    "Country of Origin",
    "Trade Price",
    "Cost Price",
    "Split Price",
    "Split Cost Price",
    "Purchase Tax Code",
    "Sales Tax Code",
    "Trade Split Quantity",
    "Minimum Pack Quantity",
    "Manufacturer",
    "Supplier Part Number",
    "Favourite",
    "Search Terms",
    "Purchase Stage",
    "Inventory Item",
    "Notes",
    "Unit of Measurement",
    "Add-on Enabled",
    "Markup (Tier 1 Name)",
    "Sell Price (Tier 1 Name)",
    "Add-on Markup (Tier 1 Name)",
    "Add-on Sell Price (Tier 1 Name)",
    "Markup (Tier 2 Name)",
    "Sell Price (Tier 2 Name)",
    "Add-on Markup (Tier 2 Name)",
    "Add-on Sell Price (Tier 2 Name)",
];

// Which headers we populate and how we map from DB fields
const HEADER_KEYS = {
    description: ["Description", "Supplier Description"], // we will fill any header that contains "Description" safely
    upc: "Universal Product Code",
    trade: "Trade Price",
    cost: "Cost Price",
    splitPrice: "Split Price",
    splitCost: "Split Cost Price",
    purchaseTax: "Purchase Tax Code",
    salesTax: "Sales Tax Code",
    manufacturer: "Manufacturer",
    supplierPart: ["Supplier Part Number", "Part Number"],
    uom: ["Unit of Measurement"],
    markupTier1: "Markup (Tier 1 Name)",
};

export default function ExportPage() {
    // ---------------- State ----------------
    const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
    const [supplierId, setSupplierId] = React.useState<number | null>(null);

    const [brands, setBrands] = React.useState<string[]>([]);
    const [brandOpen, setBrandOpen] = React.useState(false);
    const [selectedBrands, setSelectedBrands] = React.useState<string[]>([]);

    const [loading, setLoading] = React.useState(false);
    const [rows, setRows] = React.useState<
        (SupplierProduct & { price_ex_gst: number | null })[]
    >([]);

    const [templateHeaders, setTemplateHeaders] = React.useState<string[] | null>(null);

    // ---------------- Effects ----------------
    React.useEffect(() => {
        (async () => {
            const { data, error } = await supabase
                .from("supplier")
                .select("supplier_id, name")
                .eq("is_active", true)
                .order("name");
            if (!error && data) setSuppliers(data as Supplier[]);
        })();
    }, []);

    // fetch brands for supplier
    React.useEffect(() => {
        if (!supplierId) return;
        (async () => {
            const { data, error } = await supabase
                .from("supplier_product")
                .select("brand")
                .eq("supplier_id", supplierId)
                .eq("is_active", true);
            if (error) return;
            const uniq = Array.from(
                new Set((data as { brand: string | null }[]).map((r) => (r.brand ?? "").trim()))
            )
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
            setBrands(uniq);
            setSelectedBrands([]);
            setRows([]);
        })();
    }, [supplierId]);

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
        if (!supplierId) return;
        setLoading(true);
        try {
            // 1) products by supplier + brand filter
            let q = supabase
                .from("supplier_product")
                .select(
                    "supplier_product_id, supplier_id, supplier_sku, supplier_description, is_active, uom, pack_size, brand, mpn"
                )
                .eq("supplier_id", supplierId)
                .eq("is_active", true);

            if (selectedBrands.length) {
                // PostgREST in. operator needs array of unique strings
                // We'll chunk if too large, but usually this is fine
                q = q.in("brand", selectedBrands);
            }

            const { data: products, error } = await q.limit(10000);
            if (error) throw error;

            const prods = (products as SupplierProduct[]) ?? [];
            const ids = prods.map((p) => p.supplier_product_id);

            // 2) active price rows: effective overlaps [today, tomorrow)
            const today = new Date();
            const iso = toISODate(today);
            const next = toISODate(addDays(today, 1));

            const priceMap = new Map<number, number>();
            for (const ch of chunk(ids, 400)) {
                if (!ch.length) continue;
                const { data: prices, error: perr } = await supabase
                    .from("price_history")
                    .select("supplier_product_id, price_ex_gst, effective, start_date")
                    .in("supplier_product_id", ch)
                    .filter("effective", "ov", `[${iso},${next})`);
                if (perr) throw perr;
                for (const r of (prices as PriceRow[]) ?? []) {
                    priceMap.set(r.supplier_product_id, r.price_ex_gst);
                }
            }

            const withPrice = prods.map((p) => ({ ...p, price_ex_gst: priceMap.get(p.supplier_product_id) ?? null }));
            setRows(withPrice);
        } catch (e: any) {
            alert(e?.message ?? "Failed to fetch data");
        } finally {
            setLoading(false);
        }
    }

    // ---------------- Export ----------------
    function pickHeader(headers: string[], names: string | string[]) {
        const list = Array.isArray(names) ? names : [names];
        const lower = headers.map((h) => h.toLowerCase());
        for (const n of list) {
            const idx = lower.indexOf(n.toLowerCase());
            if (idx !== -1) return headers[idx];
        }
        return null;
    }

    function makeCsv(): string {
        const hdrs = templateHeaders ?? FALLBACK_HEADERS;

        // Build rows as object keyed by header -> value
        const output: Record<string, string | number | null>[] = [];

        // Resolve target header names present in template (robust to exact naming)
        const H = {
            description1: pickHeader(hdrs, HEADER_KEYS.description),
            upc: pickHeader(hdrs, HEADER_KEYS.upc),
            trade: pickHeader(hdrs, HEADER_KEYS.trade),
            cost: pickHeader(hdrs, HEADER_KEYS.cost),
            splitPrice: pickHeader(hdrs, HEADER_KEYS.splitPrice),
            splitCost: pickHeader(hdrs, HEADER_KEYS.splitCost),
            purchaseTax: pickHeader(hdrs, HEADER_KEYS.purchaseTax),
            salesTax: pickHeader(hdrs, HEADER_KEYS.salesTax),
            manufacturer: pickHeader(hdrs, HEADER_KEYS.manufacturer),
            supplierPart: pickHeader(hdrs, HEADER_KEYS.supplierPart),
            uom: pickHeader(hdrs, HEADER_KEYS.uom),
            markupTier1: pickHeader(hdrs, HEADER_KEYS.markupTier1),
            partNumber: pickHeader(hdrs, "Part Number"),
        } as const;

        const hdrSet = new Set(hdrs);

        for (const r of rows) {
            const price = r.price_ex_gst ?? 0;
            const row: Record<string, string | number | null> = {};

            // fill all headers with blank by default so column count matches exactly
            for (const h of hdrs) row[h] = "";

            // Mappings per your spec
            if (H.description1) { const formatted = [r.brand, r.mpn, r.supplier_description].filter(Boolean).join(" • "); row[H.description1] = formatted; }
            if (H.upc) row[H.upc] = r.mpn ?? ""; // Universal Product Code = MPN

            if (H.trade) row[H.trade] = price;
            if (H.cost) row[H.cost] = price;
            if (H.splitPrice) row[H.splitPrice] = price;
            if (H.splitCost) row[H.splitCost] = price;

            if (H.purchaseTax) row[H.purchaseTax] = "Default"; // Purchase Tax Code
            if (H.salesTax) row[H.salesTax] = "Default"; // Sales Tax Code

            if (H.manufacturer) row[H.manufacturer] = r.brand ?? ""; // Manufacturer = brand

            if (H.supplierPart) row[H.supplierPart] = r.supplier_sku ?? ""; // Supplier Part Number = supplier_sku

            // UOM forced to ea
            if (H.uom) row[H.uom] = "ea";

            // Default markup 25
            if (H.markupTier1) row[H.markupTier1] = 25;

            // Optional: also set Part Number = supplier_sku if present and Supplier Part Number header missing in template
            if (H.supplierPart) row[H.supplierPart] = r.supplier_sku ?? "";
            if (H.partNumber) row[H.partNumber] = r.supplier_sku ?? "";

            output.push(row);
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
        if (!rows.length) {
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
        <div className="mx-auto max-w-7xl p-6 space-y-6">
            <PageHeader
                title="Export Catalogue"
                description="Choose a supplier and brand(s), preview items, and export a catalogue CSV matching your template."
                breadcrumbs={[
                    { href: "/", label: "Home" },
                    { label: "Export Catalogue" },
                ]}
            />

            <Card>
                <CardContent className="p-6 space-y-6">
                    {/* Supplier */}
                    <div className="grid gap-3 md:grid-cols-3 items-end">
                        <div className="space-y-1">
                            <Label>Supplier</Label>
                            <select
                                className="w-full border rounded h-10 px-3"
                                value={supplierId ?? ""}
                                onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}
                            >
                                <option value="">— Select supplier —</option>
                                {suppliers.map((s) => (
                                    <option key={s.supplier_id} value={s.supplier_id}>
                                        {s.name}
                                    </option>
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
                                <PopoverContent className="p-0 w-80" align="start">
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
                            <Button variant="outline" disabled={!rows.length} onClick={downloadCsv}>
                                Export CSV
                            </Button>
                        </div>
                    </div>

                    {/* Template status */}
                    <p className="text-xs text-muted-foreground">
                        Template headers: {templateHeaders ? `${templateHeaders.length} found` : "loading…"}. Place your file as
                        <code className="mx-1">/public/Catalogue-Import-Template-AU.csv</code> to use the exact header order.
                    </p>

                    {/* Preview Table */}
                    {rows.length > 0 && (
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Brand</TableHead>
                                        <TableHead>MPN</TableHead>
                                        <TableHead>Supplier SKU</TableHead>
                                        <TableHead>Description</TableHead>
                                        <TableHead className="text-right">Price ex GST</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((r) => (
                                        <TableRow key={r.supplier_product_id}>
                                            <TableCell className="whitespace-nowrap">{r.brand}</TableCell>
                                            <TableCell className="whitespace-nowrap">{r.mpn}</TableCell>
                                            <TableCell className="whitespace-nowrap">{r.supplier_sku}</TableCell>
                                            <TableCell className="whitespace-nowrap max-w-[500px] truncate">{r.supplier_description}</TableCell>
                                            <TableCell className="text-right">{r.price_ex_gst ?? 0}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
