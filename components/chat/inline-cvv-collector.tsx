"use client";

/**
 * InlineCvvCollector — CVV re-entry widget for chat interface.
 *
 * Renders NekudaCvvCollector from @nekuda/wallet inline within chat messages
 * when the completeCheckout tool returns CVV_EXPIRED error.
 *
 * Card metadata is fetched from useWallet() hook — no props needed from tool response.
 */

import { useState } from "react";
import { NekudaCvvCollector, useWallet, type EnrichedPaymentMethod } from "@nekuda/wallet";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ShieldAlert, CheckCircle2, AlertCircle } from "lucide-react";

interface InlineCvvCollectorProps {
  onSuccess: () => void;
}

export function InlineCvvCollector({ onSuccess }: InlineCvvCollectorProps) {
  const wallet = useWallet();
  const [refreshed, setRefreshed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cards = wallet.payments.list;
  const defaultCard = cards.find((c: EnrichedPaymentMethod) => c.isDefault);

  if (!defaultCard) {
    return null;
  }

  if (refreshed) {
    return (
      <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 max-w-md">
        <CardContent className="flex items-center gap-3 py-4">
          <CheckCircle2 className="size-5 text-green-600 dark:text-green-400" />
          <p className="text-sm text-green-700 dark:text-green-300">
            CVV updated successfully. Retrying payment...
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 max-w-md">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-sm">
          <ShieldAlert className="size-4" />
          Security code expired
        </CardTitle>
        <CardDescription className="text-amber-600 dark:text-amber-400">
          Re-enter the CVV for your card ending in {defaultCard.lastFourDigits} to continue.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <NekudaCvvCollector
          cardId={defaultCard.id}
          last4={defaultCard.lastFourDigits}
          brand={defaultCard.cardType}
          holderName={defaultCard.cardHolderName}
          expiry={defaultCard.expiryDate}
          onSuccess={() => {
            setError(null);
            setRefreshed(true);
            onSuccess();
          }}
          onError={(err) => {
            const message = typeof err === "string" ? err : err?.message || "Please enter a valid CVV";
            setError(message);
          }}
        />
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" />
            <span>{error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
