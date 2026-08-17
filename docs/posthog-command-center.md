# Dibs — Command Center

This is the prepared PostHog dashboard specification. Creating it requires a PostHog personal API key or authenticated UI access; `POSTHOG_API_KEY` is a project ingestion key and must not be used as a management credential. No dashboard API calls or synthetic events are made by this repository.

## Global settings

- Dashboard name: `Dibs — Command Center`
- Default date range: `Today`
- Saved date-range variants: `Today`, `Last 7 days`, `Last 30 days`
- All insights count events unless a unique-user count is explicitly stated.
- Person identity is the internal Dibs user UUID. Anonymous events use the fixed non-person identifier `dibs_anonymous`; person profile creation and GeoIP enrichment are disabled.

## TODAY

Create number insights with date range **Today**:

| Tile | Event | Aggregation |
| --- | --- | --- |
| New users | `user_signed_up` | Unique users |
| Onboardings completed | `onboarding_completed` | Unique users |
| First conversations | `first_message_received` | Unique users |
| Listings created | `listing_created` | Total events |
| Buy requests | `buy_request` | Total events |
| Sell requests | `sell_request` | Total events |
| Deals started | `deal_started` | Total events |
| Deals completed | `deal_completed` | Total events |
| Messages received | `message_received` | Total events |
| Messages sent | `message_sent` | Total events |
| AI responses | `ai_response_generated` | Total events; filter `success = true` |
| Relay conversations | `relay_started` | Total events |
| Follow-ups sent | `followup_sent` | Total events |
| Errors | `dibs_error` | Total events |

## GROWTH

Create trends with daily interval and saved variants for Today, 7 days, and 30 days:

- New users by day: unique users on `user_signed_up`
- Listings by day: count `listing_created`
- Buy requests by day: count `buy_request`
- Sell requests by day: count `sell_request`
- First conversations by day: unique users on `first_message_received`

## ACTIVATION

Create a unique-users funnel with ordered steps and a 30-day conversion window:

1. `user_signed_up`
2. `onboarding_completed`
3. `first_message_received`
4. `first_response_sent`
5. `buy_request` **or** `sell_request` (use a grouped final step)

Add a second retention/trend insight for repeat marketplace interaction: users with at least two `buy_request` or `sell_request` events in the selected period. No separate activation-state event is stored.

## MARKETPLACE

- Buy vs sell: bar trend with `buy_request` and `sell_request`
- Listings by category: `listing_created`, breakdown `category`
- Searches by category: `product_search`, breakdown `category`
- Deals by category: `deal_completed`, breakdown `category`
- Activity by city: combined `listing_created`, `product_search`, `buy_request`, and `sell_request`, breakdown `city`

## MESSAGING

- Inbound messages: `message_received`, filter `direction = inbound`
- Outbound messages: `message_sent`, filter `direction = outbound`
- AI responses: `ai_response_generated`, breakdown `success`
- Delivery failures: `message_delivery_failed`, breakdown `failure_type`

## RELAY

- Starts: `relay_started`
- Messages: `relay_message_sent`, breakdown `direction`
- Completions: `relay_completed`
- Failures: `relay_failed`, breakdown `failure_type`

## NOTIFICATIONS

- Scheduled: `followup_scheduled`
- Evaluated: `followup_evaluated`, breakdown `decision`
- Sent: `followup_sent`
- Suppressed: `followup_suppressed`, breakdown `decision`
- Failed: `followup_failed`, breakdown `failure_type`

## ERRORS

- Errors by subsystem: `dibs_error`, breakdown `subsystem`
- Errors by type: `dibs_error`, breakdown `error_type`
- Retryable vs non-retryable: `dibs_error`, breakdown `retryable`

## Current source coverage

Future events currently available to these insights are web signup/completion, web listing creation/sell request, web search/buy request, web participant messages, confirmed web deals, and mapped first-party onboarding/conversation events. Relay, follow-up, general iMessage delivery, and AI lifecycle widgets are intentionally prepared but will remain empty until observation points can be added without editing the protected implementations. This dashboard must not be populated by automatic historical backfill.