import { createTransport, type Transporter } from "nodemailer";
import { getEnv } from "./env";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  from?: string; // overrides MAIL_FROM (e.g. campaign sender identity)
};

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const env = getEnv();
  if (!env.SMTP_URL) return null;
  if (!transporter) {
    transporter = createTransport(env.SMTP_URL);
  }
  return transporter;
}

/**
 * Sends mail when SMTP is configured. Without SMTP (dev), the message is
 * emitted to the server log and the call resolves — it never silently drops.
 */
export async function sendMail(msg: MailMessage): Promise<void> {
  const env = getEnv();
  const t = getTransporter();
  if (!t) {
    console.info(
      `[mail:not-configured] to=${msg.to} subject="${msg.subject}"\n${msg.text}`,
    );
    return;
  }
  if (!env.MAIL_FROM) {
    throw new Error("MAIL_FROM must be configured when SMTP_URL is set");
  }
  await t.sendMail({
    from: msg.from ?? env.MAIL_FROM,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    replyTo: msg.replyTo,
  });
}
