import { escapeHtml, renderEmailLayout } from './shared';
import type { EmailTemplate } from './application';

export interface NominationEmailData {
  nominatorFirstName: string;
  nominatorLastName: string;
  nominatorEmail: string;
  country: string;
}

export function nominatorConfirmationEmail(data: NominationEmailData): EmailTemplate {
  const firstName = escapeHtml(data.nominatorFirstName);
  const country = escapeHtml(data.country);

  return {
    subject: 'Your park nomination has been received',
    html: renderEmailLayout({
      preheading: `We received your park nomination for ${data.country}`,
      bodyHtml: `
        <h1 style="font-size:20px;margin:0 0 16px;">Thank you, ${firstName}!</h1>
        <p>We've received your park nomination for <strong>${country}</strong>.</p>
        <p>Our team will review it and reach out with any questions or next steps.</p>
        <p style="margin-top:24px;">Ride with purpose,<br/>The Rally for Rangers Team</p>
      `,
    }),
  };
}

export function adminNominationNotificationEmail(data: NominationEmailData): EmailTemplate {
  const fullName = escapeHtml(`${data.nominatorFirstName} ${data.nominatorLastName}`);
  const email = escapeHtml(data.nominatorEmail);
  const country = escapeHtml(data.country);

  return {
    subject: `New park nomination: ${data.country}`,
    html: renderEmailLayout({
      preheading: `New park nomination from ${fullName}`,
      bodyHtml: `
        <h1 style="font-size:20px;margin:0 0 16px;">New Park Nomination</h1>
        <p><strong>Country:</strong> ${country}</p>
        <p><strong>Submitted by:</strong> ${fullName}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p style="margin-top:24px;">Review it in the admin dashboard.</p>
      `,
    }),
  };
}
