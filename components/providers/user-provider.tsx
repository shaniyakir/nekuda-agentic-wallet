"use client";

/**
 * UserProvider — React context for user identity propagation.
 *
 * Reads the encrypted session cookie via GET /api/auth/session on mount.
 * Authentication is via magic link: email → link → session set on verify.
 *
 * Provides:
 *   - userId (email) — null if not authenticated
 *   - isLoading — true during initial session fetch
 *   - sendMagicLink(email) — sends magic link email
 *   - refresh() — re-fetch session (call after magic link verify redirect)
 *   - logout() — destroy session
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

interface MagicLinkResponse {
  message: string;
  magicLink?: string; // Only in dev mode
}

interface UserContextValue {
  userId: string | null;
  isLoading: boolean;
  /** Send a magic link email. Returns the response (includes magicLink in dev mode). */
  sendMagicLink: (email: string) => Promise<MagicLinkResponse>;
  /** Re-fetch session from server (call after redirect from magic link). */
  refresh: () => Promise<void>;
  /** Destroy session (logout). */
  logout: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session");
      const data = await res.json();
      setUserId(data.userId ?? null);
    } catch {
      setUserId(null);
    }
  }, []);

  // Fetch session on mount
  useEffect(() => {
    fetchSession().finally(() => setIsLoading(false));
  }, [fetchSession]);

  const sendMagicLink = useCallback(
    async (email: string): Promise<MagicLinkResponse> => {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to send magic link");
      }
      return res.json();
    },
    []
  );

  const refresh = useCallback(async () => {
    await fetchSession();
  }, [fetchSession]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    setUserId(null);
  }, []);

  return (
    <UserContext.Provider
      value={{ userId, isLoading, sendMagicLink, refresh, logout }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error("useUser() must be used within a <UserProvider>");
  }
  return ctx;
}
