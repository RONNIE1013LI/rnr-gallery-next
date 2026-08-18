"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClientId } from "@/lib/client-id";
import type { StaffAccessProfile } from "@/server/auth/staff-access-profile";
import { EmployeeAccessFields, emptyStaffAccessProfile } from "./employee-access-fields";
import styles from "./admin.module.css";

export function EmployeeCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const [profile, setProfile] = useState<StaffAccessProfile>(() => emptyStaffAccessProfile());
  const [idempotencyKey] = useState(() => createClientId());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: email.trim().toLowerCase(),
          initialPassword,
          adminPermissions: profile.adminPermissions,
          formPermissions: profile.formPermissions,
          assignedOnly: profile.assignedOnly,
          idempotencyKey,
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; result?: { id?: string } } | null;
      if (!response.ok || !payload?.result?.id) throw new Error(payload?.error || "The employee could not be created.");
      setInitialPassword("");
      router.push(`/admin/users/${encodeURIComponent(payload.result.id)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The employee could not be created.");
    } finally {
      setPending(false);
    }
  }

  return <form className={styles.employeeAccessForm} onSubmit={submit}>
    <div className={styles.employeeIdentityFields}>
      <label><span>Name</span><input required autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label><span>Email</span><input required type="email" autoComplete="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className={styles.employeeWideField}><span>Initial password</span><input aria-label="Initial password" required type="password" autoComplete="new-password" value={initialPassword} onChange={(event) => setInitialPassword(event.target.value)} /><small>Keep this password private. The employee can change it later through Password Reset.</small></label>
    </div>
    <EmployeeAccessFields profile={profile} onChange={setProfile} disabled={pending} />
    <div className={styles.employeeFormActions}>
      <p role="status">{message || "Choose only the permissions this employee needs."}</p>
      <button className={styles.primaryAdminButton} disabled={pending} type="submit">{pending ? "Creating…" : "Create employee"}</button>
    </div>
  </form>;
}
