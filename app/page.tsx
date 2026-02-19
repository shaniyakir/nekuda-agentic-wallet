import Link from "next/link";
import { Wallet, MessageSquare, LayoutDashboard, ShieldCheck } from "lucide-react";

const features = [
  {
    href: "/wallet",
    icon: Wallet,
    title: "Wallet",
    description: "Manage your Nekuda wallet, add cards, and handle CVV collection securely.",
    color: "text-violet-500",
    bg: "bg-violet-500/10",
  },
  {
    href: "/chat",
    icon: MessageSquare,
    title: "AI Assistant",
    description: "Chat with our AI agent to browse products, compare prices, and checkout.",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    href: "/dashboard",
    icon: LayoutDashboard,
    title: "Dashboard",
    description: "Monitor agent state, cart contents, payment status, and errors in real-time.",
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
  },
] as const;

export default function Home() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center px-4 py-16">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-emerald-500" />
          Card credentials never touch the LLM
        </div>

        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          AI-Powered Shopping
          <span className="block bg-gradient-to-r from-violet-500 to-blue-500 bg-clip-text text-transparent">
            with Secure Payments
          </span>
        </h1>

        <p className="mt-4 text-lg text-muted-foreground">
          ByteShop combines a conversational AI agent with Nekuda&apos;s secure wallet
          infrastructure. Browse products, build a cart, and pay — all through chat.
        </p>
      </div>

      <div className="mt-12 grid w-full max-w-3xl gap-4 sm:grid-cols-3">
        {features.map(({ href, icon: Icon, title, description, color, bg }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-xl border bg-card p-6 transition-all hover:shadow-md hover:border-primary/20"
          >
            <div className={`mb-4 inline-flex rounded-lg p-2.5 ${bg}`}>
              <Icon className={`size-5 ${color}`} />
            </div>
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
              {description}
            </p>
            <span className="mt-3 inline-flex text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
              Open &rarr;
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
