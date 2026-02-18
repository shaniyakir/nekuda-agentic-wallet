/**
 * POST /api/auth/magic-link
 *
 * Send a magic link email for passwordless authentication.
 * Body: { email: string }
 *
 * In dev mode (no RESEND_API_KEY), the link is logged to the console
 * so you can click it without needing a real email service.
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { generateMagicToken } from "@/lib/auth";
import { createLogger } from "@/lib/logger";

const log = createLogger("AUTH");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const email = body?.email?.trim()?.toLowerCase();

  if (!email || !EMAIL_REGEX.test(email)) {
    return NextResponse.json(
      { error: "Valid email address is required" },
      { status: 400 }
    );
  }

  // Generate a single-use token (10-min TTL)
  const token = generateMagicToken(email);

  // Build the magic link URL
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    request.nextUrl.origin;
  const magicLink = `${baseUrl}/api/auth/verify?token=${token}`;

  // Send email via Resend (or log to console in dev mode)
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey && !resendKey.startsWith("re_...")) {
    try {
      const resend = new Resend(resendKey);
      await resend.emails.send({
        from: "Nekuda Wallet <onboarding@resend.dev>",
        to: email,
        subject: "Sign in to Nekuda Agentic Wallet",
        html: `
          <h2>Sign in to Nekuda Wallet</h2>
          <p>Click the link below to sign in. This link expires in 10 minutes.</p>
          <a href="${magicLink}" style="display:inline-block;padding:12px 24px;background:#0070f3;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">
            Sign In
          </a>
          <p style="margin-top:16px;color:#666;font-size:14px;">
            If you didn't request this, you can safely ignore this email.
          </p>
        `,
      });
      log.info("Magic link email sent via Resend", { email });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Email send failed";
      log.error("Resend email failed, falling back to console", { error: msg });
      log.info(`🔗 MAGIC LINK (Resend failed): ${magicLink}`);
    }
  } else {
    // Dev mode: no Resend key, log the link to the console
    log.info(`🔗 MAGIC LINK (dev mode): ${magicLink}`);
  }

  return NextResponse.json({
    message: "If that email exists in our system, a sign-in link has been sent.",
    // In dev mode, return the link for convenience (never in production)
    ...(process.env.NODE_ENV !== "production" && { magicLink }),
  });
}
