import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type ReviewInput = {
  id?: string;
  reviewer: string;
  recommended?: boolean;
  text: string;
};

type ReviewImport = {
  recommendationRate?: number;
  reviewCount?: number;
  sourceUrl?: string;
  reviews: ReviewInput[];
};

const defaultSourceUrl =
  "https://www.facebook.com/RandRgallery/reviews/?id=100063872118160&sk=reviews";
const defaultRecommendationRate = 100;
const defaultReviewCount = 284;

function option(name: string) {
  const position = process.argv.indexOf(name);
  return position >= 0 ? process.argv[position + 1] : undefined;
}

function reviewId(review: ReviewInput, index: number) {
  return (review.id ?? `${review.reviewer}-${index + 1}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function validateImport(input: ReviewImport) {
  if (!Array.isArray(input.reviews)) {
    throw new Error("The input JSON must contain a reviews array.");
  }

  const reviews = input.reviews
    .filter((review) => review.recommended !== false)
    .map((review, index) => {
      const reviewer = review.reviewer?.trim();
      const text = review.text?.trim();
      const id = reviewId(review, index);
      if (!reviewer || !text || !id) {
        throw new Error(`Review ${index + 1} needs a reviewer and text.`);
      }
      return { id, reviewer, recommended: true, text };
    });

  if (!reviews.length) {
    throw new Error("No recommended reviews were supplied.");
  }

  return {
    sourceUrl: input.sourceUrl?.trim() || defaultSourceUrl,
    recommendationRate: input.recommendationRate ?? defaultRecommendationRate,
    reviewCount: input.reviewCount ?? defaultReviewCount,
    reviews,
  };
}

async function main() {
  const inputPath = option("--input");
  const outputPath = option("--output");
  if (!inputPath || !outputPath) {
    throw new Error(
      "Usage: tsx scripts/import-facebook-reviews.ts --input approved-reviews.json --output src/content/facebook-reviews.json",
    );
  }

  const raw = await readFile(resolve(inputPath), "utf8");
  const parsed = JSON.parse(raw) as ReviewImport;
  const output = validateImport(parsed);
  const destination = resolve(outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${output.reviews.length} reviewed Facebook recommendations to ${destination}`);
}

void main();
