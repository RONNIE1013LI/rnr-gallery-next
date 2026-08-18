"use client";

import { useState, type FormEvent } from "react";
import { createClientId } from "@/lib/client-id";
import type { AdminUserAccount, AdminUserRole, FormAccessPreset } from "@/server/admin/admin-user-service";
import {
  normalizeStaffAccessProfile,
  type StaffAccessProfile,
} from "@/server/auth/staff-access-profile";
import { EmployeeAccessFields, emptyStaffAccessProfile } from "./employee-access-fields";
import styles from "./admin.module.css";

const roles: readonly Readonly<{ value: AdminUserRole; label: string }>[] = [
  { value: "admin", label: "Admin" }, { value: "form_staff", label: "Forms staff" },
  { value: "staff", label: "Staff" }, { value: "customer", label: "Customer" },
];

function profileFor(account: AdminUserAccount): StaffAccessProfile {
  if (account.role === "staff" && account.adminPermissions && account.formPermissions && account.assignedOnly !== null) {
    try {
      return normalizeStaffAccessProfile({
        adminPermissions: account.adminPermissions,
        formPermissions: account.formPermissions,
        assignedOnly: account.assignedOnly,
      });
    } catch {
      return emptyStaffAccessProfile();
    }
  }
  return emptyStaffAccessProfile();
}

function accessPayload(
  role: AdminUserRole,
  profile: StaffAccessProfile,
  formPreset: FormAccessPreset | "",
) {
  if (role === "staff") {
    return {
      role,
      adminPermissions: profile.adminPermissions,
      formPermissions: profile.formPermissions,
      assignedOnly: profile.assignedOnly,
    };
  }
  return role === "form_staff" ? { role, formPreset } : { role };
}

type PendingMutation = Readonly<{ fingerprint: string; idempotencyKey: string }>;

export function EmployeeAccessForm({ account, currentUserId }: Readonly<{ account: AdminUserAccount; currentUserId: string }>) {
  const locked = account.id === currentUserId;
  const [role, setRole] = useState<AdminUserRole>(account.role);
  const [profile, setProfile] = useState<StaffAccessProfile>(() => profileFor(account));
  const [formPreset, setFormPreset] = useState<FormAccessPreset | "">(account.formPreset ?? "");
  const [savedFingerprint, setSavedFingerprint] = useState(() => JSON.stringify(
    accessPayload(account.role, profileFor(account), account.formPreset ?? ""),
  ));
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const payload = accessPayload(role, profile, formPreset);
  const fingerprint = JSON.stringify(payload);
  const unchanged = fingerprint === savedFingerprint;
  const presetMissing = role === "form_staff" && formPreset === "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || locked || unchanged) return;
    setPending(true);
    setMessage("");
    const mutation = pendingMutation?.fingerprint === fingerprint
      ? pendingMutation
      : { fingerprint, idempotencyKey: createClientId() };
    if (mutation !== pendingMutation) setPendingMutation(mutation);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(account.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey: mutation.idempotencyKey }),
      });
      const responseBody = await response.json().catch(() => null) as { error?: string; result?: { changed?: boolean } } | null;
      if (!response.ok) throw new Error(responseBody?.error || "The employee access could not be updated.");
      setSavedFingerprint(fingerprint);
      setMessage(responseBody?.result?.changed === false ? "No change was needed." : "Employee access saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The employee access could not be updated.");
    } finally {
      setPending(false);
    }
  }

  return <form className={styles.employeeAccessForm} onSubmit={submit}>
    <div className={styles.employeeAccountSummary}>
      <div><strong>{account.name}</strong><span>{account.email}</span></div>
      <label><span>Account type</span><select aria-label="Account type" value={role} disabled={locked || pending} onChange={(event) => { setRole(event.target.value as AdminUserRole); setMessage(""); }}>{roles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    </div>
    {locked ? <div className={styles.safetyBanner} role="note"><strong>Current account — access is locked.</strong><p>Another database administrator must make changes to this account.</p></div> : null}
    {role === "admin" ? <div className={styles.fullAccessNote} role="note"><strong>Full access to all Admin and Forms permissions.</strong><p>Administrator accounts are not limited by employee permission selections.</p></div> : null}
    {role === "staff" ? <EmployeeAccessFields profile={profile} onChange={setProfile} disabled={locked || pending} /> : null}
    {role === "form_staff" ? <label className={styles.employeePresetField}><span>Forms profile</span><select aria-label="Forms profile" value={formPreset} disabled={locked || pending} onChange={(event) => setFormPreset(event.target.value as FormAccessPreset | "")}><option value="" disabled>Choose a Forms profile</option><option value="manager">Manager</option><option value="artist">Artist · assigned orders only</option><option value="finance">Finance</option><option value="readOnly">Read only</option></select><small>Forms staff continue to use the existing Order Entry preset model.</small></label> : null}
    {role === "customer" ? <div className={styles.fullAccessNote} role="note"><strong>Customer account</strong><p>This account has no Admin or Forms permissions.</p></div> : null}
    <div className={styles.employeeFormActions}>
      <p role="status">{message || (locked ? "This account cannot be changed here." : presetMissing ? "Choose a Forms profile before saving." : "Changes take effect on the next permission check.")}</p>
      <button className={styles.primaryAdminButton} disabled={locked || pending || unchanged || presetMissing} type="submit">{pending ? "Saving…" : "Save employee access"}</button>
    </div>
  </form>;
}
