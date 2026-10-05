import { escapeHtml, renderEmailLayout } from './shared';

export interface ApplicationEmailData {
  firstName: string;
  lastName: string;
  email: string;
  rallyTitle: string;
}

export interface EmailTemplate {
  subject: string;
  html: string;
}

export function applicantConfirmationEmail(data: ApplicationEmailData): EmailTemplate {
  const rallyTitle = escapeHtml(data.rallyTitle);
  const firstName = escapeHtml(data.firstName);

  return {
    subject: `Your application for ${data.rallyTitle} has been received`,
    html: renderEmailLayout({
      preheading: `We received your application for ${data.rallyTitle}`,
      bodyHtml: `
        <h1 style="font-size:20px;margin:0 0 16px;">Thanks for applying, ${firstName}!</h1>
        <p>We've received your application for <strong>${rallyTitle}</strong>.</p>
        <p>Our team will review your submission and get back to you soon with next steps.</p>
        <p style="margin-top:24px;">Ride with purpose,<br/>The Rally for Rangers Team</p>
      `,
    }),
  };
}

export function adminApplicationNotificationEmail(data: ApplicationEmailData): EmailTemplate {
  const rallyTitle = escapeHtml(data.rallyTitle);
  const fullName = escapeHtml(`${data.firstName} ${data.lastName}`);
  const email = escapeHtml(data.email);

  return {
    subject: `New rally application: ${data.rallyTitle}`,
    html: renderEmailLayout({
      preheading: `New application from ${fullName} for ${data.rallyTitle}`,
      bodyHtml: `
        <h1 style="font-size:20px;margin:0 0 16px;">New Rally Application</h1>
        <p><strong>Rally:</strong> ${rallyTitle}</p>
        <p><strong>Applicant:</strong> ${fullName}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p style="margin-top:24px;">Review it in the admin dashboard.</p>
      `,
    }),
  };
}
