// lib/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
    if (browserClient) return browserClient;

    if (typeof window === "undefined") {
        // Prevent accidental construction during SSR/prerender
        throw new Error("supabaseBrowser() was called on the server. Use a server client instead.");
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
        throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }

    browserClient = createClient(url, key);
    return browserClient;
}
