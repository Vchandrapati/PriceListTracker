"use client";

import * as React from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type VehicleRow = {
    vehicleId: string;
    plateNumber: string;
    status: "Active" | "In Service" | "Inactive";
    odometerKm: number;
    lastDriver: string;
    lastActivity: string;
    registrationDue: string; // ISO "YYYY-MM-DD"
};

type ToolRow = {
    toolName: string;
    status: "Available" | "Checked Out" | "Maintenance";
    contractor: string | null;
    checkedOutBy: string | null;
    location: string;
    lastActivity: string;
};

type ActivityLog = { at: string; description: string };

function daysUntil(iso: string) {
    const today = new Date();
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const due = new Date(iso + "T00:00:00").getTime();
    const MS = 86_400_000;
    return Math.ceil((due - base) / MS);
}

export default function AssetsDashboardPage() {
    // --- Sample state (no DB yet) ---
    const [vehicles] = React.useState<VehicleRow[]>([
        {
            vehicleId: "VH-001",
            plateNumber: "ABC-123",
            status: "Active",
            odometerKm: 84215,
            lastDriver: "Sam Carter",
            lastActivity: "Trip ended 2h ago",
            registrationDue: "2025-11-15",
        },
        {
            vehicleId: "VH-002",
            plateNumber: "XYZ-789",
            status: "In Service",
            odometerKm: 120355,
            lastDriver: "Jamie Fox",
            lastActivity: "At workshop",
            registrationDue: "2025-10-28",
        },
        {
            vehicleId: "VH-003",
            plateNumber: "NSW-555",
            status: "Active",
            odometerKm: 45310,
            lastDriver: "Ava Nguyen",
            lastActivity: "Trip started 10m ago",
            registrationDue: "2025-10-08",
        },
    ]);

    const [tools] = React.useState<ToolRow[]>([
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

    const [vehicleLog] = React.useState<ActivityLog[]>([
        { at: new Date().toISOString(), description: "Registration renewed for ABC-123" },
        { at: new Date(Date.now() - 2 * 3600_000).toISOString(), description: "VH-003 trip started (Ava Nguyen)" },
        { at: new Date(Date.now() - 6 * 3600_000).toISOString(), description: "VH-001 trip ended (Sam Carter)" },
    ]);
    const [toolLog] = React.useState<ActivityLog[]>([
        { at: new Date().toISOString(), description: "Hammer Drill checked out by Alex Morgan" },
        { at: new Date(Date.now() - 3600_000).toISOString(), description: "Laser Level returned to Depot" },
    ]);

    // --- Aggregates ---
    const totalVehicles = vehicles.length;
    const totalTools = tools.length;

    // Define "in use":
    //   Vehicles: status === "Active" (you can refine later)
    //   Tools: status === "Checked Out"
    const vehiclesInUse = vehicles.filter((v) => v.status === "Active").length;
    const toolsInUse = tools.filter((t) => t.status === "Checked Out").length;

    // Registrations expiring within 30 days
    const expiringRegoCount = vehicles.filter(
        (v) => daysUntil(v.registrationDue) <= 30,
    ).length;

    return (
        <div className="p-4 md:p-6 lg:p-8 space-y-4">
            <PageHeader
                title="Assets Dashboard"
                subtitle="Snapshot of vehicles, tools, upcoming registrations, and recent activity."
            />

            {/* KPI cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Card>
                    <CardContent className="p-5">
                        <div className="text-sm text-muted-foreground">Vehicles in use</div>
                        <div className="mt-2 text-2xl font-semibold">
                            {vehiclesInUse}/{totalVehicles}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                            Considered “in use” when status is <span className="font-medium">Active</span>.
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-5">
                        <div className="text-sm text-muted-foreground">Tools in use</div>
                        <div className="mt-2 text-2xl font-semibold">
                            {toolsInUse}/{totalTools}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                            Considered “in use” when status is <span className="font-medium">Checked Out</span>.
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-5">
                        <div className="text-sm text-muted-foreground">Registrations expiring ≤ 30 days</div>
                        <div className="mt-2 text-2xl font-semibold">{expiringRegoCount}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                            Count of vehicles with registration due within the next 30 days.
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Quick activity logs */}
            <div className="grid gap-4 lg:grid-cols-2">
                {/* Vehicles activity */}
                <Card>
                    <CardContent className="p-5 space-y-2">
                        <div className="text-sm font-medium">Vehicles — Activity</div>
                        <div className="rounded-xl border bg-card overflow-hidden">
                            <div className="overflow-x-auto">
                                <Table className="w-full min-w-[700px] text-[14px]">
                                    <TableHeader>
                                        <TableRow className="h-10">
                                            <TableHead className="px-4">When</TableHead>
                                            <TableHead className="px-4">What</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {vehicleLog.map((e, i) => (
                                            <TableRow key={i}>
                                                <TableCell className="px-4">{new Date(e.at).toLocaleString()}</TableCell>
                                                <TableCell className="px-4">{e.description}</TableCell>
                                            </TableRow>
                                        ))}
                                        {vehicleLog.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                                                    No recent vehicle activity.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Tools activity */}
                <Card>
                    <CardContent className="p-5 space-y-2">
                        <div className="text-sm font-medium">Tools — Activity</div>
                        <div className="rounded-xl border bg-card overflow-hidden">
                            <div className="overflow-x-auto">
                                <Table className="w-full min-w-[700px] text-[14px]">
                                    <TableHeader>
                                        <TableRow className="h-10">
                                            <TableHead className="px-4">When</TableHead>
                                            <TableHead className="px-4">What</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {toolLog.map((e, i) => (
                                            <TableRow key={i}>
                                                <TableCell className="px-4">{new Date(e.at).toLocaleString()}</TableCell>
                                                <TableCell className="px-4">{e.description}</TableCell>
                                            </TableRow>
                                        ))}
                                        {toolLog.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                                                    No recent tool activity.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
