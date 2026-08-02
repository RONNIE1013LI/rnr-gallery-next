"use client";

import { useState } from "react";
import type { AddressInput } from "@/domain/address/types";
import { AddressForm, type AddressFieldErrors } from "./address-form";
import styles from "./storefront.module.css";

export type SavedAddressView = AddressInput & { id: string };

type SavedAddressesProps = {
  initialAddresses: SavedAddressView[];
};

type Editor =
  | { mode: "create" }
  | { mode: "edit"; addressId: string }
  | null;

type ApiError = {
  error?: {
    message?: string;
    fields?: AddressFieldErrors;
  };
};

const emptyAddress: AddressInput = {
  country: "NZ",
  fullName: "",
  building: "",
  street: "",
  suburb: "",
  region: "",
  postcode: "",
  phone: "",
  email: "",
};

async function readApiError(response: Response) {
  try {
    return (await response.json()) as ApiError;
  } catch {
    return {};
  }
}

function addressInputFrom(address: SavedAddressView): AddressInput {
  return {
    country: address.country,
    fullName: address.fullName,
    building: address.building,
    street: address.street,
    suburb: address.suburb,
    region: address.region,
    postcode: address.postcode,
    phone: address.phone,
    email: address.email,
  };
}

function savedAddressViewFrom(address: SavedAddressView): SavedAddressView {
  return { id: address.id, ...addressInputFrom(address) };
}

export function SavedAddresses({ initialAddresses }: SavedAddressesProps) {
  const [addresses, setAddresses] = useState(initialAddresses);
  const [editor, setEditor] = useState<Editor>(null);
  const [formValue, setFormValue] = useState<AddressInput>(emptyAddress);
  const [fieldErrors, setFieldErrors] = useState<AddressFieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);

  const isPending = pendingAction !== null;

  function openCreate() {
    setEditor({ mode: "create" });
    setFormValue({ ...emptyAddress });
    setFieldErrors({});
    setGeneralError(null);
    setDeleteConfirmationId(null);
  }

  function openEdit(address: SavedAddressView) {
    setEditor({ mode: "edit", addressId: address.id });
    setFormValue(addressInputFrom(address));
    setFieldErrors({});
    setGeneralError(null);
    setDeleteConfirmationId(null);
  }

  function closeEditor() {
    setEditor(null);
    setFieldErrors({});
    setGeneralError(null);
  }

  async function saveAddress(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || isPending) return;

    setPendingAction("save");
    setFieldErrors({});
    setGeneralError(null);

    const endpoint = editor.mode === "create"
      ? "/api/account/addresses"
      : `/api/account/addresses/${editor.addressId}`;

    try {
      const response = await fetch(endpoint, {
        method: editor.mode === "create" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formValue),
      });

      const expectedStatus = editor.mode === "create" ? 201 : 200;
      if (response.status !== expectedStatus) {
        const apiError = await readApiError(response);
        setFieldErrors(apiError.error?.fields ?? {});
        setGeneralError(
          apiError.error?.message ?? "We could not save this address. Please try again.",
        );
        return;
      }

      const result = (await response.json()) as { address?: SavedAddressView };
      if (!result.address) throw new Error("Missing address response");
      const savedAddress = savedAddressViewFrom(result.address);

      if (editor.mode === "create") {
        setAddresses((current) => [...current, savedAddress]);
      } else {
        setAddresses((current) =>
          current.map((address) =>
            address.id === editor.addressId ? savedAddress : address,
          ),
        );
      }
      setEditor(null);
    } catch {
      setGeneralError("We could not save this address. Please try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteAddress(addressId: string) {
    if (isPending) return;
    setPendingAction(`delete:${addressId}`);
    setGeneralError(null);

    try {
      const response = await fetch(`/api/account/addresses/${addressId}`, {
        method: "DELETE",
      });

      if (response.status !== 204) {
        const apiError = await readApiError(response);
        setGeneralError(
          apiError.error?.message ?? "We could not delete this address. Please try again.",
        );
        return;
      }

      setAddresses((current) => current.filter((address) => address.id !== addressId));
      setDeleteConfirmationId(null);
      if (editor?.mode === "edit" && editor.addressId === addressId) setEditor(null);
    } catch {
      setGeneralError("We could not delete this address. Please try again.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className={styles.savedAddresses} aria-labelledby="saved-addresses-heading">
      <div className={styles.addressSectionHeading}>
        <h2 id="saved-addresses-heading">Your addresses</h2>
        {!editor && (
          <button
            className={styles.primaryButton}
            disabled={isPending}
            onClick={openCreate}
            type="button"
          >
            Add address
          </button>
        )}
      </div>

      {generalError && (
        <p aria-live="polite" className={styles.formError}>{generalError}</p>
      )}

      {editor?.mode === "create" && (
        <form aria-label="Add saved address" className={styles.addressEditor} onSubmit={saveAddress}>
          <h3>Add address</h3>
          <AddressForm
            disabled={isPending}
            errors={fieldErrors}
            onChange={setFormValue}
            value={formValue}
          />
          <div className={styles.addressActions}>
            <button className={styles.primaryButton} disabled={isPending} type="submit">
              {pendingAction === "save" ? "Saving…" : "Save address"}
            </button>
            <button className={styles.secondaryButton} disabled={isPending} onClick={closeEditor} type="button">
              Cancel
            </button>
          </div>
        </form>
      )}

      {addresses.length === 0 && !editor ? (
        <p className={styles.addressEmpty}>You have no saved addresses yet.</p>
      ) : (
        <div className={styles.addressList}>
          {addresses.map((address) => {
            const isEditing = editor?.mode === "edit" && editor.addressId === address.id;
            const isDeleting = pendingAction === `delete:${address.id}`;

            return (
              <article className={styles.savedAddress} key={address.id}>
                {isEditing ? (
                  <form aria-label="Edit saved address" className={styles.addressEditor} onSubmit={saveAddress}>
                    <h3>Edit address</h3>
                    <AddressForm
                      disabled={isPending}
                      errors={fieldErrors}
                      onChange={setFormValue}
                      value={formValue}
                    />
                    <div className={styles.addressActions}>
                      <button className={styles.primaryButton} disabled={isPending} type="submit">
                        {pendingAction === "save" ? "Saving…" : "Update address"}
                      </button>
                      <button className={styles.secondaryButton} disabled={isPending} onClick={closeEditor} type="button">
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div>
                      <h3>{address.fullName}</h3>
                      <address className={styles.addressDetails}>
                        {address.building && <>{address.building}<br /></>}
                        {address.street}<br />
                        {address.suburb}, {address.region} {address.postcode}<br />
                        {address.country === "NZ" ? "New Zealand" : "Australia"}<br />
                        {address.phone}<br />
                        {address.email}
                      </address>
                    </div>
                    <div className={styles.addressActions}>
                      <button
                        className={styles.secondaryButton}
                        disabled={isPending || editor !== null}
                        onClick={() => openEdit(address)}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className={styles.textButton}
                        disabled={isPending || editor !== null}
                        onClick={() => setDeleteConfirmationId(address.id)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                    {deleteConfirmationId === address.id && (
                      <div
                        aria-label={`Delete ${address.fullName}?`}
                        className={styles.deleteConfirmation}
                        role="group"
                      >
                        <p>Delete this saved address?</p>
                        <button
                          className={styles.textButton}
                          disabled={isPending}
                          onClick={() => deleteAddress(address.id)}
                          type="button"
                        >
                          {isDeleting ? "Deleting…" : "Confirm delete"}
                        </button>
                        <button
                          className={styles.secondaryButton}
                          disabled={isPending}
                          onClick={() => setDeleteConfirmationId(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
