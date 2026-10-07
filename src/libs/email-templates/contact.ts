import { escapeHtml, renderEmailLayout } from './shared';
import type { EmailTemplate } from './application';

export interface ContactEmailData {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export function adminContactNotificationEmail(data: ContactEmailData): EmailTemplate {
  const name = escapeHtml(data.name);
  const email = escapeHtml(data.email);
  const subject = escapeHtml(data.subject);
  const message = escapeHtml(data.message).replace(/\n/g, '<br/>');

  return {
    subject: `New contact message: ${data.subject}`,
    html: renderEmailLayout({
      preheading: `New message from ${name}`,
      bodyHtml: `
        <h1 style="font-size:20px;margin:0 0 16px;">New Contact Message</h1>
        <p><strong>From:</strong> ${name} (${email})</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p style="margin-top:16px;padding:16px;background-color:#ebe3d6;border-radius:4px;">${message}</p>
      `,
    }),
  };
}
