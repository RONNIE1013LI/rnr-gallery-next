"use client";

import { useState } from "react";
import type { DeliveryPreference, Orientation, PhotoSubmissionMethod } from "@/domain/configuration/types";
import { getActiveCartStorageKey } from "@/domain/cart/browser-cart-scope";
import { MAX_PEOPLE_PETS_PER_ITEM } from "@/domain/checkout/input-schema";
import css from "./configuration-flow.module.css";

export type ConfigurationDraftOptions = {
  sizeKey: string;
  orientation?: Orientation;
  peoplePets: number;
  needByDate: string;
  deliveryPreference: DeliveryPreference;
  photoMethods: PhotoSubmissionMethod[];
};

export function ConfigurationDraft({ scope, options, allowedSizes, onRestore }: {
  scope: string; options: ConfigurationDraftOptions; allowedSizes: string[]; onRestore: (options: ConfigurationDraftOptions) => void;
}) {
  const [message, setMessage] = useState("");
  function storageKey() { return `${getActiveCartStorageKey()}:configuration:${scope}`; }
  function selections(value: ConfigurationDraftOptions): ConfigurationDraftOptions {
    return { sizeKey: value.sizeKey, orientation: value.orientation, peoplePets: value.peoplePets, needByDate: value.needByDate, deliveryPreference: value.deliveryPreference, photoMethods: value.photoMethods };
  }
  function save() {
    try {
      sessionStorage.setItem(storageKey(), JSON.stringify({ version: 1, savedAt: Date.now(), options: selections(options) }));
      setMessage("Options saved for 24 hours in this browser tab. Re-add photos and design text after refreshing.");
    } catch { setMessage("Options could not be saved in this browser. Keep this page open to retain your work."); }
  }
  function restore() {
    try {
      const draft = JSON.parse(sessionStorage.getItem(storageKey()) ?? "null");
      const value = draft?.options;
      if (draft?.version !== 1 || typeof draft.savedAt !== "number" || Date.now() - draft.savedAt > 86_400_000 || draft.savedAt > Date.now()
        || !value || !allowedSizes.includes(value.sizeKey)
        || !Number.isInteger(value.peoplePets) || value.peoplePets < 0 || value.peoplePets > MAX_PEOPLE_PETS_PER_ITEM
        || (value.orientation !== undefined && value.orientation !== "landscape" && value.orientation !== "portrait")
        || typeof value.needByDate !== "string" || value.needByDate.length > 10
        || !["post", "pickup"].includes(value.deliveryPreference)
        || !Array.isArray(value.photoMethods) || value.photoMethods.length !== options.photoMethods.length
        || !value.photoMethods.every((method: unknown) => method === "upload" || method === "later")) {
        setMessage("No saved options are available for this product and customer, or they have expired."); return;
      }
      onRestore(selections(value));
      setMessage("Options restored. Check your dates and re-add photos and design text. Rush service must be confirmed again.");
    } catch { setMessage("Saved options are unavailable. You can continue with your current selections."); }
  }
  return <div className={css.draft}>
    <p>Save your options before leaving. Photos and design text stay only on this open page and are not saved.</p>
    <button type="button" onClick={save}>Save options</button>
    <button type="button" onClick={restore}>Restore options</button>
    <button type="button" onClick={() => { try { sessionStorage.removeItem(storageKey()); setMessage("Saved options cleared."); } catch { setMessage("Saved options could not be cleared in this browser."); } }}>Clear saved options</button>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
