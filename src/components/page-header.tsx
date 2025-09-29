import { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function PageHeader({
                               title,
                               subtitle,
                               cta,
                           }: {
    title: string;
    subtitle?: string;
    cta?: ReactNode;
}) {
    return (
        <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
                <h1 className="text-2xl font-semibold">{title}</h1>
                {subtitle ? (
                    <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
                ) : null}
            </div>
            {cta ? <div className="flex gap-2">{cta}</div> : null}
        </div>
    );
}
