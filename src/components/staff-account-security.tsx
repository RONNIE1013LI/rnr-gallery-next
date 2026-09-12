"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useCommerceIdentity } from "./commerce-identity-provider";
import buttons from "./storefront.module.css";
import styles from "./staff-account-security.module.css";

const roleLabels = { owner: "Owner", admin: "Admin", staff: "Staff — Orders & Payment Requests", customer_service: "Customer Service", designer: "Designer", production: "Production Staff", temporary: "Temporary Staff" };
type SecurityState = {
  staffAccounts?: { id: string; name: string; email: string; role: keyof typeof roleLabels; enabled: boolean; twoFactorEnabled: boolean; expiresAt: string | null; lastLoginAt: string | null }[];
  role: string; twoFactorEnabled: boolean; fallbackVerified: boolean; enforced: boolean;
  passkeys: { id: string; name: string | null }[];
  sessions: { id: string; userAgent: string | null; createdAt: string; lastActiveAt: string | null; current: boolean }[];
};
type AuthResult = { error: { message?: string } | null; data?: unknown };
export function StaffAccountSecurity({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const { activateUser } = useCommerceIdentity();
  const [state, setState] = useState<SecurityState | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [uri, setUri] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/security", { cache: "no-store" });
    if (response.ok) setState(await response.json());
    else setState(null);
  }, []);
  useEffect(() => {
    let active = true;
    void fetch("/api/admin/security", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as SecurityState : null)
      .then((result) => { if (active) setState(result); })
      .catch(() => { if (active) setMessage("Account security could not be loaded. Please try again."); });
    return () => { active = false; };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }
  function checked(result: AuthResult) {
    if (result.error) throw new Error(result.error.message ?? "Verification failed. Please try again.");
    return result.data;
  }
  async function finishVerification() {
    const result = await authClient.getSession();
    if (result.data?.user.id) activateUser(result.data.user.id);
    setCode(""); setRecovery(""); setUri(null);
    setMessage("Identity verified. You can continue working.");
  }
  async function post(body: object) {
    const response = await fetch("/api/admin/security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "The action could not be completed.");
  }
  return <article className={styles.page}>
    <h1>Account security</h1>
    <p>Use a passkey for secure staff access. Your authenticator and recovery codes help if a device is unavailable.</p>
    {message && <p className={styles.message} role="status">{message}</p>}
    <section className={styles.panel}>
      <h2>Verify your identity</h2>
      <div className={styles.actions}><button className={buttons.primaryButton} disabled={busy} onClick={() => void run(async () => { checked(await authClient.signIn.passkey()); await finishVerification(); })}>Use a passkey</button>
        <Link className={buttons.secondaryButton} href={`/account/sign-in?next=${encodeURIComponent(returnTo)}`}>Sign in with password</Link></div>
      <form onSubmit={(event) => { event.preventDefault(); void run(async () => { checked(await authClient.twoFactor.verifyTotp({ code, trustDevice: false })); await finishVerification(); }); }}>
        <label className={styles.field}>Authenticator code<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <div className={styles.actions}><button className={buttons.secondaryButton} disabled={busy}>Verify authenticator</button></div>
      </form>
      <details><summary>Use a recovery code</summary><p>A recovery sign-in gives you five minutes to add a replacement passkey. Verify with that passkey before changing sensitive settings.</p><form onSubmit={(event) => { event.preventDefault(); void run(async () => { checked(await authClient.twoFactor.verifyBackupCode({ code: recovery, trustDevice: false })); await finishVerification(); }); }}>
        <label className={styles.field}>Recovery code<input autoComplete="off" required value={recovery} onChange={(e) => setRecovery(e.target.value)} /></label>
        <div className={styles.actions}><button className={buttons.secondaryButton} disabled={busy}>Use recovery code once</button></div>
      </form></details>
      {state && <div className={styles.actions}><button className={buttons.primaryButton} disabled={busy} onClick={() => router.push(returnTo)}>Continue to work</button></div>}
    </section>
    {state && <>
      <section className={styles.panel}><h2>Passkeys</h2><p>Register two passkeys on separate devices if possible.</p>
        {state.passkeys.map((key) => <div className={styles.device} key={key.id}><strong>{key.name || "Passkey"}</strong><div className={styles.actions}><button className={buttons.secondaryButton} disabled={busy} onClick={() => void run(async () => { checked(await authClient.passkey.deletePasskey({ id: key.id })); })}>Remove</button></div></div>)}
        <div className={styles.actions}><button className={buttons.secondaryButton} disabled={busy} onClick={() => void run(async () => { checked(await authClient.passkey.addPasskey({ name: "Staff passkey" })); })}>Add a passkey</button></div>
      </section>
      <section className={styles.panel}><h2>Authenticator and recovery codes</h2><p>{state.twoFactorEnabled ? "Authenticator enabled. Verify your identity before regenerating recovery codes." : "Set up an authenticator, then verify its six-digit code above."}</p>
        <label className={styles.field}>Current password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <div className={styles.actions}><button className={buttons.secondaryButton} disabled={busy || !password} onClick={() => void run(async () => {
          if (state.twoFactorEnabled) {
            const result = checked(await authClient.twoFactor.generateBackupCodes({ password })) as { backupCodes: string[] }; setCodes(result.backupCodes);
          } else {
            const result = checked(await authClient.twoFactor.enable({ password })) as { totpURI: string; backupCodes: string[] }; setUri(result.totpURI); setCodes(result.backupCodes);
          }
          setPassword("");
        })}>{state.twoFactorEnabled ? "Regenerate recovery codes" : "Set up authenticator"}</button></div>
        {uri && <div className={styles.message}><a href={uri}>Open in your authenticator</a><p>Or enter this setup key in your authenticator:</p><code>{new URL(uri).searchParams.get("secret")}</code></div>}
        {!!codes.length && <div className={styles.message}><strong>Save these codes in your password manager now. They will not be shown again.</strong><ul className={styles.codes}>{codes.map((value) => <li key={value}><code>{value}</code></li>)}</ul><div className={styles.actions}><button className={buttons.secondaryButton} onClick={() => setCodes([])}>I saved my recovery codes</button></div></div>}
      </section>
      <section className={styles.panel}><h2>Active sessions</h2><p>Sessions use the site&apos;s standard secure expiry and refresh while you continue working. You can revoke any device here.</p>
        {state.sessions.map((device) => <div className={styles.device} key={device.id}><strong>{device.current ? "This session" : "Other session"}</strong><span>{device.userAgent || "Unknown browser"}</span><span>Signed in {new Date(device.createdAt).toLocaleString()}</span><span>Last active {device.lastActiveAt ? new Date(device.lastActiveAt).toLocaleString() : "Before security activation"}</span><div className={styles.actions}><button className={buttons.secondaryButton} disabled={busy} onClick={() => void run(() => post({ action: "revoke", sessionId: device.id }))}>Revoke session</button></div></div>)}
        <div className={styles.actions}><button className={buttons.secondaryButton} disabled={busy} onClick={() => void run(() => post({ action: "revoke-others" }))}>Revoke all other sessions</button></div>
      </section>
      {state.staffAccounts && ["owner", "admin"].includes(state.role) && <section className={styles.panel}>
        <h2>Staff access</h2><p>Each employee uses their own account. Access changes require recent verification and sign the affected employee out.</p>
        <form onSubmit={(event) => {
          event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
          void run(async () => { await post({ action: "invite", name: data.get("name"), email: data.get("email"), role: data.get("role") }); form.reset(); setMessage("Setup invitation requested."); });
        }}>
          <label className={styles.field}>Staff name<input name="name" required maxLength={120} autoComplete="off" /></label>
          <label className={styles.field}>Staff email<input name="email" type="email" required autoComplete="off" /></label>
          <label className={styles.field}>Staff role<select name="role" defaultValue="customer_service">{Object.entries(roleLabels).filter(([role]) => state.role === "owner" || !["owner", "admin"].includes(role)).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
          <div className={styles.actions}><button className={buttons.secondaryButton} disabled={busy}>Send setup invitation</button></div>
        </form>
        {state.staffAccounts.map((member) => <div className={styles.device} key={member.id}>
          <strong>{member.name}</strong><span>{member.email}</span><span>{roleLabels[member.role]} · {member.enabled ? "Active" : "Disabled"} · Authenticator {member.twoFactorEnabled ? "enabled" : "not set up"}</span><span>Last login: {member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString() : "Not recorded since security activation"}</span>
          {(state.role === "owner" || !["owner", "admin"].includes(member.role)) && <form onSubmit={(event) => {
            event.preventDefault(); const data = new FormData(event.currentTarget); const expiry = String(data.get("expiry") || "");
            void run(() => post({ action: "change-staff", userId: member.id, role: data.get("role"), enabled: data.get("enabled") === "on", expiresAt: expiry ? new Date(`${expiry}T23:59:59`).toISOString() : null }));
          }}>
            <label className={styles.field}>Role for {member.name}<select name="role" defaultValue={member.role}>{Object.entries(roleLabels).filter(([role]) => state.role === "owner" || !["owner", "admin"].includes(role)).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
            <label><input type="checkbox" name="enabled" defaultChecked={member.enabled} /> Account enabled</label>
            <label className={styles.field}>Access expiry (optional)<input type="date" name="expiry" defaultValue={member.expiresAt?.slice(0, 10) ?? ""} /></label>
            <div className={styles.actions}><button className={buttons.secondaryButton} disabled={busy}>Apply access and revoke sessions</button></div>
          </form>}
        </div>)}
      </section>}
      {state.role === "owner" && <section className={styles.panel}><h2>Owner rollout</h2><p>Complete a passkey and authenticator setup, save your recovery codes, then sign out and test a fallback login before enforcing the policy.</p><div className={styles.actions}><button className={buttons.primaryButton} disabled={busy || state.enforced || !state.fallbackVerified} onClick={() => void run(() => post({ action: "enforce" }))}>{state.enforced ? "Policy enforced" : "Enforce staff MFA policy"}</button><Link href="/admin/users">Staff accounts</Link></div></section>}
    </>}
  </article>;
}
