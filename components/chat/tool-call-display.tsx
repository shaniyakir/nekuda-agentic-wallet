"use client";

import {
  ShoppingCart,
  Package,
  Plus,
  Trash2,
  CreditCard,
  KeyRound,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ToolCallPart {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface ToolResultPart {
  toolCallId: string;
  toolName: string;
  result: unknown;
}

interface ToolCallDisplayProps {
  toolInvocation: ToolCallPart;
  toolResult?: ToolResultPart;
}

const toolMeta: Record<string, { icon: typeof Package; label: string; color: string }> = {
  browseProducts: { icon: Package, label: "Browsing products", color: "text-blue-500" },
  createCart: { icon: ShoppingCart, label: "Creating cart", color: "text-violet-500" },
  addToCart: { icon: Plus, label: "Adding to cart", color: "text-green-500" },
  removeFromCart: { icon: Trash2, label: "Removing from cart", color: "text-red-500" },
  checkoutCart: { icon: ShoppingCart, label: "Checking out", color: "text-amber-500" },
  createMandate: { icon: CreditCard, label: "Requesting approval", color: "text-violet-500" },
  requestCardRevealToken: { icon: KeyRound, label: "Securing payment", color: "text-indigo-500" },
  executePayment: { icon: DollarSign, label: "Processing payment", color: "text-emerald-500" },
};

function formatResult(result: unknown): { status: "success" | "error"; summary: string } {
  if (result == null) return { status: "success", summary: "Done" };
  if (typeof result !== "object") return { status: "success", summary: String(result) };

  const obj = result as Record<string, unknown>;

  if (obj.error) {
    return { status: "error", summary: String(obj.error) };
  }

  if (obj.items && Array.isArray(obj.items)) {
    const count = obj.items.length;
    const total = obj.total ? ` — ${obj.total}` : "";
    return { status: "success", summary: `${count} item${count !== 1 ? "s" : ""}${total}` };
  }

  if (obj.cartId) return { status: "success", summary: `Cart ${String(obj.cartId).slice(0, 8)}…` };
  if (obj.mandateId) return { status: "success", summary: `Mandate #${obj.mandateId}` };
  if (obj.last4) return { status: "success", summary: `Card ••••${obj.last4} secured` };
  if (obj.orderId) return { status: "success", summary: `Order ${String(obj.orderId).slice(0, 8)}… — ${obj.amount}` };
  if (obj.status) return { status: "success", summary: String(obj.status) };

  if (Array.isArray(result)) {
    return { status: "success", summary: `${result.length} products found` };
  }

  return { status: "success", summary: "Done" };
}

export function ToolCallDisplay({ toolInvocation, toolResult }: ToolCallDisplayProps) {
  const meta = toolMeta[toolInvocation.toolName] ?? {
    icon: Package,
    label: toolInvocation.toolName,
    color: "text-muted-foreground",
  };
  const Icon = meta.icon;
  const isLoading = !toolResult;
  const { status, summary } = toolResult ? formatResult(toolResult.result) : { status: "success" as const, summary: "" };

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <Icon className={cn("size-4 shrink-0", meta.color)} />
      <span className="font-medium">{meta.label}</span>

      {isLoading ? (
        <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" />
      ) : status === "error" ? (
        <>
          <Badge variant="destructive" className="ml-auto text-xs">
            <AlertCircle className="mr-1 size-3" />
            Error
          </Badge>
          <span className="max-w-[200px] truncate text-xs text-destructive">{summary}</span>
        </>
      ) : (
        <>
          <CheckCircle2 className="ml-auto size-3.5 text-green-500" />
          <span className="max-w-[200px] truncate text-xs text-muted-foreground">{summary}</span>
        </>
      )}
    </div>
  );
}
