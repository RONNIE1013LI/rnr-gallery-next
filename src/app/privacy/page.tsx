import type { Metadata } from "next";
import styles from "@/components/storefront.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main id="main-content" className={styles.legalPage}>
      <article>
        <h1>Privacy Policy</h1>
        <p><strong>Last updated: 28 August 2026</strong></p>
        <p>
          This privacy statement explains how R&amp;R Gallery handles personal
          information when you browse our website, contact us, submit photos or
          artwork, create an account, or place an order.
        </p>

        <nav className={styles.legalToc} aria-label="Privacy policy contents">
          <strong>On this page</strong>
          <ul>
            <li><a href="#information-we-collect">Information we collect</a></li>
            <li><a href="#how-we-use-information">How we use information</a></li>
            <li><a href="#information-sharing">Information sharing</a></li>
            <li><a href="#information-retention">Information retention</a></li>
            <li><a href="#your-privacy-rights">Your privacy rights</a></li>
            <li><a href="#breaches-and-complaints">Breaches and complaints</a></li>
          </ul>
        </nav>

        <h2>Who we are</h2>
        <p>
          R&amp;R Gallery Ltd, trading as R&amp;R Gallery, is the agency responsible
          for the personal information described in this statement. Our address is
          11 Para Close, Fairview Heights, Auckland 0632, New Zealand.
        </p>
        <p>
          Our Privacy Officer can be reached at{" "}
          <a href="mailto:customerservice@rnrgallery.com">customerservice@rnrgallery.com</a>
          {" "}or <a href="tel:+642102348948">+64 21 023 48948</a>.
        </p>

        <h2 id="information-we-collect">What information we collect</h2>
        <ul>
          <li>Your name, email address, phone number, billing and delivery details.</li>
          <li>Account, order, invoice, payment-status and transaction information.</li>
          <li>Photos, artwork, names, dates, wording, design instructions, messages, proof feedback and other material you provide for a personalised order.</li>
          <li>Records of customer-service conversations through our website, phone, email, Messenger or WhatsApp.</li>
          <li>Technical information such as your IP address, browser and device type, referring page, campaign or UTM information, session details and pages viewed.</li>
        </ul>
        <p>
          If an online payment service is available, the payment provider processes
          your payment credentials. R&amp;R Gallery generally receives the payment
          status and transaction reference, rather than your complete card number.
        </p>

        <h2>How we collect personal information</h2>
        <p>
          We collect information directly from you when you use this website,
          create an account, upload files, place an order, request a quote, approve
          a proof, or contact us by phone, email, Messenger or WhatsApp.
        </p>
        <p>
          We may also receive limited information indirectly, including information
          about people shown in files you submit, delivery updates from service
          providers, payment confirmation from a payment provider, and website
          referral or order-attribution information.
        </p>

        <h2 id="how-we-use-information">Why we use your information</h2>
        <p>We use personal information to:</p>
        <ul>
          <li>Prepare quotes, designs and proofs and fulfil personalised orders.</li>
          <li>Confirm specifications, requested dates, revisions, pickup or delivery.</li>
          <li>Process payments, refunds and order administration.</li>
          <li>Provide customer support and respond to enquiries or privacy requests.</li>
          <li>Protect the website, prevent misuse and diagnose technical problems.</li>
          <li>Understand how customers find and use the website and improve our products and service.</li>
          <li>Meet tax, accounting, legal and regulatory requirements.</li>
        </ul>
        <p>
          We do not sell personal information. We do not place customer photos or
          artwork in the Design Gallery, advertising or social media unless we have
          separate permission to do so.
        </p>

        <h2>AI-assisted Website customer service</h2>
        <p>
          AI-assisted customer service on our Website supports response preparation.
          The model operates under policy controls, with human review or escalation
          for high-risk enquiries, requests requiring current or real-time information,
          and system failures. For low-risk enquiries, the Website may display replies
          assembled from approved server-side templates. This does not allow AI to send
          Facebook messages.
        </p>
        <p>
          We may provide OpenAI, acting as a technical service provider, with the
          relevant and minimised message content and recent Website conversation context
          needed to process your enquiry. We use <code>store: false</code>, which means
          request-level API storage is disabled. This does not mean zero retention:
          OpenAI may process or retain limited data where permitted under its service
          terms or required for security, abuse prevention or legal obligations.
        </p>
        <p>
          Sharing of API inputs and outputs with OpenAI is currently disabled. We do not
          authorise Website customer conversations to be used for external model training
          unless this is separately enabled, appropriately disclosed and expressly
          authorised.
        </p>
        <p>
          Authorised R&amp;R Gallery staff may review Website conversations and AI-assisted
          responses. AI does not independently approve refunds, compensation, discounts,
          payments, order changes or other high-risk customer-service decisions.
        </p>

        <h2>Information you need to provide</h2>
        <p>
          You can browse the website without placing an order. Information marked
          as required during checkout is needed to process and fulfil an order. If
          you do not provide it, we may be unable to accept, prepare, deliver or
          support the order. Optional design notes and account information can be
          left blank, although this may limit the instructions available to our artists.
        </p>

        <h2>Information about other people</h2>
        <p>
          Personalised files often contain information about people other than the
          customer. Before submitting a photo, name or other personal information,
          you must have permission or another lawful basis to provide it to us and
          should make the person aware of this statement where appropriate. Files
          involving a child must be submitted by, or with the authority of, a parent
          or guardian.
        </p>
        <p>
          We use submitted files to assess, design, print and fulfil the requested
          order. We may crop, enhance or post-process a photo to improve print
          quality. Tell us in your design instructions if you want to retain the
          original photo look.
        </p>

        <h2>Cookies and order attribution</h2>
        <p>
          Essential cart, checkout and customer-session cookies and browser storage
          are separate from analytics storage. They remember cart contents, keep
          checkout working and maintain a customer session.
        </p>
        <p>
          Cookie Preferences records your choice. Analytics and advertising remain
          disabled until you make a choice; essential cart, checkout and customer-session
          storage remains separate and continues to support those functions.
        </p>
        <p>
          An analytics choice permits Google Analytics, provided by Google, to measure
          public website use. It can use persistent analytics cookies such as <code>_ga</code>
          {" "}that may remain across browser sessions until they expire or you delete
          them. Google Analytics may receive technical usage information including page
          and device information, referring pages and campaign identifiers.
        </p>
        <p>
          An advertising choice permits Google Ads purchase measurement and the Meta
          Pixel to measure public page, product, cart, checkout and purchase activity
          for advertising performance. Campaign and order-attribution information may
          include UTM parameters, <code>gclid</code>, <code>gbraid</code>, <code>wbraid</code>
          {" "}and <code>fbclid</code>. Google Ads purchase measurement receives a stable
          transaction reference, currency and order totals after a confirmed payment.
          Meta may use first-party identifiers such as <code>_fbp</code> and campaign
          information such as <code>fbclid</code>.
        </p>
        <p>
          Meta Conversions API is used only if advertising consent and the required
          configuration are present. Where it is configured, matching may use approved
          first-party identifiers and a hashed email or phone only when the required
          consent permits it. No CAPI request is made without the required configuration,
          consent and an approved matching identifier. Google Enhanced Conversions are
          not currently enabled.
        </p>
        <p>
          Browser measurement and any conditional server measurement does not send raw
          customer photos, artwork, design instructions, name, email, phone, address,
          payment proof, file names, media URLs, notes or memorial wording to Google or
          Meta. We do not currently use these tools for remarketing or personalised
          advertising campaigns.
        </p>
        <p>
          You can use your browser controls to block or delete analytics cookies.
          Blocking essential cookies may prevent the cart, checkout or customer
          session from working correctly; blocking analytics cookies affects our
          website measurement rather than those essential functions.
        </p>
        <p>
          The essential Website session cookie used for customer service lasts seven
          days. Related rate data used to prevent misuse is kept for no more than 24 hours.
        </p>

        <h2 id="information-sharing">Who we share information with</h2>
        <p>We disclose only the information reasonably needed for the relevant service. Recipients may include:</p>
        <ul>
          <li>R&amp;R Gallery staff and contracted artists or production providers working on your order.</li>
          <li>Website hosting, storage, security and technical-support providers.</li>
          <li>Payment providers, banks, accountants and professional advisers.</li>
          <li>Couriers or delivery providers when an order is shipped.</li>
          <li>Messenger, WhatsApp or email providers when you choose those channels.</li>
          <li>Government, regulatory, law-enforcement or dispute-resolution bodies where disclosure is required or authorised by law.</li>
        </ul>
        <p>
          We require service providers to handle personal information only for the
          service they provide and with appropriate confidentiality and security.
        </p>

        <h2>Overseas service providers</h2>
        <p>
          Some technology, communications, storage or payment providers may process
          information outside New Zealand. Where New Zealand law requires it, we
          take reasonable steps to confirm that an overseas recipient provides
          comparable privacy safeguards, is covered by an approved binding scheme,
          or we obtain your informed authorisation before disclosure.
        </p>

        <h2>Security</h2>
        <p>
          We use reasonable administrative and technical safeguards designed to
          protect personal information from loss, misuse, unauthorised access,
          alteration or disclosure. Access to order files is limited to people who
          need them to prepare, produce or support the order. No internet or storage
          system can be guaranteed completely secure.
        </p>

        <h2 id="information-retention">How long we keep information</h2>
        <p>
          Temporary website uploads that are not attached to an order are normally
          deleted after seven days. Files attached to an order may be kept while the
          order is active and afterwards only for as long as reasonably needed for
          production, customer support, reorders, dispute handling and record-keeping.
        </p>
        <p>
          Order, invoice and tax records are generally kept for at least seven tax
          years where required. Other information is deleted, anonymised or securely
          disposed of when it is no longer reasonably required. You may request
          earlier deletion, subject to any legal, accounting, fraud-prevention or
          dispute-related reason that requires us to retain it.
        </p>
        <p>
          Anonymous Website conversations are retained for up to 90 days unless a
          conversation is linked to a business record, protected by an active human
          review or approved hold, or required to be kept longer for an order, payment,
          legal, audit, security, fraud-prevention or dispute reason.
        </p>

        <h2 id="your-privacy-rights">Access, correction and deletion</h2>
        <p>
          You may ask whether we hold personal information about you and request
          access to or correction of that information. You may also request deletion
          where we do not need to retain it. Contact our Privacy Officer using the
          details above. We may need to verify your identity and may refuse or limit
          a request only where the Privacy Act 2020 permits us to do so.
        </p>

        <h2 id="breaches-and-complaints">Privacy breaches and complaints</h2>
        <p>
          If a privacy breach is likely to cause serious harm, we will notify the
          Office of the Privacy Commissioner and affected people as required by the
          Privacy Act 2020.
        </p>
        <p>
          If you have a privacy concern, please contact us first so we can investigate
          and respond. You may also make a complaint to the{" "}
          <a href="https://www.privacy.org.nz/your-rights/how-to-complain/" rel="noopener noreferrer">
            Office of the Privacy Commissioner
          </a>.
        </p>

        <h2>Changes to this statement</h2>
        <p>
          We may update this statement when our services, providers or legal
          obligations change. The current version and its update date will remain
          available on this page.
        </p>
      </article>
    </main>
  );
}
