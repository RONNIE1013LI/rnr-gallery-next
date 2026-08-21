# Facebook Customer Display Names Design

## Goal

Show a Facebook customer's sanitized first and last name in the internal Reply Assistant when Meta permits a least-privilege profile lookup, while preserving the existing no-send and privacy boundaries.

## Safety Boundary

- The resolver performs one fixed Graph `GET /{PSID}?fields=first_name,last_name` request.
- `FACEBOOK_PROFILE_LOOKUP_TOKEN` is server-only and is read only by the resolver factory.
- The token must not have `pages_messaging` or another sending capability. Staging is blocked unless the effective scopes satisfy this condition.
- There is no generic Graph client, Graph `POST`, Messenger Send API, profile picture lookup, or automatic reply path.
- Raw PSID exists only while the webhook request is handled. It is never stored, logged, returned to the browser, or passed to the Customer Service Engine or OpenAI.
- Display names are UI-only. They are excluded from prompts, conversation context, feedback, Golden Replies, Case Memory, Learning Candidates, and reusable examples.

## Flow

1. The Facebook adapter normalizes a real Messenger event and exposes the raw PSID in its existing server-only normalized message.
2. The webhook HMACs the PSID and persists the message first.
3. For customer messages only, the webhook asks the repository to claim profile resolution for the hashed conversation.
4. A successful claim invokes the fixed, bounded Graph GET during the same request lifecycle.
5. The resolver validates and sanitizes `first_name` and `last_name`, then the repository stores only the display name, status, and cache timestamps.
6. A queue-conversation live-update event lets existing incremental polling refresh the card and timeline without resetting draft editor state.
7. Any lookup or persistence failure is fail-soft and cannot change webhook success or downstream AI processing.

## Storage And CAS

Additive conversation columns:

- `customer_display_name`
- `profile_resolution_status`: `unresolved`, `resolving`, `resolved`, `temporary_failure`, or `unavailable`
- `profile_resolved_at`
- `profile_retry_after`

`profile_retry_after` is also the expiry of a short `resolving` lease. A database compare-and-set claim allows only an unresolved, expired-cache, failed-after-backoff, or expired-lease row to transition to `resolving`. Concurrent webhook requests therefore make at most one profile API request.

Cache periods:

- resolved: 30 days
- temporary failure: 24 hours
- known unavailable or no permission: 7 days

Old conversations are not reverse-resolved from their hashes. Their next real customer webhook supplies the PSID briefly and follows the same claim path.

## Resolver Contract

Input: raw PSID supplied by the current Facebook webhook request.

Output:

- `resolved`: sanitized display name
- `temporary_failure`: timeout, transport, 429, or 5xx
- `unavailable`: permission denial, absent profile, invalid response, or no usable name

The request uses an Authorization header and a fixed fields list. Error bodies and URLs are not logged.

## UI

Queue records expose `customerDisplayName: string | null`. The conversation card and every customer timeline item use `customerDisplayName ?? "Customer"`. Staff remains `R&R`. Existing live polling carries the updated queue item.

## Staging Stop Rule

Before real Test Page validation, inspect the dedicated token's effective scopes. Staging is READY only when profile lookup succeeds and `pages_messaging`/sending capability is absent. Otherwise stop with `STAGING NOT READY`; do not expand permissions.
