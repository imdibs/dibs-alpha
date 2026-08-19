# Dibs Alpha

The smallest useful Dibs loop: create a listing, ask for an item in natural language, message its seller, and record a deal.

## Local setup

1. Create a free Supabase project.
2. Run migrations `001_alpha.sql` through `012_marketplace_imessage_groups.sql` in order in its SQL editor.
3. Copy `.env.example` to `.env.local` and add the project URL, service-role key, and a random 32+ character session secret.
4. Run `npm install && npm run dev`.

## iMessage marketplace connections

Before starting the AI-enabled worker, apply migrations through `012_marketplace_imessage_groups.sql` in the Supabase SQL editor. An authenticated inbound Photon identity is normalized and automatically recognized as a Dibs user; email is not required for iMessage search, selling, buying, or marketplace conversations. Existing Alpha users may still be linked manually as a fallback:

```sql
update users set imessage_address = '+13055550123' where email = 'buyer@example.com';
update users set imessage_address = '+13055550456' where email = 'seller@example.com';
```

Phone identities must use E.164 (`+` plus country code and digits); iMessage email identities must be lowercase. Never put one participant's identity in messages or user-facing output. The listing must belong to the linked seller. Set `PHOTON_IMESSAGE_LINE` to a dedicated Dibs line: Spectrum group creation does not support shared-line mode. The connection tool creates one durable group per buyer/listing pair and reuses it on subsequent calls. Private buyer/seller relay remains the fallback for conversations that have not been connected to a group.

The worker accepts only provider events explicitly marked `inbound`, uses the provider sender identity rather than phone numbers typed into message text, claims each parent Photon message ID once, and records Spectrum's outbound message IDs separately. Text, one-photo, and grouped text/photo messages are supported; grouped content remains one inbound event. Connected groups are resolved by the exact Spectrum space ID and receiving line before private routing. Only the two persisted participant identities may write to the marketplace conversation; group messages are persisted without a bot reply. Do not start the updated worker until migration `012` is present.

If group creation or introduction delivery has an ambiguous provider failure, the conversation enters `reconciliation_required`. Inspect the Spectrum space and the conversation row before changing its state; do not blindly retry and risk creating a duplicate group or introduction.

Seller drafts require two to six JPEG, PNG, WebP, GIF, HEIC, or HEIF photos, at most 8 MB each. Photos are uploaded from their real attachment bytes to `listing-images`. Publishing, removal, sold status, and price changes require a separate explicit confirmation message. Cancelled unpublished drafts have their uploaded files removed.

Verified listings receive a stable opaque `/l/{token}` public URL. Public pages expose only buyer-facing listing fields, retain inactive listings without exposing seller contact data, and record first-party page, CTA, activation, conversation, and deal-signal events. Apply migration `006` before deploying code that uses public listing URLs or product events.

## Photon iMessage worker

Add `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET`, and the existing Supabase variables to `.env.local`, then run `npm run photon`. The persistent worker uses Photon's managed iMessage line and searches the same real listings as `/api/search`. `PHOTON_DEFAULT_CITY` defaults to `Miami, FL` for the Alpha test.

The AI worker uses the direct OpenAI Responses API and requires explicit `DIBS_AI_PROVIDER=openai`, `DIBS_AI_MODEL`, and `DIBS_AI_API_KEY` values. The example uses the cost-efficient `gpt-5.6-luna`, but the model remains configurable without code changes. Credentials are never inferred from unrelated environment variables. `DIBS_AI_TIMEOUT_MS` defaults to 15000. If AI is unavailable, Dibs preserves structured state and does not infer or execute marketplace actions.

The legacy web marketplace still requires email and password authentication; a phone identity alone never grants a web session. Alpha web auth has no email verification or password reset, so keep launch invite-only and handle resets manually.

## Public website onboarding

The standalone public website is maintained in the separate `dibs.web` repository and deployed independently. Do not import its source or deployment configuration into this application. It submits phone onboarding directly to this application's `/api/onboarding` endpoint. Local requests are allowed from `http://127.0.0.1:3001` and `http://localhost:3001` (the existing port `4200` development origins remain allowed).

`DIBS_WEB_ORIGINS` accepts comma-separated trusted origins and matches them exactly; never use `*`. Keep it unset in isolated staging. In production, set it only to the independently deployed public website origin, `https://www.dibs.chat`. That website uses the separately deployed application origin, `https://app.dibs.chat`, as its public API URL.

## Deploy

Apply migrations `001` through `012` before inviting users. Supabase serves listing images from the public `listing-images` bucket; web sellers upload directly with short-lived server-authorized URLs and publish through a small metadata request. Never put secrets in this README or commit environment-specific credentials.

After configuring the dedicated line, manually verify one new buyer/listing connection and one reused connection. Confirm that Spectrum creates a group containing exactly the buyer and seller, sends one introduction, routes inbound messages from both participants without a bot reply, ignores a repeated provider message ID, rejects an unknown sender, and leaves an unconnected conversation on the private relay path.

### Isolated staging

- Use the dedicated `dibs-chat-staging` Supabase project, never the production Supabase project.
- Use a dedicated staging Vercel project, separate from the production Vercel project.
- Set `NEXT_PUBLIC_SITE_URL` to that staging deployment's own application origin. The application intentionally fails when this value is missing or is not an HTTP(S) origin.
- Keep `DIBS_WEB_ORIGINS` unset so isolated staging does not accept requests from the production public website.
- Configure all other credentials only in the staging environment; do not copy production secrets.

### Production

Production keeps the application and public website as separate deployments:

```env
NEXT_PUBLIC_SITE_URL=https://app.dibs.chat
DIBS_WEB_ORIGINS=https://www.dibs.chat
```

Deploy this repository only as the production application. Deploy `dibs.web` from its own repository as the standalone public website; do not import that repository into this Vercel project or this application.

## Alpha operating notes

- Invite only adults (18+) and manually remove prohibited listings in Supabase.
- Sellers can confirm price changes, sold status, and removals over iMessage; other listing edits and user support remain manual for the first users.
- Conversations poll every three seconds; no realtime service is required.
- There are no payments or purchase protection. Users arrange meetup/payment themselves.
- Add iMessage only after the web loop shows real usage; its adapter should call these same API/core operations.

Expected initial recurring cost: Vercel and Supabase free tiers, plus OpenAI usage (typically under $25/month at early Alpha volume). A third-party iMessage line is not included.