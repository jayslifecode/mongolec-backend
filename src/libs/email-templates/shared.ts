/**
 * Shared HTML escaping and layout helpers for Rally for Rangers email templates.
 * Brand: dark header (#1a110a) with "RALLY FOR RANGERS", orange accent (#e05e28).
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailLayoutOptions {
  preheading: string;
  bodyHtml: string;
}

export function renderEmailLayout({ preheading, bodyHtml }: EmailLayoutOptions): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0;padding:0;background-color:#f5f0e8;font-family:Arial,Helvetica,sans-serif;color:#1a110a;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheading)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f0e8;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:4px;overflow:hidden;">
            <tr>
              <td style="background-color:#1a110a;padding:28px 32px;">
                <span style="color:#f5f0e8;font-size:20px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">
                  RALLY <span style="color:#e05e28;">FOR</span> RANGERS
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;font-size:15px;line-height:1.6;color:#1a110a;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background-color:#ebe3d6;font-size:12px;color:#2a1f1a;">
                Rally for Rangers &middot; rallyforrangers.org
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderButton(label: string, href: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin-top:16px;padding:12px 24px;background-color:#e05e28;color:#ffffff;text-decoration:none;font-weight:bold;border-radius:4px;">${escapeHtml(label)}</a>`;
}
