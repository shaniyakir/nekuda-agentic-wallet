"use client";

import type { AgentSessionState } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreditCard } from "lucide-react";

export function StripePanel({ state }: { state: AgentSessionState | null }) {
  const hasPayment = state?.paymentStatus != null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <CreditCard className="size-4 text-emerald-500" />
          Stripe Settlement
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!hasPayment ? (
          <p className="text-muted-foreground">No payment processed yet</p>
        ) : (
          <>
            <Row
              label="Status"
              value={
                <Badge
                  variant="secondary"
                  className={
                    state.paymentStatus === "succeeded"
                      ? "bg-green-500/10 text-green-600"
                      : state.paymentStatus === "failed"
                        ? "bg-red-500/10 text-red-600"
                        : "bg-amber-500/10 text-amber-600"
                  }
                >
                  {state.paymentStatus}
                </Badge>
              }
            />
            {state.stripePaymentIntentId && (
              <Row
                label="Payment Intent"
                value={state.stripePaymentIntentId.slice(0, 16) + "…"}
              />
            )}
            {state.orderId && (
              <Row label="Order ID" value={state.orderId.slice(0, 8) + "…"} />
            )}
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
