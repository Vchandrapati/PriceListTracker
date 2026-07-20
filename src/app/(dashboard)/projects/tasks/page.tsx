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
type OpenTask = {
    task_id: number; job_id: number; subject: string; assignees: string;
    due_date: string | null; is_overdue: boolean; is_blocked: boolean;
    priority: string; attention_rank: number;
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
    return `${days}d left`;
}

function healthStyle(health: Health) {
    if (health === "Overdue") return "border-l-red-500 bg-red-50/70 dark:bg-red-950/20";
    if (health === "At risk") return "border-l-amber-500 bg-amber-50/70 dark:bg-amber-950/20";
    if (health === "On track") return "border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/15";
    return "border-l-blue-500 bg-blue-50/60 dark:bg-blue-950/20";
}

function JobRow({ job, tasks }: { job: JobTaskSummary; tasks: OpenTask[] }) {
    return (
        <article className={cn("rounded-md border border-l-4 px-2.5 py-2", healthStyle(job.health))}>
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{job.job_id}</span>
                        <h2 className="truncate text-sm font-semibold" title={job.job_name}>{job.job_name}</h2>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{job.current_phase || "Unmapped status"}</div>
                </div>
                <span className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    job.health === "Overdue" && "bg-red-600 text-white",
                    job.health === "At risk" && "bg-amber-500 text-black",
                    job.health === "On track" && "bg-emerald-600 text-white",
                    job.health === "No tasks" && "bg-blue-600 text-white",
                )}>{job.health}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${job.task_progress_percent}%` }} />
                </div>
                <span className="text-xs font-medium tabular-nums">{job.task_progress_percent}%</span>
            </div>
            <div className="mt-1.5 divide-y divide-black/10 border-t border-black/10 dark:divide-white/10 dark:border-white/10">
                {tasks.length ? tasks.map((task) => (
                    <div key={task.task_id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 py-1">
                        <span className="truncate text-xs font-medium" title={task.subject}>{task.subject}</span>
                        <span className={cn(
                            "text-xs tabular-nums",
                            task.is_overdue ? "font-semibold text-red-700 dark:text-red-400" : "text-muted-foreground",
                        )}>{dueLabel(task.due_date)}</span>
                        <span className="truncate text-[10px] text-muted-foreground">{task.assignees || "Unassigned"}</span>
                        <span className="text-[10px] text-muted-foreground">{task.is_blocked ? "Blocked" : task.priority}</span>
                    </div>
                )) : (
                    <div className="py-1 text-xs text-muted-foreground">{job.current_task}</div>
                )}
            </div>
            <div className="mt-0.5 text-right text-[10px] text-muted-foreground">
                {job.open_tasks} open{job.blocked_tasks ? ` · ${job.blocked_tasks} blocked` : ""}
            </div>
        </article>
    );
}

export default function TaskWallboardPage() {
    const [jobs, setJobs] = React.useState<JobTaskSummary[]>([]);
    const [tasksByJob, setTasksByJob] = React.useState<Record<number, OpenTask[]>>({});
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const load = React.useCallback(async () => {
        setError(null);
        const supabase = supabaseBrowser();
        const [jobsResult, tasksResult] = await Promise.all([
            supabase.from("task_dashboard_jobs").select("*"),
            supabase.from("task_dashboard_tasks")
                .select("task_id,job_id,subject,assignees,due_date,is_overdue,is_blocked,priority,attention_rank")
                .eq("is_open", true)
                .order("attention_rank", { ascending: false }),
        ]);
        const queryError = jobsResult.error ?? tasksResult.error;
        if (queryError) setError(queryError.message);
        else {
            setJobs(((jobsResult.data ?? []) as JobTaskSummary[]).sort((a, b) =>
            healthOrder[a.health] - healthOrder[b.health]
            || (a.current_task_due_date ?? "9999").localeCompare(b.current_task_due_date ?? "9999")
            || a.job_id - b.job_id));
            const grouped: Record<number, OpenTask[]> = {};
            for (const task of (tasksResult.data ?? []) as OpenTask[]) {
                (grouped[task.job_id] ??= []).push(task);
            }
            setTasksByJob(grouped);
        }
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
    const sections = React.useMemo(() => [
        {
            title: "Behind Schedule",
            jobs: jobs.filter((job) => job.health === "Overdue" || job.health === "At risk"),
            heading: "text-red-700 dark:text-red-400",
            rule: "border-red-300 dark:border-red-900",
        },
        {
            title: "On Track",
            jobs: jobs.filter((job) => job.health === "On track"),
            heading: "text-emerald-700 dark:text-emerald-400",
            rule: "border-emerald-300 dark:border-emerald-900",
        },
        {
            title: "No Tasks Assigned",
            jobs: jobs.filter((job) => job.health === "No tasks"),
            heading: "text-blue-700 dark:text-blue-400",
            rule: "border-blue-300 dark:border-blue-900",
        },
    ], [jobs]);
    const lastUpdated = jobs.reduce((latest, job) => job.updated_at > latest ? job.updated_at : latest, "");

    return (
        <div className="space-y-3">
            <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b pb-3">
                <div className="mr-auto">
                    <h1 className="text-2xl font-semibold tracking-tight">Project Task Wallboard</h1>
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
            {!!jobs.length && <div className="space-y-4">
                {sections.map((section) => (
                    <section key={section.title} aria-labelledby={`section-${section.title.replaceAll(" ", "-").toLowerCase()}`}>
                        <div className={cn("mb-2 flex items-baseline gap-2 border-b-2 px-1 pb-1", section.rule)}>
                            <h2
                                id={`section-${section.title.replaceAll(" ", "-").toLowerCase()}`}
                                className={cn("text-xl font-semibold leading-none tracking-tight", section.heading)}
                            >
                                {section.title}
                            </h2>
                            <span className="text-base font-medium leading-none tabular-nums text-foreground">
                                {section.jobs.length} jobs
                            </span>
                        </div>
                        {section.jobs.length ? (
                            <div className="columns-1 gap-1.5 md:columns-2 xl:columns-3">
                                {section.jobs.map((job) => (
                                    <div key={job.job_id} className="mb-1.5 break-inside-avoid">
                                        <JobRow job={job} tasks={tasksByJob[job.job_id] ?? []} />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="py-2 text-xs text-muted-foreground">No jobs in this section.</div>
                        )}
                    </section>
                ))}
            </div>}
            <footer className="text-right text-[10px] text-muted-foreground">
                {lastUpdated ? `Data updated ${new Date(lastUpdated).toLocaleString("en-AU")}` : ""}
            </footer>
        </div>
    );
}
