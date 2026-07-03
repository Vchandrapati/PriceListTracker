"use client";

import * as React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

// One row per job: quoted vs actual labour and the P/L impact. Fed by the
// labour_dashboard_jobs table, pushed from the DataPipeline simPRO sync.

type Kind = "text" | "int" | "hours" | "pct" | "money";

type Column = { key: keyof JobRow; label: string; kind: Kind; signed?: boolean };

type JobRow = {
    job_number: number;
    job_name: string | null;
    salesperson: string | null;
    date_completed: string | null;
    total_project_duration: number | null;
    distinct_contractors: number | null;
    quoted_callout: number | null;
    actual_callout: number | null;
    quoted_field_hours: number | null;
    actual_field_hours: number | null;
    quoted_commissioning: number | null;
    actual_commissioning: number | null;
    quoted_hours: number | null;
    actual_hours: number | null;
    quoting_variance_pct: number | null;
    sell_price_ex_tax: number | null;
    total_cost_quoted: number | null;
    total_cost_actual: number | null;
    nett_pl: number | null;
    adjusted_nett_pl: number | null;
    margin_impact: number | null;
    labour_impact_pct: number | null;
};

const COLUMNS: Column[] = [
    { key: "job_name", label: "Job Name", kind: "text" },
    { key: "salesperson", label: "Salesperson", kind: "text" },
    { key: "date_completed", label: "Date Completed", kind: "text" },
    { key: "total_project_duration", label: "Duration (days)", kind: "int" },
    { key: "distinct_contractors", label: "Contractors", kind: "int" },
    { key: "quoted_callout", label: "Quoted Callout", kind: "hours" },
    { key: "actual_callout", label: "Actual Callout", kind: "hours" },
    { key: "quoted_field_hours", label: "Quoted Field", kind: "hours" },
    { key: "actual_field_hours", label: "Actual Field", kind: "hours" },
    { key: "quoted_commissioning", label: "Quoted Comm.", kind: "hours" },
    { key: "actual_commissioning", label: "Actual Comm.", kind: "hours" },
    { key: "quoted_hours", label: "Quoted Hours", kind: "hours" },
    { key: "actual_hours", label: "Actual Hours", kind: "hours" },
    { key: "quoting_variance_pct", label: "Variance %", kind: "pct", signed: true },
    { key: "sell_price_ex_tax", label: "Sell (ExTax)", kind: "money" },
    { key: "total_cost_quoted", label: "Cost (Quoted)", kind: "money" },
    { key: "total_cost_actual", label: "Cost (Actuals)", kind: "money" },
    { key: "nett_pl", label: "Nett P/L", kind: "money" },
    { key: "adjusted_nett_pl", label: "Adj. Nett P/L", kind: "money" },
    { key: "margin_impact", label: "Margin Impact", kind: "money", signed: true },
    { key: "labour_impact_pct", label: "Labour Impact %", kind: "pct", signed: true },
];

const money = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
});

function formatCell(row: JobRow, col: Column): string {
    const raw = row[col.key];
    if (col.kind === "text") return String(raw ?? "").trim() || "-";
    const n = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    if (n == null) return "-";
    switch (col.kind) {
        case "int":
            return Math.round(n).toLocaleString();
        case "hours":
            return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
        case "pct":
            return `${(n * 100).toFixed(1)}%`;
        case "money":
            return money.format(n);
    }
}

// Positive margin/labour impact = under budget (good); positive quoting
// variance = actual over quoted (bad).
function signedClass(row: JobRow, col: Column): string {
    if (!col.signed) return "";
    const n = row[col.key];
    if (typeof n !== "number" || !Number.isFinite(n) || n === 0) return "";
    const good = col.key === "quoting_variance_pct" ? n < 0 : n > 0;
    return good ? "text-green-600" : "text-red-600";
}

type GroupStats = {
    jobs: number;
    under: number;
    underPct: number | null;
    over: number;
    overPct: number | null;
    grossPL: number;
    labourImpact: number;
    avgLabourImpactPct: number | null;
    portfolioPosition: number;
    quotedHours: number;
    actualHours: number;
    avgVariancePct: number | null;
    calloutEff: number | null;
    fieldEff: number | null;
    commEff: number | null;
    sell: number;
    grossMarginPct: number | null;
};

const fmtPct = (v: number | null, dp = 1) => (v == null ? "-" : `${(v * 100).toFixed(dp)}%`);
const fmtInt = (v: number) => Math.round(v).toLocaleString();

// ▲ (green) = hours saved vs quote; ▼ (red) = hours over quote
function effCell(v: number | null): React.ReactNode {
    if (v == null) return "-";
    const saved = v < 0;
    return (
        <span className={saved ? "text-green-600" : "text-red-600"}>
            {saved ? "▲" : "▼"} {fmtPct(v)}
        </span>
    );
}

function countWithPct(count: number, p: number | null): React.ReactNode {
    return (
        <>
            {fmtInt(count)}
            <span className="ml-2 text-xs text-muted-foreground">{fmtPct(p)}</span>
        </>
    );
}

type StatRow = { label: string; render: (s: GroupStats) => React.ReactNode; note?: string };

const STAT_ROWS: StatRow[] = [
    { label: "Total Jobs Quoted", render: (s) => fmtInt(s.jobs) },
    { label: "Total Jobs Under Budget", render: (s) => countWithPct(s.under, s.underPct) },
    { label: "Total Jobs Over Budget", render: (s) => countWithPct(s.over, s.overPct) },
    { label: "Total Portfolio Gross P/L", render: (s) => money.format(s.grossPL) },
    {
        label: "Total Labour Impact ($)",
        render: (s) => money.format(s.labourImpact),
        note: "Negative indicates cut into gross profit",
    },
    { label: "Average Labour Impact %", render: (s) => fmtPct(s.avgLabourImpactPct) },
    {
        label: "Total Portfolio Position ($)",
        render: (s) => money.format(s.portfolioPosition),
        note: "Portfolio position after accounting for labour changes",
    },
    { label: "Total Quoted Hours", render: (s) => fmtInt(s.quotedHours) },
    { label: "Total Actual Hours", render: (s) => fmtInt(s.actualHours) },
    {
        label: "Average Labour Hour Variance %",
        render: (s) => fmtPct(s.avgVariancePct),
        note: "Negative = overquoted / labour saved. Positive = underquoted / labour over",
    },
    { label: "Callout Efficiency %", render: (s) => effCell(s.calloutEff) },
    { label: "Field Hours Efficiency %", render: (s) => effCell(s.fieldEff) },
    { label: "Commissioning Efficiency %", render: (s) => effCell(s.commEff) },
    { label: "Total Sell Price (ExTax)", render: (s) => money.format(s.sell) },
    { label: "Gross Margin %", render: (s) => fmtPct(s.grossMarginPct) },
];

// date_completed is DD/MM/YYYY text; sortable key = YYYYMMDD
function dateSortKey(d: string | null): string {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((d ?? "").trim());
    return m ? `${m[3]}${m[2]}${m[1]}` : "";
}

export default function LabourDashboardPage() {
    const [sb, setSb] = React.useState<SupabaseClient | null>(null);
    React.useEffect(() => {
        setSb(supabaseBrowser());
    }, []);

    const [rows, setRows] = React.useState<JobRow[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [filter, setFilter] = React.useState("");
    const [sortKey, setSortKey] = React.useState<keyof JobRow>("date_completed");
    const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
    const [syncedAt, setSyncedAt] = React.useState<string | null>(null);

    const onSort = (key: keyof JobRow) => {
        if (key === sortKey) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            // dates and numbers read best newest/biggest first; text A→Z
            const col = COLUMNS.find((c) => c.key === key);
            setSortDir(col?.kind === "text" && key !== "date_completed" ? "asc" : "desc");
        }
    };

    React.useEffect(() => {
        if (!sb) return;
        (async () => {
            setLoading(true);
            setError(null);
            const all: JobRow[] = [];
            const pageSize = 1000;
            for (let from = 0; ; from += pageSize) {
                const { data, error: err } = await sb
                    .from("labour_dashboard_jobs")
                    .select("*")
                    .order("job_number", { ascending: false })
                    .range(from, from + pageSize - 1);
                if (err) {
                    setError(err.message);
                    break;
                }
                const batch = (data ?? []) as JobRow[];
                all.push(...batch);
                if (batch.length < pageSize) break;
            }
            all.sort((a, b) => dateSortKey(b.date_completed).localeCompare(dateSortKey(a.date_completed)));
            setRows(all);
            setLoading(false);

            const { data: sync } = await sb
                .from("pipeline_sync")
                .select("pushed_at")
                .eq("table_name", "labour_dashboard_jobs")
                .order("pushed_at", { ascending: false })
                .limit(1);
            const pushed = (sync ?? [])[0]?.pushed_at as string | undefined;
            if (pushed) setSyncedAt(new Date(pushed).toLocaleString());
        })();
    }, [sb]);

    const visibleRows = React.useMemo(() => {
        const q = filter.trim().toLowerCase();
        const filtered = !q
            ? rows
            : rows.filter(
                (r) =>
                    (r.job_name ?? "").toLowerCase().includes(q) ||
                    (r.salesperson ?? "").toLowerCase().includes(q)
            );

        const dir = sortDir === "asc" ? 1 : -1;
        const sorted = [...filtered].sort((a, b) => {
            const va = a[sortKey];
            const vb = b[sortKey];
            // nulls/blanks always sink to the bottom regardless of direction
            const aEmpty = va == null || va === "";
            const bEmpty = vb == null || vb === "";
            if (aEmpty && bEmpty) return 0;
            if (aEmpty) return 1;
            if (bEmpty) return -1;
            if (sortKey === "date_completed") {
                return dateSortKey(String(va)).localeCompare(dateSortKey(String(vb))) * dir;
            }
            if (typeof va === "number" && typeof vb === "number") {
                return (va - vb) * dir;
            }
            return String(va).localeCompare(String(vb), undefined, { sensitivity: "base" }) * dir;
        });
        return sorted;
    }, [rows, filter, sortKey, sortDir]);

    // Global Statistics: whole portfolio plus one column per salesperson.
    const statsGroups = React.useMemo(() => {
        if (!rows.length) return [];

        const compute = (jobs: JobRow[]) => {
            const sum = (f: (r: JobRow) => number | null) =>
                jobs.reduce((acc, r) => acc + (f(r) ?? 0), 0);
            const mean = (f: (r: JobRow) => number | null) => {
                const vals = jobs.map(f).filter((v): v is number => typeof v === "number");
                return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
            };
            const eff = (q: (r: JobRow) => number | null, a: (r: JobRow) => number | null) => {
                const quoted = sum(q);
                return quoted > 0 ? sum(a) / quoted - 1 : null;
            };

            const jobsN = jobs.length;
            const under = jobs.filter((r) => (r.margin_impact ?? 0) > 0).length;
            const grossPL = sum((r) => r.nett_pl);
            const sell = sum((r) => r.sell_price_ex_tax);
            return {
                jobs: jobsN,
                under,
                underPct: jobsN ? under / jobsN : null,
                over: jobsN - under,
                overPct: jobsN ? (jobsN - under) / jobsN : null,
                grossPL,
                labourImpact: sum((r) => r.margin_impact),
                avgLabourImpactPct: mean((r) => r.labour_impact_pct),
                portfolioPosition: sum((r) => r.adjusted_nett_pl),
                quotedHours: sum((r) => r.quoted_hours),
                actualHours: sum((r) => r.actual_hours),
                avgVariancePct: mean((r) => r.quoting_variance_pct),
                calloutEff: eff((r) => r.quoted_callout, (r) => r.actual_callout),
                fieldEff: eff((r) => r.quoted_field_hours, (r) => r.actual_field_hours),
                commEff: eff((r) => r.quoted_commissioning, (r) => r.actual_commissioning),
                sell,
                grossMarginPct: sell > 0 ? grossPL / sell : null,
            };
        };

        const bySalesperson = new Map<string, JobRow[]>();
        for (const r of rows) {
            const name = (r.salesperson ?? "").trim() || "Unassigned";
            const list = bySalesperson.get(name) ?? [];
            list.push(r);
            bySalesperson.set(name, list);
        }
        const people = [...bySalesperson.entries()].sort((a, b) => b[1].length - a[1].length);

        return [
            { label: "Global Statistics", stats: compute(rows) },
            ...people.map(([name, jobs]) => ({ label: name, stats: compute(jobs) })),
        ];
    }, [rows]);

    const summary = React.useMemo(() => {
        if (!visibleRows.length) return null;
        let sell = 0;
        let marginImpact = 0;
        const variances: number[] = [];
        for (const r of visibleRows) {
            sell += r.sell_price_ex_tax ?? 0;
            marginImpact += r.margin_impact ?? 0;
            if (typeof r.quoting_variance_pct === "number") variances.push(r.quoting_variance_pct);
        }
        variances.sort((a, b) => a - b);
        const median = variances.length
            ? variances[Math.floor(variances.length / 2)]
            : null;
        return {
            jobs: visibleRows.length,
            sell,
            marginImpact,
            medianVariance: median,
        };
    }, [visibleRows]);

    return (
        <div className="p-4 md:p-6 lg:p-8 space-y-4">
            <PageHeader
                title="Labour Dashboard"
                subtitle="Quoted vs actual labour per job, and the P/L impact of the variance."
            />

            <Card>
                <CardContent className="p-5 space-y-3">
                    <div className="grid gap-3 md:grid-cols-2 items-end">
                        <div className="space-y-1">
                            <Label htmlFor="dashfilter">Filter</Label>
                            <Input
                                id="dashfilter"
                                placeholder="Job name or salesperson"
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                                disabled={!rows.length}
                            />
                        </div>
                        <p className="text-sm text-muted-foreground md:text-right">
                            {loading
                                ? "Loading jobs…"
                                : error
                                    ? `Failed to load: ${error}`
                                    : `${rows.length.toLocaleString()} jobs from simPRO sync` +
                                      (syncedAt ? ` · last pushed ${syncedAt}` : "")}
                        </p>
                    </div>
                </CardContent>
            </Card>

            {summary && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardContent className="p-5">
                            <div className="text-sm text-muted-foreground">Jobs</div>
                            <div className="mt-2 text-2xl font-semibold">{summary.jobs.toLocaleString()}</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-5">
                            <div className="text-sm text-muted-foreground">Total Sell (ExTax)</div>
                            <div className="mt-2 text-2xl font-semibold">{money.format(summary.sell)}</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-5">
                            <div className="text-sm text-muted-foreground">Total Margin Impact</div>
                            <div
                                className={
                                    "mt-2 text-2xl font-semibold " +
                                    (summary.marginImpact >= 0 ? "text-green-600" : "text-red-600")
                                }
                            >
                                {money.format(summary.marginImpact)}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">positive = under budget</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-5">
                            <div className="text-sm text-muted-foreground">Median Quoting Variance</div>
                            <div className="mt-2 text-2xl font-semibold">
                                {summary.medianVariance != null
                                    ? `${(summary.medianVariance * 100).toFixed(1)}%`
                                    : "-"}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">negative = actual under quoted</div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {statsGroups.length > 0 && (
                <Card>
                    <CardContent className="p-5 space-y-3">
                        <div className="text-sm font-medium">Global Statistics</div>
                        <div className="rounded-xl border bg-card overflow-hidden">
                            <div className="overflow-x-auto">
                                <Table className="w-full min-w-[900px] text-sm">
                                    <TableHeader>
                                        <TableRow className="h-10">
                                            <TableHead className="px-3 whitespace-nowrap">Metric</TableHead>
                                            {statsGroups.map((g) => (
                                                <TableHead key={g.label} className="px-3 text-right whitespace-nowrap">
                                                    {g.label === "Global Statistics" ? "All" : g.label}
                                                </TableHead>
                                            ))}
                                            <TableHead className="px-3">Notes</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody className="[&>tr]:h-10 [&>tr>td]:py-2 [&>tr>td]:px-3 [&>tr>td]:whitespace-nowrap">
                                        {STAT_ROWS.map((m) => (
                                            <TableRow key={m.label}>
                                                <TableCell className="font-medium">{m.label}</TableCell>
                                                {statsGroups.map((g) => (
                                                    <TableCell key={g.label} className="text-right tabular-nums">
                                                        {m.render(g.stats)}
                                                    </TableCell>
                                                ))}
                                                <TableCell className="text-xs text-muted-foreground whitespace-normal">
                                                    {m.note ?? ""}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardContent className="p-5">
                    <div className="rounded-xl border bg-card overflow-hidden">
                        <div className="overflow-x-auto">
                            <Table className="w-full min-w-[2200px] text-sm">
                                <TableHeader>
                                    <TableRow className="h-11">
                                        {COLUMNS.map((c) => (
                                            <TableHead
                                                key={c.key}
                                                onClick={() => onSort(c.key)}
                                                aria-sort={
                                                    sortKey === c.key
                                                        ? sortDir === "asc" ? "ascending" : "descending"
                                                        : undefined
                                                }
                                                className={
                                                    "px-3 whitespace-nowrap cursor-pointer select-none hover:text-foreground" +
                                                    (c.kind === "text" ? "" : " text-right") +
                                                    (sortKey === c.key ? " text-foreground font-semibold" : "") +
                                                    (c.key === "job_name"
                                                        ? " sticky left-0 z-20 bg-white border-r"
                                                        : "")
                                                }
                                                title={`Sort by ${c.label}`}
                                            >
                                                {c.label}
                                                <span className="ml-1 inline-block w-3 text-[10px]">
                                                    {sortKey === c.key ? (sortDir === "asc" ? "▲" : "▼") : ""}
                                                </span>
                                            </TableHead>
                                        ))}
                                    </TableRow>
                                </TableHeader>
                                <TableBody className="[&>tr]:h-11 [&>tr>td]:py-2 [&>tr>td]:px-3 [&>tr>td]:whitespace-nowrap">
                                    {!visibleRows.length && (
                                        <TableRow>
                                            <TableCell
                                                colSpan={COLUMNS.length}
                                                className="text-center text-sm text-muted-foreground"
                                            >
                                                {loading
                                                    ? "Loading…"
                                                    : rows.length
                                                        ? "No jobs match the filter."
                                                        : "No jobs found."}
                                            </TableCell>
                                        </TableRow>
                                    )}
                                    {visibleRows.map((r) => (
                                        <TableRow key={r.job_number}>
                                            {COLUMNS.map((c) => (
                                                <TableCell
                                                    key={c.key}
                                                    className={
                                                        (c.kind === "text"
                                                            ? c.key === "job_name"
                                                                ? "max-w-[340px] truncate sticky left-0 z-10 bg-white border-r"
                                                                : ""
                                                            : "text-right tabular-nums ") + signedClass(r, c)
                                                    }
                                                >
                                                    {formatCell(r, c)}
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
