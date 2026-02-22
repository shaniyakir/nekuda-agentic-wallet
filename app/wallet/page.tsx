"use client";

/**
 * Wallet Page — /wallet
 *
 * Two modes:
 * 1. Onboarding: no session → magic link email form
 * 2. Management: authenticated → NekudaWallet + CVV collector
 *
 * Also handles the ?auth=success redirect from magic link verification
 * by auto-refreshing the session.
 *
 * Wrapped in <Suspense> because useSearchParams() opts out of static
 * rendering — required by Next.js 14+ production builds.
 */

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@/components/providers/user-provider";
import { MagicLinkForm } from "@/components/wallet/magic-link-form";
import { WalletManager } from "@/components/wallet/wallet-manager";
import { Loader2, Wallet } from "lucide-react";

function WalletPageContent() {
  const { userId, isLoading, refresh } = useUser();
  const searchParams = useSearchParams();

  useEffect(() => {
    const authStatus = searchParams.get("auth");
    if (authStatus === "success") {
      refresh();
    }
  }, [searchParams, refresh]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <Wallet className="size-6 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Wallet</h1>
          <p className="mt-2 text-muted-foreground">
            {userId
              ? "Manage your payment methods"
              : "Sign in to set up your Nekuda wallet"}
          </p>
        </div>

        {userId ? <WalletManager /> : <MagicLinkForm />}
      </div>
    </div>
  );
}

export default function WalletPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <WalletPageContent />
    </Suspense>
  );
}
