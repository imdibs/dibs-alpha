import { z } from "zod";
import { createAiClient } from "../ai/client";
import type { AiClient } from "../ai/types";
import type { FollowupContext, FollowupDecision } from "./types";

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["notify", "ignore"] },
    reason: { type: "string", minLength: 1, maxLength: 160 },
    message: { type: ["string", "null"], maxLength: 500 },
  },
  required: ["action", "reason", "message"],
};

const parsedDecision = z.object({
  action: z.enum(["notify", "ignore"]),
  reason: z.string().trim().min(1).max(160),
  message: z.string().trim().max(500).nullable(),
}).superRefine((value, context) => {
  if (value.action === "notify" && !value.message) context.addIssue({ code: "custom", path: ["message"], message: "Notify requires a message." });
  if (value.action === "ignore" && value.message) context.addIssue({ code: "custom", path: ["message"], message: "Ignore cannot include a message." });
});

export async function decideFollowup(context: FollowupContext, client: AiClient = createAiClient()): Promise<FollowupDecision> {
  const stage = context.kind === "unanswered_10m" ? "10-minute" : "final 24-hour";
  const history = context.history.slice(-12).map(turn => `${turn.role}: ${turn.body.slice(0, 1000)}`).join("\n");
  const raw = await client.complete([
    { role: "system", content: `Evaluate a ${stage} unanswered Dibs conversation. Notify only when one concise, useful, context-specific follow-up can help. Never invent facts, pressure the user, repeat a prior message, or create a generic reminder. The 24-hour stage is final. Return ignore when silence is best.` },
    { role: "user", content: history || "No useful conversation history is available." },
  ], decisionSchema);
  const value = parsedDecision.parse(JSON.parse(raw));
  return value.action === "notify"
    ? { action: "notify", reason: value.reason, message: value.message! }
    : { action: "ignore", reason: value.reason };
}