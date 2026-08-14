"use client";

import { FormEvent, useState } from "react";
import type {
  AdminUserRole,
  FormAccessPreset,
} from "@/server/admin/admin-user-service";
import { createClientId } from "@/lib/client-id";
import styles from "./admin.module.css";

const roleOptions: readonly Readonly<{ value: AdminUserRole; label: string }>[] = [
  { value: "admin", label: "Admin" },
  { value: "form_staff", label: "Forms staff" },
  { value: "staff", label: "Staff" },
  { value: "customer", label: "Customer" },
];

export function UserRoleControl({
  userId,
  email,
  currentRole,
  currentFormPreset = null,
  disabled = false,
}: Readonly<{
  userId: string;
  email: string;
  currentRole: AdminUserRole;
  currentFormPreset?: FormAccessPreset | null;
  disabled?: boolean;
}>) {
  const [savedRole, setSavedRole] = useState(currentRole);
  const [selectedRole, setSelectedRole] = useState(currentRole);
  const [savedPreset, setSavedPreset] = useState<FormAccessPreset | null>(currentFormPreset);
  const [selectedPreset, setSelectedPreset] = useState<FormAccessPreset>(
    currentFormPreset ?? "manager",
  );
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const presetChanged = selectedRole === "form_staff" && selectedPreset !== savedPreset;
    if (disabled || pending || (selectedRole === savedRole && !presetChanged)) return;
    setPending(true);
    setFeedback("");
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: selectedRole,
          ...(selectedRole === "form_staff" ? { formPreset: selectedPreset } : {}),
          idempotencyKey: createClientId(),
        }),
      });
      const body = await response.json().catch(() => null) as {
        error?: string;
        result?: { role?: AdminUserRole; formPreset?: FormAccessPreset | null; changed?: boolean };
      } | null;
      if (!response.ok) throw new Error(body?.error || "The user role could not be updated.");
      const role = body?.result?.role ?? selectedRole;
      setSavedRole(role);
      setSelectedRole(role);
      const preset = body?.result?.formPreset ?? (role === "form_staff" ? selectedPreset : null);
      setSavedPreset(preset);
      if (preset) setSelectedPreset(preset);
      setFeedback(body?.result?.changed === false ? "No change was needed." : "Role updated.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The user role could not be updated.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.roleEditor} onSubmit={submit}>
      <select
        aria-label={`Role for ${email}`}
        value={selectedRole}
        disabled={disabled || pending}
        onChange={(event) => {
          setSelectedRole(event.target.value as AdminUserRole);
          setFeedback("");
        }}
      >
        {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {selectedRole === "form_staff" ? (
        <select
          aria-label={`Forms profile for ${email}`}
          value={selectedPreset}
          disabled={disabled || pending}
          onChange={(event) => {
            setSelectedPreset(event.target.value as FormAccessPreset);
            setFeedback("");
          }}
        >
          <option value="manager">Manager</option>
          <option value="artist">Artist · assigned orders only</option>
          <option value="finance">Finance</option>
          <option value="readOnly">Read only</option>
        </select>
      ) : null}
      <button
        type="submit"
        disabled={
          disabled ||
          pending ||
          (selectedRole === savedRole &&
            (selectedRole !== "form_staff" || selectedPreset === savedPreset))
        }
        aria-label={`Save role for ${email}`}
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <small className={styles.roleFeedback} aria-live="polite">
        {disabled ? "Current account" : feedback}
      </small>
    </form>
  );
}
