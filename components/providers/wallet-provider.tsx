"use client";

/**
 * AppWalletProvider — lifts WalletProvider to app level.
 *
 * Enables useWallet() access throughout the app (chat, dashboard, etc.)
 * without requiring each page to wrap its own WalletProvider.
 *
 * Conditionally renders: only provides wallet context when user is authenticated.
 */

import { type ReactNode } from "react";
import { WalletProvider } from "@nekuda/wallet";
import { useUser } from "@/components/providers/user-provider";

const NEKUDA_PUBLIC_KEY = process.env.NEXT_PUBLIC_NEKUDA_PUBLIC_KEY ?? "";

export function AppWalletProvider({ children }: { children: ReactNode }) {
  const { userId } = useUser();

  if (!userId) {
    return <>{children}</>;
  }

  return (
    <WalletProvider publicKey={NEKUDA_PUBLIC_KEY} userId={userId}>
      {children}
    </WalletProvider>
  );
}
