"use client";

import { useState } from "react";
import { galleryBirthdayAges } from "@/domain/gallery/query";
import { galleryOccasions } from "@/domain/gallery/taxonomy";
import styles from "./storefront.module.css";

const occasionLabels = {
  "baby-kids": "Baby / Kids",
  birthday: "Birthday",
  "business-promotion": "Business / Promotion",
  "family-portrait": "Family Portrait",
  "general-celebration": "General Celebration",
  graduation: "Graduation",
  memorial: "Memorial",
  "personalised-artwork": "Personalised Artwork",
  religious: "Religious",
  wedding: "Wedding",
} as const;

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

export function DesignGalleryOccasionFilters({ selectedOccasions, selectedBirthdayAges }: Props) {
  const [birthdaySelected, setBirthdaySelected] = useState(selectedOccasions.includes("birthday"));

  return (
    <>
      <fieldset>
        <legend>Occasion</legend>
        {galleryOccasions.map((value) => (
          <FilterCheckbox
            key={value}
            name="occasion"
            value={value}
            label={occasionLabels[value]}
            checked={selectedOccasions.includes(value)}
            onChange={value === "birthday" ? setBirthdaySelected : undefined}
          />
        ))}
      </fieldset>
      {birthdaySelected && (
        <fieldset>
          <legend>Birthday age</legend>
          {galleryBirthdayAges.map((value) => (
            <FilterCheckbox
              key={value}
              name="birthday_age"
              value={value}
              label={value}
              checked={selectedBirthdayAges.includes(value)}
            />
          ))}
        </fieldset>
      )}
    </>
  );
}
