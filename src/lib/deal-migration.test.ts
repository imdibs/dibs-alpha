import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const initialSql = readFileSync(new URL("../../supabase/migrations/001_alpha.sql", import.meta.url), "utf8");
const provenanceSql = readFileSync(new URL("../../supabase/migrations/013_canonical_deal_provenance.sql", import.meta.url), "utf8");

describe("canonical deal schema contract", () => {
  it("allows only one canonical deal per conversation", () => {
    expect(initialSql).toMatch(/conversation_id uuid not null unique references conversations\(id\)/);
  });

  it("records automatic agreement provenance without rewriting existing deals", () => {
    expect(provenanceSql).toContain("source text not null default 'participant_bilateral_reports'");
    expect(provenanceSql).toContain("trigger_message_id uuid references messages(id) on delete set null");
    expect(provenanceSql).toContain("confidence numeric(4,3) not null default 1");
    expect(provenanceSql).toContain("'conversation_bilateral_agreement'");
    expect(provenanceSql).toContain("create or replace function confirm_marketplace_group_deal");
    expect(provenanceSql).toContain("connection_status in ('connected', 'completed')");
    expect(provenanceSql).toContain("provider_introduction_message_id is not null");
    expect(provenanceSql).toContain("on conflict (conversation_id) do nothing");
    expect(provenanceSql).toContain("insert into deal_signals");
    expect(provenanceSql).toContain("requested_confidence < 0.95");
    expect(provenanceSql).not.toMatch(/delete from|truncate/i);
  });
});