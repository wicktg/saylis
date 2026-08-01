import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB, matches Pinata's typical free-tier ceiling

/**
 * Server-side only: receives an image file from the Create Token modal and
 * pins it to IPFS via Pinata, using PINATA_JWT (no NEXT_PUBLIC_ prefix —
 * never exposed to the browser). Returns an `ipfs://<cid>` URI, which is
 * what gets stored in Supabase; the frontend resolves it to a gateway URL
 * only at render time (see resolveIpfsUrl in app/_lib/ipfs.ts).
 */
export async function POST(request: Request) {
  const pinataJwt = process.env.PINATA_JWT;
  if (!pinataJwt) {
    return NextResponse.json(
      { error: "Image upload is not configured (missing PINATA_JWT)." },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "File must be an image." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "Image is too large (max 10MB)." }, { status: 400 });
  }

  const pinataFormData = new FormData();
  pinataFormData.append("file", file, file.name);
  pinataFormData.append(
    "pinataMetadata",
    JSON.stringify({ name: file.name || "saylis-token-image" })
  );

  const pinataResponse = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${pinataJwt}` },
    body: pinataFormData,
  });

  if (!pinataResponse.ok) {
    const errorBody = await pinataResponse.text().catch(() => "");
    return NextResponse.json(
      { error: `Pinata upload failed: ${errorBody || pinataResponse.statusText}` },
      { status: 502 }
    );
  }

  const { IpfsHash } = (await pinataResponse.json()) as { IpfsHash: string };
  return NextResponse.json({ uri: `ipfs://${IpfsHash}` });
}
