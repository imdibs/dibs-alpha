import { db } from "../db";
import type { AiHistoryTurn } from "./types";

const HISTORY_LIMIT = 16;
export async function loadAiHistory(userId: string): Promise<AiHistoryTurn[]> {
  const result = await db().from("dibs_ai_turns").select("role,body").eq("user_id", userId).order("created_at", { ascending: false }).limit(HISTORY_LIMIT);
  if (result.error) throw new Error("Could not load Dibs conversation history. Migration 005 may not be applied.");
  return ((result.data || []) as AiHistoryTurn[]).reverse();
}

export async function appendAiTurn(userId: string, turn: AiHistoryTurn, providerMessageId?: string): Promise<void> {
  const body = turn.body.trim().slice(0, 8000);
  if (!body) return;
  const result = await db().from("dibs_ai_turns").insert({ user_id: userId, role: turn.role, body, provider_message_id: providerMessageId || null });
  if (result.error && !providerMessageId) throw new Error("Could not save Dibs conversation history.");
}