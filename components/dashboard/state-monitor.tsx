"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentSessionState } from "@/lib/types";
import { useUser } from "@/components/providers/user-provider";
import { useChatId } from "@/components/providers/chat-provider";
import { CartPanel } from "@/components/dashboard/cart-panel";
import { NekudaPanel } from "@/components/dashboard/nekuda-panel";
import { StripePanel } from "@/components/dashboard/stripe-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertCircle,
  LayoutDashboard,
  RefreshCw,
  Loader2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const POLL_INTERVAL_MS = 3000;

export function StateMonitor() {
  const { userId } = useUser();
  const chatId = useChatId();
  const [state, setState] = useState<AgentSessionState | null>(null);
  const [polling, setPolling] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    if (!chatId) return;
    try {
      const res = await fetch(`/api/agent/state/${encodeURIComponent(chatId)}`);
      if (!res.ok) {
        setFetchError(`HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      if (data.state === null) {
        setState(null);
        setFetchError(null);
        return;
      }
      setState(data);
      setFetchError(null);
      setLastFetch(new Date());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Fetch failed");
    }
  }, [chatId]);

  useEffect(() => {
    if (!polling || !chatId) return;
    fetchState();
    const interval = setInterval(fetchState, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [polling, chatId, fetchState]);

  if (!userId) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto size-12 text-muted-foreground/50" />
          <h2 className="mt-4 text-xl font-semibold">Sign in required</h2>
          <p className="mt-2 text-muted-foreground">
            Visit the{" "}
            <a href="/wallet" className="font-medium text-primary underline">
              Wallet page
            </a>{" "}
            to sign in first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Agent Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPolling((p) => !p)}
            className="gap-1.5"
          >
            {polling ? (
              <Wifi className="size-3.5 text-green-500" />
            ) : (
              <WifiOff className="size-3.5 text-muted-foreground" />
            )}
            {polling ? "Live" : "Paused"}
          </Button>
          <Button variant="ghost" size="icon" onClick={fetchState}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      {/* Session info */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="font-mono">
          {chatId ?? "no session"}
        </Badge>
        {lastFetch && (
          <span>Updated {lastFetch.toLocaleTimeString()}</span>
        )}
        {fetchError && (
          <Badge variant="destructive" className="text-xs">
            {fetchError}
          </Badge>
        )}
        {!state && !fetchError && chatId && (
          <span className="flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" />
            Waiting for agent activity…
          </span>
        )}
      </div>

      {/* Panels */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CartPanel state={state} />
        <NekudaPanel state={state} />
        <StripePanel state={state} />
      </div>

      {/* Error panel */}
      {state?.error && (
        <Card className="border-destructive/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertCircle className="size-4" />
              Last Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-mono text-destructive">{state.error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              at {state.updatedAt ? new Date(state.updatedAt).toLocaleString() : "—"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
