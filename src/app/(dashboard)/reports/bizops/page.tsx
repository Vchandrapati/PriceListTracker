"use client";

import * as React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

// Renders the BizOps report exactly as DataPipeline's bizops_report.html does.
// The pipeline pushes each section's rendered HTML + Plotly figure JSON to
// report_sections (plus the report CSS in the "meta" section). This page
// reassembles that into a sandboxed iframe: same CSS, same markup, same
// Plotly render loop - so the output is identical to the offline report.

const PLOTLY_SRC = "https://cdn.plot.ly/plotly-3.6.0.min.js";

type SectionRow = {
    section_key: string;
    title: string;
    sort_order: number;
    payload: {
        html?: string;
        figs?: Record<string, unknown>;
        css?: string;
        data?: HeaderData;
    };
};

type HeaderData = {
    n_competitive_quotes?: number;
    n_noncompetitive?: number;
    n_jobs?: number;
    date_min?: string;
    date_max?: string;
    generated?: string;
};

function headerMetaLine(d: HeaderData): string {
    const n = (v: number | undefined) => (v ?? 0).toLocaleString();
    return (
        `${n(d.n_competitive_quotes)} competitive quotes (plus ${n(d.n_noncompetitive)} set aside: ` +
        `service, variations, breakfix) · ${n(d.n_jobs)} jobs · quotes issued ` +
        `${d.date_min ?? "?"} to ${d.date_max ?? "?"} · generated ${d.generated ?? "?"}`
    );
}

function buildSrcDoc(sections: SectionRow[], autoPrint = false): string {
    const meta = sections.find((s) => s.section_key === "meta");
    const css = meta?.payload.css ?? "";
    const headerMeta = headerMetaLine(meta?.payload.data ?? {});

    const bodySections = sections
        .filter((s) => s.section_key !== "meta")
        .sort((a, b) => a.sort_order - b.sort_order);

    const html = bodySections.map((s) => s.payload.html ?? "").join("\n");

    const figs: Record<string, unknown> = {};
    for (const s of bodySections) {
        for (const [k, v] of Object.entries(s.payload.figs ?? {})) {
            figs[k] = typeof v === "string" ? JSON.parse(v) : v;
        }
    }
    // keep inline <script> parsing safe
    const figsJson = JSON.stringify(figs).replace(/<\//g, "<\\/");

    // after every chart has rendered, print (used by the Print / PDF button)
    const autoPrintJs = autoPrint
        ? "Promise.all(ps).then(()=>setTimeout(()=>window.print(),600));"
        : "";

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Complete AV BizOps Report</title>
<style>${css}
@media print { body{background:#fff} section{break-inside:avoid;box-shadow:none} }</style>
</head>
<body>
<div class="wrap">
<header><h1>Complete AV BizOps Report</h1>
<div class="meta">${headerMeta}</div></header>
${html}
</div>
<script src="${PLOTLY_SRC}"></script>
<script>
const FIGS=${figsJson};
const ps=[];
document.querySelectorAll('[data-fig-id]').forEach(el=>{const s=FIGS[el.dataset.figId];if(s)ps.push(Plotly.newPlot(el,s.data,s.layout,{displayModeBar:false,responsive:true}));});
new ResizeObserver(()=>parent.postMessage({type:'bizops-height',h:document.body.scrollHeight},'*')).observe(document.body);
${autoPrintJs}
</script>
</body>
</html>`;
}

export default function BizOpsReportPage() {
    const [sb, setSb] = React.useState<SupabaseClient | null>(null);
    React.useEffect(() => {
        setSb(supabaseBrowser());
    }, []);

    const [sections, setSections] = React.useState<SectionRow[] | null>(null);
    const [srcDoc, setSrcDoc] = React.useState<string | null>(null);
    const [generatedAt, setGeneratedAt] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [frameHeight, setFrameHeight] = React.useState(1200);

    // opens the assembled report in its own tab; it prints itself once all
    // charts have rendered (choose "Save as PDF" in the dialog)
    const handlePrint = () => {
        if (!sections) return;
        const w = window.open("", "_blank");
        if (!w) {
            alert("Popup blocked - allow popups for this site to print the report.");
            return;
        }
        w.document.write(buildSrcDoc(sections, true));
        w.document.close();
    };

    React.useEffect(() => {
        if (!sb) return;
        (async () => {
            const { data: runs, error: runErr } = await sb
                .from("report_runs")
                .select("run_id, generated_at")
                .eq("kind", "bizops")
                .eq("status", "complete")
                .order("generated_at", { ascending: false })
                .limit(1);
            if (runErr) return setError(runErr.message);
            const run = (runs ?? [])[0];
            if (!run) return setError("No completed BizOps report runs found.");

            const { data: sections, error: secErr } = await sb
                .from("report_sections")
                .select("section_key, title, sort_order, payload")
                .eq("run_id", run.run_id)
                .order("sort_order");
            if (secErr) return setError(secErr.message);
            if (!sections?.length) return setError("Report run has no sections.");

            try {
                setSections(sections as SectionRow[]);
                setSrcDoc(buildSrcDoc(sections as SectionRow[]));
                setGeneratedAt(new Date(run.generated_at).toLocaleString());
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : "Failed to assemble report");
            }
        })();
    }, [sb]);

    // the iframe reports its content height so the page scrolls as one document
    React.useEffect(() => {
        function onMessage(e: MessageEvent) {
            if (e.data?.type === "bizops-height" && typeof e.data.h === "number") {
                setFrameHeight(Math.max(600, e.data.h + 40));
            }
        }
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, []);

    return (
        <div className="p-4 md:p-6 lg:p-8 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <PageHeader
                    title="Biz Ops Report"
                    subtitle={generatedAt ? `Latest run: ${generatedAt}` : "Quoting, pipeline, margin and labour analytics from simPRO."}
                />
                <Button variant="outline" onClick={handlePrint} disabled={!sections}>
                    <Printer className="mr-2 size-4" />
                    Print / PDF
                </Button>
            </div>

            {error && (
                <Card>
                    <CardContent className="p-5">
                        <p className="text-sm text-red-600">{error}</p>
                    </CardContent>
                </Card>
            )}

            {!error && !srcDoc && (
                <Card>
                    <CardContent className="p-5">
                        <p className="text-sm text-muted-foreground">Loading report…</p>
                    </CardContent>
                </Card>
            )}

            {srcDoc && (
                <iframe
                    title="BizOps Report"
                    srcDoc={srcDoc}
                    sandbox="allow-scripts"
                    className="w-full rounded-xl border bg-[#f1f5f9]"
                    style={{ height: frameHeight }}
                />
            )}
        </div>
    );
}
