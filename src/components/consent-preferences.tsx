"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  parseAdvertisingConsent,
  type AdvertisingConsent,
} from "@/domain/consent/advertising-consent";

type AdvertisingConsentContextValue = Readonly<{
  consent: AdvertisingConsent | null;
  openPreferences: () => void;
}>;

const AdvertisingConsentContext = createContext<AdvertisingConsentContextValue | null>(null);

export function useAdvertisingConsent(): AdvertisingConsent | null {
  return useContext(AdvertisingConsentContext)?.consent ?? null;
}

export function CookiePreferencesTrigger() {
  const context = useContext(AdvertisingConsentContext);
  if (!context?.consent) return null;

  return <button
    className="site-footer__cookie-trigger"
    type="button"
    onClick={context.openPreferences}
  >
    Cookie preferences
  </button>;
}

type Choice = Readonly<{ analytics: boolean; advertising: boolean }>;

function choicesFromConsent(consent: AdvertisingConsent | null): Choice {
  return {
    analytics: consent?.analytics ?? false,
    advertising: consent?.advertising ?? false,
  };
}

export function ConsentPreferences({
  initialConsent,
  children,
}: Readonly<{
  initialConsent: AdvertisingConsent | null;
  children: React.ReactNode;
}>) {
  const [consent, setConsent] = useState(initialConsent);
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [choice, setChoice] = useState<Choice>(() => choicesFromConsent(initialConsent));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const defaultSaved = useRef(false);

  function openPreferences() {
    setChoice(choicesFromConsent(consent));
    setError(null);
    setManaging(false);
    setOpen(true);
  }

  const save = useCallback(async (next: Choice) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error("Consent save failed");
      const payload = await response.json() as { consent?: unknown };
      const saved = parseAdvertisingConsent(
        payload.consent === undefined ? undefined : JSON.stringify(payload.consent),
      );
      if (!saved) throw new Error("Invalid consent response");
      setConsent(saved);
      setChoice(choicesFromConsent(saved));
      setManaging(false);
      setOpen(false);
    } catch {
      setError("Your cookie preferences could not be saved. Please try again.");
      setOpen(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (initialConsent || defaultSaved.current) return;
    defaultSaved.current = true;
    void save({ analytics: true, advertising: true });
  }, [initialConsent, save]);

  return (
    <AdvertisingConsentContext value={{ consent, openPreferences }}>
      {children}
      {open ? <section className="consent-preferences" aria-label="Cookie preferences">
        <div className="consent-preferences__content">
          <h2>Cookie preferences</h2>
          <p>We use optional cookies to measure site use and advertising performance.</p>
          {managing ? <fieldset className="consent-preferences__options">
            <legend>Optional cookies</legend>
            <label>
              <input
                type="checkbox"
                checked={choice.analytics}
                onChange={(event) => setChoice((current) => ({
                  ...current,
                  analytics: event.target.checked,
                }))}
              />
              Analytics measurement
            </label>
            <label>
              <input
                type="checkbox"
                checked={choice.advertising}
                onChange={(event) => setChoice((current) => ({
                  ...current,
                  advertising: event.target.checked,
                }))}
              />
              Advertising measurement
            </label>
          </fieldset> : null}
          {error ? <p role="alert">{error}</p> : null}
          <div className="consent-preferences__actions">
            <button type="button" disabled={saving} onClick={() => void save({ analytics: true, advertising: true })}>Accept all</button>
            <button type="button" disabled={saving} onClick={() => void save({ analytics: false, advertising: false })}>Essential only</button>
            {managing ? <>
              <button type="button" disabled={saving} onClick={() => void save(choice)}>Save preferences</button>
              <button type="button" disabled={saving} onClick={() => {
                setManaging(false);
                setError(null);
                if (consent) setOpen(false);
              }}>Cancel</button>
            </> : <button type="button" disabled={saving} onClick={() => setManaging(true)}>Manage preferences</button>}
          </div>
        </div>
      </section> : null}
    </AdvertisingConsentContext>
  );
}
