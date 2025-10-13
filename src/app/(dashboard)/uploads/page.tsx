"use client";

import * as React from "react";
import Papa from "papaparse";
import { supabase } from "@/lib/supabase";
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

type Supplier = { supplier_id: number; name: string };

type Canonical =
    | "supplier_sku"
    | "brand"
    | "mpn"
    | "description"
    | "price_ex_gst"
    | "uom"
    | "pack_size";

const CANONICAL_FIELDS: { value: Canonical; label: string; required: boolean }[] = [
    { value: "supplier_sku", label: "Supplier SKU", required: true },
    { value: "mpn", label: "Manufacturer Part Number", required: true },
    { value: "description", label: "Product Description", required: true },
    { value: "price_ex_gst", label: "Price ex GST", required: true },
    { value: "brand", label: "Brand (optional — defaults to supplier name)", required: false },
    { value: "uom", label: "Unit of Measure (optional)", required: false },
    { value: "pack_size", label: "Pack Size (optional)", required: false },
];

// yyyy-mm-dd (from <input type="date">) → dd-mm-yyyy for backend
function ymdToDmy(ymd: string): string {
    const [y, m, d] = ymd.split("-");
    return `${d}-${m}-${y}`;
}

// pretty ms → "2m 20s" or "41s"
function fmtDuration(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return "—";
    const s = Math.round(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

type Row = Record<string, unknown>;
type MappingState = Partial<Record<Canonical, string>>;

// safe header option type
type HeaderOpt = { key: string; label: string; value: string };

async function sha256Hex(file: File): Promise<string> {
    const subtle = typeof window !== "undefined" ? window.crypto?.subtle : undefined;

    if (subtle) {
        const buf = await file.arrayBuffer();
        const digest = await subtle.digest("SHA-256", buf);
        return Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    }

    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/hash", { method: "POST", body: fd });
    if (!res.ok) throw new Error("Failed to hash file");
    const { hex } = await res.json();
    return hex as string;
}

export default function Page() {
    // suppliers
    const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
    const [suppliersLoading, setSuppliersLoading] = React.useState(false);
    const [selectedSupplierId, setSelectedSupplierId] = React.useState<number | null>(null);

    // inline create supplier
    const [showCreate, setShowCreate] = React.useState(false);
    const [newSupplierName, setNewSupplierName] = React.useState("");
    const [creatingSupplier, setCreatingSupplier] = React.useState(false);

    // csv
    const [file, setFile] = React.useState<File | null>(null);
    const [fileName, setFileName] = React.useState<string>("");
    const [headers, setHeaders] = React.useState<string[]>([]);
    const [rowsPreview, setRowsPreview] = React.useState<Row[]>([]);
    const [totalParsed, setTotalParsed] = React.useState<number>(0);
    const [previewLimit, setPreviewLimit] = React.useState<number>(100);

    // mapping (canonical -> csv header STRING)
    const [mapping, setMapping] = React.useState<MappingState>({});
    const [submitting, setSubmitting] = React.useState(false);

    // effective date (global) — default = today
    const today = React.useMemo(() => {
        const t = new Date();
        const y = t.getFullYear();
        const m = String(t.getMonth() + 1).padStart(2, "0");
        const d = String(t.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }, []);
    const [effectiveDateYMD, setEffectiveDateYMD] = React.useState<string>(today);

    // progress UI state
    const [limitPerBatch] = React.useState(70);
    const [totalRowsServer, setTotalRowsServer] = React.useState<number | null>(null);
    const [totalBatches, setTotalBatches] = React.useState<number | null>(null);
    const [currentBatch, setCurrentBatch] = React.useState<number>(0);
    const [elapsedMs, setElapsedMs] = React.useState<number>(0);
    const [lastBatchMs, setLastBatchMs] = React.useState<number>(0);
    const [avgBatchMs, setAvgBatchMs] = React.useState<number>(0);
    const [etaMs, setEtaMs] = React.useState<number | null>(null);

    // load suppliers
    React.useEffect(() => {
        (async () => {
            setSuppliersLoading(true);
            const { data, error } = await supabase
                .from("supplier")
                .select("supplier_id, name")
                .order("name", { ascending: true });
            if (!error && data) setSuppliers(data as Supplier[]);
            setSuppliersLoading(false);
        })();
    }, []);

    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setFile(f);
        setFileName(f.name);

        // Parse entire CSV but only keep first N rows for preview
        const preview: Row[] = [];
        let count = 0;
        setHeaders([]);
        Papa.parse<Row>(f, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: "greedy",
            worker: true,
            chunkSize: 1024 * 512,
            chunk: (res: Papa.ParseResult<Row>) => {
                if (!headers.length) {
                    const hdrs = res.meta.fields ?? Object.keys(res.data[0] ?? {});
                    setHeaders(hdrs);
                    // initialize mapping to "unmapped" for all canonicals
                    const init: MappingState = {};
                    setMapping(init);
                }
                for (const r of res.data) {
                    count++;
                    if (preview.length < previewLimit) preview.push(r);
                }
            },
            complete: () => {
                setRowsPreview(preview);
                setTotalParsed(count);
            },
            error: (err) => alert(`Parse error: ${err.message}`),
        });
    };

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
        const name = newSupplierName.trim();
        if (!name) return;
        setCreatingSupplier(true);
        const { data, error } = await supabase
            .from("supplier")
            .insert({ name, is_active: true })
            .select("supplier_id, name")
            .single();
        setCreatingSupplier(false);
        if (error) {
            alert(error.message);
            return;
        }
        setSuppliers((prev) =>
            [...prev, data as Supplier].sort((a, b) => a.name.localeCompare(b.name))
        );
        setSelectedSupplierId((data as Supplier).supplier_id);
        setNewSupplierName("");
        setShowCreate(false);
    }

    const handleSubmit = async () => {
        try {
            if (!file) return alert("Choose a CSV file");
            if (!selectedSupplierId) return alert("Select a supplier");
            if (!effectiveDateYMD) return alert("Please pick an effective date.");

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

            // 1) hash & upload file
            const sha256 = await sha256Hex(file);
            const storagePath = `${selectedSupplierId}/${sha256}.csv`;
            const { error: upErr } = await supabase.storage
                .from("price_uploads")
                .upload(storagePath, file, { upsert: true, contentType: "text/csv" });
            if (upErr) throw upErr;

            // 2) create upload row
            const { data: uploadRow, error: insErr } = await supabase
                .from("upload")
                .insert({
                    supplier_id: selectedSupplierId,
                    filename: file.name,
                    sha256,
                    parsed_ok: false,
                })
                .select("*")
                .single();
            if (insErr) throw insErr;

            // --- BUILD WIRE MAPPING (only mapped canonicals go over the wire) ---
            const wireMapping: Partial<Record<Canonical, string>> = {};
            (Object.keys(mapping) as Canonical[]).forEach((k) => {
                const v = mapping[k];
                if (v != null && v !== "") wireMapping[k] = v;
            });

            // 3) trigger ingestion in CHUNKS (70) with live progress
            const effective_date_ddmmyyyy = ymdToDmy(effectiveDateYMD);

            // reset progress state (UI)
            setCurrentBatch(0);
            setElapsedMs(0);
            setLastBatchMs(0);
            setAvgBatchMs(0);
            setEtaMs(null);
            setTotalRowsServer(null);
            setTotalBatches(null);

            const startedAt = Date.now();
            let nextOffset: number | null = 0;
            let completedBatches = 0;

            // locals
            let localTotalRows: number | null = null;
            let localTotalBatches: number | null = null;
            let localAvgMs = 0;

            async function callChunk(offset: number) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 140_000);

                try {
                    const resp = await fetch("/api/ingest", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        signal: controller.signal,
                        body: JSON.stringify({
                            upload_id: uploadRow.upload_id,
                            effective_date_ddmmyyyy,
                            offset,
                            limit: limitPerBatch,
                            mapping: wireMapping, // <-- SEND MAPPING TO EDGE FUNCTION
                        }),
                    });

                    const text = await resp.text();
                    let json: any = text;
                    try {
                        json = JSON.parse(text);
                    } catch {}

                    if (!resp.ok) {
                        throw new Error(typeof json === "string" ? json : JSON.stringify(json));
                    }
                    return json as {
                        ok: true;
                        processed: number;
                        nextOffset: number | null;
                        totalRows: number;
                        done: boolean;
                    };
                } finally {
                    clearTimeout(timeoutId);
                }
            }

            while (nextOffset !== null) {
                const batchStart = Date.now();

                let res;
                try {
                    res = await callChunk(nextOffset);
                } catch {
                    // retry once
                    await new Promise((r) => setTimeout(r, 800));
                    res = await callChunk(nextOffset);
                }

                if (localTotalRows == null && typeof res.totalRows === "number") {
                    localTotalRows = res.totalRows;
                    localTotalBatches = Math.max(1, Math.ceil(localTotalRows / limitPerBatch));
                    setTotalRowsServer(localTotalRows);
                    setTotalBatches(localTotalBatches);
                }

                nextOffset = res.done ? null : res.nextOffset;

                const thisBatchMs = Date.now() - batchStart;
                completedBatches += 1;

                const totalElapsed = Date.now() - startedAt;
                localAvgMs = Math.round(totalElapsed / completedBatches);
                const remainingBatches =
                    localTotalBatches != null ? Math.max(0, localTotalBatches - completedBatches) : null;
                const localEta = remainingBatches != null ? remainingBatches * localAvgMs : null;

                setCurrentBatch(completedBatches - 1);
                setLastBatchMs(thisBatchMs);
                setElapsedMs(totalElapsed);
                setAvgBatchMs(localAvgMs);
                setEtaMs(localEta);

                await new Promise((r) => setTimeout(r, 0));
            }

            alert(`Upload saved for supplier "${selectedSupplier?.name}". Ingest completed.`);
        } catch (e: unknown) {
            console.error(e);
            const msg = e instanceof Error ? e.message : "Something went wrong";
            alert(msg);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        /* Full-width like Items (no max-w) */
        <div className="p-4 md:p-6 lg:p-8 space-y-4">
            {/* Removed breadcrumbs prop */}
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
                                Loaded: {fileName} — Parsed rows: {totalParsed.toLocaleString()}
                            </p>
                        )}
                    </div>

                    {/* Effective Date (global) */}
                    <div className="space-y-2">
                        <Label htmlFor="effdate">Effective date</Label>
                        <Input
                            id="effdate"
                            type="date"
                            value={effectiveDateYMD}
                            onChange={(e) => setEffectiveDateYMD(e.target.value)}
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
                                                <SelectValue placeholder="— Unmapped —" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white text-foreground border">
                                                <SelectItem value={UNMAPPED}>— Unmapped —</SelectItem>
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
                                Brand can be left unmapped; the backend will default it to the supplier name.
                            </p>
                        </div>
                    )}

                    {/* CSV preview table (full-width, larger) */}
                    {headers.length > 0 && rowsPreview.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label>
                                    CSV Preview (first {rowsPreview.length} of {totalParsed.toLocaleString()} rows)
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
                                            if (file) {
                                                const evt = { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>;
                                                onFileChange(evt);
                                            }
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
                                                            {String((row[h] ?? "") as unknown)}
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
                    {(submitting || totalRowsServer !== null) && (
                        <div className="space-y-2 rounded-md border p-4">
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-medium">
                                    {totalBatches != null ? (
                                        <>Batch {Math.min(currentBatch + 1, totalBatches)} / {totalBatches}</>
                                    ) : (
                                        <>Calculating batches…</>
                                    )}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {totalRowsServer != null
                                        ? `${totalRowsServer.toLocaleString()} rows · ${limitPerBatch} per batch`
                                        : "—"}
                                </div>
                            </div>

                            <div className="h-2 w-full rounded bg-muted">
                                <div
                                    className="h-2 rounded bg-primary transition-all"
                                    style={{
                                        width:
                                            totalBatches != null
                                                ? `${Math.min(100, ((currentBatch + 1) / totalBatches) * 100)}%`
                                                : "0%",
                                    }}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="space-y-0.5">
                                    <div className="text-muted-foreground">Last batch</div>
                                    <div className="font-medium">{fmtDuration(lastBatchMs)}</div>
                                </div>
                                <div className="space-y-0.5">
                                    <div className="text-muted-foreground">Avg / batch</div>
                                    <div className="font-medium">{fmtDuration(avgBatchMs)}</div>
                                </div>
                                <div className="space-y-0.5">
                                    <div className="text-muted-foreground">Elapsed</div>
                                    <div className="font-medium">{fmtDuration(elapsedMs)}</div>
                                </div>
                                <div className="space-y-0.5">
                                    <div className="text-muted-foreground">ETA</div>
                                    <div className="font-medium">{etaMs == null ? "—" : fmtDuration(etaMs)}</div>
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
