/** Converts an `ipfs://<cid>` URI into an https gateway URL for <img> use. */
export function resolveIpfsUrl(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith("ipfs://")) {
    return `https://gateway.pinata.cloud/ipfs/${uri.slice("ipfs://".length)}`;
  }
  return uri;
}

/**
 * Uploads an image file to IPFS via our server-side Pinata route (the
 * Pinata JWT never reaches the browser — see app/api/upload-image) and
 * returns the resulting ipfs:// URI.
 */
export async function uploadImageToIpfs(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/upload-image", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Image upload failed.");
  }

  const { uri } = (await response.json()) as { uri: string };
  return uri;
}
