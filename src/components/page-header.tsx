import { ReactNode } from "react";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

type Crumb = { label: string; href?: string };

export function PageHeader({
                               title,
                               subtitle,
                               description,          // optional alias
                               breadcrumbs,
                               cta,
                           }: {
    title: string;
    subtitle?: string;
    description?: string;
    breadcrumbs?: Crumb[]; // <- add this
    cta?: ReactNode;
}) {
    const sub = subtitle ?? description;

    return (
        <div className="mb-4 space-y-3 sm:mb-6">
            {breadcrumbs && breadcrumbs.length ? (
                <Breadcrumb>
                    <BreadcrumbList>
                        {breadcrumbs.map((c, i) => {
                            const isLast = i === breadcrumbs.length - 1;
                            return (
                                <BreadcrumbItem key={`${c.label}-${i}`}>
                                    {isLast || !c.href ? (
                                        <BreadcrumbPage>{c.label}</BreadcrumbPage>
                                    ) : (
                                        <BreadcrumbLink href={c.href}>{c.label}</BreadcrumbLink>
                                    )}
                                    {!isLast ? <BreadcrumbSeparator /> : null}
                                </BreadcrumbItem>
                            );
                        })}
                    </BreadcrumbList>
                </Breadcrumb>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">{title}</h1>
                    {sub ? <p className="mt-1 text-sm text-muted-foreground">{sub}</p> : null}
                </div>
                {cta ? <div className="flex gap-2">{cta}</div> : null}
            </div>
        </div>
    );
}
