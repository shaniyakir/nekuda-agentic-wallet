"use client";

/**
 * ChatProvider — holds a singleton Chat instance that persists across
 * page navigations. Without this, navigating away from /chat and back
 * would destroy the conversation (and the user's cart state with it).
 *
 * The Chat instance is recreated when userId changes (login/logout).
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useUser } from "@/components/providers/user-provider";

const transport = new DefaultChatTransport({
  api: "/api/agent/chat",
});

const ChatContext = createContext<Chat<UIMessage> | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { userId } = useUser();

  const chat = useMemo(() => {
    if (!userId) return null;
    return new Chat<UIMessage>({
      id: `agent_${userId}`,
      transport,
    });
  }, [userId]);

  return <ChatContext.Provider value={chat}>{children}</ChatContext.Provider>;
}

export function useChatInstance(): Chat<UIMessage> | null {
  return useContext(ChatContext);
}
