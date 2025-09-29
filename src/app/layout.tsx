import "./globals.css";
import type { Metadata } from "next";
import AppShell from "@/components/app-shell";

export const metadata: Metadata = {
    title: "Complete AV — Internal",
    description: "Price lists, suppliers, imports, fleet & maintenance.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
        <body>
        <AppShell>{children}</AppShell>
        </body>
        </html>
    );
}
