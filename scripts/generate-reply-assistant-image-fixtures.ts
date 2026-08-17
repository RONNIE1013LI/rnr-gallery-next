import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

type EvaluationCase = Readonly<{
  id: string;
  category: string;
  assetIds: readonly string[];
  expected: Readonly<{
    classifications: readonly string[];
    issueCodes: readonly string[];
    likelyMainOrdinal: number | null;
  }>;
  failureMode: string | null;
}>;

type ExistingManifest = Readonly<{
  assets: ReadonlyArray<Readonly<{
    assetId: string;
    relativePath: string;
    mimeType: string;
  }>>;
}>;

const fixturePath = resolve("src/server/customer-service/fixtures/image-evaluation-cases.jsonl");
const assetDirectory = resolve("src/server/customer-service/fixtures/image-evaluation-assets");
const manifestPath = resolve(assetDirectory, "manifest.json");

const palettes = [
  ["#8fc6d4", "#edf4e8", "#315d67", "#d25f4b", "#f1c75b"],
  ["#a8c8a1", "#f4efe3", "#3b6253", "#c95f72", "#e4aa55"],
  ["#c1b7d4", "#f2eee6", "#514969", "#4f88a3", "#db7554"],
  ["#e1b08d", "#edf1eb", "#6b4e54", "#3d7c78", "#e0c35a"],
] as const;

function seedFor(value: string) {
  return createHash("sha256").update(value).digest().readUInt32BE(0);
}

function paletteFor(seed: number) {
  return palettes[seed % palettes.length];
}

function photoScene({
  seed,
  classification,
  smallSubject,
  cropped,
  obstructed,
  screenshot,
  sideCandidate,
}: Readonly<{
  seed: number;
  classification: string;
  smallSubject: boolean;
  cropped: boolean;
  obstructed: boolean;
  screenshot: boolean;
  sideCandidate: boolean;
}>) {
  const [sky, paper, dark, accent, highlight] = paletteFor(seed);
  const designLike = classification === "design_reference"
    || classification === "screenshot_of_design"
    || classification === "price_or_ad_reference";
  const frameX = screenshot ? 78 : 0;
  const frameY = screenshot ? 30 : 0;
  const frameWidth = screenshot ? 484 : 640;
  const frameHeight = screenshot ? 420 : 480;
  const contentX = screenshot ? 102 : 0;
  const contentY = screenshot ? 76 : 0;
  const contentWidth = screenshot ? 436 : 640;
  const contentHeight = screenshot ? 342 : 480;
  const subjectScale = cropped ? 2.65 : smallSubject ? 0.28 : sideCandidate ? 0.62 : 1;
  const subjectX = cropped ? contentX + contentWidth - 48 : contentX + contentWidth * (0.48 + (seed % 7) / 100);
  const subjectY = contentY + contentHeight * 0.71;
  const plantWidth = 112 * subjectScale;
  const plantHeight = 190 * subjectScale;
  const posterX = cropped ? contentX + contentWidth - 55 : contentX + contentWidth * 0.5;
  const posterWidth = 230 * subjectScale;
  const posterHeight = 290 * subjectScale;
  const noiseSeed = seed % 97;

  const scene = designLike
    ? `
      <rect x="${contentX}" y="${contentY}" width="${contentWidth}" height="${contentHeight}" fill="${paper}"/>
      <rect x="${posterX - posterWidth / 2}" y="${subjectY - posterHeight}" width="${posterWidth}" height="${posterHeight}" rx="5" fill="${sky}" stroke="${dark}" stroke-width="5"/>
      <circle cx="${posterX - posterWidth * 0.18}" cy="${subjectY - posterHeight * 0.67}" r="${posterWidth * 0.18}" fill="${highlight}"/>
      <path d="M ${posterX - posterWidth * 0.4} ${subjectY - posterHeight * 0.35} Q ${posterX} ${subjectY - posterHeight * 0.62} ${posterX + posterWidth * 0.4} ${subjectY - posterHeight * 0.28}" fill="none" stroke="${accent}" stroke-width="${Math.max(6, 18 * subjectScale)}"/>
      <rect x="${posterX - posterWidth * 0.34}" y="${subjectY - posterHeight * 0.18}" width="${posterWidth * 0.68}" height="${posterHeight * 0.075}" rx="${posterHeight * 0.035}" fill="${dark}" opacity="0.75"/>
    `
    : `
      <rect x="${contentX}" y="${contentY}" width="${contentWidth}" height="${contentHeight * 0.62}" fill="url(#sky)"/>
      <rect x="${contentX}" y="${contentY + contentHeight * 0.62}" width="${contentWidth}" height="${contentHeight * 0.38}" fill="url(#ground)"/>
      <circle cx="${contentX + contentWidth * 0.18}" cy="${contentY + contentHeight * 0.2}" r="34" fill="${highlight}" opacity="0.85"/>
      <path d="M ${contentX} ${contentY + contentHeight * 0.62} L ${contentX + contentWidth * 0.27} ${contentY + contentHeight * 0.31} L ${contentX + contentWidth * 0.48} ${contentY + contentHeight * 0.62} Z" fill="${dark}" opacity="0.35"/>
      <path d="M ${contentX + contentWidth * 0.28} ${contentY + contentHeight * 0.62} L ${contentX + contentWidth * 0.61} ${contentY + contentHeight * 0.25} L ${contentX + contentWidth * 0.88} ${contentY + contentHeight * 0.62} Z" fill="${accent}" opacity="0.32"/>
      <ellipse cx="${subjectX}" cy="${subjectY + 11 * subjectScale}" rx="${plantWidth * 0.68}" ry="${plantWidth * 0.18}" fill="${dark}" opacity="0.22"/>
      <path d="M ${subjectX - plantWidth * 0.38} ${subjectY - plantHeight * 0.47} L ${subjectX + plantWidth * 0.38} ${subjectY - plantHeight * 0.47} L ${subjectX + plantWidth * 0.25} ${subjectY} L ${subjectX - plantWidth * 0.25} ${subjectY} Z" fill="${accent}" stroke="${dark}" stroke-width="${Math.max(2, 4 * subjectScale)}"/>
      <path d="M ${subjectX} ${subjectY - plantHeight * 0.48} C ${subjectX - plantWidth * 0.42} ${subjectY - plantHeight * 0.7}, ${subjectX - plantWidth * 0.24} ${subjectY - plantHeight}, ${subjectX} ${subjectY - plantHeight * 0.74} C ${subjectX + plantWidth * 0.22} ${subjectY - plantHeight}, ${subjectX + plantWidth * 0.46} ${subjectY - plantHeight * 0.72}, ${subjectX} ${subjectY - plantHeight * 0.48} Z" fill="${dark}"/>
      <ellipse cx="${subjectX - plantWidth * 0.28}" cy="${subjectY - plantHeight * 0.76}" rx="${plantWidth * 0.26}" ry="${plantHeight * 0.13}" transform="rotate(-28 ${subjectX - plantWidth * 0.28} ${subjectY - plantHeight * 0.76})" fill="${highlight}"/>
      <ellipse cx="${subjectX + plantWidth * 0.3}" cy="${subjectY - plantHeight * 0.7}" rx="${plantWidth * 0.27}" ry="${plantHeight * 0.13}" transform="rotate(31 ${subjectX + plantWidth * 0.3} ${subjectY - plantHeight * 0.7})" fill="${sky}"/>
    `;

  const obstruction = obstructed
    ? Array.from({ length: 6 }, (_, index) => (
      `<rect x="${contentX - 90 + index * 132}" y="${contentY - 80}" width="30" height="${contentHeight + 160}" transform="rotate(18 ${contentX + index * 132} ${contentY + contentHeight / 2})" fill="${dark}" opacity="0.78"/>`
    )).join("")
    : "";
  const frame = screenshot
    ? `
      <rect x="${frameX}" y="${frameY}" width="${frameWidth}" height="${frameHeight}" rx="28" fill="#20242b"/>
      <rect x="${contentX}" y="${contentY}" width="${contentWidth}" height="${contentHeight}" rx="5" fill="${paper}"/>
      <circle cx="${frameX + 38}" cy="${frameY + 23}" r="7" fill="${accent}"/>
      <circle cx="${frameX + 62}" cy="${frameY + 23}" r="7" fill="${highlight}"/>
      <circle cx="${frameX + 86}" cy="${frameY + 23}" r="7" fill="${sky}"/>
      <rect x="${frameX + 132}" y="${frameY + 15}" width="265" height="16" rx="8" fill="#6f7680"/>
    `
    : "";

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="${paper}"/></linearGradient>
        <linearGradient id="ground" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${paper}"/><stop offset="1" stop-color="${highlight}"/></linearGradient>
        <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="2" seed="${noiseSeed}"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .055 0"/></filter>
      </defs>
      <rect width="640" height="480" fill="${paper}"/>
      ${frame}
      ${scene}
      ${obstruction}
      <rect width="640" height="480" filter="url(#grain)" opacity="0.32"/>
    </svg>
  `);
}

async function renderScene(item: EvaluationCase, assetId: string, ordinal: number) {
  if (item.failureMode === "malformed_input") {
    return createHash("sha256").update(`malformed:${assetId}`).digest();
  }
  if (item.failureMode === "oversized_input") {
    return sharp({
      create: {
        width: 8_193,
        height: 96,
        channels: 3,
        background: paletteFor(seedFor(assetId))[0],
      },
    }).png().toBuffer();
  }

  const classification = item.expected.classifications[ordinal] ?? "unknown";
  const issues = new Set(item.expected.issueCodes);
  const screenshot = item.category === "screenshot_original"
    || classification === "screenshot_of_photo"
    || classification === "screenshot_of_design";
  const likelyMain = item.expected.likelyMainOrdinal;
  const sideCandidate = likelyMain !== null && ordinal !== likelyMain;
  let pipeline = sharp(photoScene({
    seed: seedFor(assetId),
    classification,
    smallSubject: issues.has("request_closer_subject") || sideCandidate,
    cropped: issues.has("request_uncropped"),
    obstructed: issues.has("request_less_obstructed"),
    screenshot,
    sideCandidate,
  }));
  if (item.category === "blur_low_resolution" || issues.has("request_original") || sideCandidate) {
    pipeline = pipeline.blur(item.category === "blur_low_resolution" ? 8 : 2.4);
  }
  if (item.failureMode === "unsupported_input") {
    return pipeline.gif().toBuffer();
  }
  return pipeline.png({ compressionLevel: 9, palette: false }).toBuffer();
}

async function main() {
  const cases = readFileSync(fixturePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvaluationCase);
  const existingManifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExistingManifest;
  const ownership = new Map<string, Readonly<{ item: EvaluationCase; ordinal: number }>>();
  for (const item of cases) {
    item.assetIds.forEach((assetId, ordinal) => ownership.set(assetId, { item, ordinal }));
  }
  if (ownership.size !== existingManifest.assets.length) {
    throw new Error("image_fixture_ownership_mismatch");
  }

  mkdirSync(assetDirectory, { recursive: true });
  const assets = [];
  for (const asset of existingManifest.assets) {
    const owner = ownership.get(asset.assetId);
    if (!owner) throw new Error("image_fixture_owner_missing");
    const bytes = await renderScene(owner.item, asset.assetId, owner.ordinal);
    const outputPath = resolve(assetDirectory, asset.relativePath);
    if (dirname(outputPath) !== assetDirectory) throw new Error("image_fixture_unsafe_path");
    writeFileSync(outputPath, bytes);
    assets.push({
      assetId: asset.assetId,
      relativePath: asset.relativePath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      provenanceCategory: "deterministic_realistic_synthetic",
      consentStatus: "not_applicable_generated",
      permittedUse: "internal_reply_assistant_image_evaluation",
      pixelContent: "label_free_synthetic_scene",
      mimeType: asset.mimeType,
    });
  }

  writeFileSync(manifestPath, `${JSON.stringify({
    schemaVersion: "1",
    generatedAt: "2026-08-17T00:00:00.000Z",
    generator: "deterministic label-free synthetic raster scenes generated by scripts/generate-reply-assistant-image-fixtures.ts",
    assets,
  }, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "image_fixture_generation_failed"}\n`);
  process.exitCode = 1;
});
