"use client";

import type { AgentSessionState } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KeyRound, CheckCircle2, XCircle, Clock } from "lucide-react";

export function NekudaPanel({ state }: { state: AgentSessionState | null }) {
  const hasMandate = state?.mandateId != null;

  const cvvAge = state?.credentialsRevealedAt
    ? Math.round((Date.now() - new Date(state.credentialsRevealedAt).getTime()) / 60000)
    : null;
  const cvvExpiring = cvvAge != null && cvvAge >= 50;

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
              label="Reveal Token"
              value={
                state.revealTokenObtained ? (
                  <CheckCircle2 className="size-4 text-green-500" />
                ) : (
                  <XCircle className="size-4 text-muted-foreground" />
                )
              }
            />
            <Row
              label="Credentials"
              value={
                state.credentialsRevealed ? (
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="size-4 text-green-500" />
                    {cvvAge != null && (
                      <span className={cvvExpiring ? "text-amber-600" : "text-muted-foreground"}>
                        <Clock className="mr-0.5 inline size-3" />
                        {cvvAge}m
                      </span>
                    )}
                  </div>
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
