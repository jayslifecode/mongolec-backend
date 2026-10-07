import { createLogger } from '@/utils/logger';

const logger = createLogger('EMAIL');

const RESEND_API_URL = 'https://api.resend.com/emails';

export const DEFAULT_EMAIL_FROM = 'Rally for Rangers <noreply@rallyforrangers.org>';
export const DEFAULT_ADMIN_NOTIFY_EMAIL = 'info@rally4rangers.org';

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}

export interface SendEmailResult {
  sent: boolean;
  id?: string;
  reason?: string;
}

interface ResendSuccessResponse {
  id: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

/**
 * Sends an email via the Resend REST API. Never throws: any failure (missing
 * API key, network error, non-2xx response) resolves to { sent: false, reason }
 * so callers can fire-and-forget this without risking the calling mutation.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    logger.info('Email not sent: RESEND_API_KEY not set', { subject: input.subject });
    return { sent: false, reason: 'RESEND_API_KEY not set' };
  }

  const from = process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM;

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.replyTo && { reply_to: input.replyTo }),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.error('Resend API returned an error response', undefined, {
        status: response.status,
        body,
      });
      return { sent: false, reason: `Resend API error: ${response.status}` };
    }

    const data = (await response.json()) as ResendSuccessResponse;
    return { sent: true, id: data.id };
  } catch (error: unknown) {
    logger.error('Failed to send email via Resend', error instanceof Error ? error : undefined, {
      subject: input.subject,
    });
    return { sent: false, reason: getErrorMessage(error) };
  }
}

export function getAdminNotifyEmail(): string {
  return process.env.ADMIN_NOTIFY_EMAIL || DEFAULT_ADMIN_NOTIFY_EMAIL;
}
