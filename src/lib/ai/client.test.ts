import { describe, expect, it, vi } from "vitest";
import { createAiClient, loadAiConfig } from "./client";

describe("Dibs AI provider configuration", () => {
  it("requires explicit Dibs configuration and never consumes inherited keys", () => {
    expect(() => loadAiConfig({ OPENAI_API_KEY: "accidental" })).toThrow("DIBS_AI_PROVIDER");
    expect(() => loadAiConfig({ DIBS_AI_PROVIDER: "openai", DIBS_AI_API_KEY: "key" })).toThrow("DIBS_AI_MODEL");
    expect(() => loadAiConfig({ DIBS_AI_PROVIDER: "unsupported", DIBS_AI_MODEL: "model", DIBS_AI_API_KEY: "key" })).toThrow("must be openai");
  });

  it("builds the explicit OpenAI configuration", () => {
    expect(loadAiConfig({ DIBS_AI_PROVIDER: "openai", DIBS_AI_MODEL: "gpt-5.6-luna", DIBS_AI_API_KEY: "secret" })).toEqual({ model: "gpt-5.6-luna", apiKey: "secret", timeoutMs: 15000 });
  });

  it("uses OpenAI bearer authentication", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ output_text: "hey" }), { status: 200 }));
    const client = createAiClient({ model: "gpt-5.6-luna", apiKey: "secret", timeoutMs: 1000 }, fetcher as typeof fetch);
    expect(await client.complete([{ role: "user", content: "hi" }])).toBe("hey");
    expect(fetcher).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret" }) }));
  });
});