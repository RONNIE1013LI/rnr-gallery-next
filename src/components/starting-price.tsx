import styles from "./storefront.module.css";

export function StartingPrice({ amount, includesGst }: Readonly<{
  amount: string;
  includesGst: boolean;
}>) {
  return (
    <p className={styles.productDetailPrice}>
      <span className={styles.productDetailPriceStart}>
        <span className={styles.productDetailPriceFrom}>From</span>{" "}
        <strong className={styles.productDetailPriceAmount}>{amount}</strong>
      </span>
      {includesGst && <>{" "}<span className={styles.productDetailPriceTax}>incl GST</span></>}
    </p>
  );
}
