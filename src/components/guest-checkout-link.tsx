"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./storefront.module.css";

export function GuestCheckoutLink() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const navigating = useRef(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);

  function navigate() {
    if (navigating.current) return;
    navigating.current = true;
    setPending(true);
    setFailed(false);
    const fail = () => {
      navigating.current = false;
      setPending(false);
      setFailed(true);
    };
    timeout.current = setTimeout(fail, 15_000);
    try {
      router.push("/checkout");
    } catch {
      clearTimeout(timeout.current);
      fail();
    }
  }

  return <>
    <Link className={styles.primaryButton} href="/checkout"
      aria-disabled={pending || undefined} aria-busy={pending || undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        navigate();
      }}>
      <span aria-live="polite">{pending ? "Opening checkout…" : "Continue as Guest"}</span>
    </Link>
    {failed ? <div role="alert">
      <p>Checkout is taking longer than expected. Please try again.</p>
      <button type="button" className={styles.secondaryButton} onClick={navigate}>Try again</button>
    </div> : null}
  </>;
}
