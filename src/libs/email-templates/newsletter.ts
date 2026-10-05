import { escapeHtml, renderEmailLayout } from './shared';
import type { EmailTemplate } from './application';

export interface NewsletterEmailData {
  firstName?: string | null;
}

export function newsletterWelcomeEmail(data: NewsletterEmailData): EmailTemplate {
  const greetingName = data.firstName ? escapeHtml(data.firstName) : 'there';

  return {
    subject: 'Welcome to Rally for Rangers',
    html: renderEmailLayout({
      preheading: "You're subscribed to Rally for Rangers updates",
      bodyHtml: `
        <h1 style="font-size:20px;margin:0 0 16px;">Welcome, ${greetingName}!</h1>
        <p>Thanks for subscribing to the Rally for Rangers newsletter.</p>
        <p>You'll be the first to hear about upcoming rallies, ranger stories, and ways to get involved.</p>
        <p style="margin-top:24px;">Ride with purpose,<br/>The Rally for Rangers Team</p>
      `,
    }),
  };
}
