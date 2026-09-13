import Link from "next/link";
import type { DeliveryPreference } from "@/domain/configuration/types";
import type { Market } from "@/domain/markets/types";
import { deliveryCopy } from "@/domain/content/delivery-copy";
import { getCustomerTiming } from "@/domain/scheduling/customer-timing";
import styles from "./storefront.module.css";
import css from "./configuration-flow.module.css";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export function ConfigurationTiming({ orderDate, needByDate, market, deliveryPreference, productionDate, onChange }: {
  orderDate: string; needByDate: string; market: Market; deliveryPreference: DeliveryPreference; productionDate?: string; onChange: (date: string) => void;
}) {
  const timing = getCustomerTiming(orderDate, needByDate, market, deliveryPreference, productionDate);
  const pickup = market === "NZ" && deliveryPreference === "pickup";
  return <div className={css.timing}>
    <label className={styles.formField}>
      <span>When do you need the finished item?</span>
      <input type="date" value={needByDate} aria-invalid={false} aria-describedby="configuration-timing-note" onChange={(event) => onChange(event.target.value)} />
    </label>
    <p>{deliveryCopy.production}</p>
    <dl>
      <div><dt>Estimated production completion</dt><dd>{dateLabel(timing.productionDate)}</dd></div>
      <div><dt>{pickup ? "Estimated ready for pickup" : "Estimated delivery"}</dt><dd>{dateLabel(timing.estimatedArrivalStart)}{timing.estimatedArrivalEnd !== timing.estimatedArrivalStart ? ` – ${dateLabel(timing.estimatedArrivalEnd)}` : ""}</dd></div>
    </dl>
    <p id="configuration-timing-note">{pickup ? "Pickup is by appointment once we confirm your item is ready." : "Delivery dates are estimates, not guaranteed arrival dates. Shipping service and cost are confirmed at checkout."} Allow time to send your photos and approve your proof promptly.</p>
    {timing.error ? <p role="status" className={css.warning}>{timing.error}</p> : null}
    <p>Dates are advisory only. You decide whether the timing is acceptable. Choosing a date does not add rush production or express shipping. <Link href="/help#timing" target="_blank" rel="noopener noreferrer">Timing and delivery help (opens in new tab)</Link></p>
    {!pickup ? <details><summary>How delivery is estimated</summary>{market === "NZ" ? <p>{deliveryCopy.newZealand}</p> : <><p>{deliveryCopy.australiaDhl}</p><p>{deliveryCopy.australiaStandard}</p><p>{deliveryCopy.australiaRemote}</p><p>For planning, we allow 7–14 calendar days until your address and shipping service are confirmed. Contact us if you need a faster option.</p></>}</details> : null}
  </div>;
}
