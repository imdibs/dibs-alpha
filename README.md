# Dibs Alpha

The smallest useful Dibs loop: create a listing, ask for an item in natural language, message its seller, and record a deal.

## Local setup

1. Create a free Supabase project.
2. Run `supabase/migrations/001_alpha.sql` in its SQL editor.
3. Copy `.env.example` to `.env.local` and add the project URL, service-role key, and a random 32+ character session secret.
4. Run `npm install && npm run dev`.

## Private iMessage relay

Before starting the AI-enabled worker, run migrations `002`, `003`, `004`, and `005` in order in the Supabase SQL editor. An authenticated inbound Photon identity is normalized and automatically recognized as a Dibs user; email is not required for iMessage search, selling, buying, or relay conversations. Existing Alpha users may still be linked manually as a fallback:

```sql
update users set imessage_address = '+13055550123' where email = 'buyer@example.com';
update users set imessage_address = '+13055550456' where email = 'seller@example.com';
```

Phone identities must use E.164 (`+` plus country code and digits); iMessage email identities must be lowercase. Never put one participant's identity in messages or user-facing output. The listing must belong to the linked seller. If the Photon project manages more than one outbound iMessage line, set `PHOTON_IMESSAGE_LINE` to the Dibs line so both private threads consistently use the same Dibs identity.

The worker accepts only provider events explicitly marked `inbound`, uses the provider sender identity rather than phone numbers typed into message text, claims each parent Photon message ID once, and records Spectrum's outbound message IDs separately. Text, one-photo, and grouped text/photo messages are supported; grouped content remains one inbound event. Do not start the updated worker until migrations `002`, `003`, and `004` are present.

Seller drafts accept up to six JPEG, PNG, WebP, GIF, HEIC, or HEIF photos, at most 8 MB each. Photos are uploaded from their real attachment bytes to `listing-images`. Publishing, removal, sold status, and price changes require a separate explicit confirmation message. Cancelled unpublished drafts have their uploaded files removed.

## Photon iMessage worker

Add `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET`, and the existing Supabase variables to `.env.local`, then run `npm run photon`. The persistent worker uses Photon's managed iMessage line and searches the same real listings as `/api/search`. `PHOTON_DEFAULT_CITY` defaults to `Miami, FL` for the Alpha test.

The AI worker uses the direct OpenAI Responses API and requires explicit `DIBS_AI_PROVIDER=openai`, `DIBS_AI_MODEL`, and `DIBS_AI_API_KEY` values. The example uses the cost-efficient `gpt-5.6-luna`, but the model remains configurable without code changes. Credentials are never inferred from unrelated environment variables. `DIBS_AI_TIMEOUT_MS` defaults to 15000. If AI is unavailable, Dibs preserves structured state and does not infer or execute marketplace actions.

The legacy web marketplace still requires email and password authentication; a phone identity alone never grants a web session. Alpha web auth has no email verification or password reset, so keep launch invite-only and handle resets manually.

## Deploy

Import this repository into Vercel, add the same environment variables, and deploy. Run the SQL migration before inviting users. Supabase serves listing images from the public `listing-images` bucket.

## Alpha operating notes

- Invite only adults (18+) and manually remove prohibited listings in Supabase.
- Sellers can confirm price changes, sold status, and removals over iMessage; other listing edits and user support remain manual for the first users.
- Conversations poll every three seconds; no realtime service is required.
- There are no payments or purchase protection. Users arrange meetup/payment themselves.
- Add iMessage only after the web loop shows real usage; its adapter should call these same API/core operations.

Expected initial recurring cost: Vercel and Supabase free tiers, plus OpenAI usage (typically under $25/month at early Alpha volume). A third-party iMessage line is not included.