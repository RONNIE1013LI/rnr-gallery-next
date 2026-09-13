import { parseQuote, QUOTE_MAX_PHOTOS, QUOTE_PHOTO_MAX_BYTES } from "@/domain/enquiry/quote";
import { products } from "@/domain/catalogue/products";
import type { CustomerEmailProvider } from "@/server/notifications/customer-notification-service";
import { assertTrustedMultipartMutationRequest, parseBoundedMultipartFormData } from "@/server/http/multipart-mutation-request";
import { MutationRequestError } from "@/server/http/mutation-request";
import { hasImageSignature, InvalidUploadError, validatePrivateUpload } from "@/server/uploads/local-private-upload-store";

const maximumRequestBytes = QUOTE_MAX_PHOTOS * QUOTE_PHOTO_MAX_BYTES + 32 * 1024;
const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" };
const headers = { "Cache-Control": "no-store" };
const failureMessage = "Your enquiry could not be confirmed. Please retry the same enquiry, or contact us if you need help.";
function json(body: unknown, status: number) { return Response.json(body, { status, headers }); }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }

export function createQuoteHandler(dependencies: {
  provider: CustomerEmailProvider;
  trustedOrigin: string;
  allowRequest: (request: Request, requestId: string) => Promise<boolean>;
}) {
  return async function POST(request: Request) {
    try {
      assertTrustedMultipartMutationRequest(request, dependencies.trustedOrigin, maximumRequestBytes);
      const form = await parseBoundedMultipartFormData(request, maximumRequestBytes);
      const rawDetails = form.get("details");
      if (typeof rawDetails !== "string" || rawDetails.length > 12_000 || form.getAll("details").length !== 1 || [...form.keys()].some((key) => key !== "details" && key !== "photos")) {
        return json({ error: "Please check your enquiry and try again." }, 422);
      }
      let value: unknown;
      try { value = JSON.parse(rawDetails); } catch { return json({ error: "Please check your enquiry and try again." }, 422); }
      const parsed = parseQuote(value);
      if (!parsed.success) return json({ error: "Please check the highlighted fields.", fields: parsed.errors }, 422);
      if (!dependencies.provider.configured) return json({ error: failureMessage }, 503);
      if (!await dependencies.allowRequest(request, parsed.data.requestId)) {
        return json({ error: "Too many enquiries were submitted recently. Please wait before trying again, or contact us directly." }, 429);
      }
      const photos = form.getAll("photos");
      if (photos.length > QUOTE_MAX_PHOTOS) return json({ error: "Choose up to 3 photos.", fields: { photos: "Choose up to 3 photos." } }, 422);
      const attachments = [];
      for (const [index, file] of photos.entries()) {
        if (typeof file === "string" || file.size > QUOTE_PHOTO_MAX_BYTES) {
          return json({ error: "Each photo must be 1 MB or smaller.", fields: { photos: "Each photo must be 1 MB or smaller." } }, 422);
        }
        validatePrivateUpload(file);
        const bytes = Buffer.from(await file.arrayBuffer());
        if (!hasImageSignature(bytes, file.type)) throw new InvalidUploadError("A photo could not be verified. Please choose a valid image and retry.");
        attachments.push({ filename: `reference-${index + 1}.${extensions[file.type]}`, content: bytes.toString("base64") });
      }
      const quote = parsed.data;
      const text = [
        "Source: Website contact / quote form (/contact)",
        `Enquiry reference: ${quote.requestId}`,
        `Full name: ${quote.name}`,
        `Preferred contact: ${quote.contactMethod === "email" ? "Email" : "Phone"}`,
        `Contact details: ${quote.contactMethod === "email" ? quote.email : quote.phone}`,
        `Occasion: ${quote.occasion || "Not specified"}`,
        `Product: ${products.find((product) => product.key === quote.product)?.title ?? "Not sure yet"}`,
        `Preferred size: ${quote.size || "Not specified"}`,
        `Required date: ${quote.requiredDate || "Not specified"} (timing needs confirmation)`,
        `Photos attached: ${attachments.length}`,
        "Message / design idea:", quote.message,
        "This is an enquiry, not an order. No marketing subscription requested.",
      ].join("\n");
      await dependencies.provider.send({
        to: "customerservice@rnrgallery.com",
        subject: `Website quote — ${quote.requestId.slice(0, 8)}`,
        text,
        html: `<pre style="white-space:pre-wrap;font:16px/1.5 sans-serif">${escapeHtml(text)}</pre>`,
        idempotencyKey: `website-quote-v1/${quote.requestId}`,
        ...(attachments.length ? { attachments } : {}),
      });
      return json({ status: "accepted", reference: quote.requestId }, 202);
    } catch (error) {
      if (error instanceof MutationRequestError) return json({ error: error.status === 413 ? "Choose up to 3 photos, no larger than 1 MB each." : "Please submit the enquiry from this website." }, error.status);
      if (error instanceof InvalidUploadError) return json({ error: "A photo could not be verified. Use JPG, PNG, WebP, HEIC or HEIF, up to 1 MB each.", fields: { photos: "Choose valid image files and try again." } }, 422);
      return json({ error: failureMessage }, 503);
    }
  };
}
