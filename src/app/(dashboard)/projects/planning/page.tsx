"use client";

import * as React from "react";
import Link from "next/link";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase";

import { Plus, ChevronDown, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

/** ---- Types ---- */
type SubtaskPriority = "Standard" | "Urgent";

type Subtask = {
    id: number;
    name: string;
    completed: boolean;
    startDate: string; // ISO yyyy-mm-dd
    dueDate: string;   // ISO yyyy-mm-dd
    assignedTo: string;
    duration: number;  // days
    priority: SubtaskPriority;
    sortOrder: number;// NEW
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
    startDate: string;   // ISO yyyy-mm-dd
    finishDate: string;  // ISO yyyy-mm-dd
    archived: boolean;
    expanded: boolean;   // UI-only
    subtasks: Subtask[];
};

type ProjectUpdatePatch = {
    [key: string]: string | number | boolean | null;
};

type SubtaskUpdatePatch = {
    [key: string]: string | number | boolean | null;
};

/** ---- Helper utils ---- */
// ---- Colour helpers ----
function getStatusChipClasses(status: ProjectStatus) {
    switch (status) {
        case "Engineering":
            return "bg-pink-100 text-pink-800 border-pink-300";
        case "Procurement":
            return "bg-yellow-100 text-yellow-800 border-yellow-300";
        case "On Hold":
            return "bg-amber-100 text-amber-800 border-amber-300"; // orangey-gold
        case "Schedule":
            return "bg-orange-100 text-orange-800 border-orange-300";
        case "In Progress":
            return "bg-green-100 text-green-800 border-green-300";
        case "Completed":
            return "bg-sky-100 text-sky-800 border-sky-300";
        default:
            return "bg-gray-100 text-gray-800 border-gray-300";
    }
}

function getPriorityChipClasses(priority: SubtaskPriority) {
    switch (priority) {
        case "Urgent":
            return "bg-red-100 text-red-800 border-red-300";
        case "Standard":
        default:
            return "bg-white text-gray-800 border-gray-300";
    }
}

function calcDurationDays(startISO: string, endISO: string) {
    if (!startISO || !endISO) return 0;
    const start = new Date(startISO);
    const end = new Date(endISO);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const diffMs = end.getTime() - start.getTime();
    const diffDays = Math.round(diffMs / 86_400_000); // ms per day
    return Math.max(0, diffDays);
}

function isSubtaskOverdue(st: Subtask) {
    if (st.completed) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(st.dueDate);
    due.setHours(0, 0, 0, 0);
    return due < today;
}

function calcProgressByDates(startISO: string, endISO: string) {
    if (!startISO || !endISO) return 0;
    const today = new Date();
    const start = new Date(startISO);
    const end = new Date(endISO);
    if (today < start) return 0;
    if (today > end) return 100;
    const total = end.getTime() - start.getTime();
    if (total <= 0) return 0;
    const elapsed = today.getTime() - start.getTime();
    return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
}

/** ---- DB row types ---- */
type ProjectRow = {
    id: number;
    job_number: string;
    job_name: string;
    status: ProjectStatus;
    site_name: string;
    sales_person: string;
    project_manager: string;
    shop_drawings: boolean;
    device_register: boolean;
    ordered: boolean;
    job_packed: boolean;
    installed: boolean;
    as_builts: boolean;
    start_date: string | null;
    finish_date: string | null;
    archived: boolean | null;
    project_subtasks: SubtaskRow[] | null;
};

type SubtaskRow = {
    id: number;
    project_id: number;
    name: string;
    completed: boolean;
    start_date: string | null;
    due_date: string | null;
    assigned_to: string | null;
    duration: number | null;
    priority: SubtaskPriority;
    sort_order: number | null; // NEW
};

function mapRowToProject(row: ProjectRow): Project {
    const subtasks = (row.project_subtasks ?? [])
        .map((s) => ({
            id: s.id,
            name: s.name,
            completed: s.completed ?? false,
            startDate: s.start_date ?? "",
            dueDate: s.due_date ?? "",
            assignedTo: s.assigned_to ?? "",
            duration: s.duration ?? 1,
            priority: s.priority ?? "Standard",
            sortOrder: s.sort_order ?? 0,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder); // important

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
        subtasks,
    };
}

export default function ProjectOverviewPage() {
    const [sb, setSb] = React.useState<SupabaseClient | null>(null);
    const [projects, setProjects] = React.useState<Project[]>([]);
    const [loading, setLoading] = React.useState<boolean>(false);
    const [error, setError] = React.useState<string | null>(null);

    const [search, setSearch] = React.useState("");
    const [statusFilter, setStatusFilter] = React.useState<"All" | ProjectStatus>("All");

    React.useEffect(() => {
        setSb(supabaseBrowser());
    }, []);

    const statusOptions: ProjectStatus[] = [
        "Engineering",
        "Procurement",
        "On Hold",
        "Schedule",
        "In Progress",
        "Completed",
    ];

    /** ---- Fetch projects + subtasks ---- */
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
              priority,
              sort_order
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

    /** ---- Derived aggregates (only non-archived) ---- */
    const nonArchived = projects.filter((p) => !p.archived);
    const totalProjects = nonArchived.length;
    const inProgressCount = nonArchived.filter((p) => p.status === "In Progress").length;
    const urgentCount = nonArchived.reduce(
        (acc, p) => acc + p.subtasks.filter((s) => s.priority === "Urgent").length,
        0
    );
    const totalOverdueSubtasks = nonArchived.reduce(
        (acc, p) => acc + p.subtasks.filter(isSubtaskOverdue).length,
        0
    );

    /** ---- Filters / grouping ---- */
    let filtered = projects;
    if (search.trim()) {
        const q = search.toLowerCase();
        filtered = filtered.filter(
            (p) =>
                p.jobNumber.toLowerCase().includes(q) ||
                p.jobName.toLowerCase().includes(q) ||
                p.siteName.toLowerCase().includes(q) ||
                p.salesPerson.toLowerCase().includes(q) ||
                p.projectManager.toLowerCase().includes(q)
        );
    }

    // main "Active" table: non-archived and not "On Hold"
    let activeProjects = filtered.filter(
        (p) => !p.archived && p.status !== "On Hold"
    );
    if (statusFilter !== "All") {
        activeProjects = activeProjects.filter((p) => p.status === statusFilter);
    }

    // On Hold section: non-archived, status = "On Hold"
    const onHoldProjects = filtered.filter(
        (p) => !p.archived && p.status === "On Hold"
    );

    // Archived section
    const archivedProjects = filtered.filter((p) => p.archived);

    /** ---- Mutators (local + DB) ---- */

    const toggleExpand = (id: number) =>
        setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, expanded: !p.expanded } : p)));

    const updateProjectField = async (
        id: number,
        field: keyof Project,
        value: Project[keyof Project],
        patch: ProjectUpdatePatch
    ) => {
        setProjects((ps) =>
            ps.map((p) => (p.id === id ? { ...p, [field]: value } : p))
        );
        if (!sb) return;
        const { error } = await sb.from("projects").update(patch).eq("id", id);
        if (error) {
            console.error(error);
        }
    };

    const updateSubtaskField = async (
        projectId: number,
        subtaskId: number,
        field: keyof Subtask,
        value: Subtask[keyof Subtask],
        patch: SubtaskUpdatePatch
    ) => {
        // Compute whether the project finishDate needs to be extended
        let newProjectFinishDate: string | null = null;

        if (field === "dueDate" && typeof value === "string" && value) {
            const project = projects.find((p) => p.id === projectId);
            if (project) {
                // Build the updated subtasks list for this project
                const updatedSubtasks = project.subtasks.map((s) =>
                    s.id === subtaskId ? { ...s, dueDate: value as string } : s
                );

                // Find the latest due date among all subtasks (non-empty)
                const latestDue = updatedSubtasks
                    .map((s) => s.dueDate)
                    .filter((d) => d && d.trim().length > 0)
                    .sort()
                    .at(-1) ?? null;

                // Only extend finishDate, never shrink
                if (
                    latestDue &&
                    (!project.finishDate || latestDue > project.finishDate)
                ) {
                    newProjectFinishDate = latestDue;
                }
            }
        }

        // Update React state
        setProjects((ps) =>
            ps.map((p) => {
                if (p.id !== projectId) return p;

                const updatedSubtasks = p.subtasks.map((s) =>
                    s.id === subtaskId ? { ...s, [field]: value } : s
                );

                return {
                    ...p,
                    subtasks: updatedSubtasks,
                    finishDate:
                        newProjectFinishDate && newProjectFinishDate > (p.finishDate || "")
                            ? newProjectFinishDate
                            : p.finishDate,
                };
            })
        );

        if (!sb) return;

        // Update the subtask row in DB
        const { error } = await sb
            .from("project_subtasks")
            .update(patch)
            .eq("id", subtaskId);
        if (error) {
            console.error(error);
        }

        // If we extended the project finish, update the project row in DB as well
        if (newProjectFinishDate) {
            const { error: projError } = await sb
                .from("projects")
                .update({ finish_date: newProjectFinishDate })
                .eq("id", projectId);
            if (projError) {
                console.error(projError);
            }
        }
    };

    const handleAddProject = async () => {
        if (!sb) return;
        const today = new Date();
        const in30 = new Date(Date.now() + 30 * 24 * 3600 * 1000);

        const baseJobNumber = `JOB-${String(projects.length + 1).padStart(3, "0")}`;

        const insertPayload = {
            job_number: baseJobNumber,
            job_name: "New Project",
            status: "Engineering" as ProjectStatus,
            site_name: "",
            sales_person: "",
            project_manager: "",
            shop_drawings: false,
            device_register: false,
            ordered: false,
            job_packed: false,
            installed: false,
            as_builts: false,
            start_date: today.toISOString().slice(0, 10),
            finish_date: in30.toISOString().slice(0, 10),
            archived: false,
        };

        const { data, error } = await sb
            .from("projects")
            .insert(insertPayload)
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
            priority,
            sort_order
          )
        `
            )
            .single();

        if (error) {
            console.error(error);
            return;
        }

        const mapped = mapRowToProject(data as ProjectRow);
        setProjects((ps) => [...ps, mapped]);
    };

    const addSubtask = async (projectId: number) => {
        if (!sb) return;
        const today = new Date();
        const weekLater = new Date(today.getTime() + 7 * 24 * 3600 * 1000);

        const project = projects.find((p) => p.id === projectId);
        const nextIndex = project ? project.subtasks.length : 0;

        const newStart = today.toISOString().slice(0, 10);
        const newDue = weekLater.toISOString().slice(0, 10);

        const insertPayload = {
            project_id: projectId,
            name: "New Subtask",
            completed: false,
            start_date: newStart,
            due_date: newDue,
            assigned_to: "",
            duration: 7,
            priority: "Standard" as SubtaskPriority,
            sort_order: nextIndex,
        };

        const { data, error } = await sb
            .from("project_subtasks")
            .insert(insertPayload)
            .select("*")
            .single();

        if (error) {
            console.error(error);
            return;
        }

        const row = data as SubtaskRow;
        const newSubtask: Subtask = {
            id: row.id,
            name: row.name,
            completed: row.completed ?? false,
            startDate: row.start_date ?? "",
            dueDate: row.due_date ?? "",
            assignedTo: row.assigned_to ?? "",
            duration: row.duration ?? 7,
            priority: row.priority ?? "Standard",
            sortOrder: row.sort_order ?? nextIndex,
        };

        // Decide if this new subtask should extend the project finish date
        const shouldExtendFinish =
            newSubtask.dueDate &&
            project &&
            (!project.finishDate || newSubtask.dueDate > project.finishDate);

        const newFinishDate =
            shouldExtendFinish && newSubtask.dueDate ? newSubtask.dueDate : null;

        // Update state
        setProjects((ps) =>
            ps.map((p) =>
                p.id === projectId
                    ? {
                        ...p,
                        finishDate:
                            newFinishDate && newFinishDate > (p.finishDate || "")
                                ? newFinishDate
                                : p.finishDate,
                        subtasks: [...p.subtasks, newSubtask],
                    }
                    : p
            )
        );

        // Update project finish in DB if extended
        if (newFinishDate) {
            const { error: projError } = await sb
                .from("projects")
                .update({ finish_date: newFinishDate })
                .eq("id", projectId);
            if (projError) {
                console.error(projError);
            }
        }
    };

    const moveSubtask = (pid: number, sid: number, dir: "up" | "down") => {
        setProjects((prev) => {
            const updated = prev.map((p) => {
                if (p.id !== pid) return p;
                const idx = p.subtasks.findIndex((s) => s.id === sid);
                if (idx < 0) return p;

                const newIdx =
                    dir === "up"
                        ? Math.max(0, idx - 1)
                        : Math.min(p.subtasks.length - 1, idx + 1);
                if (newIdx === idx) return p;

                const next = [...p.subtasks];
                const [item] = next.splice(idx, 1);
                next.splice(newIdx, 0, item);

                // recompute sortOrder locally
                const nextWithOrder = next.map((s, i) => ({
                    ...s,
                    sortOrder: i,
                }));

                // fire-and-forget DB update – send FULL row so NOT NULL cols are satisfied
                if (sb) {
                    const payload = nextWithOrder.map((s) => ({
                        id: s.id,
                        project_id: pid,
                        name: s.name || "New Subtask",      // ensure NOT NULL
                        completed: s.completed,
                        start_date: s.startDate || null,
                        due_date: s.dueDate || null,
                        assigned_to: s.assignedTo || null,
                        duration: s.duration ?? 0,
                        priority: s.priority,
                        sort_order: s.sortOrder,
                    }));

                    sb
                        .from("project_subtasks")
                        .upsert(payload, { onConflict: "id" })
                        .then(({ error }) => {
                            if (error) console.error(error);
                        });
                }

                return { ...p, subtasks: nextWithOrder };
            });

            return updated;
        });
    };

    /** Quick helpers for state transitions */
    const archiveProject = (p: Project) =>
        updateProjectField(p.id, "archived", true, { archived: true });

    const restoreProject = (p: Project) =>
        updateProjectField(p.id, "archived", false, { archived: false });

    const moveOnHoldToActive = (p: Project) =>
        updateProjectField(p.id, "status", "Engineering", { status: "Engineering" });

    const deleteProject = async (id: number) => {
        // optimistic remove
        setProjects((ps) => ps.filter((p) => p.id !== id));
        if (!sb) return;
        const { error } = await sb.from("projects").delete().eq("id", id);
        if (error) {
            console.error(error);
            // you could refetch here if you want to revert on error
        }
    };

    return (
        <div className="p-3 md:p-6 lg:p-8 space-y-4 max-w-full">
            <PageHeader
                title="Project Overview"
                subtitle="Snapshot of active jobs, milestones, and recent updates."
            />

            {/* Controls */}
            <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                <div className="flex gap-2 flex-wrap">
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search job #, name, site, PM, sales…"
                        className="bg-white border border-gray-200 text-gray-700 rounded-lg px-3 py-2 text-xs md:text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 w-full sm:w-72"
                    />
                    <select
                        className="bg-white border border-gray-200 text-gray-700 rounded-lg px-3 py-2 text-xs md:text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as "All" | ProjectStatus)}
                    >
                        <option value="All">All Status (Active)</option>
                        {statusOptions.map((s) => (
                            <option key={s} value={s}>
                                {s}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="flex gap-2 flex-wrap">
                    <Link
                        href="/projects/gantt"
                        className="flex items-center gap-2 border border-orange-500 text-orange-600 px-3 md:px-4 py-2 rounded-lg hover:bg-orange-50 transition-colors font-medium text-xs md:text-sm"
                    >
                        Gantt View
                    </Link>

                    <button
                        onClick={handleAddProject}
                        className="flex items-center gap-2 bg-orange-500 text-white px-3 md:px-4 py-2 rounded-lg hover:bg-orange-600 transition-colors font-medium text-xs md:text-sm"
                    >
                        <Plus size={16} />
                        New Project
                    </button>
                </div>
            </div>

            {/* Error / Loading */}
            {error && (
                <div className="text-xs md:text-sm text-red-600">
                    {error}
                </div>
            )}

            {/* MAIN TABLE – ACTIVE PROJECTS */}
            <Card>
                <CardContent className="p-3 md:p-4 space-y-2">
                    <div className="text-xs md:text-sm font-semibold mb-1">
                        Active Projects
                    </div>
                    <div className="rounded-xl border border-gray-300 bg-card overflow-hidden max-w-full">
                        <div className="overflow-x-auto">
                            <Table className="w-full text-[11px] md:text-[13px] lg:text-[14px] table-fixed">
                                <TableHeader>
                                    <TableRow className="h-9 md:h-10">
                                        <TableHead className="px-2 w-6 md:w-8"></TableHead>
                                        <TableHead className="px-2 whitespace-nowrap">Job # - Name</TableHead>
                                        <TableHead className="pl-4 pr-2 whitespace-nowrap">Status</TableHead>
                                        <TableHead className="pl-4 pr-2 whitespace-nowrap">Site</TableHead>
                                        <TableHead className="pl-4 pr-2 whitespace-nowrap">Sales</TableHead>
                                        <TableHead className="pl-4 pr-2 whitespace-nowrap">PM</TableHead>
                                        <TableHead className="px-1.5 text-center whitespace-nowrap">Drawings</TableHead>
                                        <TableHead className="px-1.5 text-center whitespace-nowrap">Register</TableHead>
                                        <TableHead className="px-1.5 text-center whitespace-nowrap">Ordered</TableHead>
                                        <TableHead className="px-1.5 text-center whitespace-nowrap">Packed</TableHead>
                                        <TableHead className="px-1.5 text-center whitespace-nowrap">Installed</TableHead>
                                        <TableHead className="px-1.5 text-center whitespace-nowrap">As-builts</TableHead>
                                        <TableHead className="px-2 whitespace-nowrap">Start</TableHead>
                                        <TableHead className="px-2 whitespace-nowrap">Finish</TableHead>
                                        <TableHead className="px-2 whitespace-nowrap">Progress</TableHead>
                                        <TableHead className="px-2 whitespace-nowrap"></TableHead>
                                    </TableRow>
                                </TableHeader>

                                <TableBody>
                                    {!loading &&
                                        activeProjects.map((p) => {
                                            const prog = calcProgressByDates(p.startDate, p.finishDate);
                                            const overdue = p.subtasks.filter(isSubtaskOverdue).length;
                                            const done = p.subtasks.filter((s) => s.completed).length;

                                            return (
                                                <React.Fragment key={p.id}>
                                                    <TableRow className="hover:bg-muted/40">
                                                        <TableCell className="px-2">
                                                            <button
                                                                onClick={() => toggleExpand(p.id)}
                                                                className="text-muted-foreground hover:text-foreground transition-colors"
                                                                aria-label={p.expanded ? "Collapse" : "Expand"}
                                                            >
                                                                {p.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                                            </button>
                                                        </TableCell>

                                                        {/* Job # / Name combined */}
                                                        <TableCell className="px-2 align-middle">
                                                            <div className="flex flex-col gap-1 min-w-[180px]">
                                                                <div className="flex items-center gap-1">
                                                                    <input
                                                                        value={p.jobName}
                                                                        onChange={(e) =>
                                                                            updateProjectField(
                                                                                p.id,
                                                                                "jobName",
                                                                                e.target.value,
                                                                                { job_name: e.target.value }
                                                                            )
                                                                        }
                                                                        className="flex-1 bg-transparent border border-gray-200 rounded px-1.5 py-1 text-[11px] md:text-xs font-medium"
                                                                        placeholder="Job name"
                                                                    />
                                                                    {p.subtasks.length > 0 && (
                                                                        <div className="flex items-center gap-1">
                                      <span className="bg-gray-200 text-gray-700 text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
                                        {done}/{p.subtasks.length}
                                      </span>
                                                                            {overdue > 0 && (
                                                                                <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap">
                                          {overdue} ⚠
                                        </span>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </TableCell>

                                                        {/* Status */}
                                                        <TableCell className="pl-4 pr-2 align-middle">
                                                            <select
                                                                value={p.status}
                                                                onChange={(e) =>
                                                                    updateProjectField(
                                                                        p.id,
                                                                        "status",
                                                                        e.target.value as ProjectStatus,
                                                                        { status: e.target.value }
                                                                    )
                                                                }
                                                                className={
                                                                    "w-full rounded-full px-2 py-1 text-[10px] md:text-xs border " +
                                                                    getStatusChipClasses(p.status)
                                                                }
                                                            >
                                                                {statusOptions.map((s) => (
                                                                    <option key={s} value={s}>
                                                                        {s}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </TableCell>

                                                        <TableCell className="pl-4 pr-2 align-middle">
                                                            <input
                                                                value={p.siteName}
                                                                onChange={(e) =>
                                                                    updateProjectField(p.id, "siteName", e.target.value, {
                                                                        site_name: e.target.value,
                                                                    })
                                                                }
                                                                className="w-full bg-transparent border border-gray-200 rounded px-1.5 py-1 text-[11px] md:text-xs"
                                                            />
                                                        </TableCell>

                                                        <TableCell className="pl-4 pr-2 align-middle">
                                                            <input
                                                                value={p.salesPerson}
                                                                onChange={(e) =>
                                                                    updateProjectField(p.id, "salesPerson", e.target.value, {
                                                                        sales_person: e.target.value,
                                                                    })
                                                                }
                                                                className="w-full bg-transparent border border-gray-200 rounded px-1.5 py-1 text-[11px] md:text-xs"
                                                            />
                                                        </TableCell>

                                                        <TableCell className="pl-4 pr-2 align-middle">
                                                            <input
                                                                value={p.projectManager}
                                                                onChange={(e) =>
                                                                    updateProjectField(p.id, "projectManager", e.target.value, {
                                                                        project_manager: e.target.value,
                                                                    })
                                                                }
                                                                className="w-full bg-transparent border border-gray-200 rounded px-1.5 py-1 text-[11px] md:text-xs"
                                                            />
                                                        </TableCell>

                                                        {/* Booleans */}
                                                        {(
                                                            [
                                                                "shopDrawings",
                                                                "deviceRegister",
                                                                "ordered",
                                                                "jobPacked",
                                                                "installed",
                                                                "asBuilts",
                                                            ] as (keyof Project)[]
                                                        ).map((field) => {
                                                            const dbFieldMap: Record<string, string> = {
                                                                shopDrawings: "shop_drawings",
                                                                deviceRegister: "device_register",
                                                                ordered: "ordered",
                                                                jobPacked: "job_packed",
                                                                installed: "installed",
                                                                asBuilts: "as_builts",
                                                            };
                                                            return (
                                                                <TableCell key={field} className="px-1.5 text-center align-middle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={Boolean(p[field])}
                                                                        onChange={(e) =>
                                                                            updateProjectField(
                                                                                p.id,
                                                                                field,
                                                                                e.target.checked as unknown as Project[keyof Project],
                                                                                { [dbFieldMap[field]]: e.target.checked }
                                                                            )
                                                                        }
                                                                        className="w-4 h-4"
                                                                    />
                                                                </TableCell>
                                                            );
                                                        })}

                                                        <TableCell className="px-2 align-middle">
                                                            <input
                                                                type="date"
                                                                value={p.startDate}
                                                                onChange={(e) =>
                                                                    updateProjectField(p.id, "startDate", e.target.value, {
                                                                        start_date: e.target.value,
                                                                    })
                                                                }
                                                                className="w-full bg-transparent border border-gray-200 rounded px-1.5 py-1 text-[10px] md:text-xs h-8"
                                                            />
                                                        </TableCell>
                                                        <TableCell className="px-2 align-middle">
                                                            <input
                                                                type="date"
                                                                value={p.finishDate}
                                                                onChange={(e) =>
                                                                    updateProjectField(p.id, "finishDate", e.target.value, {
                                                                        finish_date: e.target.value,
                                                                    })
                                                                }
                                                                className="w-full bg-transparent border border-gray-200 rounded px-1.5 py-1 text-[10px] md:text-xs h-8"
                                                            />
                                                        </TableCell>

                                                        <TableCell className="px-2 align-middle">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-16 md:w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                                                                    <div
                                                                        className="h-full bg-orange-500"
                                                                        style={{ width: `${prog}%` }}
                                                                    />
                                                                </div>
                                                                <span className="text-muted-foreground text-[10px] md:text-xs font-medium whitespace-nowrap">
                                  {prog}%
                                </span>
                                                            </div>
                                                        </TableCell>

                                                        {/* Archive/Delete actions */}
                                                        <TableCell className="px-2 align-middle text-right">
                                                            <div className="flex flex-col items-end gap-1">
                                                                <button
                                                                    onClick={() => archiveProject(p)}
                                                                    className="text-[10px] md:text-xs text-gray-500 hover:text-gray-800 underline"
                                                                >
                                                                    Archive
                                                                </button>
                                                                <button
                                                                    onClick={() => deleteProject(p.id)}
                                                                    className="text-[10px] md:text-xs text-red-500 hover:text-red-700 underline"
                                                                >
                                                                    Delete
                                                                </button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>

                                                    {/* Subtasks (expanded row) */}
                                                    {p.expanded && (
                                                        <TableRow>
                                                            <TableCell colSpan={16} className="bg-muted/30 px-2 py-3">
                                                                <div className="ml-4 md:ml-8 space-y-3">
                                                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                                                        <div className="text-xs md:text-sm font-medium">
                                                                            Subtasks for <span className="font-semibold">{p.jobNumber}</span>
                                                                        </div>
                                                                        <button
                                                                            onClick={() => addSubtask(p.id)}
                                                                            className="text-orange-600 hover:text-orange-700 text-xs md:text-sm flex items-center gap-1 font-medium"
                                                                        >
                                                                            <Plus size={14} /> Add Subtask
                                                                        </button>
                                                                    </div>

                                                                    {/* Header row */}
                                                                    <div className="grid grid-cols-[24px_minmax(0,1.5fr)_7.5rem_minmax(0,1fr)_8.5rem_8.5rem_70px] md:grid-cols-[28px_minmax(0,1.5fr)_8rem_minmax(0,1fr)_9.5rem_9.5rem_90px] gap-2 px-1 md:px-2">
                                                                        <div className="text-[10px] md:text-[11px] font-semibold text-muted-foreground">
                                                                            Move
                                                                        </div>
                                                                        <div className="text-[10px] md:text-[11px] font-semibold text-muted-foreground">
                                                                            Task
                                                                        </div>
                                                                        <div className="text-[10px] md:text-[11px] font-semibold text-muted-foreground">
                                                                            Priority
                                                                        </div>
                                                                        <div className="text-[10px] md:text-[11px] font-semibold text-muted-foreground">
                                                                            Assigned to
                                                                        </div>
                                                                        <div className="text-[10px] md:text-[11px] font-semibold text-muted-foreground">
                                                                            Start
                                                                        </div>
                                                                        <div className="text-[10px] md:text-[11px] font-semibold text-muted-foreground">
                                                                            End
                                                                        </div>
                                                                        <div className="text-[10px] md:text-[11px] font-semibold text-muted-foreground text-right">
                                                                            Duration
                                                                        </div>
                                                                    </div>

                                                                    {p.subtasks.length === 0 && (
                                                                        <div className="text-xs md:text-sm text-muted-foreground italic px-1 md:px-2">
                                                                            No subtasks yet.
                                                                        </div>
                                                                    )}

                                                                    {p.subtasks.map((s) => {
                                                                        const overdue = isSubtaskOverdue(s);
                                                                        return (
                                                                            <div
                                                                                key={s.id}
                                                                                className={`grid grid-cols-[24px_minmax(0,1.5fr)_7.5rem_minmax(0,1fr)_8.5rem_8.5rem_70px] md:grid-cols-[28px_minmax(0,1.5fr)_8rem_minmax(0,1fr)_9.5rem_9.5rem_90px] gap-2 items-center p-2 rounded-lg border border-gray-300 ${
                                                                                    overdue
                                                                                        ? "border-red-300 bg-red-50"
                                                                                        : "border-border bg-card"
                                                                                }`}
                                                                            >
                                                                                {/* Move */}
                                                                                <div className="flex flex-col items-center gap-1">
                                                                                    <button
                                                                                        title="Move up"
                                                                                        onClick={() => moveSubtask(p.id, s.id, "up")}
                                                                                        className="p-1 rounded hover:bg-muted"
                                                                                    >
                                                                                        <ArrowUp className="size-3 md:size-4" />
                                                                                    </button>
                                                                                    <button
                                                                                        title="Move down"
                                                                                        onClick={() => moveSubtask(p.id, s.id, "down")}
                                                                                        className="p-1 rounded hover:bg-muted"
                                                                                    >
                                                                                        <ArrowDown className="size-3 md:size-4" />
                                                                                    </button>
                                                                                </div>

                                                                                {/* Task */}
                                                                                <div className="flex items-center gap-2">
                                                                                    <input
                                                                                        type="checkbox"
                                                                                        checked={s.completed}
                                                                                        onChange={(e) =>
                                                                                            updateSubtaskField(
                                                                                                p.id,
                                                                                                s.id,
                                                                                                "completed",
                                                                                                e.target.checked,
                                                                                                { completed: e.target.checked }
                                                                                            )
                                                                                        }
                                                                                        className="w-4 h-4"
                                                                                    />
                                                                                    <input
                                                                                        value={s.name}
                                                                                        onChange={(e) =>
                                                                                            updateSubtaskField(
                                                                                                p.id,
                                                                                                s.id,
                                                                                                "name",
                                                                                                e.target.value,
                                                                                                { name: e.target.value }
                                                                                            )
                                                                                        }
                                                                                        className={`flex-1 bg-transparent border border-gray-200 rounded px-1.5 py-1 text-[11px] md:text-sm ${
                                                                                            s.completed ? "line-through opacity-60" : ""
                                                                                        }`}
                                                                                        placeholder="Task name"
                                                                                    />
                                                                                    {overdue && (
                                                                                        <span className="bg-red-500 text-white text-[9px] md:text-[10px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap">
                                              OVERDUE
                                            </span>
                                                                                    )}
                                                                                </div>

                                                                                {/* Priority */}
                                                                                <div>
                                                                                    <select
                                                                                        value={s.priority}
                                                                                        onChange={(e) =>
                                                                                            updateSubtaskField(
                                                                                                p.id,
                                                                                                s.id,
                                                                                                "priority",
                                                                                                e.target.value as SubtaskPriority,
                                                                                                { priority: e.target.value }
                                                                                            )
                                                                                        }
                                                                                        className={
                                                                                            "w-full rounded px-1.5 py-1 text-[10px] md:text-xs h-8 border " +
                                                                                            getPriorityChipClasses(s.priority)
                                                                                        }
                                                                                    >
                                                                                        <option value="Standard">Standard</option>
                                                                                        <option value="Urgent">Urgent</option>
                                                                                    </select>
                                                                                </div>

                                                                                {/* Assigned to */}
                                                                                <div>
                                                                                    <input
                                                                                        value={s.assignedTo}
                                                                                        onChange={(e) =>
                                                                                            updateSubtaskField(
                                                                                                p.id,
                                                                                                s.id,
                                                                                                "assignedTo",
                                                                                                e.target.value,
                                                                                                { assigned_to: e.target.value }
                                                                                            )
                                                                                        }
                                                                                        className="w-full bg-gray-50 border border-gray-200 rounded px-1.5 py-1 text-[11px] md:text-sm h-8"
                                                                                        placeholder="Assignee"
                                                                                    />
                                                                                </div>

                                                                                {/* Start */}
                                                                                <div>
                                                                                    <input
                                                                                        type="date"
                                                                                        value={s.startDate}
                                                                                        onChange={(e) =>
                                                                                            updateSubtaskField(
                                                                                                p.id,
                                                                                                s.id,
                                                                                                "startDate",
                                                                                                e.target.value,
                                                                                                { start_date: e.target.value }
                                                                                            )
                                                                                        }
                                                                                        className="w-full bg-gray-50 border border-gray-200 rounded px-1.5 py-1 text-[10px] md:text-xs h-8"
                                                                                    />
                                                                                </div>

                                                                                {/* End */}
                                                                                <div>
                                                                                    <input
                                                                                        type="date"
                                                                                        value={s.dueDate}
                                                                                        onChange={(e) =>
                                                                                            updateSubtaskField(
                                                                                                p.id,
                                                                                                s.id,
                                                                                                "dueDate",
                                                                                                e.target.value,
                                                                                                { due_date: e.target.value }
                                                                                            )
                                                                                        }
                                                                                        className={`w-full border rounded px-1.5 py-1 text-[10px] md:text-xs h-8 ${
                                                                                            overdue
                                                                                                ? "bg-red-50 border-red-300"
                                                                                                : "bg-gray-50 border-gray-200"
                                                                                        }`}
                                                                                    />
                                                                                </div>

                                                                                {/* Duration */}
                                                                                <div className="flex items-center justify-end gap-1">
                                          <span className="text-[11px] md:text-sm font-medium">
                                            {calcDurationDays(s.startDate, s.dueDate)}
                                          </span>
                                                                                    <span className="text-[10px] md:text-xs text-muted-foreground">
                                            days
                                          </span>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}

                                    {!loading && activeProjects.length === 0 && (
                                        <TableRow>
                                            <TableCell
                                                colSpan={16}
                                                className="text-center text-xs md:text-sm text-muted-foreground py-8"
                                            >
                                                No active projects match your current filters.
                                            </TableCell>
                                        </TableRow>
                                    )}

                                    {loading && (
                                        <TableRow>
                                            <TableCell
                                                colSpan={16}
                                                className="text-center text-xs md:text-sm text-muted-foreground py-8"
                                            >
                                                Loading…
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* ON HOLD SECTION */}
            <Card>
                <CardContent className="p-3 md:p-4 space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="text-xs md:text-sm font-semibold">
                            On Hold Projects ({onHoldProjects.length})
                        </div>
                    </div>
                    {onHoldProjects.length === 0 ? (
                        <div className="text-xs md:text-sm text-muted-foreground">
                            No projects currently on hold.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {onHoldProjects.map((p) => (
                                <div
                                    key={p.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-300 bg-card px-3 py-2 text-xs md:text-sm"
                                >
                                    <div className="flex flex-col">
                    <span className="font-semibold">
                      {p.jobNumber} — {p.jobName}
                    </span>
                                        <span className="text-[11px] md:text-xs text-gray-600">
                      Site: {p.siteName || "—"} · PM: {p.projectManager || "—"}
                    </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-yellow-100 text-yellow-800 px-2 py-0.5 text-[11px]">
                      On Hold
                    </span>
                                        <button
                                            onClick={() => moveOnHoldToActive(p)}
                                            className="text-[11px] md:text-xs text-orange-600 hover:text-orange-700 underline"
                                        >
                                            Move to Active
                                        </button>
                                        <button
                                            onClick={() => archiveProject(p)}
                                            className="text-[11px] md:text-xs text-gray-500 hover:text-gray-800 underline"
                                        >
                                            Archive
                                        </button>
                                        <button
                                            onClick={() => deleteProject(p.id)}
                                            className="text-[11px] md:text-xs text-red-500 hover:text-red-700 underline"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ARCHIVED SECTION – TABLE */}
            <Card>
                <CardContent className="p-3 md:p-4 space-y-2">
                    <div className="flex items-center justify-between mb-1">
                        <div className="text-xs md:text-sm font-semibold">
                            Archived Projects
                        </div>
                    </div>
                    {archivedProjects.length === 0 ? (
                        <div className="text-xs md:text-sm text-muted-foreground">
                            No archived projects.
                        </div>
                    ) : (
                        <div className="rounded-xl border border-gray-300 bg-card overflow-hidden max-w-full">
                            <div className="overflow-x-auto">
                                <Table className="w-full text-[11px] md:text-[13px] lg:text-[14px]">
                                    <TableHeader>
                                        <TableRow className="h-9 md:h-10">
                                            <TableHead className="px-2 whitespace-nowrap">Job # - Name</TableHead>
                                            <TableHead className="px-2 whitespace-nowrap">Status</TableHead>
                                            <TableHead className="px-2 whitespace-nowrap">Site</TableHead>
                                            <TableHead className="px-2 whitespace-nowrap">Sales</TableHead>
                                            <TableHead className="px-2 whitespace-nowrap">PM</TableHead>
                                            <TableHead className="px-2 whitespace-nowrap">Start</TableHead>
                                            <TableHead className="px-2 whitespace-nowrap">Finish</TableHead>
                                            <TableHead className="px-2 whitespace-nowrap text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {archivedProjects.map((p) => (
                                            <TableRow key={p.id} className="hover:bg-muted/40">
                                                <TableCell className="px-2 align-middle">
                                                    <div className="flex flex-col">
                            <span className="font-medium text-xs md:text-sm">
                              {p.jobNumber} — {p.jobName}
                            </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="px-2 align-middle">
                                                    {p.status}
                                                </TableCell>
                                                <TableCell className="px-2 align-middle">
                                                    {p.siteName || "—"}
                                                </TableCell>
                                                <TableCell className="px-2 align-middle">
                                                    {p.salesPerson || "—"}
                                                </TableCell>
                                                <TableCell className="px-2 align-middle">
                                                    {p.projectManager || "—"}
                                                </TableCell>
                                                <TableCell className="px-2 align-middle">
                                                    {p.startDate || "—"}
                                                </TableCell>
                                                <TableCell className="px-2 align-middle">
                                                    {p.finishDate || "—"}
                                                </TableCell>
                                                <TableCell className="px-2 align-middle text-right">
                                                    <div className="flex flex-col items-end gap-1">
                                                        <button
                                                            onClick={() => restoreProject(p)}
                                                            className="text-[10px] md:text-xs text-orange-600 hover:text-orange-700 underline"
                                                        >
                                                            Restore
                                                        </button>
                                                        <button
                                                            onClick={() => deleteProject(p.id)}
                                                            className="text-[10px] md:text-xs text-red-500 hover:text-red-700 underline"
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Status counts (non-archived only) */}
            <Card>
                <CardContent className="p-4 md:p-5 space-y-2">
                    <div className="text-xs md:text-sm font-medium">Status — Counts (non-archived)</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                        {statusOptions.map((s) => {
                            const count = nonArchived.filter((p) => p.status === s).length;
                            return (
                                <div key={s} className="bg-white rounded-lg p-3 md:p-4 border border-gray-300 shadow-sm">
                                    <div className="text-xl md:text-2xl font-semibold text-gray-900">
                                        {count}
                                    </div>
                                    <div className="text-[11px] md:text-xs font-medium mt-1 text-gray-600">
                                        {s}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* KPI chips */}
            <div className="flex flex-wrap gap-2 text-[10px] md:text-xs">
        <span className="rounded-full bg-gray-100 text-gray-800 px-3 py-1">
          In&nbsp;Progress: <span className="font-semibold">{inProgressCount}</span>
        </span>
                <span className="rounded-full bg-red-100 text-red-700 px-3 py-1">
          Urgent&nbsp;Subtasks: <span className="font-semibold">{urgentCount}</span>
        </span>
                <span className="rounded-full bg-amber-100 text-amber-700 px-3 py-1">
          Overdue&nbsp;Subtasks: <span className="font-semibold">{totalOverdueSubtasks}</span>
        </span>
                <span className="rounded-full bg-gray-100 text-gray-800 px-3 py-1">
          Total&nbsp;Projects (non-archived): <span className="font-semibold">{totalProjects}</span>
        </span>
            </div>
        </div>
    );
}
