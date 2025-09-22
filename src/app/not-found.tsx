import Link from "next/link";

export default function NotFound() {
    return (
        <div className="mx-auto max-w-7xl p-6 space-y-3">
            <h1 className="text-2xl font-semibold">Page not found</h1>
            <p className="text-muted-foreground">The page you’re looking for doesn’t exist.</p>
            <Link href="/" className="underline underline-offset-4">Go home</Link>
        </div>
    );
}
