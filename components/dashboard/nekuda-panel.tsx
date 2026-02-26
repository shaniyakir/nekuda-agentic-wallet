"use client";

import type { AgentSessionState } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KeyRound, CheckCircle2, XCircle, Loader2 } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  reveal_token_obtained: "Token obtained",
  card_revealed: "Card revealed",
  cvv_expired: "CVV expired",
  billing_obtained: "Billing ready",
  browser_filling: "Filling checkout…",
  completed: "Completed",
  failed: "Failed",
};

export function NekudaPanel({ state }: { state: AgentSessionState | null }) {
  const hasMandate = state?.mandateId != null;
  const checkoutStatus = state?.browserCheckoutStatus;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="size-4 text-violet-500" />
          Nekuda Wallet
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!hasMandate ? (
          <p className="text-muted-foreground">No mandate created yet</p>
        ) : (
          <>
            <Row label="Mandate ID" value={`#${state.mandateId}`} />
            <Row
              label="Status"
              value={
                <Badge
                  variant="secondary"
                  className={
                    state.mandateStatus === "approved"
                      ? "bg-green-500/10 text-green-600"
                      : state.mandateStatus === "failed"
                        ? "bg-red-500/10 text-red-600"
                        : "bg-amber-500/10 text-amber-600"
                  }
                >
                  {state.mandateStatus ?? "—"}
                </Badge>
              }
            />
            <Row
              label="Browser Checkout"
              value={
                checkoutStatus === "completed" ? (
                  <CheckCircle2 className="size-4 text-green-500" />
                ) : checkoutStatus === "failed" || checkoutStatus === "cvv_expired" ? (
                  <XCircle className="size-4 text-red-500" />
                ) : checkoutStatus === "browser_filling" ? (
                  <Loader2 className="size-4 animate-spin text-blue-500" />
                ) : checkoutStatus ? (
                  <span className="text-muted-foreground">
                    {STATUS_LABELS[checkoutStatus] ?? checkoutStatus}
                  </span>
                ) : (
                  <XCircle className="size-4 text-muted-foreground" />
                )
              }
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}
