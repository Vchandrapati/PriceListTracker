"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
    Menu, Settings, Truck, Wrench, ListChecks, Package, Upload,
} from "lucide-react";

type NavItem = { title: string; href: string; icon?: React.ComponentType<any> };

const commerce: NavItem[] = [
    { title: "Items", href: "/items", icon: ListChecks },
    { title: "New Upload", href: "/uploads", icon: Upload },
    { title: "Export", href: "/export", icon: Package },
];

/** ✅ New “Assets” section */
const assets: NavItem[] = [
    { title: "Asset Dashboard", href: "/assets", icon: ListChecks },
    { title: "Vehicles", href: "/assets/vehicles", icon: Truck },
    { title: "Tools", href: "/assets/tools", icon: Wrench },
];

const admin: NavItem[] = [{ title: "Admin", href: "/admin", icon: Settings }];

export default function AppShell({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = useState(false);

    return (
        <div className="min-h-dvh bg-background text-foreground">
            {/* Top bar spans full width */}
            <header className="sticky top-0 z-40 border-b bg-card/70 backdrop-blur">
                <div className="flex items-center gap-3 px-4 py-3">
                    {/* Mobile menu */}
                    <Sheet open={open} onOpenChange={setOpen}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon" className="md:hidden">
                                <Menu className="size-5" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="p-0">
                            <MobileNav onNavigate={() => setOpen(false)} />
                        </SheetContent>
                    </Sheet>

                    {/* Brand */}
                    <Link href="/" className="flex items-center gap-2">
                        <Image src="/CAV logo-v1.png" alt="Complete AV" width={100} height={100} />
                        <span className="font-semibold tracking-tight">Complete AV — Internal</span>
                    </Link>

                    <div className="ml-auto" />
                </div>
            </header>

            {/* Full-bleed two-column layout; sidebar pinned to left */}
            <div className="grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]">
                <aside className="hidden h-[calc(100dvh-57px)] border-r md:sticky md:top-[57px] md:block">
                    <DesktopNav />
                </aside>

                {/* Main content area */}
                <main className="p-4 md:p-6 lg:p-8 max-w-none">{children}</main>
            </div>
        </div>
    );
}

function Section({ label, items }: { label: string; items: NavItem[] }) {
    return (
        <div className="px-2">
            <div className="px-2 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {label}
            </div>
            <nav className="grid gap-1">
                {items.map((item) => (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                            "hover:bg-muted hover:text-[hsl(var(--primary))]"
                        )}
                    >
                        {item.icon ? <item.icon className="size-4" /> : null}
                        <span>{item.title}</span>
                    </Link>
                ))}
            </nav>
        </div>
    );
}

function DesktopNav() {
    return (
        <div className="flex h-full flex-col">
            <Separator />
            <ScrollArea className="flex-1">
                <div className="py-2 space-y-2">
                    <Section label="Commercial" items={commerce} />
                    {/* ✅ New Assets section in desktop sidebar */}
                    <Section label="Assets" items={assets} />
                    <Section label="Settings" items={admin} />
                </div>
            </ScrollArea>
            <Separator />
            <div className="p-3 text-[11px] text-muted-foreground">© Complete AV</div>
        </div>
    );
}

function MobileNav({ onNavigate }: { onNavigate: () => void }) {
    const groups = [
        { label: "Commercial", items: commerce },
        { label: "Assets", items: assets },     // ✅ New Assets section in mobile drawer
        { label: "Settings", items: admin },
    ];
    return (
        <div className="h-full w-72">
            <div className="p-4">
                <Image src="/completeav-logo.svg" alt="Complete AV" width={28} height={28} />
            </div>
            <Separator />
            <ScrollArea className="h-[calc(100dvh-90px)]">
                {groups.map((g) => (
                    <div key={g.label} className="py-2">
                        <div className="px-4 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {g.label}
                        </div>
                        {g.items.map((i) => (
                            <Link
                                key={i.href}
                                href={i.href}
                                onClick={onNavigate}
                                className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-muted"
                            >
                                {i.icon ? <i.icon className="size-4" /> : null}
                                {i.title}
                            </Link>
                        ))}
                    </div>
                ))}
            </ScrollArea>
        </div>
    );
}
