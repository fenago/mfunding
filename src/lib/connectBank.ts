// Connect-Bank link — mint a tokenized public /connect-bank/<token> URL for a
// deal and copy it to the clipboard. The merchant links their bank via Plaid to
// verify revenue in ~60 seconds (statements stop being a chase). Nothing is sent
// to the merchant here — it's a copy-and-text affordance, so callers use it
// without an armed two-step confirm (a copy is non-destructive).
//
// Shared by every surface that offers the action: the Send-docs menu, the sticky
// deal bar chip, and the empty-state of the deal's Bank panel — one code path so
// the mint/copy behaviour can't drift between them.
import supabase from "../supabase";
import { parseEdgeError } from "./edgeError";

/**
 * Mints a Connect-Bank link for the deal and RETURNS it — no clipboard.
 * The SMS compose panel inserts the URL straight into the message body, so it
 * needs the link, not a copy. Throws an Error whose message is the server's real
 * message (dug out by parseEdgeError) on failure.
 */
export async function mintConnectBankLink(dealId: string): Promise<string> {
  try {
    const { data, error } = await supabase.functions.invoke("plaid-mint-link", {
      body: { dealId },
    });
    if (error) throw error;
    const d = data as { ok?: boolean; url?: string; error?: string } | null;
    if (d?.error) throw new Error(d.error);
    if (!d?.url) throw new Error("No Connect-Bank link was returned.");
    return d.url;
  } catch (e) {
    const { message } = await parseEdgeError(e, "Could not create a Connect-Bank link.");
    throw new Error(message);
  }
}

/**
 * Mints a Connect-Bank link for the deal and writes it to the clipboard.
 * Returns the URL on success; throws on failure (same errors as mintConnectBankLink).
 */
export async function mintAndCopyConnectBankLink(dealId: string): Promise<string> {
  const url = await mintConnectBankLink(dealId);
  await navigator.clipboard.writeText(url);
  return url;
}
