# Reply Assistant Meta Test Environment Runbook

Date prepared: 17 August 2026

## Current result

**Real Meta webhook: FAIL - PENDING TEST ENVIRONMENT**

The Vercel Preview and signed-fixture webhook checks pass, but there is not yet an approved non-Production Messenger App/Page pair. The Preview currently identifies the Production R&R Gallery Page, so it must not be used for this test.

This runbook changes only the development/test Meta environment. It does not authorise a change to the Production App, Production Page, Production callback, Production database or Production feature flag.

## Fixed test boundary

- Development App: select the App currently marked **Development**. Its App ID ends in `66307`.
- Do not touch the published Production-connected App. Its App ID ends in `71071`.
- Test Page: create or select a clearly named non-Production Page, for example `R&R Gallery Messenger Test`.
- Preview callback: `https://rnr-gallery-reply-preview.vercel.app/api/meta/webhook`
- Do not create or configure `META_PAGE_ACCESS_TOKEN`.
- Do not use Messenger Send API.
- Do not change the callback attached to the Production R&R Gallery Page.

Stop if any Meta screen shows the Production Page or the published App ending in `71071` as the asset being edited.

## Ronnie: Meta UI configuration

These steps require the account owner because they change Meta App/Page subscriptions and may require account confirmation.

1. Open **Meta for Developers -> My Apps**.
2. Select the App marked **Development** whose App ID ends in `66307`.
3. Open **Use cases** or **Add product**.
4. Add **Messenger from Meta / Interact with customers on Messenger**.
5. In **App roles**, add the alternate Facebook test account as a Tester if Meta requires a role for Development-mode messaging. Accept the invitation from that test account.
6. Create or select a non-Production Facebook Page named clearly as a test asset. Do not select `R&R Gallery`.
7. In the Development App, open **Messenger API Settings**.
8. Under **Configure Webhooks**, enter:
   - Callback URL: `https://rnr-gallery-reply-preview.vercel.app/api/meta/webhook`
   - Verify token: the Preview-only value stored as `META_VERIFY_TOKEN`
9. Select only the fields required for this test:
   - `messages`
   - `message_echoes`
10. Connect/subscribe only the Test Page to this Development App.
11. Skip any **Generate token** or Page access-token step. A Page access token is not required because this system cannot send messages.

Do not paste Meta secrets or tokens into chat, screenshots, this document or source control.

## Ronnie: Vercel Preview-only environment

In the Vercel project, edit the **Preview** environment only. Do not change Production values.

1. Set `META_APP_SECRET` to the Development App secret.
2. Set `META_VERIFY_TOKEN` to the same Preview-only verification value entered in Meta.
3. Set `META_PAGE_ID` to the non-Production Test Page ID.
4. Confirm `REPLY_ASSISTANT_ENABLED=true` and `REPLY_ASSISTANT_PILOT_LIMIT=100` remain Preview-only.
5. Confirm `AI_PROVIDER=openai` and the reviewed model/budget values remain server-only.
6. Confirm `META_PAGE_ACCESS_TOKEN` does not exist.
7. Redeploy the current candidate to Preview so the new Preview-only variables are active.

## Real test messages

Use a different approved test Facebook account to message the Test Page. Do not use a real customer conversation.

| Case | Test message/action | Expected result |
| --- | --- | --- |
| Low risk | `What details do you need for a custom canvas quote?` | Webhook 200; one message persisted; `DRAFT_ALLOWED`; one OpenAI call; validated draft visible in `/reply-assistant`. |
| HIGH RISK | `I want a refund for this order.` | Webhook 200; message persisted; `NEEDS_HUMAN_REVIEW`; zero OpenAI calls; no sendable draft. |
| REALTIME_REQUIRED | `How much is an A1 canvas today?` | Webhook 200; message persisted; `REALTIME_DATA_REQUIRED`; zero OpenAI calls; no guessed price. |
| Duplicate | In Meta Webhooks test tools, redeliver/test the exact same low-risk event with the same message ID. | Webhook 200; still one message and one attempt; no second OpenAI call. If Meta creates a new message ID instead of redelivering, record this case as not proven rather than PASS. |
| Echo | Manually reply once from the Test Page in Meta Business Suite after subscribing to `message_echoes`. Do not use the App or Send API. | Webhook 200; adapter marks/filter echo; zero new customer message rows and zero OpenAI calls. |

## Evidence to record

Do not record raw sender IDs, conversation IDs, payloads, App secrets, verify tokens or API keys.

| Layer | Required evidence | Result |
| --- | --- | --- |
| Meta | Development App name/ID suffix; Test Page name/ID suffix; `messages` and `message_echoes` subscribed | PENDING |
| Webhook | Five test timestamps and HTTP 200 statuses | PENDING |
| Signature | Real Meta requests accepted; tampered fixture remains rejected | PENDING |
| Page validation | Test Page accepted; any other Page rejected | PENDING |
| PostgreSQL | Hashed message rows and attempt counts for each case | PENDING |
| Policy gate | Low risk allowed; HIGH RISK and REALTIME_REQUIRED blocked before provider | PENDING |
| OpenAI | Exactly one provider call for the low-risk case; zero for blocked, duplicate and echo cases | PENDING |
| UI | Low-risk draft visible; blocked items visible without sendable draft | PENDING |
| No-send | No Page token; no outbound Meta request; test account receives no automatic reply | PENDING |

## Completion record

- Development App reviewer: `________________________________`
- Test Page owner: `________________________________`
- Test executed by: `________________________________`
- Test time (Pacific/Auckland): `________________________________`
- Preview deployment ID: `________________________________`
- Sanitised evidence location: `________________________________`
- Result: `PASS / FAIL`
- Failure reason, if any: `________________________________`

The result may be changed to PASS only when every row above has direct evidence from the real Test Page chain.
