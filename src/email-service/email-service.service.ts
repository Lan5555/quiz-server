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

  getHtmlTemplate(type: 'message' | 'notification' | 'otp', content: string) {
    const config: Record<
      'message' | 'notification' | 'otp',
      {
        title: string;
        headerColor: string;
        icon: string;
        buttonText: string;
      }
    > = {
      message: {
        title: 'New Message',
        headerColor: 'linear-gradient(135deg, #6366f1, #4f46e5)',
        icon: '💬',
        buttonText: 'View Message',
      },
      otp: {
        title: 'Verification Code',
        headerColor: 'linear-gradient(135deg, #f59e0b, #d97706)',
        icon: '🔐',
        buttonText: 'Verify Now',
      },
      notification: {
        title: 'System Notification',
        headerColor: 'linear-gradient(135deg, #10b981, #059669)',
        icon: 'ℹ️',
        buttonText: 'Visit Portal',
      },
    };

    const selectedConfig = config[type];
    const currentYear = new Date().getFullYear();

    // Use default values since options is not defined
    const buttonUrl: string | null =
      'https://test-app-sandy-one.vercel.app/pages/';
    const userName = 'Valued Customer';
    const physicalAddress = 'Online Platform';

    // HTML Version
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="light dark">
      <meta name="supported-color-schemes" content="light dark">
      <title>${selectedConfig.title}</title>
      <style>
        /* Reset styles for email clients */
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #1e293b;
          margin: 0;
          padding: 0;
          background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
          -webkit-font-smoothing: antialiased;
        }
        
        .email-wrapper {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        
        .container {
          background: #ffffff;
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 20px 40px -12px rgba(0, 0, 0, 0.1);
        }
        
        .header {
          background: ${selectedConfig.headerColor};
          color: white;
          padding: 48px 32px;
          text-align: center;
          position: relative;
          overflow: hidden;
        }
        
        .header::before {
          content: '';
          position: absolute;
          top: -50%;
          right: -20%;
          width: 200px;
          height: 200px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 50%;
          pointer-events: none;
        }
        
        .icon {
          font-size: 48px;
          margin-bottom: 16px;
          display: inline-block;
        }
        
        .header h1 {
          margin: 0;
          font-size: 32px;
          font-weight: 700;
          letter-spacing: -0.5px;
        }
        
        .content {
          padding: 48px 40px;
          background: #ffffff;
        }
        
        .greeting {
          font-size: 18px;
          font-weight: 600;
          color: #0f172a;
          margin-bottom: 16px;
        }
        
        .message-text {
          color: #334155;
          font-size: 16px;
          line-height: 1.7;
          margin-bottom: 32px;
        }
        
        .otp-container {
          background: #f8fafc;
          border: 2px dashed #e2e8f0;
          border-radius: 12px;
          padding: 24px;
          text-align: center;
          margin: 24px 0;
        }
        
        .otp-code {
          font-family: 'SF Mono', 'Courier New', monospace;
          font-size: 36px;
          font-weight: 700;
          letter-spacing: 8px;
          color: ${type === 'otp' ? '#d97706' : '#4f46e5'};
          background: white;
          display: inline-block;
          padding: 12px 24px;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }
        
        .button {
          display: inline-block;
          padding: 14px 32px;
          background: ${selectedConfig.headerColor};
          color: white;
          text-decoration: none;
          border-radius: 12px;
          font-weight: 600;
          font-size: 15px;
          margin-top: 24px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        
        .divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, #e2e8f0, transparent);
          margin: 32px 0 24px;
        }
        
        .footer {
          background: #fafcff;
          padding: 32px 40px;
          text-align: center;
          border-top: 1px solid #f1f5f9;
        }
        
        .footer-text {
          color: #94a3b8;
          font-size: 13px;
          line-height: 1.5;
          margin: 8px 0;
        }
        
        .footer a {
          color: #64748b;
          text-decoration: none;
          border-bottom: 1px dotted #cbd5e1;
        }
        
        @media only screen and (max-width: 600px) {
          .email-wrapper {
            padding: 12px;
          }
          
          .header {
            padding: 32px 24px;
          }
          
          .header h1 {
            font-size: 28px;
          }
          
          .content {
            padding: 32px 24px;
          }
          
          .footer {
            padding: 24px 24px;
          }
          
          .otp-code {
            font-size: 28px;
            letter-spacing: 4px;
            padding: 8px 16px;
          }
        }
        
        @media (prefers-color-scheme: dark) {
          body {
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          }
          
          .container, .content {
            background: #1e293b;
          }
          
          .greeting {
            color: #f1f5f9;
          }
          
          .message-text {
            color: #cbd5e1;
          }
          
          .otp-container {
            background: #0f172a;
            border-color: #334155;
          }
          
          .otp-code {
            background: #1e293b;
            color: #fbbf24;
          }
          
          .footer {
            background: #0f172a;
            border-top-color: #1e293b;
          }
        }
      </style>
    </head>
    <body>
      <div class="email-wrapper">
        <div class="container">
          <div class="header">
            <div class="icon">${selectedConfig.icon}</div>
            <h1>${selectedConfig.title}</h1>
          </div>
          
          <div class="content">
            <div class="greeting">Hello ${userName},</div>
            <div class="message-text">
              ${type === 'otp' ? 'Your verification code is ready. Please use the code below to complete your verification process:' : content}
            </div>
            
            ${
              type === 'otp'
                ? `
              <div class="otp-container">
                <div class="otp-code">${content}</div>
                <p style="margin-top: 16px; font-size: 14px; color: #64748b;">This code will expire in 10 minutes</p>
              </div>
            `
                : `
              <p class="message-text" style="margin-bottom: 16px;">${content}</p>
            `
            }
            
            ${
              buttonUrl
                ? `
              <div style="text-align: center;">
                <a href="${buttonUrl}" class="button">${selectedConfig.buttonText}</a>
              </div>
              <div class="divider"></div>
            `
                : ''
            }
            
            ${type !== 'otp' ? '<div class="divider"></div>' : ''}
          </div>
          
          <div class="footer">
            <p class="footer-text">
              <strong>Lan's Hub</strong><br>
              ${physicalAddress}
            </p>
            <p class="footer-text">
              © ${currentYear} Lan's Hub. All rights reserved.
            </p>
            <p class="footer-text">
              You received this email because you have an account with Lan's Hub.<br>
            </p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `.trim();

    const textContent = `
${selectedConfig.title.toUpperCase()}

Hello ${userName},

${type === 'otp' ? 'Your verification code is ready. Please use the code below to complete your verification process:' : content}

${type === 'otp' ? `Verification Code: ${content}\nThis code will expire in 10 minutes\n` : ''}

${buttonUrl ? `To continue, visit: ${buttonUrl}\n` : ''}

---
Lan's Hub
${physicalAddress}

© ${currentYear} Lan's Hub. All rights reserved.

You received this email because you have an account with Lan's Hub.
  `.trim();

    // Return both versions for multipart email
    return {
      html: htmlContent,
      text: textContent,
    };
  }
  async sendEmail(
    to: string,
    subject: string,
    text: string,
    type: 'message' | 'notification' | 'otp',
  ) {
    const templates = this.getHtmlTemplate(type, text);
    const emailData = {
      sender: { email: process.env.BREVO_SENDER || '' },
      to: [{ email: to }],
      subject: subject,
      htmlContent: templates.html,
      textContent: templates.text,
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
