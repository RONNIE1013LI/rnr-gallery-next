import Link from "next/link";
import { deliveryCopy } from "@/domain/content/delivery-copy";
import styles from "@/components/storefront.module.css";
import { buildPublicMetadata } from "@/server/seo/metadata";

export const metadata = buildPublicMetadata({
  title: "Custom Artwork Help",
  description: "Get help choosing photos, sending files, reviewing proofs and ordering personalised canvas and banners from R&R Gallery.",
  path: "/help",
  image: "/media/home/homepage-begin-photo-help.webp",
  imageAlt: "Help preparing photos for personalised artwork",
});

export default function HelpPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <p className={styles.eyebrow}>Help</p>
        <h1>Help with your custom order.</h1>
        <nav aria-label="Help topics" className={styles.legalToc}><a href="#photos">Photos and files</a> · <a href="#proofs">Proofs and revisions</a> · <a href="#timing">Timing and delivery</a> · <a href="#payment">Payment</a> · <a href="#existing-orders">Existing orders</a></nav>
        <h2 id="photos">Which photos should I send?</h2>
        <p>Send clear original photos rather than screenshots or compressed copies. If a photo is blurry, send the original for us to assess; enhancement may help, but a very low-resolution image can affect the final result. People from separate photographs can be combined in one composition. Tell us who to include in your design notes.</p>
        <h2>Do I need to upload photos while ordering?</h2>
        <p>No. Choose Upload Photos Now or Send Photos After Ordering. Photos sent later can be provided by Messenger, Email or WhatsApp. Include your order number so we can match them to your artwork.</p>
        <h2 id="files">Which file formats and sizes can I upload?</h2>
        <p>Photo uploads accept JPG, PNG, WebP, HEIC and HEIF, up to 25 MB per image. The product configuration shows the permitted photo count. Only send images you are authorised to use. If an upload fails, keep the original and try again, or choose to send photos after ordering.</p>
        <h2 id="main-photo">How do I choose the main photo?</h2>
        <p>Where the product offers a main-photo choice, use Set as main beside the uploaded photo. Review the Main photo label before adding to cart.</p>
        <h2 id="background-removal">How does background removal work?</h2>
        <p>For products offering background removal, the main photo is included. Additional removals are optional and show their fee before you select them. Review the photo choices and total before adding to cart.</p>
        <h2 id="proofs">Will I see the artwork before it is printed?</h2>
        <p>Yes. Personalised orders include a proof before printing and up to two revision rounds. Check names, dates, wording, size and every design detail before approval. Send requested changes together in one message. See <Link href="/terms#drafts-and-revisions">revision terms</Link> for additional changes or replacing source photos after work begins.</p>
        <h2 id="timing">How long does production take?</h2>
        <p>{deliveryCopy.production}</p>
        <p>Your need-by date and estimated delivery are guidance only. You decide whether the timing is acceptable. An estimated date does not require rush production or express shipping. Optional rush production shows its fee when you choose it; transport time is separate.</p>
        <h2>Where do you deliver, and can I pick up?</h2>
        <p>Delivery is available within New Zealand and to Australia. See <Link href="/shipping-delivery">shipping and delivery estimates</Link> for current services. Pickup is available by appointment in Fairview Heights, Auckland; wait for confirmation that your item is ready and arrange collection before visiting.</p>
        <h2 id="payment">Which payment methods can I use?</h2>
        <p>Pay securely by card. Available wallets and Afterpay are shown at checkout when supported for your order, country and device. The payment options shown there are the options available for that purchase.</p>
        <h2 id="refunds">Can I cancel or request a refund?</h2>
        <p>Read our <Link href="/returns-refunds">Cancellations and refunds</Link> policy for the rules before design begins, after the first proof, and for faulty or incorrect items. Contact us with your order details so we can review your request.</p>
        <h2 id="existing-orders">How do I get help with an existing order?</h2>
        <p>Contact us with your order number and the email used to order. Keep design changes together in the same conversation so the team can review the full request. You can also <Link href="/account">view your account</Link> for orders linked to it.</p>
        <div className={styles.legalActions}>
          <Link className={styles.primaryButton} href="/how-it-works">How It Works</Link>
          <Link className={styles.secondaryButton} href="/contact">Contact Us</Link>
        </div>
      </article>
    </main>
  );
}
