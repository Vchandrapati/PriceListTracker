"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Crumb = { href?: string; label: string };

export function PageHeader({
                               title,
                               description,
                               actions,
                               breadcrumbs,
                           }: {
    title: string;
    description?: string;
    actions?: React.ReactNode;
    /** Optional: override the auto breadcrumb builder */
    breadcrumbs?: Crumb[];
}) {
    const pathname = usePathname();

    // Fallback: auto build (Home / ...segments)
    const segments = pathname.split("/").filter(Boolean);
    const auto: Crumb[] = [
        { href: "/", label: "Home" },
        ...segments.map((seg, i) => ({
            href: "/" + segments.slice(0, i + 1).join("/"),
            label: seg.replace(/-/g, " "),
        })),
    ];

    const crumbs = breadcrumbs ?? auto;

    return (
        <div className="space-y-2">
            <nav className="text-sm text-muted-foreground">
                {crumbs.map((c, i) => (
                    <span key={`${c.label}-${i}`}>
            {c.href ? (
                <Link href={c.href} className="hover:underline">{c.label}</Link>
            ) : (
                <span>{c.label}</span>
            )}
                        {i < crumbs.length - 1 ? " / " : ""}
          </span>
                ))}
            </nav>

            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                    {description && <p className="text-sm text-muted-foreground">{description}</p>}
                </div>
                {actions}
            </div>
        </div>
    );
}
