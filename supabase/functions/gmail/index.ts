import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }

  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({
        success: false,
        message: 'Method not allowed'
      }), {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const { to, subject, html, text, from, cc, bcc } = await req.json();

    // Validate required fields
    if (!to || !subject) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Missing required fields: to, subject'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    if (!html && !text) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Either html or text content is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Send email using Gmail SMTP
    const response = await sendWithGmailSMTP({
      to,
      subject,
      html,
      text,
      from,
      cc,
      bcc
    });

    return new Response(JSON.stringify(response), {
      status: response.success ? 200 : 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Email function error:', error);
    return new Response(JSON.stringify({
      success: false,
      message: 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});

// Gmail SMTP (with App Password)
async function sendWithGmailSMTP(emailData) {
  const gmailUser = Deno.env.get('GMAIL_USER') || 'haivy.health@gmail.com';
  const gmailAppPassword = Deno.env.get('GMAIL_APP_PASSWORD') || 'yzst srqs mbml dmzj';

  if (!gmailUser || !gmailAppPassword) {
    throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD environment variables are required');
  }

  try {
    const mimeMessage = createMimeMessage(emailData);
    
    // Use Gmail's REST API with Basic Auth (App Password)
    const response = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${gmailUser}:${gmailAppPassword}`)}`,
        'Content-Type': 'message/rfc822'
      },
      body: mimeMessage
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        message: `Gmail API error: ${errorText}`
      };
    }

    const result = await response.json();
    return {
      success: true,
      message: 'Email sent successfully with Gmail',
      messageId: result.id
    };

  } catch (error) {
    return {
      success: false,
      message: `Gmail SMTP error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

function createMimeMessage(emailData) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const defaultFrom = Deno.env.get('DEFAULT_FROM_EMAIL') || 'noreply@yourdomain.com';
  
  let mimeMessage = '';
  
  // Headers
  mimeMessage += `From: ${emailData.from || defaultFrom}\r\n`;
  mimeMessage += `To: ${Array.isArray(emailData.to) ? emailData.to.join(', ') : emailData.to}\r\n`;
  
  if (emailData.cc) {
    mimeMessage += `Cc: ${Array.isArray(emailData.cc) ? emailData.cc.join(', ') : emailData.cc}\r\n`;
  }
  
  if (emailData.bcc) {
    mimeMessage += `Bcc: ${Array.isArray(emailData.bcc) ? emailData.bcc.join(', ') : emailData.bcc}\r\n`;
  }
  
  mimeMessage += `Subject: ${emailData.subject}\r\n`;
  mimeMessage += `MIME-Version: 1.0\r\n`;
  
  // Content
  if (emailData.html && emailData.text) {
    mimeMessage += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
    
    // Text part
    mimeMessage += `--${boundary}\r\n`;
    mimeMessage += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
    mimeMessage += `${emailData.text}\r\n\r\n`;
    
    // HTML part
    mimeMessage += `--${boundary}\r\n`;
    mimeMessage += `Content-Type: text/html; charset=UTF-8\r\n\r\n`;
    mimeMessage += `${emailData.html}\r\n\r\n`;
    
    mimeMessage += `--${boundary}--\r\n`;
  } else if (emailData.html) {
    mimeMessage += `Content-Type: text/html; charset=UTF-8\r\n\r\n`;
    mimeMessage += `${emailData.html}\r\n`;
  } else {
    mimeMessage += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
    mimeMessage += `${emailData.text}\r\n`;
  }
  
  return mimeMessage;
}