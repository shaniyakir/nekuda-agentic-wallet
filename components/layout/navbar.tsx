"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@/components/providers/user-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Wallet, MessageSquare, LayoutDashboard, LogOut } from "lucide-react";

const navItems = [
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
] as const;

export function Navbar() {
  const pathname = usePathname();
  const { userId, logout } = useUser();

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
            B
          </div>
          ByteShop
        </Link>

        <nav className="flex items-center gap-1">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                pathname === href
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              )}
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {userId && (
            <>
              <span className="text-xs text-muted-foreground truncate max-w-[120px] hidden sm:block">
                {userId}
              </span>
              <Button variant="ghost" size="sm" onClick={logout} className="gap-1.5">
                <LogOut className="size-4" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
