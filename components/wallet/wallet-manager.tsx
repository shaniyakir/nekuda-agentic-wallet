"use client";

/**
 * WalletManager — authenticated wallet view.
 *
 * Wraps @nekuda/wallet's WalletProvider + NekudaWallet and surfaces
 * NekudaCvvCollector when the default card's CVV has expired.
 */

import { useState } from "react";
import {
  WalletProvider,
  NekudaWallet,
  NekudaCvvCollector,
  useWallet,
  type EnrichedPaymentMethod,
} from "@nekuda/wallet";
import { useUser } from "@/components/providers/user-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ShieldAlert, CheckCircle2, LogOut } from "lucide-react";

const NEKUDA_PUBLIC_KEY = process.env.NEXT_PUBLIC_NEKUDA_PUBLIC_KEY ?? "";

function WalletContent() {
  const wallet = useWallet();
  const [cvvRefreshed, setCvvRefreshed] = useState(false);

  const cards = wallet.payments.list;
  const defaultCard = cards.find((c: EnrichedPaymentMethod) => c.isDefault);
  const needsCvv = defaultCard && !defaultCard.isCvvValid;

  return (
    <div className="flex flex-col gap-6">
      {needsCvv && !cvvRefreshed && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
              <ShieldAlert className="size-5" />
              CVV Re-entry Required
            </CardTitle>
            <CardDescription className="text-amber-600 dark:text-amber-400">
              Your card&apos;s security code has expired. Re-enter it below to continue
              making payments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NekudaCvvCollector
              cardId={defaultCard.id}
              last4={defaultCard.lastFourDigits}
              brand={defaultCard.cardType}
              holderName={defaultCard.cardHolderName}
              expiry={defaultCard.expiryDate}
              onSuccess={() => setCvvRefreshed(true)}
              onError={(error) => console.error("CVV re-collection failed:", error)}
            />
          </CardContent>
        </Card>
      )}

      {cvvRefreshed && (
        <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
          <CardContent className="flex items-center gap-3 py-4">
            <CheckCircle2 className="size-5 text-green-600 dark:text-green-400" />
            <p className="text-sm text-green-700 dark:text-green-300">
              CVV refreshed successfully. You can now return to chat and complete your purchase.
            </p>
          </CardContent>
        </Card>
      )}

      <NekudaWallet showSettings={false} />
    </div>
  );
}

export function WalletManager() {
  const { userId } = useUser();

  if (!userId) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Your Wallet</h2>
          <p className="text-sm text-muted-foreground">{userId}</p>
        </div>
      </div>

      <WalletProvider publicKey={NEKUDA_PUBLIC_KEY} userId={userId}>
        <WalletContent />
      </WalletProvider>
    </div>
  );
}
