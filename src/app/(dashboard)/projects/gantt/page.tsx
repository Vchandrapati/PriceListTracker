"use client";

import * as React from "react";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

/** ---- Types (aligned with overview / DB) ---- */
type Subtask = {
    id: number;
    name: string;
    completed: boolean;
    startDate: string;
    dueDate: string;
    assignedTo: string;
    duration: number;
};

type ProjectStatus =
    | "Engineering"
    | "Procurement"
    | "On Hold"
    | "Schedule"
    | "In Progress"
    | "Completed";

type Project = {
    id: number;
    jobNumber: string;
    status: ProjectStatus;
    jobName: string;
    siteName: string;
    salesPerson: string;
    projectManager: string;
    shopDrawings: boolean;
    deviceRegister: boolean;
    ordered: boolean;
    jobPacked: boolean;
    installed: boolean;
    asBuilts: boolean;
    startDate: string;
    finishDate: string;
    archived: boolean;
    expanded: boolean;
    subtasks: Subtask[];
};

/** ---- DB row types (matches your overview page schema) ---- */
type ProjectRow = {
    id: number;
    job_number: string;
    job_name: string;
    status: ProjectStatus;
    site_name: string | null;
    sales_person: string | null;
    project_manager: string | null;
    shop_drawings: boolean | null;
    device_register: boolean | null;
    ordered: boolean | null;
    job_packed: boolean | null;
    installed: boolean | null;
    as_builts: boolean | null;
    start_date: string | null;
    finish_date: string | null;
    archived: boolean | null;
    project_subtasks: SubtaskRow[] | null;
};

type SubtaskRow = {
    id: number;
    project_id: number;
    name: string;
    completed: boolean | null;
    start_date: string | null;
    due_date: string | null;
    assigned_to: string | null;
    duration: number | null;
    priority?: "Standard" | "Urgent" | null; // present in DB but not used in Gantt
};

function mapRowToProject(row: ProjectRow): Project {
    return {
        id: row.id,
        jobNumber: row.job_number,
        jobName: row.job_name,
        status: row.status,
        siteName: row.site_name ?? "",
        salesPerson: row.sales_person ?? "",
        projectManager: row.project_manager ?? "",
        shopDrawings: row.shop_drawings ?? false,
        deviceRegister: row.device_register ?? false,
        ordered: row.ordered ?? false,
        jobPacked: row.job_packed ?? false,
        installed: row.installed ?? false,
        asBuilts: row.as_builts ?? false,
        startDate: row.start_date ?? "",
        finishDate: row.finish_date ?? "",
        archived: row.archived ?? false,
        expanded: false,
        subtasks: (row.project_subtasks ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            completed: s.completed ?? false,
            startDate: s.start_date ?? "",
            dueDate: s.due_date ?? "",
            assignedTo: s.assigned_to ?? "",
            duration: s.duration ?? 1,
        })),
    };
}

export default function ProjectGanttPage() {
    const [sb, setSb] = React.useState<SupabaseClient | null>(null);
    const [projects, setProjects] = React.useState<Project[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        setSb(supabaseBrowser());
    }, []);

    React.useEffect(() => {
        if (!sb) return;

        const fetchProjects = async () => {
            setLoading(true);
            setError(null);

            const { data, error } = await sb
                .from("projects")
                .select(
                    `
        id,
        job_number,
        job_name,
        status,
        site_name,
        sales_person,
        project_manager,
        shop_drawings,
        device_register,
        ordered,
        job_packed,
        installed,
        as_builts,
        start_date,
        finish_date,
        archived,
        project_subtasks (
          id,
          project_id,
          name,
          completed,
          start_date,
          due_date,
          assigned_to,
          duration,
          priority
        )
      `
                )
                .order("start_date", { ascending: true });

            if (error) {
                console.error(error);
                setError("Failed to load projects");
                setProjects([]);
                setLoading(false);
                return;
            }

            const mapped = (data ?? []).map((row) => mapRowToProject(row as ProjectRow));
            setProjects(mapped);
            setLoading(false);
        };

        fetchProjects();
    }, [sb]);

    // Show only active (non-archived, not On Hold) in Gantt
    const activeProjects = projects.filter(
        (p) => !p.archived && p.status !== "On Hold"
    );

    return (
        <div className="p-4 md:p-6 lg:p-8 space-y-4">
            <PageHeader
                title="Project Gantt"
                subtitle="Timeline view of active projects and subtasks."
            />

            {error && (
                <div className="text-sm text-red-600 mb-2">
                    {error}
                </div>
            )}

            <GanttChart projects={activeProjects} loading={loading} />
        </div>
    );
}

type ZoomMode = "day" | "week" | "month";

function GanttChart({
                        projects,
                        loading,
                    }: {
    projects: Project[];
    loading: boolean;
}) {
    const [zoom, setZoom] = React.useState<ZoomMode>("day");

    // ---- date utils
    const parseISO = (s: string) => {
        const d = new Date(s);
        d.setHours(0, 0, 0, 0);
        return d;
    };
    const dayDiff = (a: Date, b: Date) =>
        Math.round((b.getTime() - a.getTime()) / 86_400_000);
    const addDays = (d: Date, n: number) =>
        new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

    const fmtTickLabel = (d: Date) => {
        if (zoom === "month") {
            return d.toLocaleDateString(undefined, {
                month: "short",
                year: "2-digit",
            });
        }
        if (zoom === "week") {
            return d.toLocaleDateString(undefined, {
                day: "2-digit",
                month: "short",
            });
        }
        // day view
        return d.toLocaleDateString(undefined, {
            day: "2-digit",
            month: "short",
        });
    };

    // ---- layout / spacing
    const dayWidth =
        zoom === "day" ? 28 : zoom === "week" ? 18 : 8; // month = narrower
    const HEADER_H = 32;
    const ROW_H = 56;
    const ROW_GAP = 6;
    const BAR_VPAD = 12;
    const LABEL_W = 320;
    const BODY_MAX_H = 640;

    // ---- compute chart range from all project + subtask dates
    const ranges = projects.flatMap((p) => {
        const arr: { start: Date; end: Date }[] = [];
        if (p.startDate && p.finishDate) {
            arr.push({
                start: parseISO(p.startDate),
                end: parseISO(p.finishDate),
            });
        }
        p.subtasks.forEach((s) => {
            if (s.startDate && s.dueDate) {
                arr.push({
                    start: parseISO(s.startDate),
                    end: parseISO(s.dueDate),
                });
            }
        });
        return arr;
    });

    if (!ranges.length) {
        return (
            <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">
                    {loading ? "Loading timeline…" : "No active projects to display."}
                </CardContent>
            </Card>
        );
    }

    const minDate = new Date(Math.min(...ranges.map((r) => r.start.getTime())));
    const maxDate = new Date(Math.max(...ranges.map((r) => r.end.getTime())));

    const PAD_DAYS = 3;
    const chartStart = addDays(minDate, -PAD_DAYS);
    const chartEnd = addDays(maxDate, PAD_DAYS);
    const totalDays = Math.max(1, dayDiff(chartStart, chartEnd));

    // flattened rows (project row + subtasks)
    type Row = {
        kind: "project" | "subtask";
        pIdx: number;
        sIdx?: number;
        label: string;
    };
    const rows: Row[] = [];
    projects.forEach((p, pIdx) => {
        rows.push({
            kind: "project",
            pIdx,
            label: `${p.jobNumber} — ${p.jobName}`,
        });
        p.subtasks.forEach((s, sIdx) =>
            rows.push({
                kind: "subtask",
                pIdx,
                sIdx,
                label: s.name || "Untitled subtask",
            })
        );
    });
    const bodyHeight = rows.length * (ROW_H + ROW_GAP);

    // axis helpers
    const xFromISO = (iso: string) =>
        dayDiff(chartStart, parseISO(iso)) * dayWidth;
    const wFromRange = (startISO: string, endISO: string) => {
        const wDays = Math.max(1, dayDiff(parseISO(startISO), parseISO(endISO)));
        return wDays * dayWidth;
    };

    // ticks: based on zoom mode
    const tickDates: Date[] = [];
    if (zoom === "day") {
        const stepDays = 1;
        for (let d = 0; d <= totalDays; d += stepDays) {
            tickDates.push(addDays(chartStart, d));
        }
    } else if (zoom === "week") {
        const stepDays = 7;
        for (let d = 0; d <= totalDays; d += stepDays) {
            tickDates.push(addDays(chartStart, d));
        }
    } else {
        // month view: approximate 30-day steps
        const stepDays = 30;
        for (let d = 0; d <= totalDays; d += stepDays) {
            tickDates.push(addDays(chartStart, d));
        }
    }

    // today marker
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayX = Math.max(
        0,
        Math.min(totalDays * dayWidth, dayDiff(chartStart, today) * dayWidth)
    );

    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium">
                        Gantt — Active Projects & Subtasks
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Zoom</span>
                        <select
                            className="border bg-card rounded px-2 py-1"
                            value={zoom}
                            onChange={(e) => setZoom(e.target.value as ZoomMode)}
                        >
                            <option value="day">Day</option>
                            <option value="week">Week</option>
                            <option value="month">Month</option>
                        </select>
                    </div>
                </div>

                <div className="relative border border-gray-300 rounded-lg overflow-hidden">
                    {/* HEADER */}
                    <div
                        className="grid"
                        style={{ gridTemplateColumns: `${LABEL_W}px 1fr` }}
                    >
                        <div
                            className="border-r border-gray-300 bg-card px-4 flex items-center text-xs font-medium"
                            style={{ height: HEADER_H }}
                        >
                            Task
                        </div>
                        <div className="relative bg-muted/40" style={{ height: HEADER_H }}>
                            {tickDates.map((d, i) => {
                                const x = dayDiff(chartStart, d) * dayWidth;
                                return (
                                    <div
                                        key={i}
                                        className="absolute border-l text-[10px] text-muted-foreground"
                                        style={{ left: x, height: "100%" }}
                                    >
                                        <div className="absolute left-1 top-0.5">
                                            {fmtTickLabel(d)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* BODY (labels + timeline) */}
                    <div
                        className="grid"
                        style={{
                            gridTemplateColumns: `${LABEL_W}px 1fr`,
                            maxHeight: BODY_MAX_H,
                            overflowY: "auto",
                        }}
                    >
                        {/* Labels */}
                        <div className="border-r bg-card relative">
                            {rows.map((r) => {
                                const isProject = r.kind === "project";
                                return (
                                    <div
                                        key={`lbl-${r.kind}-${r.pIdx}-${r.sIdx ?? -1}`}
                                        className={
                                            isProject
                                                ? "px-4 flex items-center text-sm font-semibold"
                                                : "px-6 text-xs text-muted-foreground flex items-center"
                                        }
                                        style={{
                                            height: ROW_H,
                                            marginBottom: ROW_GAP,
                                        }}
                                    >
                                        {r.kind === "subtask" ? <>▸ {r.label}</> : r.label}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Timeline */}
                        <div className="overflow-x-auto">
                            <div
                                className="relative"
                                style={{
                                    width: totalDays * dayWidth,
                                    height: bodyHeight,
                                    backgroundImage: `repeating-linear-gradient(
                    to bottom,
                    transparent,
                    transparent ${ROW_H + ROW_GAP - 1}px,
                    rgba(0,0,0,0.03) ${ROW_H + ROW_GAP - 1}px,
                    rgba(0,0,0,0.03) ${ROW_H + ROW_GAP}px
                  )`,
                                }}
                            >
                                {/* Today marker */}
                                <div
                                    className="absolute top-0 bottom-0 border-l border-orange-500/70"
                                    style={{ left: todayX }}
                                    title="Today"
                                />

                                {/* Bars */}
                                {projects.map((p, pIdx) => {
                                    const projRowIndex = rows.findIndex(
                                        (r) => r.kind === "project" && r.pIdx === pIdx
                                    );
                                    const baseTop = projRowIndex * (ROW_H + ROW_GAP);

                                    const projX =
                                        p.startDate && p.finishDate ? xFromISO(p.startDate) : 0;
                                    const projW =
                                        p.startDate && p.finishDate
                                            ? Math.max(6, wFromRange(p.startDate, p.finishDate))
                                            : dayWidth;

                                    const pColor = (() => {
                                        switch (p.status) {
                                            case "Engineering":
                                                return "bg-pink-400";
                                            case "Procurement":
                                                return "bg-yellow-400";
                                            case "On Hold":
                                                return "bg-amber-400"; // orangey gold
                                            case "Schedule":
                                                return "bg-orange-400";
                                            case "In Progress":
                                                return "bg-green-500";
                                            case "Completed":
                                                return "bg-sky-400";
                                            default:
                                                return "bg-slate-400";
                                        }
                                    })();

                                    const barCommon = {
                                        top: baseTop + BAR_VPAD,
                                        height: ROW_H - BAR_VPAD * 2,
                                        opacity: 0.9,
                                    } as const;

                                    return (
                                        <div key={`bars-${p.id}`}>
                                            {/* Project bar */}
                                            <div
                                                className={`absolute rounded ${pColor}`}
                                                title={`${p.jobNumber} — ${p.jobName}`}
                                                style={{ left: projX, width: projW, ...barCommon }}
                                            />

                                            {/* Subtask bars */}
                                            {p.subtasks.map((s, sIdx) => {
                                                const rowIndex = projRowIndex + 1 + sIdx;
                                                const y = rowIndex * (ROW_H + ROW_GAP);

                                                if (!s.startDate || !s.dueDate) {
                                                    return null;
                                                }

                                                const x = xFromISO(s.startDate);
                                                const w = Math.max(
                                                    4,
                                                    wFromRange(s.startDate, s.dueDate)
                                                );
                                                const overdue =
                                                    !s.completed && parseISO(s.dueDate) < today;
                                                const cls = s.completed
                                                    ? "bg-emerald-400"
                                                    : overdue
                                                        ? "bg-red-500"
                                                        : "bg-blue-500";

                                                return (
                                                    <div
                                                        key={s.id}
                                                        className={`absolute rounded ${cls}`}
                                                        title={`${s.name} (${s.assignedTo || "Unassigned"})`}
                                                        style={{
                                                            left: x,
                                                            width: w,
                                                            top: y + BAR_VPAD,
                                                            height: ROW_H - BAR_VPAD * 2,
                                                            opacity: 0.9,
                                                        }}
                                                    />
                                                );
                                            })}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Legend */}
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded bg-green-500" />{" "}
              Project (in progress)
          </span>
                    <span className="inline-flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded bg-sky-500" />{" "}
                        Project (completed)
          </span>
                    <span className="inline-flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded bg-slate-400" />{" "}
                        Project (other status)
          </span>
                    <span className="inline-flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded bg-sky-500" />{" "}
                        Subtask (completed)
          </span>
                    <span className="inline-flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded bg-green-500" />{" "}
                        Subtask (active)
          </span>
                    <span className="inline-flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded bg-red-500" />{" "}
                        Subtask (overdue)
          </span>
                    <span className="inline-flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded bg-orange-500/70" />{" "}
                        Today
          </span>
                </div>
            </CardContent>
        </Card>
    );
}
