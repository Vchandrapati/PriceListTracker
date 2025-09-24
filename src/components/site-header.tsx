"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils"; // shadcn utility (or write a tiny cn)
import { Button } from "@/components/ui/button";

const links = [
    { href: "/", label: "Home" },
    { href: "/items", label: "Items" },
    { href: "/uploads/new", label: "New Upload" },
    { href: "/export", label: "New Export" },
];


export function SiteHeader() {
    const pathname = usePathname();

    return (
        <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur">
            <div className="mx-auto max-w-7xl h-14 px-6 flex items-center justify-between">
                <Link href="/" className="font-semibold tracking-tight">Price Console</Link>

                <nav className="flex items-center gap-1">
                    {links.map((l) => {
                        const active = pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href));
                        return (
                            <Link key={l.href} href={l.href}>
                                <Button
                                    variant={active ? "default" : "ghost"}
                                    size="sm"
                                    className={cn("rounded-full")}
                                >
                                    {l.label}
                                </Button>
                            </Link>
                        );
                    })}
                </nav>
            </div>
        </header>
    );
}
