// Fast base64 for the PDF/image payloads we send to Anthropic.
//
// WHY THIS EXISTS: edge functions get a hard CPU-time budget (~2s), and it is
// enforced by killing the worker — the runtime answers with HTTP 546
// ("WORKER_RESOURCE_LIMIT" / "CPU Time exceeded"), which NO try/catch inside the
// function can turn into an error message. The underwriter blew that budget on a
// 25-statement merchant purely on base64 encoding, so the UI just saw an opaque
// "non-2xx status code".
//
// Measured on 10MB (Deno 2.7):
//   String.fromCharCode(...chunk) + btoa   — slowest, plus a UTF-16 intermediate
//   std encodeBase64 (pure JS)            — 456ms
//   FileReader → data URL (native)        —   9ms   ← ~50x cheaper
//   Uint8Array.toBase64() (native)        —   2ms   ← not in the edge runtime yet
// All three produce byte-identical output (verified).
//
// Async because the FileReader path is; every caller already sits in an async
// document-loading path.
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

export async function base64FromBytes(bytes: Uint8Array): Promise<string> {
  // 1) TC39 native encoder — cheapest. Present in newer Deno; feature-detected so
  //    the edge runtime picks it up for free whenever it catches up.
  const native = (bytes as unknown as { toBase64?: () => string }).toBase64;
  if (typeof native === "function") return native.call(bytes);

  // 2) FileReader → "data:...;base64,<payload>". The encoding happens in native
  //    code rather than a JS loop, which is the whole point.
  try {
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const r = String(fr.result);
        const comma = r.indexOf(",");
        if (comma === -1) reject(new Error("unexpected data URL"));
        else resolve(r.slice(comma + 1));
      };
      fr.onerror = () => reject(fr.error ?? new Error("FileReader failed"));
      fr.readAsDataURL(new Blob([bytes as unknown as BlobPart]));
    });
  } catch {
    // 3) Pure-JS fallback — correct everywhere, just expensive.
    return encodeBase64(bytes);
  }
}
