"use client";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

// ...imports
export default function Home() {
    return (
        <div className="space-y-6">
            <PageHeader title="Home" description="Jump into items or upload a CSV." />

            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardContent className="p-6 space-y-2">
                        <h3 className="font-medium">Items</h3>
                        <p className="text-sm text-muted-foreground">Browse supplier items & latest prices.</p>
                        <Link className="underline underline-offset-4" href="/items">Open</Link>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-6 space-y-2">
                        <h3 className="font-medium">New Upload</h3>
                        <p className="text-sm text-muted-foreground">Map columns and run the ingest with progress.</p>
                        <Link className="underline underline-offset-4" href="/uploads/new">Open</Link>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
