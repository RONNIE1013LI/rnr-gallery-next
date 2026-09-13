"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { products } from "@/domain/catalogue/products";
import { parseQuote, QUOTE_MAX_PHOTOS, QUOTE_PHOTO_MAX_BYTES, QUOTE_PHOTO_TYPES, type QuoteErrors, type QuoteInput } from "@/domain/enquiry/quote";
import { emitAnalyticsEvent } from "@/domain/analytics/client";
import { createClientId } from "@/lib/client-id";
import css from "./contact-quote.module.css";

const empty: QuoteInput = { requestId: "", name: "", contactMethod: "email", email: "", phone: "", occasion: "", product: "", size: "", requiredDate: "", message: "", website: "" };
const uncertainMessage = "We could not confirm your enquiry was received. Your details and photos are kept here. Retry sends the same enquiry without creating another email.";

export function ContactQuote() {
  const [values, setValues] = useState(empty);
  const [photos, setPhotos] = useState<File[]>([]);
  const [errors, setErrors] = useState<QuoteErrors>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [feedback, setFeedback] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [acceptedReference, setAcceptedReference] = useState("");
  const [retryPending, setRetryPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const sending = useRef(false);
  const requestId = useRef("");
  const pending = useRef<{ body: FormData; startedAt: number } | null>(null);

  function change(field: keyof QuoteInput, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }
  function fieldError(field: keyof QuoteErrors) {
    return errors[field] ? <p id={`quote-${field}-error`} className={css.fieldError}>{errors[field]}</p> : null;
  }
  function textField(field: "name" | "email" | "phone" | "occasion" | "size" | "requiredDate", label: string, type = "text", required = false, maxLength = 100, autoComplete?: string) {
    return <div className={css.field}>
      <label htmlFor={`quote-${field}`}>{label}</label>
      <input id={`quote-${field}`} name={field} type={type} required={required} maxLength={maxLength} autoComplete={autoComplete} value={values[field]} onChange={(event) => change(field, event.target.value)} aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `quote-${field}-error` : undefined} />
      {fieldError(field)}
    </div>;
  }
  function choosePhotos(files: FileList | null) {
    if (!files) return;
    const next = [...photos, ...Array.from(files)];
    const error = next.length > QUOTE_MAX_PHOTOS ? "Choose up to 3 photos." : next.some((file) => file.size < 1 || file.size > QUOTE_PHOTO_MAX_BYTES) ? "Each photo must be 1 MB or smaller." : next.some((file) => !QUOTE_PHOTO_TYPES.includes(file.type as typeof QUOTE_PHOTO_TYPES[number])) ? "Choose JPG, PNG, WebP, HEIC or HEIF images." : undefined;
    setErrors((current) => ({ ...current, photos: error }));
    if (!error) setPhotos(next);
  }
  function finishFailure(message = uncertainMessage) {
    sending.current = false;
    setBusy(false);
    setRetryPending(true);
    setFeedback(message);
  }
  function send(event?: FormEvent) {
    event?.preventDefault();
    if (sending.current || submitted) return;
    if (!pending.current) {
      try { requestId.current ||= createClientId(); } catch { setFeedback("Please use our email or phone contact option in this browser."); return; }
      const checked = parseQuote({ ...values, email: values.contactMethod === "email" ? values.email : "", phone: values.contactMethod === "phone" ? values.phone : "", requestId: requestId.current });
      if (!checked.success || errors.photos) {
        const issues = { ...(!checked.success ? checked.errors : {}), ...(errors.photos ? { photos: errors.photos } : {}) };
        setErrors(issues);
        formRef.current?.querySelector<HTMLElement>(`#quote-${Object.keys(issues)[0]}`)?.focus();
        return;
      }
      const body = new FormData();
      body.set("details", JSON.stringify(checked.data));
      photos.forEach((photo) => body.append("photos", photo));
      pending.current = { body, startedAt: Date.now() };
    }
    // Provider deduplication is bounded to 24 hours. Never silently start a fresh
    // request after an uncertain older attempt.
    if (Date.now() - pending.current.startedAt >= 23 * 60 * 60 * 1000) {
      setFeedback("This enquiry is too old to retry safely here. Please contact us to check whether it was received.");
      setRetryPending(true);
      return;
    }
    sending.current = true;
    setBusy(true);
    setProgress(undefined);
    setFeedback("");
    setErrors({});
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/quote");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.timeout = 30_000;
    xhr.upload.onprogress = (upload) => { if (upload.lengthComputable) setProgress(Math.round(upload.loaded / upload.total * 100)); };
    xhr.onerror = () => finishFailure();
    xhr.ontimeout = () => finishFailure();
    xhr.onload = () => {
      let body: { status?: string; error?: string; fields?: QuoteErrors } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* Fail closed on an unreadable response. */ }
      if (xhr.status === 202 && body.status === "accepted") {
        sending.current = false;
        setBusy(false);
        setAcceptedReference(requestId.current.slice(0, 8));
        setSubmitted(true);
        pending.current = null;
        try { emitAnalyticsEvent({ event: "generate_lead", method: "website_quote_form" }); } catch { /* A saved enquiry stays successful if analytics is unavailable. */ }
      } else if (xhr.status === 422 || xhr.status === 413) {
        sending.current = false;
        pending.current = null;
        setBusy(false);
        setRetryPending(false);
        setErrors(body.fields ?? {});
        setFeedback("Please check the form and photos, then try again.");
      } else {
        finishFailure(xhr.status === 429 ? "Too many enquiries were submitted recently. Please wait before retrying, or contact us directly." : uncertainMessage);
      }
    };
    try { xhr.send(pending.current.body); } catch { finishFailure(); }
  }

  if (submitted) return <section className={css.success} role="status" aria-live="polite">
    <h2>Your enquiry has been sent.</h2>
    <p>Our customer support team will review your details{photos.length ? ` and ${photos.length} attached photo${photos.length > 1 ? "s" : ""}` : ""} and reply using your preferred contact method.</p>
    <p>Enquiry reference: <strong>{acceptedReference}</strong></p>
    <p>This is an enquiry, not an order or a confirmed delivery date.</p>
  </section>;

  const activeErrors = Object.entries(errors).filter(([, message]) => message);
  return <form ref={formRef} className={css.form} noValidate onSubmit={send} aria-label="Contact and quote enquiry">
    <h2>Tell us what you have in mind.</h2>
    <p>Ask a question or request a quote. Fields marked “required” help us reply. Replies are not instant; for an urgent date, please call us.</p>
    {activeErrors.length ? <div role="alert" className={css.errorSummary}><strong>Please check these details:</strong><ul>{activeErrors.map(([field, message]) => <li key={field}><a href={`#quote-${field}`} onClick={(event) => { event.preventDefault(); formRef.current?.querySelector<HTMLElement>(`#quote-${field}`)?.focus(); }}>{message}</a></li>)}</ul></div> : null}
    {feedback ? <p role="alert" className={css.errorSummary}>{feedback}</p> : null}
    <fieldset disabled={busy || retryPending} className={css.fields}>
      <legend className={css.visuallyHidden}>Enquiry details</legend>
      <div className={css.grid}>
        {textField("name", "Full name (required)", "text", true, 100, "name")}
        <div className={css.field}><label htmlFor="quote-contactMethod">Preferred contact method</label><select id="quote-contactMethod" value={values.contactMethod} onChange={(event) => change("contactMethod", event.target.value)}><option value="email">Email</option><option value="phone">Phone</option></select></div>
        {values.contactMethod === "email" ? textField("email", "Email (required)", "email", true, 254, "email") : textField("phone", "Phone, including country code (required)", "tel", true, 40, "tel")}
        {textField("occasion", "Occasion (optional)")}
        <div className={css.field}><label htmlFor="quote-product">Product type (optional)</label><select id="quote-product" value={values.product} onChange={(event) => change("product", event.target.value)}><option value="">Not sure yet</option>{products.filter((product) => product.active).map((product) => <option key={product.key} value={product.key}>{product.title}</option>)}</select>{fieldError("product")}</div>
        {textField("size", "Preferred size (optional)")}
        {textField("requiredDate", "Required date (optional)", "date", false, 10)}
      </div>
      <div className={css.field}><label htmlFor="quote-message">Message / design idea (required)</label><textarea id="quote-message" required maxLength={1500} rows={5} value={values.message} onChange={(event) => change("message", event.target.value)} aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? "quote-message-error" : undefined} />{fieldError("message")}</div>
      <div className={css.honeypot} aria-hidden="true"><label htmlFor="quote-website">Leave this empty</label><input id="quote-website" tabIndex={-1} autoComplete="off" value={values.website} onChange={(event) => change("website", event.target.value)} /></div>
      <div className={css.photos}>
        <label htmlFor="quote-photos">Optional photos</label>
        <p id="quote-photo-help">Up to 3 photos, 1 MB each. JPG, PNG, WebP, HEIC or HEIF. Photos are sent with your enquiry.</p>
        <input id="quote-photos" type="file" multiple accept={QUOTE_PHOTO_TYPES.join(",")} aria-invalid={Boolean(errors.photos)} aria-describedby={`quote-photo-help quote-photo-privacy${errors.photos ? " quote-photos-error" : ""}`} onChange={(event) => { choosePhotos(event.target.files); event.target.value = ""; }} />
        {fieldError("photos")}
        {photos.length || errors.photos ? <button className={css.clearPhotos} type="button" onClick={() => { setPhotos([]); setErrors((current) => ({ ...current, photos: undefined })); }}>Clear photos</button> : null}
        {photos.length ? <ul className={css.photoList}>{photos.map((photo, index) => <li key={`${index}:${photo.name}`}><span>{photo.name}<small>Ready to send · {Math.ceil(photo.size / 1024)} KB</small></span><button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => { setPhotos((current) => current.filter((_, position) => position !== index)); setErrors((current) => ({ ...current, photos: undefined })); }}>Remove</button></li>)}</ul> : null}
        <p id="quote-photo-privacy">Only share photos you have permission to use. Avoid identity documents or sensitive personal information. Your details and photos are sent privately to our customer support inbox to handle this enquiry.</p>
      </div>
    </fieldset>
    <p>We do not subscribe you to marketing. Read our <Link href="/privacy">privacy policy</Link>.</p>
    {busy ? <div className={css.progress} role="status"><label htmlFor="quote-progress">{progress === 100 ? "Upload complete. Confirming your enquiry…" : "Sending your enquiry and photos…"}</label><progress id="quote-progress" max={100} value={progress} /></div> : null}
    <button className={css.submit} type="submit" disabled={busy}>{busy ? "Sending…" : retryPending ? "Retry enquiry" : "Send enquiry"}</button>
  </form>;
}
