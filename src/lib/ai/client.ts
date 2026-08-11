import type { AiClient, AiConfig, AiMessage } from "./types";

type Environment = Record<string, string | undefined>;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required when Dibs AI is enabled.`);
  return value;
}

export function loadAiConfig(env: Environment = process.env): AiConfig {
  const provider = required(env, "DIBS_AI_PROVIDER");
  if (provider !== "openai") throw new Error("DIBS_AI_PROVIDER must be openai.");
  const apiKey = required(env, "DIBS_AI_API_KEY");
  const timeoutMs = Number(env.DIBS_AI_TIMEOUT_MS || 15_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) throw new Error("DIBS_AI_TIMEOUT_MS must be between 1000 and 60000.");
  return { model: required(env, "DIBS_AI_MODEL"), apiKey, timeoutMs };
}

function outputText(json: Record<string, unknown>): string | undefined {
  if (typeof json.output_text === "string") return json.output_text;
  const output = Array.isArray(json.output) ? json.output : [];
  for (const item of output) {
    const content = item && typeof item === "object" && Array.isArray((item as { content?: unknown }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
  }
}

export function createAiClient(config = loadAiConfig(), fetcher: typeof fetch = fetch): AiClient {
  return { async complete(messages: AiMessage[], schema?: Record<string, unknown>) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetcher(OPENAI_RESPONSES_URL, {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, input: messages, ...(schema ? { text: { format: { type: "json_schema", name: "dibs_turn", strict: true, schema } } } : {}) }),
      });
      if (!response.ok) throw new Error(`Dibs AI request failed (${response.status}).`);
      const text = outputText(await response.json() as Record<string, unknown>);
      if (!text?.trim()) throw new Error("Dibs AI returned an empty response.");
      return text.trim();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("Dibs AI request timed out.");
      throw error;
    } finally { clearTimeout(timeout); }
  } };
}