"use client";

import * as React from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SupabaseClient } from "@supabase/supabase-js";

type Supplier = { supplier_id: number; name: string };
type Brand = { name: string };
const ALL = "__ALL__";

type ItemRow = {
    supplier_product_id: number;
    supplier_id: number;
    supplier_name: string;
    brand_name: string | null;
    mpn: string | null;
    supplier_sku: string | null;
    supplier_description: string | null;
    price_ex_gst: number | null;
    effective_from: string | null;
};

const PAGE_SIZE = 50;

// same normalization you use in ingestion
function normalizeKey(x: string) {
    if (x == null) return "";
    let s = String(x).trim();
    if (!s) return "";
    s = s.replace(/&/g, ","); // & -> ,
    s = s.replace(/\s*,\s*/g, ","); // spaces around commas -> single comma
    s = s.replace(/\s+/g, "-"); // whitespace -> -
    s = s.replace(/-+/g, "-"); // collapse ---
    s = s.replace(/^[-,]+|[-,]+$/g, ""); // trim leading/trailing - or ,
    return s;
}

export default function ItemsPage() {
    const [sb, setSb] = React.useState<SupabaseClient | null>(null);
    React.useEffect(() => {
        setSb(supabaseBrowser());
    }, []);
    const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
    const [brands, setBrands] = React.useState<Brand[]>([]);
    const [supplierId, setSupplierId] = React.useState<string>("");
    const [brandId, setBrandId] = React.useState<string>("");
    const [search, setSearch] = React.useState<string>("");

    const [page, setPage] = React.useState(1);
    const [total, setTotal] = React.useState<number | null>(null);

    const [rows, setRows] = React.useState<ItemRow[]>([]);
    const [loading, setLoading] = React.useState(false);

    // load suppliers once
    React.useEffect(() => {
        if (!sb) return;
        (async () => {
            const { data: sup } = await sb.from("supplier").select("supplier_id,name").order("name");
            setSuppliers((sup ?? []) as Supplier[]);
        })();
    }, [sb]);

    // reset brand immediately when supplier changes so fetchItems doesn't fire with a stale brand
    React.useEffect(() => {
        setBrandId("");
    }, [supplierId]);

    // load brands filtered by selected supplier
    React.useEffect(() => {
        if (!sb) return;
        (async () => {
            const { data: br } = await sb.rpc("distinct_brands_for_supplier",
                supplierId ? { p_supplier_id: Number(supplierId) } : {}
            );
            setBrands((br ?? []) as Brand[]);
        })();
    }, [sb, supplierId]);

    // debounce search
    const [searchDeb, setSearchDeb] = React.useState(search);
    React.useEffect(() => {
        const t = setTimeout(() => setSearchDeb(search.trim()), 300);
        return () => clearTimeout(t);
    }, [search]);

    // clear table immediately when filters change
    React.useEffect(() => {
        setPage(1);
        setRows([]);
        setTotal(null);
    }, [supplierId, brandId, searchDeb]);

    const fetchItems = React.useCallback(async () => {
        if (!sb) return;

        setLoading(true);
        setRows([]);
        setTotal(null);

        const selectCols = `
      supplier_product_id,
      supplier_id,
      supplier:supplier(name),
      brand,
      mpn,
      supplier_sku,
      supplier_description,
      price_ex_gst,
      effective_from
    `;

        let query = sb
            .from("supplier_product")
            .select(selectCols, { count: "exact" });

        if (supplierId) query = query.eq("supplier_id", Number(supplierId));
        if (brandId) query = query.eq("brand", brandId);
        if (searchDeb) {
            const norm = normalizeKey(searchDeb);
            query = query.ilike("mpn", `%${norm}%`);
        }

        const from = (page - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        query = query.range(from, to);

        const { data, error, count } = await query;
        if (error) {
            console.error(error);
            setRows([]);
            setTotal(0);
            setLoading(false);
            return;
        }

        type SupplierRel = { name: string } | { name: string }[] | null;
        type SupplierProductRowRaw = {
            supplier_product_id: number;
            supplier_id: number;
            supplier: SupplierRel;
            brand: string | null;
            mpn: string | null;
            supplier_sku: string | null;
            supplier_description: string | null;
            price_ex_gst: number | null;
            effective_from: string | null;
        };

        const shaped: ItemRow[] = ((data ?? []) as SupplierProductRowRaw[]).map((r) => {
            const supplierName = Array.isArray(r.supplier) ? (r.supplier[0]?.name ?? "") : (r.supplier?.name ?? "");
            return {
                supplier_product_id: r.supplier_product_id,
                supplier_id: r.supplier_id,
                supplier_name: supplierName,
                brand_name: r.brand ?? null,
                mpn: r.mpn ?? null,
                supplier_sku: r.supplier_sku ?? null,
                supplier_description: r.supplier_description ?? null,
                price_ex_gst: r.price_ex_gst ?? null,
                effective_from: r.effective_from ?? null,
            };
        });

        setRows(shaped);
        setTotal(count ?? 0);
        setLoading(false);
    }, [sb, supplierId, brandId, searchDeb, page]);

    React.useEffect(() => {
        fetchItems();
    }, [fetchItems]);

    const totalPages = Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));

    return (
        <div className="p-4 md:p-6 lg:p-8 space-y-4">
            <PageHeader title="Items" subtitle="Search by supplier, brand, or MPN." />

            <Card>
                <CardContent className="p-5 space-y-4">
                    {/* Filters */}
                    <div className="grid gap-3 md:grid-cols-4">
                        <div className="space-y-1">
                            <Label>Supplier</Label>
                            <Select value={supplierId || ALL} onValueChange={(v) => setSupplierId(v === ALL ? "" : v)}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="All suppliers" />
                                </SelectTrigger>
                                <SelectContent className="bg-white text-foreground border shadow-md">
                                    <SelectItem value={ALL}>All suppliers</SelectItem>
                                    {suppliers.map((s) => (
                                        <SelectItem key={s.supplier_id} value={String(s.supplier_id)}>
                                            {s.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1">
                            <Label>Brand</Label>
                            <Select value={brandId || ALL} onValueChange={(v) => setBrandId(v === ALL ? "" : v)}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="All brands" />
                                </SelectTrigger>
                                <SelectContent className="bg-white text-foreground border shadow-md">
                                    <SelectItem value={ALL}>All brands</SelectItem>
                                    {brands.map((b) => (
                                        <SelectItem key={b.name} value={b.name}>
                                            {b.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1 md:col-span-2">
                            <Label>Search MPN</Label>
                            <Input
                                placeholder="Type an MPN (e.g., Neptune-Series)"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                We normalise your input (spaces → &quot;-&quot;, &quot;&amp;&quot; → &quot;,&quot;) to match stored MPNs.
                            </p>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="rounded-xl border bg-card overflow-hidden">
                        <div className="overflow-x-auto">
                            <Table className="w-full min-w-[1000px] text-[15px] md:text-base">
                                <TableHeader>
                                    <TableRow className="h-12">
                                        <TableHead className="px-4">Supplier</TableHead>
                                        <TableHead className="px-4">Brand</TableHead>
                                        <TableHead className="px-4">MPN</TableHead>
                                        <TableHead className="px-4">Supplier SKU</TableHead>
                                        <TableHead className="px-4">Description</TableHead>
                                        <TableHead className="px-4 text-right">Price ex GST</TableHead>
                                        <TableHead className="px-4">Effective From</TableHead>
                                    </TableRow>
                                </TableHeader>

                                <TableBody className="[&>tr]:h-12 [&>tr>td]:py-3 [&>tr>td]:px-4 [&>tr>td]:whitespace-nowrap">
                                    {!loading && rows.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                                                No items found.
                                            </TableCell>
                                        </TableRow>
                                    )}

                                    {!loading &&
                                        rows.map((r) => (
                                            <TableRow key={r.supplier_product_id}>
                                                <TableCell>{r.supplier_name}</TableCell>
                                                <TableCell>{r.brand_name ?? "—"}</TableCell>
                                                <TableCell>{r.mpn ?? "—"}</TableCell>
                                                <TableCell>{r.supplier_sku ?? "—"}</TableCell>
                                                <TableCell className="max-w-[700px] truncate">{r.supplier_description || "—"}</TableCell>
                                                <TableCell className="text-right">
                                                    {r.price_ex_gst != null ? r.price_ex_gst.toFixed(2) : "—"}
                                                </TableCell>
                                                <TableCell>{r.effective_from ?? "—"}</TableCell>
                                            </TableRow>
                                        ))}

                                    {loading && (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                                                Loading…
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">
                            {total != null
                                ? `Showing ${(rows.length && (page - 1) * PAGE_SIZE + 1) || 0}-${(page - 1) * PAGE_SIZE + rows.length} of ${total}`
                                : "—"}
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page <= 1 || loading}
                            >
                                Previous
                            </Button>
                            <div className="px-2 text-sm">
                                Page {page} / {totalPages}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={page >= totalPages || loading}
                            >
                                Next
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
