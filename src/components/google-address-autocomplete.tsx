"use client";

import Image from "next/image";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  mergeGooglePlaceAddress,
  type GoogleAddressComponent,
} from "@/domain/address/google-place-address";
import { ADDRESS_FIELD_LIMITS } from "@/domain/address/schema";
import type { AddressInput, SupportedCountry } from "@/domain/address/types";
import styles from "./storefront.module.css";

type Place = {
  addressComponents?: readonly GoogleAddressComponent[];
  fetchFields(options: { fields: readonly string[] }): Promise<void>;
};

type PlacePrediction = {
  text: { toString(): string };
  toPlace(): Place;
};

type AutocompleteSuggestion = {
  placePrediction?: PlacePrediction;
};

type PlacesLibrary = {
  AutocompleteSessionToken: new () => unknown;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(options: {
      includedPrimaryTypes: string[];
      includedRegionCodes: string[];
      input: string;
      language: string;
      region: string;
      sessionToken: unknown;
    }): Promise<{ suggestions: readonly AutocompleteSuggestion[] }>;
  };
};

type GoogleMapsRuntime = {
  maps: {
    importLibrary(name: "places"): Promise<PlacesLibrary>;
  };
};

declare global {
  interface Window {
    google?: GoogleMapsRuntime;
    __rnrGoogleMapsReady?: () => void;
  }
}

let placesLibraryPromise: Promise<PlacesLibrary> | null = null;
const GOOGLE_MAPS_CALLBACK = "__rnrGoogleMapsReady";

function importPlacesLibrary() {
  if (!window.google?.maps.importLibrary) {
    throw new Error("Google Maps JavaScript API did not initialise");
  }
  return window.google.maps.importLibrary("places");
}

function loadPlacesLibrary(apiKey: string): Promise<PlacesLibrary> {
  if (window.google?.maps.importLibrary) return importPlacesLibrary();
  if (placesLibraryPromise) return placesLibraryPromise;

  placesLibraryPromise = new Promise<PlacesLibrary>((resolve, reject) => {
    const ready = () => {
      try {
        void importPlacesLibrary().then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    };
    const fail = () => reject(new Error("Google Maps JavaScript API could not load"));
    let existing = document.querySelector<HTMLScriptElement>(
      "script[data-rnr-google-maps]",
    );

    window.__rnrGoogleMapsReady = ready;
    if (existing) {
      const existingUrl = new URL(existing.src);
      if (existingUrl.searchParams.get("callback") !== GOOGLE_MAPS_CALLBACK) {
        existing.remove();
        existing = null;
      } else {
        existing.addEventListener("error", fail, { once: true });
        return;
      }
    }

    const script = document.createElement("script");
    const query = new URLSearchParams({
      callback: GOOGLE_MAPS_CALLBACK,
      key: apiKey,
      libraries: "places",
      loading: "async",
      v: "weekly",
    });
    script.dataset.rnrGoogleMaps = "true";
    script.src = `https://maps.googleapis.com/maps/api/js?${query.toString()}`;
    script.async = true;
    script.addEventListener("error", fail, { once: true });
    document.head.append(script);
  }).then(
    (library) => {
      delete window.__rnrGoogleMapsReady;
      return library;
    },
    (error) => {
      document.querySelector<HTMLScriptElement>(
        "script[data-rnr-google-maps]",
      )?.remove();
      delete window.__rnrGoogleMapsReady;
      placesLibraryPromise = null;
      throw error;
    },
  );

  return placesLibraryPromise;
}

type GoogleAddressAutocompleteProps = {
  apiKey: string;
  country: SupportedCountry;
  disabled: boolean;
  errorId: string;
  errors?: string[];
  inputId: string;
  onChange(value: AddressInput): void;
  value: AddressInput;
};

type SuggestionResult = {
  failed: boolean;
  key: string;
  predictions: readonly PlacePrediction[];
};

export function GoogleAddressAutocomplete({
  apiKey,
  country,
  disabled,
  errorId,
  errors = [],
  inputId,
  onChange,
  value,
}: GoogleAddressAutocompleteProps) {
  const hintId = useId();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<PlacesLibrary | null>(null);
  const onChangeRef = useRef(onChange);
  const requestIdRef = useRef(0);
  const selectedStreetRef = useRef<string | null>(null);
  const sessionTokenRef = useRef<unknown | null>(null);
  const valueRef = useRef(value);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestionResult, setSuggestionResult] = useState<SuggestionResult>({
    failed: false,
    key: "",
    predictions: [],
  });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const suggestionKey = `${country}:${value.street.trim()}`;
  const suggestions = !disabled && isSuggesting && suggestionResult.key === suggestionKey
    ? suggestionResult.predictions
    : [];
  const requestFailed = isSuggesting
    && suggestionResult.key === suggestionKey
    && suggestionResult.failed;

  useEffect(() => {
    onChangeRef.current = onChange;
    valueRef.current = value;
  }, [onChange, value]);

  useEffect(() => {
    requestIdRef.current += 1;
    sessionTokenRef.current = null;
  }, [country]);

  useEffect(() => {
    let disposed = false;
    void loadPlacesLibrary(apiKey).then(
      (library) => {
        if (disposed) return;
        libraryRef.current = library;
        setStatus("ready");
      },
      () => {
        if (!disposed) setStatus("error");
      },
    );
    return () => {
      disposed = true;
      libraryRef.current = null;
      requestIdRef.current += 1;
    };
  }, [apiKey]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const input = value.street.trim();
    if (selectedStreetRef.current === value.street) {
      selectedStreetRef.current = null;
      return;
    }
    if (!isSuggesting || disabled || status !== "ready" || input.length < 3 || !libraryRef.current) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const library = libraryRef.current;
      if (!library) return;
      sessionTokenRef.current ??= new library.AutocompleteSessionToken();
      void library.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        includedPrimaryTypes: ["street_address"],
        includedRegionCodes: [country.toLowerCase()],
        input,
        language: country === "NZ" ? "en-NZ" : "en-AU",
        region: country.toLowerCase(),
        sessionToken: sessionTokenRef.current,
      }).then(
        ({ suggestions: nextSuggestions }) => {
          if (requestId !== requestIdRef.current) return;
          setActiveIndex(-1);
          setSuggestionResult({
            failed: false,
            key: suggestionKey,
            predictions: nextSuggestions.flatMap((suggestion) =>
              suggestion.placePrediction ? [suggestion.placePrediction] : []
            ),
          });
        },
        () => {
          if (requestId !== requestIdRef.current) return;
          setActiveIndex(-1);
          setSuggestionResult({ failed: true, key: suggestionKey, predictions: [] });
        },
      );
    }, 160);

    return () => window.clearTimeout(timeout);
  }, [country, disabled, isSuggesting, status, suggestionKey, value.street]);

  async function selectPrediction(prediction: PlacePrediction) {
    requestIdRef.current += 1;
    setActiveIndex(-1);
    setIsSuggesting(false);
    setSuggestionResult({ failed: false, key: "", predictions: [] });
    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ["addressComponents"] });
      if (!place.addressComponents) return;
      const merged = mergeGooglePlaceAddress(valueRef.current, place.addressComponents);
      if (!merged) return;
      selectedStreetRef.current = merged.street;
      valueRef.current = merged;
      onChangeRef.current(merged);
    } catch {
      setSuggestionResult({ failed: true, key: suggestionKey, predictions: [] });
    } finally {
      sessionTokenRef.current = null;
      inputRef.current?.focus({ preventScroll: true });
    }
  }

  function handleStreetChange(street: string) {
    const nextValue = { ...valueRef.current, street };
    valueRef.current = nextValue;
    setActiveIndex(-1);
    setIsSuggesting(true);
    setSuggestionResult({ failed: false, key: "", predictions: [] });
    onChangeRef.current(nextValue);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => index <= 0 ? suggestions.length - 1 : index - 1);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      void selectPrediction(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      requestIdRef.current += 1;
      setActiveIndex(-1);
      setIsSuggesting(false);
      setSuggestionResult({ failed: false, key: "", predictions: [] });
    }
  }

  function handleBlur() {
    window.setTimeout(() => {
      if (containerRef.current?.contains(document.activeElement)) return;
      requestIdRef.current += 1;
      setActiveIndex(-1);
      setIsSuggesting(false);
      setSuggestionResult({ failed: false, key: "", predictions: [] });
    });
  }

  return (
    <div
      className={`${styles.formField} ${styles.addressAutocomplete}`}
      ref={containerRef}
    >
      <label htmlFor={inputId}><span>Street address</span></label>
      <input
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-autocomplete="list"
        aria-controls={suggestions.length ? listId : undefined}
        aria-describedby={errors.length ? errorId : hintId}
        aria-expanded={Boolean(suggestions.length)}
        aria-invalid={errors.length ? true : undefined}
        autoComplete="address-line1"
        disabled={disabled}
        id={inputId}
        maxLength={ADDRESS_FIELD_LIMITS.street}
        name="street"
        onBlur={handleBlur}
        onChange={(event) => handleStreetChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Start typing your street address"
        ref={inputRef}
        required
        role="combobox"
        value={value.street}
      />
      {suggestions.length ? (
        <div className={styles.addressAutocompleteMenu}>
          <div
            aria-label="Address suggestions"
            className={styles.addressAutocompleteList}
            id={listId}
            role="listbox"
          >
            {suggestions.map((prediction, index) => (
              <button
                aria-selected={activeIndex === index}
                className={styles.addressAutocompleteOption}
                id={`${listId}-${index}`}
                key={`${prediction.text.toString()}-${index}`}
                onClick={() => void selectPrediction(prediction)}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                tabIndex={-1}
                type="button"
              >
                {prediction.text.toString()}
              </button>
            ))}
          </div>
          <div className={styles.addressAutocompleteAttribution}>
            <Image
              alt="Powered by Google"
              height={18}
              src="/media/google/powered-by-google-on-white.png"
              width={59}
            />
          </div>
        </div>
      ) : null}
      <span className={styles.addressAutocompleteHint} id={hintId}>
        {status === "loading" && "Address suggestions are loading. You can keep typing manually."}
        {status === "ready" && !requestFailed && "Choose a suggestion to fill Suburb, Region / city and Postcode, or enter the address manually."}
        {(status === "error" || requestFailed) && "Address suggestions are unavailable. Continue entering the address manually."}
      </span>
      {errors.length ? (
        <span className={styles.fieldError} id={errorId}>{errors.join(" ")}</span>
      ) : null}
    </div>
  );
}
