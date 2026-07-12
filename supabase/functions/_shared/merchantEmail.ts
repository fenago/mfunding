// merchantEmail — ONE branded HTML shell for every merchant-facing email.
//
// All merchant emails (invite, login link, document-to-sign, notifications) render
// through renderMerchantEmail() so they arrive looking like the same company:
// a "Momentum Funding" wordmark header, a white card on a light background, a
// prominent rounded CTA button (brand mint-green on navy text — the site's
// .btn-primary), a copy-paste link fallback under it, and a muted signoff.
//
// Email-client-safe by construction: table-based layout, everything inline-styled,
// no <style> block, no remote assets (images are widely blocked in email, so the
// wordmark is live text), ~560px max width.
//
// Palette mirrors src/index.css:
//   navy   #0A2342   deep-sea #0C516E   ocean #007EA7   mint #00D49D
//
// Compliance: this is template CHROME only — it adds NO product claims and never
// uses "loan". Callers own their subject + body copy.

const BRAND = {
  navy: "#0A2342",
  deepSea: "#0C516E",
  ocean: "#007EA7",
  mint: "#00D49D",
  pageBg: "#F3F4F6",
  cardBg: "#FFFFFF",
  border: "#E5E7EB",
  text: "#0F172A",
  muted: "#5A6D7C",
  faint: "#94A3B8",
};

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export interface MerchantEmailOptions {
  /** Optional bold heading inside the card, above the body. */
  heading?: string;
  /** Optional greeting line, e.g. "Hi John,". Rendered as-is (escaped). */
  greeting?: string;
  /** Trusted, already-safe HTML for the body. Use for links/markup you control.
   * If both bodyHtml and paragraphs are given, bodyHtml wins. */
  bodyHtml?: string;
  /** Plain-text paragraphs — each is escaped and wrapped in its own <p>. */
  paragraphs?: string[];
  /** CTA button label. Requires ctaUrl to render. */
  ctaLabel?: string;
  /** CTA button destination. Requires ctaLabel to render. */
  ctaUrl?: string;
  /** Optional muted note shown under the CTA/body, above the signoff. */
  footerNote?: string;
  /** Override the signoff (defaults to "— The Momentum Funding team"). Pass an
   * empty string to suppress it entirely — used for staff-composed emails where
   * the sender writes their own closing. */
  signoff?: string;
}

/**
 * Render a complete branded merchant email as an HTML string, ready to hand to
 * sendEmailToContact(). Callers keep owning their own plain-text alternative.
 */
export function renderMerchantEmail(opts: MerchantEmailOptions): string {
  const {
    heading, greeting, bodyHtml, paragraphs, ctaLabel, ctaUrl, footerNote,
    signoff = "— The Momentum Funding team",
  } = opts;

  const parts: string[] = [];

  if (greeting) {
    parts.push(
      `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BRAND.text}">${escHtml(greeting)}</p>`,
    );
  }
  if (heading) {
    parts.push(
      `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:700;color:${BRAND.navy}">${escHtml(heading)}</h1>`,
    );
  }
  if (bodyHtml) {
    parts.push(bodyHtml);
  } else if (paragraphs?.length) {
    for (const p of paragraphs) {
      parts.push(
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BRAND.text}">${escHtml(p)}</p>`,
      );
    }
  }

  // Prominent CTA button (mint-green fill, navy text) + copy-paste fallback.
  if (ctaLabel && ctaUrl) {
    const safeUrl = escHtml(ctaUrl);
    parts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0"><tr><td` +
      ` style="border-radius:8px;background:${BRAND.mint}">` +
      `<a href="${safeUrl}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:700;` +
      `color:${BRAND.navy};text-decoration:none;border-radius:8px">${escHtml(ctaLabel)}</a>` +
      `</td></tr></table>`,
    );
    parts.push(
      `<p style="margin:0 0 16px;font-size:12px;line-height:1.5;color:${BRAND.muted}">` +
      `Button not working? Copy and paste this link into your browser:<br>` +
      `<a href="${safeUrl}" style="color:${BRAND.ocean};word-break:break-all">${safeUrl}</a></p>`,
    );
  }

  if (footerNote) {
    parts.push(
      `<p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:${BRAND.muted}">${escHtml(footerNote)}</p>`,
    );
  }

  const signoffHtml = signoff
    ? `\n<p style="margin:26px 0 0;font-size:14px;line-height:1.6;color:${BRAND.navy};font-weight:600">${escHtml(signoff)}</p>`
    : "";

  const inner = parts.join("\n");

  // Wordmark: live text (email clients routinely block remote images).
  const wordmark =
    `<span style="font-size:19px;font-weight:800;letter-spacing:0.2px;color:${BRAND.navy}">Momentum</span>` +
    `<span style="font-size:19px;font-weight:800;letter-spacing:0.2px;color:${BRAND.ocean}"> Funding</span>`;

  return `<!-- merchant email: Momentum Funding -->
<div style="margin:0;padding:0;background:${BRAND.pageBg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.pageBg};padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%">
<tr><td style="padding:8px 4px 18px">${wordmark}</td></tr>
<tr><td style="background:${BRAND.cardBg};border:1px solid ${BRAND.border};border-radius:12px;padding:32px 32px 28px">
<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,Helvetica,sans-serif">
${inner}${signoffHtml}
</div>
</td></tr>
<tr><td style="padding:16px 4px 4px;font-size:11px;line-height:1.5;color:${BRAND.faint}">
Momentum Funding · This message was sent about your funding request. You are receiving it because you contacted us or started an application.
</td></tr>
</table>
</td></tr>
</table>
</div>`;
}
