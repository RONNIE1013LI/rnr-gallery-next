"use client";

import { FormEvent, useRef, useState } from "react";
import { createClientId } from "@/lib/client-id";
import type { InternalNotificationRecipientView } from "@/server/notifications/internal-notification-recipient-service";
import {
  INTERNAL_NOTIFICATION_TOPICS,
  INTERNAL_NOTIFICATION_TOPIC_LABELS,
  type InternalNotificationTopic,
} from "@/server/notifications/internal-notification-types";
import styles from "./admin.module.css";

type Coverage = Readonly<Record<InternalNotificationTopic, number>>;
type VerificationDelivery = "sent" | "failed" | "not_configured";
type RecipientJson = Omit<InternalNotificationRecipientView,
  "createdAt" | "verifiedAt" | "verificationExpiresAt" | "disabledAt"> & Readonly<{
    createdAt: string | Date;
    verifiedAt: string | Date | null;
    verificationExpiresAt: string | Date | null;
    disabledAt: string | Date | null;
  }>;

const statusLabels = {
  pending_verification: "Pending verification",
  active: "Active",
  disabled: "Disabled",
} as const;

const dateFormatter = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Pacific/Auckland",
});

function toDate(value: string | Date | null) {
  return value === null ? null : value instanceof Date ? value : new Date(value);
}

function reviveRecipient(recipient: RecipientJson): InternalNotificationRecipientView {
  return Object.freeze({
    ...recipient,
    createdAt: toDate(recipient.createdAt)!,
    verifiedAt: toDate(recipient.verifiedAt),
    verificationExpiresAt: toDate(recipient.verificationExpiresAt),
    disabledAt: toDate(recipient.disabledAt),
  });
}

function activeCoverage(recipients: readonly InternalNotificationRecipientView[]): Coverage {
  const coverage = Object.fromEntries(
    INTERNAL_NOTIFICATION_TOPICS.map((topic) => [topic, 0]),
  ) as Record<InternalNotificationTopic, number>;
  for (const recipient of recipients) {
    if (recipient.status !== "active") continue;
    for (const topic of recipient.topics) coverage[topic] += 1;
  }
  return coverage;
}

function deliveryFeedback(delivery: VerificationDelivery) {
  if (delivery === "sent") return "Verification email sent.";
  if (delivery === "not_configured") {
    return "Recipient saved. Email delivery is not configured. Retry after configuration.";
  }
  return "Recipient saved, but the verification email could not be sent. Retry when ready.";
}

async function responseBody(response: Response) {
  return response.json().catch(() => null) as Promise<{
    error?: string;
    recipient?: RecipientJson;
    verificationDelivery?: VerificationDelivery;
  } | null>;
}

function TopicChoices({ selected, disabled, onToggle }: Readonly<{
  selected: readonly InternalNotificationTopic[];
  disabled?: boolean;
  onToggle: (topic: InternalNotificationTopic) => void;
}>) {
  return (
    <div className={styles.notificationTopicChoices}>
      {INTERNAL_NOTIFICATION_TOPICS.map((topic) => (
        <label key={topic}>
          <input
            type="checkbox"
            checked={selected.includes(topic)}
            disabled={disabled}
            onChange={() => onToggle(topic)}
          />
          <span>{INTERNAL_NOTIFICATION_TOPIC_LABELS[topic]}</span>
        </label>
      ))}
    </div>
  );
}

function toggleTopic(
  topics: readonly InternalNotificationTopic[],
  topic: InternalNotificationTopic,
) {
  return topics.includes(topic)
    ? topics.filter((candidate) => candidate !== topic)
    : [...topics, topic];
}

export function InternalNotificationSettings({ recipients: initialRecipients, coverage: initialCoverage }: Readonly<{
  recipients: readonly InternalNotificationRecipientView[];
  coverage: Coverage;
}>) {
  const [recipientState, setRecipientState] = useState(() => ({
    recipients: [...initialRecipients],
    coverage: initialCoverage,
  }));
  const { recipients, coverage } = recipientState;
  const [email, setEmail] = useState("");
  const [selectedTopics, setSelectedTopics] = useState<readonly InternalNotificationTopic[]>([]);
  const [editingRecipientId, setEditingRecipientId] = useState<string | null>(null);
  const [editTopics, setEditTopics] = useState<readonly InternalNotificationTopic[]>([]);
  const [reenableTopics, setReenableTopics] = useState<Readonly<
    Record<string, readonly InternalNotificationTopic[]>
  >>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const mutationKeys = useRef(new Map<string, string>());

  function mutationKey(scope: string) {
    const existing = mutationKeys.current.get(scope);
    if (existing) return existing;
    const created = createClientId();
    mutationKeys.current.set(scope, created);
    return created;
  }

  function replaceRecipient(next: InternalNotificationRecipientView) {
    setRecipientState((current) => {
      const exists = current.recipients.some((recipient) => recipient.id === next.id);
      const updated = exists
        ? current.recipients.map((recipient) => recipient.id === next.id ? next : recipient)
        : [...current.recipients, next];
      return { recipients: updated, coverage: activeCoverage(updated) };
    });
  }

  async function addRecipient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || selectedTopics.length === 0 || pendingAction) return;
    const scope = `create:${email.trim().toLowerCase()}:${selectedTopics.join(",")}`;
    setPendingAction(scope);
    setFeedback("");
    try {
      const response = await fetch("/api/admin/notification-recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          topics: selectedTopics,
          idempotencyKey: mutationKey(scope),
        }),
      });
      const body = await responseBody(response);
      if (!response.ok || !body?.recipient || !body.verificationDelivery) {
        throw new Error(body?.error || "The notification recipient could not be saved.");
      }
      replaceRecipient(reviveRecipient(body.recipient));
      mutationKeys.current.delete(scope);
      setEmail("");
      setSelectedTopics([]);
      setFeedback(deliveryFeedback(body.verificationDelivery));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The notification recipient could not be saved.");
    } finally {
      setPendingAction(null);
    }
  }

  async function saveSubscriptions(recipientId: string) {
    if (editTopics.length === 0 || pendingAction) return;
    const scope = `edit:${recipientId}:${editTopics.join(",")}`;
    setPendingAction(scope);
    setFeedback("");
    try {
      const response = await fetch(`/api/admin/notification-recipients/${encodeURIComponent(recipientId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: editTopics, idempotencyKey: mutationKey(scope) }),
      });
      const body = await responseBody(response);
      if (!response.ok || !body?.recipient) {
        throw new Error(body?.error || "Subscriptions could not be updated.");
      }
      replaceRecipient(reviveRecipient(body.recipient));
      mutationKeys.current.delete(scope);
      setEditingRecipientId(null);
      setFeedback("Subscriptions updated.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Subscriptions could not be updated.");
    } finally {
      setPendingAction(null);
    }
  }

  async function resendVerification(recipientId: string) {
    if (pendingAction) return;
    const scope = `resend:${recipientId}`;
    setPendingAction(scope);
    setFeedback("");
    try {
      const response = await fetch(
        `/api/admin/notification-recipients/${encodeURIComponent(recipientId)}/verification`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idempotencyKey: mutationKey(scope) }),
        },
      );
      const body = await responseBody(response);
      if (!response.ok || !body?.recipient || !body.verificationDelivery) {
        throw new Error(body?.error || "Verification could not be resent.");
      }
      replaceRecipient(reviveRecipient(body.recipient));
      mutationKeys.current.delete(scope);
      setFeedback(deliveryFeedback(body.verificationDelivery));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Verification could not be resent.");
    } finally {
      setPendingAction(null);
    }
  }

  async function reenableRecipient(
    recipient: InternalNotificationRecipientView,
    topics: readonly InternalNotificationTopic[],
  ) {
    if (topics.length === 0 || pendingAction) return;
    const scope = `reenable:${recipient.id}:${topics.join(",")}`;
    setPendingAction(scope);
    setFeedback("");
    try {
      const response = await fetch("/api/admin/notification-recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: recipient.email,
          topics,
          idempotencyKey: mutationKey(scope),
        }),
      });
      const body = await responseBody(response);
      if (!response.ok || !body?.recipient || !body.verificationDelivery) {
        throw new Error(body?.error || "The notification recipient could not be saved.");
      }
      replaceRecipient(reviveRecipient(body.recipient));
      mutationKeys.current.delete(scope);
      setReenableTopics((current) => {
        const next = { ...current };
        delete next[recipient.id];
        return next;
      });
      setFeedback(deliveryFeedback(body.verificationDelivery));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The notification recipient could not be saved.");
    } finally {
      setPendingAction(null);
    }
  }

  async function disableRecipient(recipient: InternalNotificationRecipientView) {
    if (pendingAction || !window.confirm(`Delete ${recipient.email} from notification emails?`)) return;
    const scope = `disable:${recipient.id}`;
    setPendingAction(scope);
    setFeedback("");
    try {
      const response = await fetch(`/api/admin/notification-recipients/${encodeURIComponent(recipient.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: mutationKey(scope) }),
      });
      const body = await responseBody(response);
      if (!response.ok || !body?.recipient) {
        throw new Error(body?.error || "The notification email could not be deleted.");
      }
      replaceRecipient(reviveRecipient(body.recipient));
      mutationKeys.current.delete(scope);
      setFeedback("Notification email deleted.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The notification email could not be deleted.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className={styles.notificationSettings}>
      <section className={styles.notificationCoverage} aria-labelledby="notification-coverage-heading">
        <div>
          <h2 id="notification-coverage-heading">Notification coverage</h2>
          <p>Only verified active emails count toward coverage.</p>
        </div>
        <div className={styles.notificationWarnings}>
          {INTERNAL_NOTIFICATION_TOPICS.map((topic) => coverage[topic] === 0 ? (
            <p role="status" key={topic}>
              No active recipient for {INTERNAL_NOTIFICATION_TOPIC_LABELS[topic]}.
            </p>
          ) : null)}
        </div>
      </section>

      <form className={styles.notificationAddForm} onSubmit={addRecipient}>
        <div>
          <h2>Add notification email</h2>
          <p>Any valid email may be added. A verification email is required before notifications begin.</p>
        </div>
        <label className={styles.notificationEmailField}>
          <span>Email address</span>
          <input
            type="email"
            value={email}
            maxLength={320}
            required
            disabled={pendingAction !== null}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <fieldset>
          <legend>Notifications</legend>
          <TopicChoices
            selected={selectedTopics}
            disabled={pendingAction !== null}
            onToggle={(topic) => setSelectedTopics((current) => toggleTopic(current, topic))}
          />
        </fieldset>
        <button
          type="submit"
          disabled={pendingAction !== null || !email.trim() || selectedTopics.length === 0}
        >
          {pendingAction?.startsWith("create:") ? "Adding…" : "Add email"}
        </button>
      </form>

      <p className={styles.notificationFeedback} aria-live="polite">{feedback}</p>

      <section className={styles.notificationRecipients} aria-labelledby="notification-recipients-heading">
        <h2 id="notification-recipients-heading">Recipients</h2>
        {recipients.length === 0 ? (
          <p className={styles.emptyState}>No notification emails have been added.</p>
        ) : recipients.map((recipient) => {
          const editing = editingRecipientId === recipient.id;
          const selectedReenableTopics = reenableTopics[recipient.id] ?? [];
          return (
            <article
              className={styles.notificationRecipientCard}
              aria-label={recipient.email}
              key={recipient.id}
            >
              <header>
                <div>
                  <h3>{recipient.email}</h3>
                  <p>
                    Created {dateFormatter.format(recipient.createdAt)}
                    {recipient.verifiedAt ? ` · Verified ${dateFormatter.format(recipient.verifiedAt)}` : ""}
                  </p>
                </div>
                <span className={`${styles.notificationStatus} ${styles[`notificationStatus_${recipient.status}`]}`}>
                  {statusLabels[recipient.status]}
                </span>
              </header>

              {recipient.status === "disabled" ? (
                <fieldset>
                  <legend>Choose notifications to re-enable</legend>
                  <TopicChoices
                    selected={selectedReenableTopics}
                    disabled={pendingAction !== null}
                    onToggle={(topic) => setReenableTopics((current) => ({
                      ...current,
                      [recipient.id]: toggleTopic(current[recipient.id] ?? [], topic),
                    }))}
                  />
                </fieldset>
              ) : editing ? (
                <fieldset>
                  <legend>Edit notifications</legend>
                  <TopicChoices
                    selected={editTopics}
                    disabled={pendingAction !== null}
                    onToggle={(topic) => setEditTopics((current) => toggleTopic(current, topic))}
                  />
                </fieldset>
              ) : (
                <div className={styles.notificationTopicChips} aria-label="Subscribed notifications">
                  {recipient.topics.map((topic) => (
                    <span key={topic}>{INTERNAL_NOTIFICATION_TOPIC_LABELS[topic]}</span>
                  ))}
                </div>
              )}

              <div className={styles.notificationRecipientActions}>
                {editing ? (
                  <>
                    <button
                      type="button"
                      disabled={pendingAction !== null || editTopics.length === 0}
                      onClick={() => void saveSubscriptions(recipient.id)}
                    >Save subscriptions</button>
                    <button type="button" disabled={pendingAction !== null} onClick={() => setEditingRecipientId(null)}>
                      Cancel
                    </button>
                  </>
                ) : recipient.status !== "disabled" ? (
                  <button
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => {
                      setEditTopics(recipient.topics);
                      setEditingRecipientId(recipient.id);
                    }}
                  >Edit subscriptions</button>
                ) : null}
                {recipient.status === "pending_verification" ? (
                  <button
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => void resendVerification(recipient.id)}
                  >Resend verification</button>
                ) : null}
                {recipient.status === "disabled" ? (
                  <button
                    type="button"
                    disabled={pendingAction !== null || selectedReenableTopics.length === 0}
                    onClick={() => void reenableRecipient(recipient, selectedReenableTopics)}
                  >Re-enable and send verification</button>
                ) : null}
                {recipient.status !== "disabled" ? (
                  <button
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => void disableRecipient(recipient)}
                    aria-label={`Delete ${recipient.email}`}
                  >Delete</button>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
