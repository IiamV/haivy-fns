import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface EmailRequest {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  from?: string
  cc?: string | string[]
  bcc?: string | string[]
}

interface EmailResponse {
  success: boolean
  message: string
  messageId?: string
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Method not allowed' 
        }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const { to, subject, html, text, from, cc, bcc }: EmailRequest = await req.json()

    // Validate required fields
    if (!to || !subject) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Missing required fields: to, subject' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    if (!html && !text) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Either html or text content is required' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Get email provider from environment
    const emailProvider = Deno.env.get('EMAIL_PROVIDER') || 'resend'
    
    let response: EmailResponse

    switch (emailProvider) {
      case 'resend':
        response = await sendWithResend({ to, subject, html, text, from, cc, bcc })
        break
      case 'brevo':
        response = await sendWithBrevo({ to, subject, html, text, from, cc, bcc })
        break
      case 'gmail-smtp':
        response = await sendWithGmailSMTP({ to, subject, html, text, from, cc, bcc })
        break
      case 'outlook-smtp':
        response = await sendWithOutlookSMTP({ to, subject, html, text, from, cc, bcc })
        break
      default:
        return new Response(
          JSON.stringify({ 
            success: false, 
            message: 'Unsupported email provider' 
          }),
          { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
    }

    return new Response(
      JSON.stringify(response),
      { 
        status: response.success ? 200 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Email function error:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: 'Internal server error' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

// FREE OPTION 1: Resend (100 emails/month free)
async function sendWithResend(emailData: EmailRequest): Promise<EmailResponse> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const defaultFrom = Deno.env.get('DEFAULT_FROM_EMAIL') || 'noreply@yourdomain.com'
  
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY environment variable is required')
  }

  const payload = {
    from: emailData.from || defaultFrom,
    to: Array.isArray(emailData.to) ? emailData.to : [emailData.to],
    subject: emailData.subject,
    html: emailData.html,
    text: emailData.text,
    cc: emailData.cc ? (Array.isArray(emailData.cc) ? emailData.cc : [emailData.cc]) : undefined,
    bcc: emailData.bcc ? (Array.isArray(emailData.bcc) ? emailData.bcc : [emailData.bcc]) : undefined,
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const result = await response.json()

  if (!response.ok) {
    return {
      success: false,
      message: result.message || 'Failed to send email with Resend'
    }
  }

  return {
    success: true,
    message: 'Email sent successfully with Resend',
    messageId: result.id
  }
}

// FREE OPTION 2: Brevo (300 emails/day free)
async function sendWithBrevo(emailData: EmailRequest): Promise<EmailResponse> {
  const brevoApiKey = Deno.env.get('BREVO_API_KEY')
  const defaultFrom = Deno.env.get('DEFAULT_FROM_EMAIL') || 'noreply@yourdomain.com'
  
  if (!brevoApiKey) {
    throw new Error('BREVO_API_KEY environment variable is required')
  }

  const payload = {
    sender: { email: emailData.from || defaultFrom },
    to: Array.isArray(emailData.to) 
      ? emailData.to.map(email => ({ email }))
      : [{ email: emailData.to }],
    subject: emailData.subject,
    htmlContent: emailData.html,
    textContent: emailData.text,
    cc: emailData.cc ? (Array.isArray(emailData.cc) 
      ? emailData.cc.map(email => ({ email }))
      : [{ email: emailData.cc }]) : undefined,
    bcc: emailData.bcc ? (Array.isArray(emailData.bcc) 
      ? emailData.bcc.map(email => ({ email }))
      : [{ email: emailData.bcc }]) : undefined,
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': brevoApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const result = await response.json()

  if (!response.ok) {
    return {
      success: false,
      message: result.message || 'Failed to send email with Brevo'
    }
  }

  return {
    success: true,
    message: 'Email sent successfully with Brevo',
    messageId: result.messageId
  }
}

// FREE OPTION 3: Gmail SMTP (with App Password)
async function sendWithGmailSMTP(emailData: EmailRequest): Promise<EmailResponse> {
  const gmailUser = Deno.env.get('GMAIL_USER')
  const gmailAppPassword = Deno.env.get('GMAIL_APP_PASSWORD')
  
  if (!gmailUser || !gmailAppPassword) {
    throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD environment variables are required')
  }

  try {
    const mimeMessage = createMimeMessage(emailData)
    const encodedMessage = btoa(mimeMessage).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    
    // Use Gmail's REST API with Basic Auth (App Password)
    const response = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${gmailUser}:${gmailAppPassword}`)}`,
        'Content-Type': 'message/rfc822',
      },
      body: mimeMessage,
    })

    if (!response.ok) {
      // Fallback to SMTP-like approach using fetch
      return await sendViaSMTPRelay(emailData)
    }

    const result = await response.json()
    
    return {
      success: true,
      message: 'Email sent successfully with Gmail SMTP',
      messageId: result.id
    }

  } catch (error) {
    return {
      success: false,
      message: `Gmail SMTP error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}

// FREE OPTION 4: Outlook SMTP (with App Password)
async function sendWithOutlookSMTP(emailData: EmailRequest): Promise<EmailResponse> {
  const outlookUser = Deno.env.get('OUTLOOK_USER')
  const outlookPassword = Deno.env.get('OUTLOOK_PASSWORD')
  
  if (!outlookUser || !outlookPassword) {
    throw new Error('OUTLOOK_USER and OUTLOOK_PASSWORD environment variables are required')
  }

  try {
    return await sendViaSMTPRelay(emailData, 'outlook')
  } catch (error) {
    return {
      success: false,
      message: `Outlook SMTP error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}

// Helper function for SMTP-like sending
async function sendViaSMTPRelay(emailData: EmailRequest, provider: string = 'gmail'): Promise<EmailResponse> {
  // This is a simplified approach - in production, you'd use a proper SMTP library
  // For now, we'll return an error suggesting to use API-based providers
  return {
    success: false,
    message: 'SMTP functionality requires additional setup. Please use Resend or Brevo for easier integration.'
  }
}

function createMimeMessage(emailData: EmailRequest): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const defaultFrom = Deno.env.get('DEFAULT_FROM_EMAIL') || 'noreply@yourdomain.com'
  
  let mimeMessage = ''
  
  // Headers
  mimeMessage += `From: ${emailData.from || defaultFrom}\r\n`
  mimeMessage += `To: ${Array.isArray(emailData.to) ? emailData.to.join(', ') : emailData.to}\r\n`
  
  if (emailData.cc) {
    mimeMessage += `Cc: ${Array.isArray(emailData.cc) ? emailData.cc.join(', ') : emailData.cc}\r\n`
  }
  
  if (emailData.bcc) {
    mimeMessage += `Bcc: ${Array.isArray(emailData.bcc) ? emailData.bcc.join(', ') : emailData.bcc}\r\n`
  }
  
  mimeMessage += `Subject: ${emailData.subject}\r\n`
  mimeMessage += `MIME-Version: 1.0\r\n`
  
  // Content
  if (emailData.html && emailData.text) {
    mimeMessage += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`
    
    // Text part
    mimeMessage += `--${boundary}\r\n`
    mimeMessage += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`
    mimeMessage += `${emailData.text}\r\n\r\n`
    
    // HTML part
    mimeMessage += `--${boundary}\r\n`
    mimeMessage += `Content-Type: text/html; charset=UTF-8\r\n\r\n`
    mimeMessage += `${emailData.html}\r\n\r\n`
    
    mimeMessage += `--${boundary}--\r\n`
  } else if (emailData.html) {
    mimeMessage += `Content-Type: text/html; charset=UTF-8\r\n\r\n`
    mimeMessage += `${emailData.html}\r\n`
  } else {
    mimeMessage += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`
    mimeMessage += `${emailData.text}\r\n`
  }
  
  return mimeMessage
}