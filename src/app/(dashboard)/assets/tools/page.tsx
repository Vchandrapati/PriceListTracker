"use client";

import * as React from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ToolRow = {
    toolName: string;
    status: "Available" | "Checked Out" | "Maintenance";
    contractor: string | null;      // contractor given to
    checkedOutBy: string | null;    // employee/user who checked it out
    location: string;               // depot/site/van
    lastActivity: string;           // human label
};

type ActivityLog = {
    at: string;         // ISO
    description: string;
};

export default function ToolsPage() {
    const [rows, setRows] = React.useState<ToolRow[]>([
        {
            toolName: "Hammer Drill",
            status: "Checked Out",
            contractor: "BuildRight Pty Ltd",
            checkedOutBy: "Alex Morgan",
            location: "Site A",
            lastActivity: "Checked out 2025-10-01 15:10",
        },
        {
            toolName: "Laser Level",
            status: "Available",
            contractor: null,
            checkedOutBy: null,
            location: "Depot",
            lastActivity: "Returned 2025-09-30 09:22",
        },
        {
            toolName: "Angle Grinder",
            status: "Maintenance",
            contractor: null,
            checkedOutBy: null,
            location: "Workshop",
            lastActivity: "Tagged out 2025-09-29",
        },
    ]);

    const [log, setLog] = React.useState<ActivityLog[]>([
        { at: new Date().toISOString(), description: "Tool list imported" },
        { at: new Date(Date.now() - 3600_000).toISOString(), description: "Hammer Drill was checked out by Alex Morgan" },
    ]);

    // optional simulated actions (no backend yet)
    function markReturned(toolName: string) {
        setRows((cur) =>
            cur.map((t) =>
                t.toolName === toolName
                    ? {
                        ...t,
                        status: "Available",
                        contractor: null,
                        checkedOutBy: null,
                        lastActivity: `Returned ${new Date().toLocaleString()}`,
                        location: "Depot",
                    }
                    : t,
            ),
        );
        setLog((l) => [{ at: new Date().toISOString(), description: `${toolName} was returned` }, ...l]);
    }

    return (
        <div className="p-4 md:p-6 lg:p-8 space-y-4">
            <PageHeader title="Tools" subtitle="Tool pool status and recent activity." />

            {/* Tools table */}
            <Card>
                <CardContent className="p-5 space-y-4">
                    <div className="rounded-xl border bg-card overflow-hidden">
                        <div className="overflow-x-auto">
                            <Table className="w-full min-w-[1100px] text-[15px] md:text-base">
                                <TableHeader>
                                    <TableRow className="h-12">
                                        <TableHead className="px-4">Tool Name</TableHead>
                                        <TableHead className="px-4">Status</TableHead>
                                        <TableHead className="px-4">Contractor</TableHead>
                                        <TableHead className="px-4">Checked Out By</TableHead>
                                        <TableHead className="px-4">Location</TableHead>
                                        <TableHead className="px-4">Last Activity</TableHead>
                                        <TableHead className="px-4">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody className="[&>tr]:h-12 [&>tr>td]:py-3 [&>tr>td]:px-4 [&>tr>td]:whitespace-nowrap">
                                    {rows.map((r) => (
                                        <TableRow key={r.toolName}>
                                            <TableCell>{r.toolName}</TableCell>
                                            <TableCell>{r.status}</TableCell>
                                            <TableCell>{r.contractor ?? "—"}</TableCell>
                                            <TableCell>{r.checkedOutBy ?? "—"}</TableCell>
                                            <TableCell>{r.location}</TableCell>
                                            <TableCell className="max-w-[420px] truncate">{r.lastActivity}</TableCell>
                                            <TableCell>
                                                <div className="flex gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={r.status !== "Checked Out"}
                                                        onClick={() => markReturned(r.toolName)}
                                                    >
                                                        Mark Returned
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {rows.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                                                No tools yet.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>

                    {/* Activity log */}
                    <div className="space-y-2">
                        <div className="text-sm font-medium">Activity Log</div>
                        <div className="rounded-xl border bg-card overflow-hidden">
                            <div className="overflow-x-auto">
                                <Table className="w-full min-w-[800px] text-[14px]">
                                    <TableHeader>
                                        <TableRow className="h-10">
                                            <TableHead className="px-4">When</TableHead>
                                            <TableHead className="px-4">What</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {log.map((e, i) => (
                                            <TableRow key={i}>
                                                <TableCell className="px-4">{new Date(e.at).toLocaleString()}</TableCell>
                                                <TableCell className="px-4">{e.description}</TableCell>
                                            </TableRow>
                                        ))}
                                        {log.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                                                    No activity yet.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
