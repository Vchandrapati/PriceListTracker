import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

function QuickLink({ title, desc, href }: { title: string; desc: string; href: string }) {
    return (
        <Card className="transition-shadow hover:shadow-soft">
            <CardContent className="p-5 space-y-3">
                <div>
                    <h3 className="font-medium">{title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                </div>
                <div>
                    <Link href={href} className="btn-primary">Open</Link>
                </div>
            </CardContent>
        </Card>
    );
}

export default function Home() {
    return (
        <div className="space-y-6">
            <PageHeader title="Home" subtitle="Jump into items or upload a CSV." />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <QuickLink title="Items" desc="Browse supplier items & latest prices." href="/items" />
                <QuickLink title="New Upload" desc="Map columns and run the ingest with progress." href="/uploads/new" />
                <QuickLink title="Export" desc="Export suppliers to simpro." href="/export" />
            </div>
        </div>
    );
}
