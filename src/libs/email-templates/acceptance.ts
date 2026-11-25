import { escapeHtml, renderButton, renderEmailLayout } from './shared';
import type { EmailTemplate } from './application';

export interface AcceptanceInviteEmailData {
  firstName: string;
  rallyTitle: string;
  acceptanceUrl: string;
}

export interface AcceptanceReceivedEmailData {
  firstName: string;
  lastName: string;
  email: string;
  rallyTitle: string;
}

/** Sent when an application is approved: congratulations plus the private acceptance-letter link. */
export function acceptanceInviteEmail(data: AcceptanceInviteEmailData): EmailTemplate {
  const firstName = escapeHtml(data.firstName);
  const rallyTitle = escapeHtml(data.rallyTitle);

  return {
    subject: `You're selected for Rally for Rangers ${data.rallyTitle}`,
    html: renderEmailLayout({
      preheading: `Congratulations! Please complete your acceptance letter for ${data.rallyTitle}`,
      bodyHtml: `
        <h1 style="font-size:20px;margin:0 0 16px;">Congratulations, ${firstName}!</h1>
        <p>We are pleased to let you know you have been selected as a rider for <strong>${rallyTitle}</strong>.</p>
        <p>Please read and sign your Commitment Letter and Liability Agreement, and upload your photo and bio, within two weeks using your personal link below.</p>
        ${renderButton('Complete your acceptance letter', data.acceptanceUrl)}
        <p style="margin-top:24px;">Ride with purpose,<br/>The Rally for Rangers Team</p>
      `,
    }),
  };
}

/** Sent to the team when a rider submits their acceptance letter. */
export function adminAcceptanceReceivedEmail(data: AcceptanceReceivedEmailData): EmailTemplate {
  const fullName = escapeHtml(`${data.firstName} ${data.lastName}`);
  const rallyTitle = escapeHtml(data.rallyTitle);
  const email = escapeHtml(data.email);

  return {
    subject: `Acceptance letter received: ${data.firstName} ${data.lastName} (${data.rallyTitle})`,
    html: renderEmailLayout({
      preheading: `${fullName} submitted their acceptance letter for ${data.rallyTitle}`,
      bodyHtml: `
        <h1 style="font-size:20px;margin:0 0 16px;">Acceptance Letter Received</h1>
        <p><strong>Rally:</strong> ${rallyTitle}</p>
        <p><strong>Rider:</strong> ${fullName}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p style="margin-top:24px;">Review it on the application in the admin dashboard, then confirm the rider once the deposit is in.</p>
      `,
    }),
  };
}
