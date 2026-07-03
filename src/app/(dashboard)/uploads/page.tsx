"use client";

import * as React from "react";
import Papa from "papaparse";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase";
import { normalizeKey, toPriceOrZero } from "@/lib/normalize";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

const UNMAPPED = "__UNMAPPED__";
const CHUNK_SIZE = 1000;

type Supplier = { supplier_id: number; name: string };

type Canonical =
    | "supplier_sku"
    | "brand"
    | "mpn"
    | "description"
    | "price_ex_gst";

const CANONICAL_FIELDS: { value: Canonical; label: string; required: boolean }[] = [
    { value: "supplier_sku", label: "Supplier SKU", required: true },
    { value: "mpn", label: "Manufacturer Part Number (optional)", required: false },
    { value: "description", label: "Product Description", required: true },
    { value: "price_ex_gst", label: "Price ex GST", required: true },
    { value: "brand", label: "Brand (optional - defaults to supplier name)", required: false },
];

// pretty ms → "2m 20s" or "41s"
function fmtDuration(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return "-";
    const s = Math.round(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

type Row = Record<string, string>;
type MappingState = Partial<Record<Canonical, string>>;

// safe header option type
type HeaderOpt = { key: string; label: string; value: string };

type StagingRow = {
    upload_id: number;
    supplier_id: number;
    supplier_sku: string;
    supplier_description: string | null;
    brand: string | null;
    mpn: string | null;
    price_ex_gst: number;
    effective_from: string;
    is_active: boolean;
};

async function sha256Hex(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const digest = await window.crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

export default function Page() {
    const [sb, setSb] = React.useState<SupabaseClient | null>(null);
    React.useEffect(() => {
        setSb(supabaseBrowser());
    }, []);

    // suppliers
    const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
    const [suppliersLoading, setSuppliersLoading] = React.useState(false);
    const [selectedSupplierId, setSelectedSupplierId] = React.useState<number | null>(null);

    // inline create supplier
    const [showCreate, setShowCreate] = React.useState(false);
    const [newSupplierName, setNewSupplierName] = React.useState("");
    const [creatingSupplier, setCreatingSupplier] = React.useState(false);

    // csv - the file is parsed ONCE and all rows are kept in memory
    const [file, setFile] = React.useState<File | null>(null);
    const [fileName, setFileName] = React.useState<string>("");
    const [headers, setHeaders] = React.useState<string[]>([]);
    const [allRows, setAllRows] = React.useState<Row[]>([]);
    const [previewLimit, setPreviewLimit] = React.useState<number>(100);

    // mapping (canonical -> csv header STRING)
    const [mapping, setMapping] = React.useState<MappingState>({});
    const [submitting, setSubmitting] = React.useState(false);

    // effective date (global) - default = today
    const today = React.useMemo(() => {
        const t = new Date();
        const y = t.getFullYear();
        const m = String(t.getMonth() + 1).padStart(2, "0");
        const d = String(t.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }, []);
    const [effectiveDate, setEffectiveDate] = React.useState<string>(today);

    // progress UI state
    const [progressLabel, setProgressLabel] = React.useState<string>("");
    const [totalBatches, setTotalBatches] = React.useState<number | null>(null);
    const [currentBatch, setCurrentBatch] = React.useState<number>(0);
    const [elapsedMs, setElapsedMs] = React.useState<number>(0);
    const [skippedRows, setSkippedRows] = React.useState<number>(0);

    // load suppliers
    React.useEffect(() => {
        if (!sb) return;
        (async () => {
            setSuppliersLoading(true);
            const { data, error } = await sb
                .from("supplier")
                .select("supplier_id, name")
                .order("name", { ascending: true });
            if (!error && data) setSuppliers(data as Supplier[]);
            setSuppliersLoading(false);
        })();
    }, [sb]);

    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setFile(f);
        setFileName(f.name);
        setHeaders([]);
        setAllRows([]);
        setMapping({});

        Papa.parse<Row>(f, {
            header: true,
            dynamicTyping: false,
            skipEmptyLines: "greedy",
            worker: true,
            complete: (res) => {
                const rows = res.data.filter((r) => r && Object.keys(r).length);
                setHeaders(res.meta.fields ?? Object.keys(rows[0] ?? {}));
                setAllRows(rows);
            },
            error: (err) => alert(`Parse error: ${err.message}`),
        });
    };

    const rowsPreview = React.useMemo(
        () => allRows.slice(0, previewLimit),
        [allRows, previewLimit]
    );

    // safe header options
    const headerOpts = React.useMemo<HeaderOpt[]>(() => {
        return headers.map((h, idx) => {
            const value = String(h ?? "");
            const isEmpty = value.trim() === "";
            return {
                key: isEmpty ? `__EMPTY__${idx}` : `H_${idx}`,
                label: isEmpty ? `(Empty header #${idx + 1})` : value,
                value,
            };
        });
    }, [headers]);

    const keyToValue = React.useMemo(() => {
        const m = new Map<string, string>();
        headerOpts.forEach((o) => m.set(o.key, o.value));
        return m;
    }, [headerOpts]);

    const valueToKey = React.useMemo(() => {
        const m = new Map<string, string>();
        for (const o of headerOpts) {
            if (!m.has(o.value)) m.set(o.value, o.key);
        }
        return m;
    }, [headerOpts]);

    // map canonical using UI key -> real header value
    const onMapCanonical = (canonical: Canonical, keyOrSentinel: string) => {
        setMapping((cur) => {
            if (keyOrSentinel === UNMAPPED) {
                const next = { ...cur };
                delete next[canonical];
                return next;
            }
            const actual = keyToValue.get(keyOrSentinel);
            return { ...cur, [canonical]: actual };
        });
    };

    const selectedSupplier = React.useMemo(
        () => suppliers.find((s) => s.supplier_id === selectedSupplierId) || null,
        [suppliers, selectedSupplierId]
    );

    async function handleCreateSupplier() {
        if (!sb) return;
        const name = newSupplierName.trim();
        if (!name) return;
        setCreatingSupplier(true);
        const { data, error } = await sb
            .from("supplier")
            .insert({ name, is_active: true })
            .select("supplier_id, name")
            .single();
        setCreatingSupplier(false);
        if (error) return alert(error.message);
        setSuppliers(prev => [...prev, data as Supplier].sort((a,b)=>a.name.localeCompare(b.name)));
        setSelectedSupplierId((data as Supplier).supplier_id);
        setNewSupplierName("");
        setShowCreate(false);
    }

    // Port of the old edge-function row normalization, now done in-browser.
    function buildStagingRows(uploadId: number, supplierId: number, supplierName: string) {
        const rows: StagingRow[] = [];
        let skipped = 0;

        const skuH = mapping.supplier_sku;
        const mpnH = mapping.mpn;
        const descH = mapping.description;
        const priceH = mapping.price_ex_gst;
        const brandH = mapping.brand;

        for (const r of allRows) {
            const mpnNorm = normalizeKey(mpnH ? r[mpnH] : null);

            let skuRaw = skuH ? String(r[skuH] ?? "").trim() : "";
            if (!skuRaw && mpnNorm) skuRaw = mpnNorm;
            const sku = normalizeKey(skuRaw).toUpperCase();
            if (!sku) {
                skipped++;
                continue;
            }

            const desc = descH ? String(r[descH] ?? "").trim() : "";
            const brandRaw = brandH ? String(r[brandH] ?? "").trim() : "";

            rows.push({
                upload_id: uploadId,
                supplier_id: supplierId,
                supplier_sku: sku,
                supplier_description: desc ? desc.toUpperCase() : null,
                brand: brandRaw || supplierName,
                mpn: mpnNorm || null,
                price_ex_gst: toPriceOrZero(priceH ? r[priceH] : null),
                effective_from: effectiveDate,
                is_active: true,
            });
        }

        return { rows, skipped };
    }

    const handleSubmit = async () => {
        try {
            if (!sb) return;
            if (!file) return alert("Choose a CSV file");
            if (!selectedSupplierId || !selectedSupplier) return alert("Select a supplier");
            if (!effectiveDate) return alert("Please pick an effective date.");
            if (!allRows.length) return alert("The CSV appears to have no data rows.");

            // validate required canonicals are mapped
            const missingRequired = CANONICAL_FIELDS
                .filter((c) => c.required)
                .filter((c) => !mapping[c.value]);
            if (missingRequired.length) {
                return alert(
                    `Please map required fields: ${missingRequired.map((m) => m.label).join(", ")}`
                );
            }

            setSubmitting(true);
            setTotalBatches(null);
            setCurrentBatch(0);
            setElapsedMs(0);
            setSkippedRows(0);
            const startedAt = Date.now();

            // 1) hash & archive the file in storage
            setProgressLabel("Uploading file…");
            const sha256 = await sha256Hex(file);
            const storagePath = `${selectedSupplierId}/${sha256}.csv`;
            const { error: upErr } = await sb.storage
                .from("price_uploads")
                .upload(storagePath, file, { upsert: true, contentType: "text/csv" });
            if (upErr) throw upErr;

            // 2) create (or reuse, for a re-upload of the same file) the upload row
            const { data: uploadRow, error: insErr } = await sb
                .from("upload")
                .upsert(
                    {
                        supplier_id: selectedSupplierId,
                        filename: file.name,
                        sha256,
                        parsed_ok: false,
                        row_count: allRows.length,
                    },
                    { onConflict: "supplier_id,sha256" }
                )
                .select("upload_id")
                .single();
            if (insErr) throw insErr;
            const uploadId = (uploadRow as { upload_id: number }).upload_id;

            // 3) normalize rows locally and stage them in chunks
            const { rows: stagingRows, skipped } = buildStagingRows(
                uploadId,
                selectedSupplierId,
                selectedSupplier.name
            );
            setSkippedRows(skipped);
            if (!stagingRows.length) throw new Error("No valid rows to ingest (every row is missing a SKU).");

            // clear any leftovers from a previously failed attempt
            const { error: clearErr } = await sb
                .from("ingest_staging")
                .delete()
                .eq("upload_id", uploadId);
            if (clearErr) throw clearErr;

            const batches = Math.ceil(stagingRows.length / CHUNK_SIZE);
            setTotalBatches(batches);

            for (let i = 0; i < batches; i++) {
                setProgressLabel(`Staging rows (batch ${i + 1} of ${batches})…`);
                const chunk = stagingRows.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                const { error: stErr } = await sb.from("ingest_staging").insert(chunk);
                if (stErr) throw stErr;
                setCurrentBatch(i + 1);
                setElapsedMs(Date.now() - startedAt);
            }

            // 4) atomic swap: delete old catalogue + insert staged rows in one transaction
            setProgressLabel("Finalizing (atomic swap)…");
            const { data: result, error: finErr } = await sb.rpc("finalize_ingest", {
                p_upload_id: uploadId,
            });
            if (finErr) throw finErr;

            setElapsedMs(Date.now() - startedAt);
            setProgressLabel("Done");
            const inserted = (result as { inserted?: number })?.inserted ?? stagingRows.length;
            alert(
                `Ingest completed for "${selectedSupplier.name}": ${inserted.toLocaleString()} items` +
                (skipped ? ` (${skipped.toLocaleString()} rows skipped - no SKU)` : "")
            );
        } catch (e: unknown) {
            console.error(e);
            setProgressLabel("Failed");
            const msg = e instanceof Error ? e.message : "Something went wrong";
            alert(msg);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="p-4 md:p-6 lg:p-8 space-y-4">
            <PageHeader
                title="New Upload"
                subtitle="Map columns and ingest your price list."
            />

            <Card>
                <CardContent className="p-5 space-y-6">
                    {/* Supplier picker + create */}
                    <div className="space-y-2">
                        <Label>Supplier</Label>
                        <div className="flex flex-wrap items-end gap-2">
                            <Select
                                value={selectedSupplierId ? String(selectedSupplierId) : ""}
                                onValueChange={(v) => setSelectedSupplierId(Number(v))}
                                disabled={suppliersLoading}
                            >
                                <SelectTrigger className="w-80">
                                    <SelectValue placeholder={suppliersLoading ? "Loading…" : "Select supplier"} />
                                </SelectTrigger>
                                <SelectContent className="bg-white text-foreground border shadow-md">
                                    {suppliers.map((s) => (
                                        <SelectItem key={s.supplier_id} value={String(s.supplier_id)}>
                                            {s.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Button variant="outline" onClick={() => setShowCreate((x) => !x)}>
                                {showCreate ? "Cancel" : "New supplier"}
                            </Button>
                        </div>

                        {showCreate && (
                            <div className="mt-3 grid items-end gap-2 md:grid-cols-[1fr_auto]">
                                <div className="space-y-2">
                                    <Label htmlFor="supplier_name">New supplier name</Label>
                                    <Input
                                        id="supplier_name"
                                        placeholder="e.g., Amber Technology"
                                        value={newSupplierName}
                                        onChange={(e) => setNewSupplierName(e.target.value)}
                                    />
                                </div>
                                <Button onClick={handleCreateSupplier} disabled={creatingSupplier || !newSupplierName.trim()}>
                                    {creatingSupplier ? "Creating…" : "Create"}
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* CSV file */}
                    <div className="space-y-2">
                        <Label htmlFor="csv">CSV File</Label>
                        <Input id="csv" type="file" accept=".csv,text/csv" onChange={onFileChange} />
                        {fileName && (
                            <p className="text-sm text-muted-foreground">
                                Loaded: {fileName} - Parsed rows: {allRows.length.toLocaleString()}
                            </p>
                        )}
                    </div>

                    {/* Effective Date (global) */}
                    <div className="space-y-2">
                        <Label htmlFor="effdate">Effective date</Label>
                        <Input
                            id="effdate"
                            type="date"
                            value={effectiveDate}
                            onChange={(e) => setEffectiveDate(e.target.value)}
                            className="w-60"
                        />
                        <p className="text-xs text-muted-foreground">
                            Applies to all rows in this upload. Defaults to today.
                        </p>
                    </div>

                    {/* Mapping UI: canonical -> CSV header */}
                    {headers.length > 0 && (
                        <div className="space-y-3">
                            <Label>Map canonical fields to CSV headers</Label>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                {CANONICAL_FIELDS.map((c) => (
                                    <div key={c.value} className="flex items-center gap-3">
                    <span className="min-w-0 grow truncate text-sm">
                      {c.label} {c.required ? <span className="text-red-600">*</span> : null}
                    </span>
                                        <Select
                                            value={
                                                mapping[c.value] != null
                                                    ? valueToKey.get(String(mapping[c.value])) ?? UNMAPPED
                                                    : UNMAPPED
                                            }
                                            onValueChange={(v) => onMapCanonical(c.value, v)}
                                        >
                                            <SelectTrigger className="w-72">
                                                <SelectValue placeholder="Unmapped" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white text-foreground border">
                                                <SelectItem value={UNMAPPED}>Unmapped</SelectItem>
                                                {headerOpts.map((o) => (
                                                    <SelectItem key={o.key} value={o.key}>
                                                        {o.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ))}
                            </div>

                            {headerOpts.some((o) => o.value.trim() === "") && (
                                <p className="text-xs text-amber-600">
                                    This CSV contains one or more empty header cells. They appear as “(Empty header #N)”.
                                </p>
                            )}

                            <p className="text-xs text-muted-foreground">
                                Brand can be left unmapped; it defaults to the supplier name.
                            </p>
                        </div>
                    )}

                    {/* CSV preview table */}
                    {headers.length > 0 && rowsPreview.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label>
                                    CSV Preview (first {rowsPreview.length} of {allRows.length.toLocaleString()} rows)
                                </Label>
                                <div className="flex items-center gap-2">
                                    <Label htmlFor="limit" className="text-xs text-muted-foreground">
                                        Rows to preview
                                    </Label>
                                    <Input
                                        id="limit"
                                        type="number"
                                        value={previewLimit}
                                        min={10}
                                        max={5000}
                                        className="h-8 w-24"
                                        onChange={(e) => {
                                            const v = Math.max(10, Math.min(5000, Number(e.target.value || 100)));
                                            setPreviewLimit(v);
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="rounded-xl border bg-card overflow-hidden">
                                <div className="overflow-x-auto">
                                    <Table className="w-full min-w-[1200px] text-[15px] md:text-base">
                                        <TableHeader>
                                            <TableRow className="h-12">
                                                {headers.map((h, i) => (
                                                    <TableHead key={`th-${i}`} className="px-4 whitespace-nowrap">
                                                        {String(h ?? "")}
                                                    </TableHead>
                                                ))}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody className="[&>tr]:h-12 [&>tr>td]:py-3 [&>tr>td]:px-4 [&>tr>td]:whitespace-nowrap">
                                            {rowsPreview.map((row, ridx) => (
                                                <TableRow key={`r-${ridx}`}>
                                                    {headers.map((h, cidx) => (
                                                        <TableCell key={`td-${ridx}-${cidx}`}>
                                                            {String(row[h] ?? "")}
                                                        </TableCell>
                                                    ))}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Live progress */}
                    {(submitting || totalBatches !== null) && (
                        <div className="space-y-2 rounded-md border p-4">
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-medium">{progressLabel || "Working…"}</div>
                                <div className="text-xs text-muted-foreground">
                                    {totalBatches != null
                                        ? `${currentBatch} / ${totalBatches} batches · ${CHUNK_SIZE.toLocaleString()} rows per batch`
                                        : "-"}
                                </div>
                            </div>

                            <div className="h-2 w-full rounded bg-muted">
                                <div
                                    className="h-2 rounded bg-primary transition-all"
                                    style={{
                                        width:
                                            totalBatches != null && totalBatches > 0
                                                ? `${Math.min(100, (currentBatch / totalBatches) * 100)}%`
                                                : "0%",
                                    }}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="space-y-0.5">
                                    <div className="text-muted-foreground">Elapsed</div>
                                    <div className="font-medium">{fmtDuration(elapsedMs)}</div>
                                </div>
                                <div className="space-y-0.5">
                                    <div className="text-muted-foreground">Rows skipped (no SKU)</div>
                                    <div className="font-medium">{skippedRows.toLocaleString()}</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Submit */}
                    {headers.length > 0 && (
                        <Button onClick={handleSubmit} disabled={submitting || !selectedSupplierId}>
                            {submitting ? "Submitting…" : "Save mapping & ingest"}
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
