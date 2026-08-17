import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../../supabase/migrations/009_notification_followups.sql", import.meta.url), "utf8");

describe("notification follow-up migration contract", () => {
  it("contains only the approved two-stage follow-up kinds and timing", () => {
    expect(sql).toContain("kind in ('unanswered_10m', 'final_24h')");
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toContain("interval '24 hours'");
    expect(sql).not.toMatch(/interest|price_change|availability|generic_reminder/);
  });

  it("uses the canonical outbound provider message as the stage-one identity", () => {
    expect(sql).toContain("notification_opportunities_10m_outbound_idx");
    expect(sql).toContain("on notification_opportunities(source_outbound_message_id)\n  where stage = 1");
    expect(sql).toContain("'unanswered_10m:' || requested_source_outbound_message_id");
    expect(sql).toContain("where source_outbound_message_id = requested_source_outbound_message_id\n    and stage = 1");
    expect(sql).not.toContain("'unanswered_10m:' || requested_user_id::text || ':' || requested_source_inbound_message_id");
  });

  it("keeps inbound causality as a secondary stage-one uniqueness guard", () => {
    expect(sql).toContain("notification_opportunities_10m_inbound_idx");
    expect(sql).toContain("on notification_opportunities(user_id, source_inbound_message_id)");
    expect(sql).toContain("requested_user_id, 'unanswered_10m', 1, requested_source_inbound_message_id");
  });

  it("makes repeated and concurrent stage-one scheduling database-idempotent", () => {
    expect(sql).toContain("on notification_opportunities(source_outbound_message_id)\n  where stage = 1");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain("for update;");
  });

  it("enforces one stage two per sent stage-one parent", () => {
    expect(sql).toContain("notification_opportunities_24h_parent_idx");
    expect(sql).toContain("on notification_opportunities(parent_opportunity_id)");
    expect(sql).toContain("if opportunity.stage = 1 then");
  });

  it("claims concurrently, revalidates replies, and never reclaims sending rows", () => {
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("state = 'evaluating' and claim_expires_at <= now()");
    expect(sql).not.toContain("state = 'sending' and claim_expires_at <= now()");
    expect(sql).toContain("where state = 'sending' and claimed_at <= now() - interval '5 minutes'");
    expect(sql).toContain("state = 'delivery_unknown'");
    expect(sql).toContain("reply detected before delivery");
    expect(sql).toContain("and (state <> 'sending' or not requested_retryable)");
  });

  it("keeps every RPC service-role only without changing onboarding RPCs", () => {
    const functions = [
      "schedule_unanswered_followup(uuid, text, text)",
      "cancel_notification_followups(uuid, text)",
      "claim_notification_opportunity()",
      "begin_notification_delivery(uuid, uuid, text, text)",
      "suppress_notification_opportunity(uuid, uuid, text)",
      "fail_notification_opportunity(uuid, uuid, text, boolean, timestamptz)",
      "complete_notification_delivery(uuid, uuid, text, timestamptz)",
    ];
    for (const fn of functions) {
      expect(sql).toContain(`revoke all on function ${fn} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function ${fn} to service_role;`);
    }
    expect(sql).not.toContain("claim_alpha_onboarding");
  });

  it("authenticates cancellation against the inbound identity", () => {
    expect(sql).toContain("join users sender on sender.id = requested_user_id");
    expect(sql).toContain("event.normalized_identity = sender.imessage_address");
  });

  it("orders messages by immutable provider occurrence time, not processing completion", () => {
    expect(sql).toContain("add column occurred_at timestamptz not null default now()");
    expect(sql).toContain("and event.occurred_at > opportunity.source_sent_at");
    expect(sql).toContain("requested_delivered_at, now()");
    expect(sql).not.toContain("coalesce(event.completed_at, event.created_at)");
  });

  it("serializes user reply decisions across schedule, cancel, authorize, and completion", () => {
    expect(sql.match(/pg_advisory_xact_lock\(hashtextextended\(/g)).toHaveLength(4);
    expect(sql).toContain("reply recorded before scheduling");
    expect(sql).toContain("reply detected before delivery");
    expect(sql).toContain("reply recorded before stage two creation");
  });

  it("validates the exact inbound source identity, space, kind, status, and ordering", () => {
    expect(sql).toContain("provider_message_id = requested_source_inbound_message_id");
    expect(sql).toContain("photon_space_id = source_event.photon_space_id");
    expect(sql).toContain("direction = 'inbound'");
    expect(sql).toContain("event_kind = 'user_message'");
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain("normalized_identity = source_identity");
    expect(sql).toContain("occurred_at <= source_event.occurred_at");
    expect(sql).toContain("Matching completed source inbound event not found.");
  });

  it("uses actual stage-one delivery time and checks replies before creating stage two", () => {
    expect(sql).toContain("sent_at = requested_delivered_at");
    expect(sql).toContain("event.occurred_at > requested_delivered_at");
    expect(sql).toContain("case when replied_at is null then 'scheduled' else 'cancelled' end");
    expect(sql).toContain("requested_delivered_at + interval '24 hours'");
  });

  it("enforces stage-two parent validity and prevents a stage three", () => {
    expect(sql).toContain("create trigger notification_stage_two_parent_guard");
    expect(sql).toContain("parent.stage <> 1");
    expect(sql).toContain("parent.kind <> 'unanswered_10m'");
    expect(sql).toContain("parent.state <> 'sent'");
    expect(sql).toContain("parent.user_id <> new.user_id");
    expect(sql).toContain("new.source_outbound_message_id <> parent.provider_message_id");
    expect(sql).toContain("if opportunity.stage = 1 then");
    expect(sql).not.toContain("if opportunity.stage = 2 then");
  });

  it("makes concurrent completion and stage-two creation idempotent", () => {
    expect(sql).toContain("opportunity.state = 'sent' and opportunity.provider_message_id = requested_provider_message_id");
    expect(sql).toContain("'final_24h:' || opportunity.id::text");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain("notification_opportunities_24h_parent_idx");
  });
});