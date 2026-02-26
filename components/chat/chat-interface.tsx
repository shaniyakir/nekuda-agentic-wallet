"use client";

import { useRef, useEffect, useState, useCallback, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { useWallet, NekudaWallet, type EnrichedPaymentMethod } from "@nekuda/wallet";
import { useUser } from "@/components/providers/user-provider";
import { useChatInstance } from "@/components/providers/chat-provider";
import { ToolCallDisplay } from "@/components/chat/tool-call-display";
import { MagicLinkForm } from "@/components/wallet/magic-link-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Send,
  Loader2,
  AlertCircle,
  Bot,
  User as UserIcon,
  Wallet,
} from "lucide-react";

function WalletAwareChat() {
  const wallet = useWallet();
  const chat = useChatInstance();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error } = useChat(
    chat
      ? { chat, onError: (err) => console.error("Chat error:", err) }
      : { onError: (err) => console.error("Chat error:", err) }
  );

  const isStreaming = status === "streaming" || status === "submitted";

  const handleCvvSuccess = useCallback(() => {
    sendMessage({ text: "I've updated my CVV, please retry the payment." });
  }, [sendMessage]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ text });
  }

  const cards = wallet.payments.list;
  const defaultCard = cards.find((c: EnrichedPaymentMethod) => c.isDefault);

  if (!defaultCard) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10">
              <Wallet className="size-6 text-primary" />
            </div>
            <CardTitle>Add a Payment Method</CardTitle>
            <CardDescription>
              Connect a card to your wallet to enable AI-powered checkout.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NekudaWallet showSettings={false} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <ScrollArea className="flex-1 px-4">
        <div className="mx-auto max-w-2xl py-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
              <Bot className="size-10 text-muted-foreground/40" />
              <h2 className="text-lg font-medium">ByteShop Assistant</h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                I can help you browse products, build a cart, and complete your
                purchase securely through your Nekuda wallet.
              </p>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "mb-4 flex gap-3",
                message.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {message.role === "assistant" && (
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Bot className="size-4" />
                </div>
              )}

              <div
                className={cn(
                  "max-w-[80%] space-y-2",
                  message.role === "user" ? "order-first" : ""
                )}
              >
                {message.parts.map((part, i) => {
                  if (part.type === "text" && part.text.trim()) {
                    return (
                      <div
                        key={`text-${i}`}
                        className={cn(
                          "rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        )}
                      >
                        {part.text}
                      </div>
                    );
                  }

                  if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
                    const toolPart = part as {
                      toolCallId: string;
                      toolName: string;
                      state: string;
                      input?: unknown;
                      output?: unknown;
                    };
                    return (
                      <ToolCallDisplay
                        key={toolPart.toolCallId}
                        toolInvocation={{
                          toolCallId: toolPart.toolCallId,
                          toolName: toolPart.toolName,
                          args: (toolPart.input ?? {}) as Record<string, unknown>,
                        }}
                        toolResult={
                          toolPart.state === "output-available"
                            ? {
                                toolCallId: toolPart.toolCallId,
                                toolName: toolPart.toolName,
                                result: toolPart.output,
                              }
                            : undefined
                        }
                        onCvvSuccess={handleCvvSuccess}
                      />
                    );
                  }

                  return null;
                })}
              </div>

              {message.role === "user" && (
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <UserIcon className="size-4" />
                </div>
              )}
            </div>
          ))}

          {isStreaming && messages.at(-1)?.role !== "assistant" && (
            <div className="mb-4 flex gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Bot className="size-4" />
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-muted px-4 py-2.5">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Thinking…</span>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3">
              <AlertCircle className="size-4 text-destructive" />
              <p className="text-sm text-destructive">{error.message}</p>
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <div className="border-t bg-background p-4">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-2xl items-center gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about products, build a cart, or start a purchase…"
            disabled={isStreaming}
            className="flex-1"
            autoFocus
          />
          <Button type="submit" size="icon" disabled={isStreaming || !input.trim()}>
            {isStreaming ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

export function ChatInterface() {
  const { userId, refresh } = useUser();
  const searchParams = useSearchParams();

  useEffect(() => {
    const authStatus = searchParams.get("auth");
    if (authStatus === "success") {
      refresh();
    }
  }, [searchParams, refresh]);

  if (!userId) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
              <Bot className="size-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Welcome to ByteShop</h1>
            <p className="mt-2 text-muted-foreground">
              Sign in to start shopping with your AI assistant.
            </p>
          </div>
          <MagicLinkForm />
        </div>
      </div>
    );
  }

  return <WalletAwareChat />;
}
