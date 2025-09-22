"use client";

import * as React from "react";
import Papa from "papaparse";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function Page() {
  const [fileName, setFileName] = React.useState<string>("");
  const [headers, setHeaders] = React.useState<string[]>([]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    Papa.parse(f, {
      header: true,
      preview: 1,
      complete: (res) => {
        setHeaders(res.meta.fields ?? []);
      },
      error: (err) => alert(err.message),
    });
  };

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">New Price Upload</h1>

      <div className="grid gap-2">
        <Label htmlFor="csv">Upload CSV</Label>
        <Input id="csv" type="file" accept=".csv,text/csv" onChange={onFileChange} />
      </div>

      {fileName && <p className="text-sm text-muted-foreground">Loaded: {fileName}</p>}

      {headers.length > 0 && (
        <div>
          <p className="font-medium">Detected headers:</p>
          <ul className="list-disc pl-6">
            {headers.map((h) => (
              <li key={h}><code>{h}</code></li>
            ))}
          </ul>
        </div>
      )}

      <Button onClick={() => alert("Hook this up to /api/ingest next")}>Continue</Button>
    </div>
  );
}
