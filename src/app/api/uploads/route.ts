import { join } from "node:path";
import { NextResponse } from "next/server";
import {
  InvalidUploadError,
  LocalPrivateUploadStore,
} from "@/server/uploads/local-private-upload-store";

export const runtime = "nodejs";

function uploadDirectory(): string {
  return process.env.RNR_PRIVATE_UPLOAD_DIR ??
    join(process.cwd(), ".data", "private-uploads");
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });
    }

    const reference = await new LocalPrivateUploadStore(uploadDirectory()).save(file);
    return NextResponse.json({ reference }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidUploadError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "The image could not be stored. Please try again." },
      { status: 500 },
    );
  }
}
