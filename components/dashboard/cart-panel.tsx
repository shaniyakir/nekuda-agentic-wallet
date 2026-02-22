"use client";

import type { AgentSessionState } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart } from "lucide-react";

const statusColors: Record<string, string> = {
  active: "bg-blue-500/10 text-blue-600",
  checked_out: "bg-amber-500/10 text-amber-600",
  paid: "bg-green-500/10 text-green-600",
};

export function CartPanel({ state }: { state: AgentSessionState | null }) {
  const hasCart = state?.cartId;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <ShoppingCart className="size-4 text-blue-500" />
          Cart
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!hasCart ? (
          <p className="text-muted-foreground">No cart created yet</p>
        ) : (
          <>
            <Row label="Cart ID" value={state.cartId!.slice(0, 8) + "…"} />
            <Row
              label="Status"
              value={
                <Badge
                  variant="secondary"
                  className={statusColors[state.cartStatus ?? ""] ?? ""}
                >
                  {state.cartStatus ?? "—"}
                </Badge>
              }
            />
            {state.cartTotal != null && (
              <Row label="Total" value={`$${state.cartTotal.toFixed(2)}`} />
            )}
            {state.checkoutId && (
              <Row label="Checkout" value={state.checkoutId.slice(0, 8) + "…"} />
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
