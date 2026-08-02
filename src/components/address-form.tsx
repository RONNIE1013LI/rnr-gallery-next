"use client";

import { useId, type ReactNode } from "react";
import {
  AUSTRALIAN_REGIONS,
  type AddressInput,
  type SupportedCountry,
} from "@/domain/address/types";
import styles from "./storefront.module.css";

export type AddressFieldErrors = Partial<Record<keyof AddressInput, string[]>>;

type AddressFormProps = {
  value: AddressInput;
  onChange: (value: AddressInput) => void;
  errors?: AddressFieldErrors;
  disabled?: boolean;
};

type FieldName = keyof AddressInput;

type FieldShellProps = {
  children: ReactNode;
  errorId: string;
  errors?: string[];
  inputId: string;
  label: string;
};

function FieldShell({ children, errorId, errors, inputId, label }: FieldShellProps) {
  return (
    <div className={styles.formField}>
      <label htmlFor={inputId}><span>{label}</span></label>
      {children}
      {errors?.length ? (
        <span className={styles.fieldError} id={errorId}>{errors.join(" ")}</span>
      ) : null}
    </div>
  );
}

export function AddressForm({
  value,
  onChange,
  errors = {},
  disabled = false,
}: AddressFormProps) {
  const idPrefix = useId();

  function updateField(field: FieldName, fieldValue: string) {
    onChange({ ...value, [field]: fieldValue });
  }

  function fieldAttributes(field: FieldName) {
    const errorId = `${idPrefix}-${field}-error`;
    return {
      "aria-describedby": errors[field]?.length ? errorId : undefined,
      "aria-invalid": errors[field]?.length ? true : undefined,
      disabled,
      id: `${idPrefix}-${field}`,
      name: field,
    } as const;
  }

  return (
    <div className={styles.addressFormFields}>
      <div className={styles.addressPair}>
        <FieldShell
          errorId={`${idPrefix}-country-error`}
          errors={errors.country}
          inputId={`${idPrefix}-country`}
          label="Country"
        >
          <select
            {...fieldAttributes("country")}
            autoComplete="country"
            onChange={(event) =>
              onChange({
                ...value,
                country: event.target.value as SupportedCountry,
                region: "",
              })
            }
            value={value.country}
          >
            <option value="NZ">New Zealand</option>
            <option value="AU">Australia</option>
          </select>
        </FieldShell>

        <FieldShell
          errorId={`${idPrefix}-building-error`}
          errors={errors.building}
          inputId={`${idPrefix}-building`}
          label="Building / unit (optional)"
        >
          <input
            {...fieldAttributes("building")}
            autoComplete="address-line2"
            onChange={(event) => updateField("building", event.target.value)}
            value={value.building}
          />
        </FieldShell>
      </div>

      <FieldShell
        errorId={`${idPrefix}-fullName-error`}
        errors={errors.fullName}
        inputId={`${idPrefix}-fullName`}
        label="Full name"
      >
        <input
          {...fieldAttributes("fullName")}
          autoComplete="name"
          onChange={(event) => updateField("fullName", event.target.value)}
          required
          value={value.fullName}
        />
      </FieldShell>

      <FieldShell
        errorId={`${idPrefix}-street-error`}
        errors={errors.street}
        inputId={`${idPrefix}-street`}
        label="Street address"
      >
        <input
          {...fieldAttributes("street")}
          autoComplete="address-line1"
          onChange={(event) => updateField("street", event.target.value)}
          required
          value={value.street}
        />
      </FieldShell>

      <FieldShell
        errorId={`${idPrefix}-suburb-error`}
        errors={errors.suburb}
        inputId={`${idPrefix}-suburb`}
        label="Suburb"
      >
        <input
          {...fieldAttributes("suburb")}
          autoComplete="address-level2"
          onChange={(event) => updateField("suburb", event.target.value)}
          required
          value={value.suburb}
        />
      </FieldShell>

      <div className={styles.addressPair}>
        <FieldShell
          errorId={`${idPrefix}-region-error`}
          errors={errors.region}
          inputId={`${idPrefix}-region`}
          label={value.country === "AU" ? "State / territory" : "Region / city"}
        >
          {value.country === "AU" ? (
            <select
              {...fieldAttributes("region")}
              autoComplete="address-level1"
              onChange={(event) => updateField("region", event.target.value)}
              required
              value={value.region}
            >
              <option value="">Select a state or territory</option>
              {AUSTRALIAN_REGIONS.map((region) => (
                <option key={region} value={region}>{region}</option>
              ))}
            </select>
          ) : (
            <input
              {...fieldAttributes("region")}
              autoComplete="address-level1"
              onChange={(event) => updateField("region", event.target.value)}
              required
              value={value.region}
            />
          )}
        </FieldShell>

        <FieldShell
          errorId={`${idPrefix}-postcode-error`}
          errors={errors.postcode}
          inputId={`${idPrefix}-postcode`}
          label="Postcode"
        >
          <input
            {...fieldAttributes("postcode")}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={4}
            onChange={(event) => updateField("postcode", event.target.value)}
            pattern="[0-9]{4}"
            required
            value={value.postcode}
          />
        </FieldShell>
      </div>

      <div className={styles.addressPair}>
        <FieldShell
          errorId={`${idPrefix}-phone-error`}
          errors={errors.phone}
          inputId={`${idPrefix}-phone`}
          label="Phone"
        >
          <input
            {...fieldAttributes("phone")}
            autoComplete="tel"
            inputMode="tel"
            onChange={(event) => updateField("phone", event.target.value)}
            required
            type="tel"
            value={value.phone}
          />
        </FieldShell>

        <FieldShell
          errorId={`${idPrefix}-email-error`}
          errors={errors.email}
          inputId={`${idPrefix}-email`}
          label="Email address"
        >
          <input
            {...fieldAttributes("email")}
            autoComplete="email"
            onChange={(event) => updateField("email", event.target.value)}
            required
            type="email"
            value={value.email}
          />
        </FieldShell>
      </div>
    </div>
  );
}
