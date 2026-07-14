"use client";

import * as React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase";
import { calculateHybrid, type CommercialAssumptions, type HybridArtifact, type Prior, type SectionInput } from "@/lib/labour-hybrid";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CountField = { key: string; label: string };
const COUNT_GROUPS: { title: string; fields: CountField[] }[] = [
    { title: "Displays & Projection", fields: [
        { key: "cat01_displays_lt75", label: "Displays <75\"" },
        { key: "cat02_displays_ge75", label: "Displays ≥75\"" },
        { key: "cat03_projectors_ust", label: "Projectors (UST)" },
        { key: "cat04_whiteboards", label: "Whiteboards" },
        { key: "cat05_interactive_panels", label: "Interactive panels" },
        { key: "cat06_ceiling_projection", label: "Large projection systems" },
        { key: "cat21_projection_accessories", label: "Projection accessories" },
        { key: "logistics_projector_screens", label: "Projector screens (freight only)" },
    ] },
    { title: "Audio", fields: [
        { key: "cat07_ceiling_speakers", label: "Ceiling speakers" },
        { key: "cat08_wall_speakers", label: "Wall speakers / soundbars" },
        { key: "cat09_amplifiers", label: "Amplifiers" },
        { key: "cat17_antennas", label: "Antennas" },
        { key: "cat18_wireless_mics", label: "Wireless microphones" },
    ] },
    { title: "Control & Video", fields: [
        { key: "cat10_control_interfaces", label: "Control interfaces" },
        { key: "cat11_dsp_processors", label: "DSPs" },
        { key: "cat12_uc_engines", label: "UC engines" },
        { key: "cat13_configurable_endpoints", label: "AVoIP / configurable endpoints" },
        { key: "cat14_simple_extenders", label: "Simple extenders" },
        { key: "cat15_switchers_matrix", label: "Switchers / matrix" },
        { key: "cat16_cameras", label: "PTZ / cameras" },
    ] },
    { title: "Rough-in & Cabling", fields: [
        { key: "cat24_roughin_data_m", label: "Rough-in Cat (m)" },
        { key: "cat25_roughin_audio_m", label: "Rough-in audio (m)" },
        { key: "cat26_roughin_coax_m", label: "Rough-in coax (m)" },
        { key: "cat27_conduit_m", label: "Conduit (m)" },
        { key: "cat28_terminations", label: "Terminations (ends)" },
        { key: "cat22_wall_plates", label: "Wall plates" },
        { key: "cat23_patch_leads", label: "Patch leads" },
    ] },
    { title: "Racks & Install Items", fields: [
        { key: "cat19_rack_count", label: "New racks" },
        { key: "cat20_rack_peripherals", label: "Rack peripherals & dressing" },
        { key: "existing_rack_count", label: "Existing racks / rework" },
        { key: "cat29_large_install", label: "Large install items" },
        { key: "cat30_small_install", label: "Small install items" },
    ] },
];

const SCOPE_FLAGS = [
    { key: "is_education", label: "Education site" },
    { key: "is_construction", label: "Construction job" },
    { key: "decommission", label: "Decommission old kit" },
    { key: "scissor_lift", label: "Scissor lift needed" },
];

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 });
const newSection = (number: number): SectionInput => ({
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${number}`,
    name: `Section ${number}`,
    quantity: 1,
    counts: {},
});

function ResultRow({ label, hint, value, sub }: { label: string; hint: string; value: React.ReactNode; sub?: string }) {
    return <div className="flex items-baseline justify-between gap-3">
        <div><div className="text-sm">{label}</div><div className="text-[11px] text-muted-foreground">{hint}</div></div>
        <div className="text-right"><div className="text-sm font-semibold tabular-nums">{value}</div>
            {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}</div>
    </div>;
}

function SectionEditor({ section, canRemove, onChange, onRemove }: {
    section: SectionInput;
    canRemove: boolean;
    onChange: (section: SectionInput) => void;
    onRemove: () => void;
}) {
    const excluded = /variation/i.test(section.name);
    return <Card className={excluded ? "border-amber-400/60 bg-amber-50/30 dark:bg-amber-950/10" : ""}>
        <CardContent className="p-5 space-y-5">
            <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-52 flex-1 space-y-1">
                    <Label>Section / room type</Label>
                    <Input value={section.name} onChange={(event) => onChange({ ...section, name: event.target.value })} />
                </div>
                <div className="w-32 space-y-1">
                    <Label>Room quantity</Label>
                    <Input type="number" min={1} value={section.quantity}
                        onChange={(event) => onChange({ ...section, quantity: Math.max(1, Number(event.target.value) || 1) })} />
                </div>
                <Button variant="outline" size="icon" disabled={!canRemove} onClick={onRemove} aria-label="Remove section">
                    <Trash2 className="size-4" />
                </Button>
            </div>
            {excluded && <p className="text-sm text-amber-700 dark:text-amber-300">
                Excluded because the section name contains “Variation”.
            </p>}
            <p className="text-xs text-muted-foreground">
                Enter equipment totals for this section group. For a 4P section with QTY 3, enter the combined equipment for all three rooms.
            </p>
            <div className="grid gap-6 xl:grid-cols-2">
                {COUNT_GROUPS.map((group) => <div key={group.title} className="space-y-3">
                    <div className="text-sm font-medium">{group.title}</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {group.fields.map((field) => <div key={field.key} className="space-y-1">
                            <Label className="text-xs">{field.label}</Label>
                            <Input type="number" min={0} placeholder="0"
                                value={section.counts[field.key] || ""}
                                onChange={(event) => onChange({
                                    ...section,
                                    counts: { ...section.counts, [field.key]: Math.max(0, Number(event.target.value) || 0) },
                                })} />
                        </div>)}
                    </div>
                </div>)}
            </div>
        </CardContent>
    </Card>;
}

export default function LabourCalculatorPage() {
    const [sb, setSb] = React.useState<SupabaseClient | null>(null);
    const [priors, setPriors] = React.useState<Map<string, Prior> | null>(null);
    const [artifact, setArtifact] = React.useState<HybridArtifact | null>(null);
    const [commercial, setCommercial] = React.useState<CommercialAssumptions | null>(null);
    const [modelInfo, setModelInfo] = React.useState("");
    const [loadError, setLoadError] = React.useState<string | null>(null);
    const [sections, setSections] = React.useState<SectionInput[]>(() => [newSection(1)]);
    const [numBuildings, setNumBuildings] = React.useState(1);
    const [paZoneCount, setPaZoneCount] = React.useState(0);
    const [decommissionRooms, setDecommissionRooms] = React.useState(0);
    const [paBuildingsDecommissioned, setPaBuildingsDecommissioned] = React.useState(0);
    const [supplierFreightQuote, setSupplierFreightQuote] = React.useState(0);
    const [ewasteDisposalQuote, setEwasteDisposalQuote] = React.useState(0);
    const [flags, setFlags] = React.useState<Record<string, boolean>>({});

    React.useEffect(() => setSb(supabaseBrowser()), []);
    React.useEffect(() => {
        if (!sb) return;
        void (async () => {
            const [priorResult, artifactResult, commercialResult] = await Promise.all([
                sb.from("labour_priors").select("param_key, field_minutes, comm_minutes"),
                sb.from("labour_model_artifacts").select("model_version, trained_at, params")
                    .order("model_version", { ascending: false }).limit(1),
                sb.from("commercial_calculator_assumptions").select("assumption_key, value"),
            ]);
            if (priorResult.error) return setLoadError(priorResult.error.message);
            setPriors(new Map((priorResult.data ?? []).map((row) => [row.param_key as string, {
                field_minutes: row.field_minutes as number | null,
                comm_minutes: row.comm_minutes as number | null,
            }])));
            if (artifactResult.error) return setLoadError(artifactResult.error.message);
            if (commercialResult.error) return setLoadError(commercialResult.error.message);
            setCommercial(Object.fromEntries((commercialResult.data ?? []).map((row) => [
                row.assumption_key as string, Number(row.value),
            ])));
            const row = artifactResult.data?.[0];
            const params = row?.params as HybridArtifact | undefined;
            if (params?.config?.model_type !== "random_forest_section_hybrid") {
                return setLoadError("The random-forest hybrid has not been deployed yet.");
            }
            setArtifact(params);
            setModelInfo(`RF hybrid v${row.model_version} · trained ${new Date(row.trained_at as string).toLocaleDateString()}`);
        })();
    }, [sb]);

    const results = React.useMemo(() => artifact && priors && commercial ? calculateHybrid(
        artifact, priors, commercial, sections, {
            numBuildings, paZoneCount, flags, decommissionRooms, paBuildingsDecommissioned,
            supplierFreightQuote, ewasteDisposalQuote,
        },
    ) : null, [artifact, priors, commercial, sections, numBuildings, paZoneCount, flags,
        decommissionRooms, paBuildingsDecommissioned, supplierFreightQuote, ewasteDisposalQuote]);
    const updateSection = (id: string, next: SectionInput) => setSections((current) =>
        current.map((section) => section.id === id ? next : section));
    const reset = () => {
        setSections([newSection(1)]);
        setNumBuildings(1);
        setPaZoneCount(0);
        setDecommissionRooms(0);
        setPaBuildingsDecommissioned(0);
        setSupplierFreightQuote(0);
        setEwasteDisposalQuote(0);
        setFlags({});
    };
    const days = (hours: number) => `${(hours / 8).toLocaleString(undefined, { maximumFractionDigits: 1 })} days`;

    return <div className="p-4 md:p-6 lg:p-8 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <PageHeader title="Labour Calculator"
                subtitle={`Build the complete job section-by-section, then calculate one reconciled labour total.${modelInfo ? ` (${modelInfo})` : ""}`} />
            <Button variant="outline" onClick={reset}><RotateCcw className="mr-2 size-4" />Reset job</Button>
        </div>

        <Card><CardContent className="p-5 space-y-4">
            <div><div className="text-sm font-medium">Job setup</div>
                <p className="text-xs text-muted-foreground">Shared context is applied once, not once per section.</p></div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1"><Label>Buildings</Label><Input type="number" min={1} value={numBuildings}
                    onChange={(event) => setNumBuildings(Math.max(1, Number(event.target.value) || 1))} /></div>
                <div className="space-y-1"><Label>PA zones</Label><Input type="number" min={0} value={paZoneCount || ""} placeholder="0"
                    onChange={(event) => setPaZoneCount(Math.max(0, Number(event.target.value) || 0))} /></div>
                <div className="space-y-1"><Label>Rooms decommissioned</Label><Input type="number" min={0}
                    value={decommissionRooms || ""} placeholder="0"
                    onChange={(event) => setDecommissionRooms(Math.max(0, Number(event.target.value) || 0))} /></div>
                <div className="space-y-1"><Label>PA buildings decommissioned</Label><Input type="number" min={0}
                    value={paBuildingsDecommissioned || ""} placeholder="0"
                    onChange={(event) => setPaBuildingsDecommissioned(Math.max(0, Number(event.target.value) || 0))} /></div>
                <div className="space-y-1"><Label>Supplier freight quote ($)</Label><Input type="number" min={0} step="0.01"
                    value={supplierFreightQuote || ""} placeholder="0"
                    onChange={(event) => setSupplierFreightQuote(Math.max(0, Number(event.target.value) || 0))} /></div>
                <div className="space-y-1"><Label>E-waste disposal quote ($)</Label><Input type="number" min={0} step="0.01"
                    value={ewasteDisposalQuote || ""} placeholder="0"
                    onChange={(event) => setEwasteDisposalQuote(Math.max(0, Number(event.target.value) || 0))} /></div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {SCOPE_FLAGS.map((flag) => <label key={flag.key} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={flags[flag.key] ?? false}
                        onCheckedChange={(value) => setFlags((current) => ({ ...current, [flag.key]: value === true }))} />
                    {flag.label}
                </label>)}
            </div>
        </CardContent></Card>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <div className="space-y-4">
                {sections.map((section) => <SectionEditor key={section.id} section={section}
                    canRemove={sections.length > 1}
                    onChange={(next) => updateSection(section.id, next)}
                    onRemove={() => setSections((current) => current.filter((row) => row.id !== section.id))} />)}
                <Button variant="outline" onClick={() => setSections((current) => [...current, newSection(current.length + 1)])}>
                    <Plus className="mr-2 size-4" />Add section
                </Button>
            </div>

            <Card className="h-fit xl:sticky xl:top-20"><CardContent className="p-5 space-y-4">
                <div className="text-sm font-medium">Whole-job result</div>
                {loadError && <p className="text-sm text-red-600">{loadError}</p>}
                {!results && !loadError && <p className="text-sm text-muted-foreground">Loading model…</p>}
                {results && <div className="space-y-3">
                    <ResultRow label="Expected (P50)" hint="random-forest whole-job estimate" value={`${results.fieldP50} h`} sub={days(results.fieldP50)} />
                    <ResultRow label="Safe (P65)" hint="training-residual calibration" value={`${results.fieldP65} h`} sub={days(results.fieldP65)} />
                    <ResultRow label="Covered (P80)" hint="busy-case buffer" value={`${results.fieldP80} h`} sub={days(results.fieldP80)} />
                    <div className="border-t pt-3 space-y-2">
                        <div className="text-xs font-medium">Section allocation · sums to job total</div>
                        {results.allocations.map((row) => <ResultRow key={row.id}
                            label={`${row.name} × ${row.quantity}`}
                            hint={`${Math.round(row.share * 100)}% of job P50`}
                            value={`${row.p50.toFixed(1)} h`} />)}
                        {results.excludedVariationCount > 0 && <p className="text-xs text-amber-700">
                            {results.excludedVariationCount} Variation section(s) excluded.
                        </p>}
                    </div>
                    <div className="border-t pt-3 space-y-3">
                        <ResultRow label="Commissioning likely?" hint="job-level hurdle"
                            value={results.pAnyComm == null ? "-" : `${results.pAnyComm >= 0.5 ? "YES" : "unlikely"} (${Math.round(results.pAnyComm * 100)}%)`} />
                        <ResultRow label="Commissioning (P50)" hint="conditional hours" value={`${results.commP50} h`} sub={days(results.commP50)} />
                        <ResultRow label="Commissioning (P80)" hint="busy-case buffer" value={`${results.commP80} h`} sub={days(results.commP80)} />
                        <ResultRow label="Project callout" hint="field + commissioning ÷ 8" value={results.projectCallout.toFixed(1)} />
                    </div>
                    <div className="border-t pt-3 space-y-3">
                        <div className="text-xs font-medium">Transport planning</div>
                        <ResultRow label="Box volume" hint={`${results.boxPallets} box pallet(s)`}
                            value={`${results.boxVolumeM3.toFixed(2)} m³`} />
                        <ResultRow label="Display / IFP pallets" hint={`${results.totalPallets} total pallet(s)`}
                            value={results.displayPallets} />
                        <ResultRow label="LDV load" hint={`${results.allocatedLoadEquivalent.toFixed(2)} allocated load equivalent`}
                            value={`${results.ldvLoadRatio.toFixed(2)} loads`} />
                        <ResultRow label="Whole LDV trips" hint="physical planning requirement"
                            value={results.wholeLdvTrips} />
                    </div>
                    <div className="border-t pt-3 space-y-3">
                        <div className="text-xs font-medium">Commercial allowances</div>
                        <ResultRow label="Freight & Handling" hint="internal ABC allocation + supplier quote"
                            value={money.format(results.freight)}
                            sub={`${money.format(results.freightInternal)} internal + ${money.format(results.supplierFreightQuote)} supplier`} />
                        <ResultRow label="Storage" hint={`${results.storageDays} estimated storage day(s)`}
                            value={money.format(results.storage)} />
                        <ResultRow label="Waste Management" hint="packaging + e-waste + disposal quote"
                            value={money.format(results.waste)}
                            sub={`${money.format(results.wasteInternal)} internal + ${money.format(results.ewasteDisposalQuote)} disposal`} />
                        <ResultRow label="Waste transport" hint={`${results.packagingWasteLoadEquivalent.toFixed(2)} compacted packaging loads`}
                            value={`${results.wasteTripEquivalent.toFixed(2)} allocated`} />
                        <ResultRow label="E-waste" hint={`${results.ewasteItems.toFixed(0)} proxy items`}
                            value={`${results.ewasteTripEquivalent.toFixed(2)} load equiv`} />
                    </div>
                </div>}
                <p className="text-xs text-muted-foreground">
                    Hours are person-hours. The forest runs once after all non-Variation sections are aggregated; section figures are reconciled allocations, not independent predictions.
                </p>
            </CardContent></Card>
        </div>
    </div>;
}
