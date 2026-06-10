import { Injectable } from '@nestjs/common';
import { BrevoClient } from '@getbrevo/brevo';

@Injectable()
export class EmailServiceService {
  private brevoClient: BrevoClient;
  constructor() {
    this.brevoClient = new BrevoClient({
      apiKey: process.env.BREVO_API_KEY || '',
    });
  }

  getHtmlTemplate(
    type: 'message' | 'notification' | 'otp',
    content: string,
  ): string {
    const title =
      type === 'message'
        ? 'New Message'
        : type === 'otp'
          ? 'Verification Code'
          : 'System Notification';
    const headerColor =
      type === 'message' ? '#4f46e5' : type === 'otp' ? '#f59e0b' : '#10b981';

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f7fa; }
          .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .header { background-color: ${headerColor}; color: white; padding: 30px 20px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; letter-spacing: 1px; }
          .content { padding: 40px 30px; color: #4a5568; font-size: 16px; }
          .footer { background-color: #f8fafc; color: #94a3b8; padding: 20px; text-align: center; font-size: 12px; border-top: 1px solid #e2e8f0; }
          .button { display: inline-block; padding: 12px 24px; background-color: ${headerColor}; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${title}</h1>
          </div>
          <div class="content">
            <p>${content}</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Lan's Hub. All rights reserved.</p>
            <p>This is an automated message, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `.trim();
  }

  async sendEmail(
    to: string,
    subject: string,
    text: string,
    type: 'message' | 'notification' | 'otp',
  ) {
    const emailData = {
      sender: { email: process.env.BREVO_SENDER || '' },
      to: [{ email: to }],
      subject: subject,
      htmlContent: this.getHtmlTemplate(type, text),
      textContent: text,
    };

    try {
      const response =
        await this.brevoClient.transactionalEmails.sendTransacEmail(emailData);
      console.log('Email sent successfully:', response);
      return {
        success: true,
        message: 'Email sent successfully',
        data: response.messageId,
      };
    } catch (error) {
      console.error('Error sending email:', error);
      return { success: false, message: 'Failed to send email', data: null };
    }
  }
}
