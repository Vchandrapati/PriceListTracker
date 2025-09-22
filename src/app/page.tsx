"use client";
import Link from "next/link";
// ...your existing imports

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
        <Link
          href="/csv/uploads/new"
          className="underline underline-offset-4 hover:no-underline"
        >
          Go to CSV Mapping / Uploads
        </Link>
      </div>

      {/* You can keep your CSV preview component here, or move it to /csv */}
      {/* ... your existing CSV preview JSX ... */}
    </div>
  );
}
