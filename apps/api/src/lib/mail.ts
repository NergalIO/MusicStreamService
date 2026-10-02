import nodemailer from 'nodemailer';
import { config, smtpConfigured } from '../config.js';

export async function sendVerificationCode(to: string, code: string): Promise<void> {
  if (!smtpConfigured()) {
    if (config.nodeEnv === 'development') {
      console.info(`[email-verification] SMTP не настроен — код для ${to}: ${code}`);
      return;
    }
    throw new Error('SMTP_NOT_CONFIGURED');
  }

  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });

  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject: 'Код подтверждения — MusicStreamService',
    text: `Ваш код подтверждения: ${code}\n\nКод действует ${config.emailVerificationTtlMin} минут.`,
    html: `<p>Ваш код подтверждения:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>Код действует ${config.emailVerificationTtlMin} минут.</p>`,
  });
}

export async function sendTestMail(to: string): Promise<void> {
  if (!smtpConfigured()) throw new Error('SMTP_NOT_CONFIGURED');
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  await transport.verify();
  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject: 'Проверка SMTP — MusicStreamService',
    text: 'Письмо отправлено из панели администратора. SMTP работает.',
    html: '<p>Письмо отправлено из панели администратора. SMTP работает.</p>',
  });
}
