"use client";

import * as React from "react";
import Image from "next/image";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export default function AuthGate({ children }: { children: React.ReactNode }) {
    const [session, setSession] = React.useState<Session | null>(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        const sb = supabaseBrowser();
        sb.auth.getSession().then(({ data }) => {
            setSession(data.session);
            setLoading(false);
        });
        const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
            setSession(s);
        });
        return () => sub.subscription.unsubscribe();
    }, []);

    if (loading) {
        return (
            <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
                Loading…
            </div>
        );
    }

    if (!session) return <LoginScreen />;

    return <>{children}</>;
}

function LoginScreen() {
    const [email, setEmail] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [error, setError] = React.useState<string | null>(null);
    const [submitting, setSubmitting] = React.useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        const sb = supabaseBrowser();
        const { error: err } = await sb.auth.signInWithPassword({ email, password });
        setSubmitting(false);
        if (err) setError(err.message);
        // On success onAuthStateChange in AuthGate swaps to the app.
    }

    return (
        <div className="flex min-h-dvh items-center justify-center bg-background p-4">
            <Card className="w-full max-w-sm">
                <CardContent className="p-6 space-y-5">
                    <div className="flex flex-col items-center gap-2 text-center">
                        <Image src="/CAV logo-v1.png" alt="Complete AV" width={80} height={80} />
                        <div className="font-semibold tracking-tight">Complete AV - Internal</div>
                        <p className="text-xs text-muted-foreground">Sign in to continue</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-3">
                        <div className="space-y-1">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                autoComplete="username"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="password">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>

                        {error && <p className="text-sm text-red-600">{error}</p>}

                        <Button type="submit" className="w-full" disabled={submitting}>
                            {submitting ? "Signing in…" : "Sign in"}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
