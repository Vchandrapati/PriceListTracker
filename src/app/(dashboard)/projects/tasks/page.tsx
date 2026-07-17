"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Clock3, ListTodo, RefreshCw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Health = "Overdue" | "At risk" | "On track" | "No tasks";
type JobTaskSummary = {
    job_id: number; job_name: string; customer_name: string; current_phase: string;
    phase_progress_percent: number; task_progress_percent: number; open_tasks: number;
    overdue_tasks: number; blocked_tasks: number; due_soon_tasks: number; health: Health;
    current_task: string; current_task_assignees: string;
    current_task_due_date: string | null; updated_at: string;
};

const healthOrder: Record<Health, number> = { Overdue: 0, "At risk": 1, "No tasks": 2, "On track": 3 };

function dueLabel(value: string | null) {
    if (!value) return "No due date";
    const due = new Date(`${value}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return "Due today";
    if (days === 1) return "Due tomorrow";
    return `Due ${due.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
}

function healthStyle(health: Health) {
    if (health === "Overdue") return "border-l-red-500 bg-red-50/70 dark:bg-red-950/20";
    if (health === "At risk") return "border-l-amber-500 bg-amber-50/70 dark:bg-amber-950/20";
    if (health === "On track") return "border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/15";
    return "border-l-slate-400 bg-muted/40";
}

function JobRow({ job }: { job: JobTaskSummary }) {
    return (
        <article className={cn("rounded-md border border-l-4 px-2.5 py-2", healthStyle(job.health))}>
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{job.job_id}</span>
                        <h2 className="truncate text-xs font-semibold" title={job.job_name}>{job.job_name}</h2>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{job.current_phase || "Unmapped status"}</div>
                </div>
                <span className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                    job.health === "Overdue" && "bg-red-600 text-white",
                    job.health === "At risk" && "bg-amber-500 text-black",
                    job.health === "On track" && "bg-emerald-600 text-white",
                    job.health === "No tasks" && "bg-slate-500 text-white",
                )}>{job.health}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${job.task_progress_percent}%` }} />
                </div>
                <span className="text-[10px] font-medium tabular-nums">{job.task_progress_percent}%</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                <span className="min-w-0 truncate font-medium" title={job.current_task}>{job.current_task}</span>
                <span className={cn("shrink-0", job.overdue_tasks > 0 ? "font-semibold text-red-700 dark:text-red-400" : "text-muted-foreground")}>
                    {dueLabel(job.current_task_due_date)}
                </span>
            </div>
            <div className="mt-0.5 flex justify-between gap-2 text-[9px] text-muted-foreground">
                <span className="truncate">{job.current_task_assignees || "Unassigned"}</span>
                <span className="shrink-0">{job.open_tasks} open{job.blocked_tasks ? ` · ${job.blocked_tasks} blocked` : ""}</span>
            </div>
        </article>
    );
}

export default function TaskWallboardPage() {
    const [jobs, setJobs] = React.useState<JobTaskSummary[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const load = React.useCallback(async () => {
        setError(null);
        const { data, error: queryError } = await supabaseBrowser().from("task_dashboard_jobs").select("*");
        if (queryError) setError(queryError.message);
        else setJobs(((data ?? []) as JobTaskSummary[]).sort((a, b) =>
            healthOrder[a.health] - healthOrder[b.health]
            || (a.current_task_due_date ?? "9999").localeCompare(b.current_task_due_date ?? "9999")
            || a.job_id - b.job_id));
        setLoading(false);
    }, []);

    React.useEffect(() => {
        void load();
        const timer = window.setInterval(() => void load(), 300_000);
        return () => window.clearInterval(timer);
    }, [load]);

    const counts = React.useMemo(() => ({
        overdue: jobs.filter((j) => j.health === "Overdue").length,
        risk: jobs.filter((j) => j.health === "At risk").length,
        track: jobs.filter((j) => j.health === "On track").length,
        open: jobs.reduce((sum, j) => sum + j.open_tasks, 0),
    }), [jobs]);
    const lastUpdated = jobs.reduce((latest, job) => job.updated_at > latest ? job.updated_at : latest, "");

    return (
        <div className="space-y-3">
            <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b pb-3">
                <div className="mr-auto">
                    <h1 className="text-xl font-semibold tracking-tight">Project Task Wallboard</h1>
                    <p className="text-xs text-muted-foreground">Every active job, ordered by what needs attention first.</p>
                </div>
                <div className="flex items-center gap-4 text-xs tabular-nums">
                    <span className="flex items-center gap-1.5"><AlertTriangle className="size-3.5 text-red-600" />{counts.overdue} overdue</span>
                    <span className="flex items-center gap-1.5"><Clock3 className="size-3.5 text-amber-500" />{counts.risk} at risk</span>
                    <span className="flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-emerald-600" />{counts.track} on track</span>
                    <span className="flex items-center gap-1.5"><ListTodo className="size-3.5" />{counts.open} open tasks</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
                    <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Refresh
                </Button>
            </header>
            {error && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">Could not load tasks: {error}</div>}
            {!error && loading && !jobs.length && <div className="py-16 text-center text-sm text-muted-foreground">Loading project tasks…</div>}
            {!error && !loading && !jobs.length && <div className="py-16 text-center text-sm text-muted-foreground">No current jobs found.</div>}
            {!!jobs.length && <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">{jobs.map((job) => <JobRow key={job.job_id} job={job} />)}</div>}
            <footer className="text-right text-[10px] text-muted-foreground">
                {lastUpdated ? `Data updated ${new Date(lastUpdated).toLocaleString("en-AU")}` : ""}
            </footer>
        </div>
    );
}
