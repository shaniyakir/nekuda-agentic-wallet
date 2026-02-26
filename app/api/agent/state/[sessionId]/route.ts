/**
 * Agent State Endpoint — GET /api/agent/state/[sessionId]
 *
 * Returns the current AgentSessionState for a given sessionId.
 * Used by the dashboard to poll agent progress in real time.
 */

import { NextResponse } from "next/server";
import { getSession as getAuthSession } from "@/lib/auth";
import { getSession } from "@/lib/agent/session-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const auth = await getAuthSession();
  if (!auth.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;

  const state = await getSession(sessionId);
  if (!state) {
    return NextResponse.json(
      { error: "Session not found" },
      { status: 404 }
    );
  }

  if (state.userId !== auth.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(state);
}
