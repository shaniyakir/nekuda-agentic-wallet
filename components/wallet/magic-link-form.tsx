"use client";

/**
 * Magic Link Onboarding Form — email input + send magic link.
 * In dev mode (no Resend), the link is returned in the response
 * and displayed inline for easy testing.
 */

import { useState } from "react";
import { useUser } from "@/components/providers/user-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Mail, Loader2, CheckCircle2, ExternalLink } from "lucide-react";

type FormState = "idle" | "sending" | "sent" | "error";

export function MagicLinkForm() {
  const { sendMagicLink } = useUser();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState("");
  const [devLink, setDevLink] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setState("sending");
    setError("");
    setDevLink(null);

    try {
      const res = await sendMagicLink(email.trim());
      setState("sent");
      if (res.magicLink) {
        setDevLink(res.magicLink);
      }
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Failed to send magic link");
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome to ByteShop</CardTitle>
        <CardDescription>
          Enter your email to sign in. We&apos;ll send you a secure link — no password needed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state === "sent" ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <CheckCircle2 className="size-12 text-green-500" />
            {devLink ? (
              <>
                <p className="text-center text-sm text-muted-foreground">
                  Click below to sign in instantly.
                </p>
                <a
                  href={devLink}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <ExternalLink className="size-4" />
                  Sign in now
                </a>
              </>
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                Check your inbox for a sign-in link. It expires in 10 minutes.
              </p>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setState("idle");
                setDevLink(null);
              }}
            >
              Use a different email
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10"
                required
                disabled={state === "sending"}
                autoFocus
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" disabled={state === "sending" || !email.trim()}>
              {state === "sending" ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send sign-in link"
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
