"use client";

import * as React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

// Port of the v2 quoting calculator (DataPipeline scripts/build_calculator.py).
// Unit minutes come from labour_priors; the trained model (betas, covariance,
// heteroscedastic noise, commissioning gate) comes from labour_model_artifacts.
// Prediction follows the artifact's stated convention:
//   m   = [1, Xs] @ mu
//   var = [1, Xs] @ Sigma @ [1, Xs]' + clip(exp(a + c*log_size), 0.15^2, 2.5^2)
//   quantile_q(hours) = prior_hours * exp(m + z_q * sqrt(var))
// where Xs = (log1p(count) | flag - x_mean) / x_scale.

type CountField = { key: string; label: string };

const COUNT_GROUPS: { title: string; fields: CountField[] }[] = [
    {
        title: "Displays & Projection",
        fields: [
            { key: "cat01_displays_lt75", label: "Displays <75\"" },
            { key: "cat02_displays_ge75", label: "Displays >=75\"" },
            { key: "cat03_projectors_ust", label: "Projectors (UST)" },
            { key: "cat04_whiteboards", label: "Whiteboards" },
            { key: "cat05_interactive_panels", label: "Interactive Panels" },
            { key: "cat06_ceiling_projection", label: "Large Projection System (projectors + projection screens)" },
            { key: "cat21_projection_accessories", label: "Projection Accessories" },
        ],
    },
    {
        title: "Audio",
        fields: [
            { key: "cat07_ceiling_speakers", label: "Ceiling speakers" },
            { key: "cat08_wall_speakers", label: "Wall Speaker / Soundbar" },
            { key: "cat09_amplifiers", label: "Amplifiers" },
            { key: "cat17_antennas", label: "Antennas" },
            { key: "cat18_wireless_mics", label: "Wireless Mics" },
        ],
    },
    {
        title: "Control & Video",
        fields: [
            { key: "cat10_control_interfaces", label: "Control Interfaces (keypad + touch)" },
            { key: "cat11_dsp_processors", label: "DSP" },
            { key: "cat12_uc_engines", label: "UC Engine" },
            { key: "cat13_configurable_endpoints", label: "AVoIP / Configurable Endpoint" },
            { key: "cat14_simple_extenders", label: "Simple Extenders" },
            { key: "cat15_switchers_matrix", label: "Switchers / Matrix" },
            { key: "cat16_cameras", label: "PTZ / Cameras" },
        ],
    },
    {
        title: "Rough-in & Cabling",
        fields: [
            { key: "cat24_roughin_data_m", label: "Rough-in Cat (m)" },
            { key: "cat25_roughin_audio_m", label: "Rough-in Speaker/Audio (m)" },
            { key: "cat26_roughin_coax_m", label: "Rough-in Coax (m)" },
            { key: "cat27_conduit_m", label: "Conduit (m)" },
            { key: "cat28_terminations", label: "Terminations (ends)" },
            { key: "cat22_wall_plates", label: "Wall plates" },
            { key: "cat23_patch_leads", label: "Patch Leads QTY" },
        ],
    },
    {
        title: "Racks",
        fields: [
            { key: "cat19_rack_count", label: "Racks (new)" },
            { key: "cat20_rack_peripherals", label: "Rack Peripherals & Dressing" },
            { key: "existing_rack_count", label: "Racks (existing, rework)" },
        ],
    },
    {
        title: "Install Items",
        fields: [
            { key: "cat29_large_install", label: "Large Install Items" },
            { key: "cat30_small_install", label: "Small Install Items" },
        ],
    },
    {
        title: "Site",
        fields: [
            { key: "num_rooms", label: "Install Spaces (rooms)" },
            { key: "num_buildings", label: "Buildings" },
            { key: "pa_zone_count", label: "PA zones" },
        ],
    },
];

type FlagField = { key: string; label: string };

const SCOPE_FLAGS: FlagField[] = [
    { key: "is_education", label: "Education site" },
    { key: "is_construction", label: "Construction job" },
    { key: "decommission", label: "Decommission old kit" },
    { key: "scissor_lift", label: "Scissor lift needed" },
];

const BINARY_COLS = new Set(["is_education", "is_construction", "decommission", "scissor_lift"]);

// log-size covariate: device-category counts only (no rough-in metres / consumables)
const DEVICE_COLS = [
    "cat01_displays_lt75", "cat02_displays_ge75", "cat03_projectors_ust", "cat04_whiteboards",
    "cat05_interactive_panels", "cat06_ceiling_projection", "cat21_projection_accessories",
    "cat07_ceiling_speakers", "cat08_wall_speakers", "cat09_amplifiers", "cat17_antennas",
    "cat18_wireless_mics", "cat10_control_interfaces", "cat11_dsp_processors", "cat12_uc_engines",
    "cat13_configurable_endpoints", "cat14_simple_extenders", "cat15_switchers_matrix",
    "cat16_cameras", "cat19_rack_count", "cat29_large_install", "cat30_small_install",
];

const Z_P65 = 0.38532;
const Z_P80 = 0.84162;

type Prior = { field_minutes: number | null; comm_minutes: number | null };

type ModelBlock = {
    mu: number[];
    sigma: number[][];
    x_mean: number[];
    x_scale: number[];
    het_a_c: [number, number];
};

type Artifacts = {
    columns: string[];
    field: ModelBlock;
    comm: ModelBlock;
    gate: { intercept: number; coef: Record<string, number> };
    conventions?: { ratio_floor?: number };
};

// hours from a model block per the artifact's predict convention
function modelQuantiles(block: ModelBlock, xs: number[], logSize: number, priorHours: number, ratioFloor: number) {
    const v = [1, ...xs];
    let m = 0;
    for (let i = 0; i < v.length; i++) m += v[i] * block.mu[i];

    let paramVar = 0;
    for (let i = 0; i < v.length; i++) {
        let acc = 0;
        for (let j = 0; j < v.length; j++) acc += block.sigma[i][j] * v[j];
        paramVar += v[i] * acc;
    }
    const [a, c] = block.het_a_c;
    const noise = Math.min(Math.max(Math.exp(a + c * logSize), 0.15 ** 2), 2.5 ** 2);
    const sd = Math.sqrt(Math.max(paramVar + noise, 0));

    const at = (z: number) => priorHours * Math.max(Math.exp(m + z * sd), ratioFloor);
    return { p50: at(0), p65: at(Z_P65), p80: at(Z_P80) };
}

// half-day rounding as in the sheet: CEILING(hours, 4)
const ceil4 = (h: number) => Math.ceil(h / 4) * 4;
// MROUND(x, 5)
const mround5 = (x: number) => Math.round(x / 5) * 5;

const money = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 2,
});

// Defined at module level (not inside the page component) so inputs keep
// focus while typing - an inline component definition remounts every render.
function CountGroup({
    title,
    fields,
    counts,
    setCount,
}: {
    title: string;
    fields: CountField[];
    counts: Record<string, string>;
    setCount: (key: string, value: string) => void;
}) {
    return (
        <div className="space-y-3">
            <div className="text-sm font-medium">{title}</div>
            <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((f) => (
                    <div key={f.key} className="space-y-1">
                        <Label htmlFor={f.key} className="text-xs">{f.label}</Label>
                        <Input
                            id={f.key}
                            type="number"
                            min={0}
                            placeholder="0"
                            value={counts[f.key] ?? ""}
                            onChange={(e) => setCount(f.key, e.target.value)}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}

function ResultRow({
    label,
    hint,
    value,
    sub,
}: {
    label: string;
    hint: string;
    value: React.ReactNode;
    sub?: string;
}) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <div>
                <div className="text-sm">{label}</div>
                <div className="text-[11px] text-muted-foreground">{hint}</div>
            </div>
            <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">{value}</div>
                {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
            </div>
        </div>
    );
}

export default function LabourCalculatorPage() {
    const [sb, setSb] = React.useState<SupabaseClient | null>(null);
    React.useEffect(() => {
        setSb(supabaseBrowser());
    }, []);

    const [priors, setPriors] = React.useState<Map<string, Prior> | null>(null);
    const [artifacts, setArtifacts] = React.useState<Artifacts | null>(null);
    const [modelInfo, setModelInfo] = React.useState<string | null>(null);
    const [loadError, setLoadError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!sb) return;
        (async () => {
            const [priorsRes, artRes] = await Promise.all([
                sb.from("labour_priors").select("param_key, field_minutes, comm_minutes"),
                sb.from("labour_model_artifacts")
                    .select("model_version, trained_at, params")
                    .order("model_version", { ascending: false })
                    .limit(1),
            ]);
            if (priorsRes.error) return setLoadError(priorsRes.error.message);
            const m = new Map<string, Prior>();
            for (const r of priorsRes.data ?? []) {
                m.set(r.param_key as string, {
                    field_minutes: r.field_minutes as number | null,
                    comm_minutes: r.comm_minutes as number | null,
                });
            }
            setPriors(m);

            if (artRes.error) return setLoadError(artRes.error.message);
            const art = (artRes.data ?? [])[0];
            if (art?.params) {
                const p = art.params as Record<string, unknown>;
                setArtifacts({
                    columns: p.columns as string[],
                    field: p.field as ModelBlock,
                    comm: p.comm as ModelBlock,
                    gate: p.gate as Artifacts["gate"],
                    conventions: p.conventions as Artifacts["conventions"],
                });
                setModelInfo(
                    `model v${art.model_version} · trained ${new Date(art.trained_at as string).toLocaleDateString()}`
                );
            }
        })();
    }, [sb]);

    const [counts, setCounts] = React.useState<Record<string, string>>({});
    const [flags, setFlags] = React.useState<Record<string, boolean>>({});

    const setCount = React.useCallback(
        (key: string, value: string) => setCounts((cur) => ({ ...cur, [key]: value })),
        []
    );

    const hasInput =
        Object.values(counts).some((v) => v !== "" && Number(v) > 0) ||
        Object.values(flags).some(Boolean);

    const handleReset = () => {
        setCounts({});
        setFlags({});
    };

    const results = React.useMemo(() => {
        if (!priors) return null;
        const num = (key: string) => {
            const n = Number(counts[key] ?? 0);
            return Number.isFinite(n) && n > 0 ? n : 0;
        };
        const flag = (key: string) => (flags[key] ? 1 : 0);
        const fieldMin = (key: string) => priors.get(key)?.field_minutes ?? 0;
        const commMin = (key: string) => priors.get(key)?.comm_minutes ?? 0;

        const rooms = num("num_rooms");

        // Sheet prior: base + per-unit minutes + room / decommission / construction adders
        let fieldMinutes = fieldMin("base");
        let commMinutes = commMin("base");
        for (const g of COUNT_GROUPS) {
            for (const f of g.fields) {
                if (f.key === "num_rooms") {
                    fieldMinutes += rooms * fieldMin("per_room");
                    commMinutes += rooms * commMin("per_room");
                } else {
                    fieldMinutes += num(f.key) * fieldMin(f.key);
                    commMinutes += num(f.key) * commMin(f.key);
                }
            }
        }
        fieldMinutes += flag("decommission") * rooms * fieldMin("decommission_per_room");
        fieldMinutes += flag("is_construction") * fieldMin("construction_adder");

        const fieldPriorHours = fieldMinutes / 60;
        const commPriorHours = commMinutes / 60;

        // Model correction + uncertainty bands
        let field = { p50: fieldPriorHours, p65: null as number | null, p80: null as number | null };
        let comm = { p50: commPriorHours, p80: null as number | null };
        let pAnyComm: number | null = null;

        if (artifacts) {
            const raw = (key: string) => (BINARY_COLS.has(key) ? flag(key) : Math.log1p(num(key)));
            const logSize = Math.log1p(DEVICE_COLS.reduce((acc, k) => acc + num(k), 0));
            const ratioFloor = artifacts.conventions?.ratio_floor ?? 0.05;

            const xsFor = (block: ModelBlock) =>
                artifacts.columns.map((col, i) => (raw(col) - block.x_mean[i]) / block.x_scale[i]);

            const fq = modelQuantiles(artifacts.field, xsFor(artifacts.field), logSize, fieldPriorHours, ratioFloor);
            field = { p50: fq.p50, p65: fq.p65, p80: fq.p80 };

            const cq = modelQuantiles(artifacts.comm, xsFor(artifacts.comm), logSize, commPriorHours, ratioFloor);
            comm = { p50: cq.p50, p80: cq.p80 };

            let logit = artifacts.gate.intercept;
            for (const [k, coef] of Object.entries(artifacts.gate.coef)) {
                logit += coef * Math.log1p(num(k));
            }
            pAnyComm = 1 / (1 + Math.exp(-logit));
        }

        const fieldP50 = ceil4(field.p50);
        const fieldP65 = field.p65 == null ? null : ceil4(field.p65);
        const fieldP80 = field.p80 == null ? null : ceil4(field.p80);
        const commP50 = ceil4(comm.p50);
        const commP80 = comm.p80 == null ? null : ceil4(comm.p80);

        // project callout = total hours / 8
        const projectCallout = (fieldP50 + commP50) / 8;

        // Freight / Storage / Waste (rates from the original sheet)
        const small = num("cat30_small_install");
        const large = num("cat29_large_install");
        const disp = num("cat01_displays_lt75") + num("cat02_displays_ge75") + num("cat04_whiteboards");
        const racks = num("cat19_rack_count") + num("existing_rack_count");
        const screens = num("cat06_ceiling_projection") + num("cat21_projection_accessories");
        // site days at a 2-person crew, 8h days
        const dur = Math.ceil((fieldP50 / 16) / 0.5) * 0.5;

        const deliveryDays = Math.ceil(dur * 0.075);
        const freight = mround5(Math.max(
            deliveryDays + 2.08 + large * 8.72 + small * 3.94 +
            (small + large) * 1.5 + (disp + racks) * 50 + screens * 90,
            35
        ));

        const storageDays = Math.ceil(dur * 0.75);
        const shelfPallet =
            small + large <= 6 ? 0.77 : 1.84 * Math.ceil(small * 0.015625 + large * 0.12);
        const storage = mround5(Math.max(
            (storageDays + shelfPallet + disp * 0.28) * storageDays,
            6
        ));

        const collectionDays = Math.ceil(dur * 0.1);
        const waste = mround5(Math.max(
            collectionDays + large * 3.56 + small * 0.76 + flag("decommission") * rooms * 11.74,
            15
        ));

        return { fieldP50, fieldP65, fieldP80, commP50, commP80, pAnyComm, projectCallout, freight, storage, waste };
    }, [priors, artifacts, counts, flags]);

    const days = (h: number) => `${(h / 8).toLocaleString(undefined, { maximumFractionDigits: 1 })} days`;

    return (
        <div className="p-4 md:p-6 lg:p-8 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <PageHeader
                    title="Labour Calculator"
                    subtitle={`Device counts and scope flags → P50 / P65 / P80 labour hours.${modelInfo ? ` (${modelInfo})` : ""}`}
                />
                <Button variant="outline" onClick={handleReset} disabled={!hasInput}>
                    <RotateCcw className="mr-2 size-4" />
                    Reset
                </Button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                {/* Inputs */}
                <Card>
                    <CardContent className="p-5 space-y-6">
                        {COUNT_GROUPS.map((g) => (
                            <CountGroup
                                key={g.title}
                                title={g.title}
                                fields={g.fields}
                                counts={counts}
                                setCount={setCount}
                            />
                        ))}

                        <div className="space-y-3">
                            <div className="text-sm font-medium">Scope</div>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {SCOPE_FLAGS.map((f) => (
                                    <label key={f.key} className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={flags[f.key] ?? false}
                                            onCheckedChange={(v) =>
                                                setFlags((cur) => ({ ...cur, [f.key]: v === true }))
                                            }
                                        />
                                        {f.label}
                                    </label>
                                ))}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Results panel */}
                <Card className="h-fit lg:sticky lg:top-20">
                    <CardContent className="p-5 space-y-4">
                        <div className="text-sm font-medium">Results</div>

                        {loadError && (
                            <p className="text-sm text-red-600">Failed to load model data: {loadError}</p>
                        )}
                        {!priors && !loadError && (
                            <p className="text-sm text-muted-foreground">Loading model…</p>
                        )}

                        {results && (
                            <div className="space-y-3">
                                <ResultRow
                                    label="Expected (P50)"
                                    hint="quote this when sharp"
                                    value={`${results.fieldP50} h`}
                                    sub={days(results.fieldP50)}
                                />
                                <ResultRow
                                    label="Safe (P65)"
                                    hint="margin protection"
                                    value={results.fieldP65 == null ? "-" : `${results.fieldP65} h`}
                                    sub={results.fieldP65 == null ? undefined : days(results.fieldP65)}
                                />
                                <ResultRow
                                    label="Covered (P80)"
                                    hint="busy-case buffer"
                                    value={results.fieldP80 == null ? "-" : `${results.fieldP80} h`}
                                    sub={results.fieldP80 == null ? undefined : days(results.fieldP80)}
                                />

                                <div className="border-t pt-3 space-y-3">
                                    <ResultRow
                                        label="Commissioning likely?"
                                        hint="gate on UC / DSP / control / racks"
                                        value={
                                            results.pAnyComm == null ? (
                                                "-"
                                            ) : (
                                                <span className={results.pAnyComm >= 0.5 ? "text-amber-600" : ""}>
                                                    {results.pAnyComm >= 0.5 ? "YES" : "unlikely"}
                                                    {` (${Math.round(results.pAnyComm * 100)}%)`}
                                                </span>
                                            )
                                        }
                                    />
                                    <ResultRow
                                        label="Commissioning hours (P50)"
                                        hint="conditional on commissioning happening"
                                        value={`${results.commP50} h`}
                                        sub={days(results.commP50)}
                                    />
                                    <ResultRow
                                        label="Commissioning hours (P80)"
                                        hint="busy-case buffer"
                                        value={results.commP80 == null ? "-" : `${results.commP80} h`}
                                        sub={results.commP80 == null ? undefined : days(results.commP80)}
                                    />
                                    <ResultRow
                                        label="Project callout"
                                        hint="total hours ÷ 8"
                                        value={results.projectCallout.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                                    />
                                </div>

                                <div className="border-t pt-3 space-y-3">
                                    <ResultRow
                                        label="Freight & Handling"
                                        hint="delivery days + item classes"
                                        value={money.format(results.freight)}
                                    />
                                    <ResultRow
                                        label="Storage"
                                        hint="shelf / pallet / display slots"
                                        value={money.format(results.storage)}
                                    />
                                    <ResultRow
                                        label="Waste Management"
                                        hint="collections + decommission"
                                        value={money.format(results.waste)}
                                    />
                                </div>
                            </div>
                        )}

                        <p className="text-xs text-muted-foreground">
                            Hours are person-hours, rounded up to half days (4h). P50 = half of jobs
                            land under it; quote P50 when sharp, P65-P70 when protecting margin.
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
