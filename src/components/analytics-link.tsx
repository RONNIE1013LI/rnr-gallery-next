"use client";

import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { emitAnalyticsEvent } from "@/domain/analytics/client";
import type { AnalyticsEvent } from "@/domain/analytics/events";

type AnalyticsLinkProps = LinkProps
  & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps>
  & Readonly<{
    children: ReactNode;
    events?: AnalyticsEvent | readonly AnalyticsEvent[];
  }>;

export function AnalyticsLink({ events = [], onClick, ...props }: AnalyticsLinkProps) {
  const analyticsEvents = Array.isArray(events) ? events : [events];
  const tracksMetaContact = analyticsEvents.some(
    (analyticsEvent) => analyticsEvent.event === "messenger_click",
  );

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    for (const analyticsEvent of analyticsEvents) {
      try {
        emitAnalyticsEvent(analyticsEvent);
      } catch {
        // Analytics must never delay or block navigation.
      }
    }
  }

  return (
    <Link
      {...props}
      data-rnr-meta-contact-tracked={tracksMetaContact ? "true" : undefined}
      onClick={handleClick}
    />
  );
}
