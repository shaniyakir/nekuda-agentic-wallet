import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { UserProvider } from "@/components/providers/user-provider";
import { ChatProvider } from "@/components/providers/chat-provider";
import { AppWalletProvider } from "@/components/providers/wallet-provider";
import { Navbar } from "@/components/layout/navbar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nekuda Agentic Wallet",
  description: "AI-powered shopping assistant with secure Nekuda wallet payments",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <UserProvider>
          <ChatProvider>
            <AppWalletProvider>
              <Navbar />
              <main>{children}</main>
            </AppWalletProvider>
          </ChatProvider>
        </UserProvider>
      </body>
    </html>
  );
}
