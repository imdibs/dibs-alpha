import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../supabase/migrations/011_repeated_onboarding_message_requests.sql", import.meta.url), "utf8");
const enqueue = sql.slice(sql.indexOf("create or replace function enqueue_onboarding_message_request"), sql.indexOf("create or replace function claim_onboarding_message_request"));
const claim = sql.slice(sql.indexOf("create or replace function claim_onboarding_message_request"), sql.indexOf("create or replace function begin_onboarding_message_dispatch"));
const begin = sql.slice(sql.indexOf("create or replace function begin_onboarding_message_dispatch"), sql.indexOf("create or replace function fail_onboarding_message_request"));
const fail = sql.slice(sql.indexOf("create or replace function fail_onboarding_message_request"), sql.indexOf("create or replace function complete_onboarding_message_request"));
const complete = sql.slice(sql.indexOf("create or replace function complete_onboarding_message_request"), sql.indexOf("create or replace function claim_onboarding_message_request_analytics"));
const backfill = sql.slice(sql.indexOf("insert into onboarding_message_requests (", sql.indexOf("claim_onboarding_message_request_analytics")));

describe("repeated onboarding message request migration contract", () => {
  it("creates a per-click queue without phone or user uniqueness", () => {
    expect(sql).toContain("create table onboarding_message_requests");
    expect(sql).toContain("id uuid primary key");
    expect(sql).toContain("state in ('pending', 'preparing', 'sending', 'sent', 'failed')");
    expect(sql).not.toMatch(/user_id uuid[^\n]*unique/);
    expect(sql).not.toMatch(/phone_e164 text[^\n]*unique/);
  });

  it("idempotently returns the request before consuming recipient allowance", () => {
    expect(enqueue.indexOf("where id = requested_id")).toBeLessThan(enqueue.indexOf("check_rate_limit('onboarding_recipient'"));
    expect(enqueue).toContain("message_request.phone_e164 <> requested_phone");
    expect(enqueue).toContain("message = 'onboarding_request_id_conflict'");
    expect(enqueue).toContain("select * into alpha_user from users where imessage_address = requested_phone");
    expect(enqueue).toContain("select * into onboarding from alpha_onboardings where user_id = alpha_user.id");
    expect(enqueue).not.toContain("update users set");
    expect(enqueue).not.toContain("update alpha_onboardings set");
  });

  it("creates one new request for every different request ID while preserving historical onboarding", () => {
    expect(enqueue).toContain("insert into users (imessage_address, city, acquisition_source, originating_listing_id, acquisition_at)");
    expect(enqueue).toContain("insert into alpha_onboardings (phone_e164, user_id, source, visitor_id, attribution_token, originating_listing_id)");
    expect(enqueue).toContain("insert into onboarding_message_requests");
    expect(enqueue).toContain("onboarding_was_created, user_was_created, onboarding_was_created");
  });

  it("claims eligible rows atomically and prevents concurrent duplicate claims", () => {
    expect(claim).toContain("for update skip locked");
    expect(claim).toContain("state = 'preparing'");
    expect(claim).toContain("attempt_count = attempt_count + 1");
    expect(claim).toContain("claim_token = new_claim_token");
    expect(claim).toContain("claim_expires_at = now() + interval '5 minutes'");
  });

  it("recovers stale preparing claims but quarantines stale sending claims", () => {
    expect(claim).toContain("request.state = 'preparing' and request.claim_expires_at <= now()");
    expect(claim).toContain("failure_class = 'preparation_timeout', retryable = true");
    expect(claim).toContain("request.state = 'sending' and request.claim_expires_at <= now()");
    expect(claim).toContain("failure_class = 'delivery_unknown', retryable = false");
    expect(claim).toContain("onboarding.id = expired.alpha_onboarding_id and onboarding.state = 'sending'");
  });

  it("requires request ID and claim token at the dispatch boundary", () => {
    expect(begin).toContain("state = 'sending'");
    expect(begin).toContain("claim_token = requested_claim_token");
    expect(begin).toContain("photon_space_id = requested_photon_space_id");
    expect(begin).toContain("where id = requested_id and state = 'preparing' and claim_token = requested_claim_token");
    expect(begin).toContain("get diagnostics historical_rows_updated = row_count");
    expect(begin).toContain("if historical_rows_updated <> 1 then");
    expect(complete).toContain("where id = requested_id and state = 'sending' and claim_token = requested_claim_token");
  });

  it("terminalizes first-lifecycle history after an immediate ambiguous send", () => {
    expect(fail).toContain("case when requested_retryable then 'photon_unavailable' else 'delivery_unknown' end");
    expect(fail).toContain("not requested_retryable and state = 'sending'");
  });

  it("marks only the responsible first lifecycle and never overwrites sent or replied history", () => {
    expect(begin).toContain("if message_request.updates_historical_onboarding then");
    expect(begin).toContain("and (state = 'pending' or (state = 'failed' and retryable))");
    expect(complete).toContain("where id = message_request.alpha_onboarding_id and state = 'sending'");
    expect(enqueue).not.toMatch(/state\s*=\s*'(sent|replied)'/);
  });

  it("backfills only pending and retryable failed legacy work", () => {
    expect(backfill).toContain("where state = 'pending' or (state = 'failed' and retryable)");
    expect(backfill).not.toContain("state = 'sent'");
    expect(backfill).not.toContain("state = 'replied'");
    expect(backfill).toContain("case when state = 'failed' then 'photon_unavailable' else null end");
  });

  it("retires legacy enqueue and claim RPCs at the queue cutover", () => {
    expect(sql).toContain("revoke execute on function request_alpha_onboarding(text, text, text, text, uuid) from service_role;");
    expect(sql).toContain("revoke execute on function claim_alpha_onboarding() from service_role;");
  });

  it("adds recipient rate limiting using HMAC-only keys", () => {
    expect(sql).toContain("'onboarding_recipient'");
    expect(enqueue).toContain("requested_recipient_key_hash text");
    expect(enqueue).toContain("requested_recipient_key_hash !~ '^[0-9a-f]{64}$'");
    expect(sql).not.toMatch(/rate_limit_counters[^;]*phone_e164/s);
  });
});