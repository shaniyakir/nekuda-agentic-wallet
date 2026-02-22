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

interface ChatContextValue {
  chat: Chat<UIMessage> | null;
  chatId: string | null;
}

const ChatContext = createContext<ChatContextValue>({ chat: null, chatId: null });

export function ChatProvider({ children }: { children: ReactNode }) {
  const { userId } = useUser();

  const value = useMemo<ChatContextValue>(() => {
    if (!userId) return { chat: null, chatId: null };
    const id = `agent_${userId}`;
    return {
      chat: new Chat<UIMessage>({ id, transport }),
      chatId: id,
    };
  }, [userId]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatInstance(): Chat<UIMessage> | null {
  return useContext(ChatContext).chat;
}

export function useChatId(): string | null {
  return useContext(ChatContext).chatId;
}
