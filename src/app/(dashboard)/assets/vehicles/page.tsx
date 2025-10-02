"use client";

import * as React from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type VehicleRow = {
    vehicleId: string;
    plateNumber: string;
    status: "Active" | "In Service" | "Inactive";
    odometerKm: number;
    lastDriver: string;
    lastActivity: string; // human label e.g., "Trip ended 1h ago"
    registrationDue: string; // ISO date "YYYY-MM-DD"
};

type ActivityLog = {
    at: string;         // ISO
    description: string;
};

function fmtDate(d: string) {
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString();
}

function daysUntil(iso: string) {
    const today = new Date();
    const due = new Date(iso + "T00:00:00");
    const msPerDay = 86_400_000;
    return Math.ceil((due.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / msPerDay);
}

function regoClass(iso: string) {
    const n = daysUntil(iso);
    if (n <= 14) return "text-red-600 font-medium";
    if (n <= 30) return "text-amber-600 font-medium";
    if (n <= 60) return "text-amber-500";
    return "";
}

export default function VehiclesPage() {
    const [rows, setRows] = React.useState<VehicleRow[]>([
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

    const [log, setLog] = React.useState<ActivityLog[]>([
        { at: new Date().toISOString(), description: "Imported fleet snapshot" },
    ]);

    function renewRego(plate: string) {
        setRows((cur) =>
            cur.map((r) => {
                if (r.plateNumber !== plate) return r;
                const curDue = new Date(r.registrationDue + "T00:00:00");
                const next = new Date(curDue);
                next.setFullYear(curDue.getFullYear() + 1);
                const iso = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(
                    next.getDate(),
                ).padStart(2, "0")}`;
                return { ...r, registrationDue: iso };
            }),
        );
        setLog((l) => [
            { at: new Date().toISOString(), description: `Registration renewed for ${plate}` },
            ...l,
        ]);
    }

    return (
        <div className="p-4 md:p-6 lg:p-8 space-y-4">
            <PageHeader title="Vehicles" subtitle="Fleet overview and registration status." />

            {/* Vehicles table */}
            <Card>
                <CardContent className="p-5 space-y-4">
                    <div className="rounded-xl border bg-card overflow-hidden">
                        <div className="overflow-x-auto">
                            <Table className="w-full min-w-[1100px] text-[15px] md:text-base">
                                <TableHeader>
                                    <TableRow className="h-12">
                                        <TableHead className="px-4">Vehicle ID</TableHead>
                                        <TableHead className="px-4">Plate Number</TableHead>
                                        <TableHead className="px-4">Status</TableHead>
                                        <TableHead className="px-4 text-right">Odometer (km)</TableHead>
                                        <TableHead className="px-4">Last Driver</TableHead>
                                        <TableHead className="px-4">Last Activity</TableHead>
                                        <TableHead className="px-4">Registration</TableHead>
                                        <TableHead className="px-4">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody className="[&>tr]:h-12 [&>tr>td]:py-3 [&>tr>td]:px-4 [&>tr>td]:whitespace-nowrap">
                                    {rows.map((r) => (
                                        <TableRow key={r.vehicleId}>
                                            <TableCell>{r.vehicleId}</TableCell>
                                            <TableCell>{r.plateNumber}</TableCell>
                                            <TableCell>{r.status}</TableCell>
                                            <TableCell className="text-right">{r.odometerKm.toLocaleString()}</TableCell>
                                            <TableCell>{r.lastDriver}</TableCell>
                                            <TableCell className="max-w-[420px] truncate">{r.lastActivity}</TableCell>
                                            <TableCell>
                        <span className={regoClass(r.registrationDue)}>
                          {fmtDate(r.registrationDue)}{" "}
                            <span className="text-xs text-muted-foreground">
                            ({daysUntil(r.registrationDue)}d)
                          </span>
                        </span>
                                            </TableCell>
                                            <TableCell>
                                                <Button size="sm" variant="outline" onClick={() => renewRego(r.plateNumber)}>
                                                    Renew (+1y)
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {rows.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                                                No vehicles yet.
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
                                                <TableCell className="px-4">
                                                    {new Date(e.at).toLocaleString()}
                                                </TableCell>
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
