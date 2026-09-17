"use client";

import { useState } from "react";
import {
  publicBirthdayAgeLabel,
  publicGalleryBirthdayAges,
  publicGalleryOccasionLabels,
  publicGalleryOccasions,
} from "@/domain/gallery/public-taxonomy";
import styles from "./storefront.module.css";

type Props = Readonly<{
  selectedOccasions: readonly string[];
  selectedBirthdayAges: readonly string[];
}>;

function FilterCheckbox({
  name,
  value,
  label,
  checked,
  onChange,
}: Readonly<{
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onChange?: (checked: boolean) => void;
}>) {
  return (
    <label className={styles.galleryCheckbox}>
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked}
        onChange={onChange ? (event) => onChange(event.currentTarget.checked) : undefined}
      />
      <span>{label}</span>
    </label>
  );
}

export function DesignGalleryOccasionFilters({
  selectedOccasions,
  selectedBirthdayAges,
}: Props) {
  const [birthdaySelected, setBirthdaySelected] = useState(
    selectedOccasions.includes("birthday"),
  );

  return (
    <>
      <fieldset>
        <legend>Occasion</legend>
        {publicGalleryOccasions.map((value) => (
          <FilterCheckbox
            key={value}
            name="occasion"
            value={value}
            label={publicGalleryOccasionLabels[value]}
            checked={selectedOccasions.includes(value)}
            onChange={value === "birthday" ? setBirthdaySelected : undefined}
          />
        ))}
      </fieldset>
      {birthdaySelected && (
        <fieldset>
          <legend>Birthday age</legend>
          {publicGalleryBirthdayAges.map((value) => (
            <FilterCheckbox
              key={value}
              name="birthday_age"
              value={value}
              label={publicBirthdayAgeLabel(value)}
              checked={selectedBirthdayAges.includes(value)}
            />
          ))}
        </fieldset>
      )}
    </>
  );
}
