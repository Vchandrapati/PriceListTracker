"use client";

import * as React from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type Supplier = { supplier_id: number; name: string };
type Brand = { brand_id: number; name: string };
const ALL = "__ALL__";

type ItemRow = {
  supplier_product_id: number;
  supplier_id: number;
  supplier_name: string;
  brand_id: number | null;
  brand_name: string | null;
  catalog_product_id: number;
  mpn: string | null;
  catalog_description: string | null;
  supplier_sku: string | null;
  supplier_description: string | null;
  uom: string;
  pack_size: number;
  latest_price_ex_gst: number | null;
  latest_effective: string | null; // e.g. "[2025-01-01,)"
};

const PAGE_SIZE = 50;

export default function ItemsPage() {
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [brands, setBrands] = React.useState<Brand[]>([]);
  const [supplierId, setSupplierId] = React.useState<string>("");
  const [brandId, setBrandId] = React.useState<string>("");
  const [search, setSearch] = React.useState<string>("");

  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState<number | null>(null);

  const [rows, setRows] = React.useState<ItemRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  // load filter options
  React.useEffect(() => {
    (async () => {
      const [{ data: sup }, { data: br }] = await Promise.all([
        supabase.from("supplier").select("supplier_id,name").order("name"),
        supabase.from("brand").select("brand_id,name").order("name"),
      ]);
      setSuppliers((sup ?? []) as Supplier[]);
      setBrands((br ?? []) as Brand[]);
    })();
  }, []);

  // debounce search
  const [searchDeb, setSearchDeb] = React.useState(search);
  React.useEffect(() => {
    const t = setTimeout(() => setSearchDeb(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // clear table immediately when filters change
  React.useEffect(() => {
    setPage(1);
    setRows([]);
    setTotal(null);
  }, [supplierId, brandId, searchDeb]);

  const fetchItems = React.useCallback(async () => {
    setLoading(true);
    setRows([]);
    setTotal(null);

    // NEW: build the select string conditionally.
    // When a brand is chosen, use !inner joins so rows with no brand/mpn are omitted.
    const selectCols = `
    supplier_product_id,
    supplier_id,
    supplier:supplier_id(name),
    ${brandId ? "catalog_product:catalog_product_id!inner(" : "catalog_product:catalog_product_id("}
      catalog_product_id,
      mpn,
      description,
      ${brandId ? "brand:brand_id!inner(brand_id,name)" : "brand:brand_id(brand_id,name)"}
    ),
    supplier_sku,
    supplier_description,
    uom,
    pack_size,
    price_history:price_history(
      price_id,
      price_ex_gst,
      effective
    )
  `;

    let query = supabase
        .from("supplier_product")
        // CHANGED: use the selectCols string instead of the inline select
        .select(selectCols, { count: "exact" })
        .order("price_id", { foreignTable: "price_history", ascending: false })
        .limit(1, { foreignTable: "price_history" });

    if (supplierId) query = query.eq("supplier_id", Number(supplierId));
    if (brandId) {
      // keep the brand filter; inner join already removes null/mismatched rows
      query = query.eq("catalog_product.brand_id", Number(brandId));
    }

    if (searchDeb) {
      const like = `%${searchDeb}%`;
      query = query.or(
          [
            `supplier_sku.ilike.${like}`,
            `supplier_description.ilike.${like}`,
            `catalog_product.mpn.ilike.${like}`,
            `catalog_product.description.ilike.${like}`,
          ].join(",")
      );
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

    const shaped: ItemRow[] = (data ?? []).map((r: any) => {
      const ph = (r.price_history ?? [])[0] ?? null;
      return {
        supplier_product_id: r.supplier_product_id,
        supplier_id: r.supplier_id,
        supplier_name: r.supplier?.name ?? "",
        brand_id: r.catalog_product?.brand?.brand_id ?? null,
        brand_name: r.catalog_product?.brand?.name ?? null,
        catalog_product_id: r.catalog_product?.catalog_product_id ?? 0,
        mpn: r.catalog_product?.mpn ?? null,
        catalog_description: r.catalog_product?.description ?? null,
        supplier_sku: r.supplier_sku ?? null,
        supplier_description: r.supplier_description ?? null,
        uom: r.uom ?? "ea",
        pack_size: r.pack_size ?? 1,
        latest_price_ex_gst: ph?.price_ex_gst ?? null,
        latest_effective: ph?.effective ?? null,
      };
    });

    setRows(shaped);
    setTotal(count ?? 0);
    setLoading(false);
  }, [supplierId, brandId, searchDeb, page]);

  React.useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const totalPages = Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-7xl p-6 space-y-6">
      <PageHeader
          title="Items"
          description="Search by supplier, manufacturer, or text."
          breadcrumbs={[
            { href: "/", label: "Home" },
            { label: "Items" },
          ]}
      />
      <Card>
        <CardContent className="p-6 space-y-4">
          {/* Filters */}
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label>Supplier</Label>
              <Select
                value={supplierId || ALL}
                onValueChange={(v) => setSupplierId(v === ALL ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All suppliers" />
                </SelectTrigger>
                <SelectContent>
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
              <Label>Manufacturer</Label>
              <Select
                value={brandId || ALL}
                onValueChange={(v) => setBrandId(v === ALL ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All manufacturers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All manufacturers</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.brand_id} value={String(b.brand_id)}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label>Search</Label>
              <Input
                placeholder="SKU, MPN, description…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Table */}
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>MPN</TableHead>
                  <TableHead>Supplier SKU</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Price ex GST</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Pack</TableHead>
                  <TableHead>Effective</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                      No items found.
                    </TableCell>
                  </TableRow>
                )}

                {!loading &&
                  rows.map((r) => (
                    <TableRow key={r.supplier_product_id}>
                      <TableCell className="whitespace-nowrap">{r.supplier_name}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.brand_name ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.mpn ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.supplier_sku ?? "—"}</TableCell>
                      <TableCell className="max-w-[480px] truncate">
                        {r.supplier_description || r.catalog_description || "—"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {r.latest_price_ex_gst != null ? r.latest_price_ex_gst.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{r.uom}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.pack_size}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.latest_effective ?? "—"}</TableCell>
                    </TableRow>
                  ))}

                {loading && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
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
              <div className="px-2 text-sm">Page {page} / {Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE))}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE)), p + 1))}
                disabled={page >= Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE)) || loading}
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
