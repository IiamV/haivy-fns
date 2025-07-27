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

    const response = await sendWithGmail({ to, subject, html, text, from, cc, bcc })

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

async function getGoogleAccessToken(): Promise<string> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const refreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN')

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Google OAuth credentials. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN')
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  const tokenData = await tokenResponse.json()

  if (!tokenResponse.ok) {
    throw new Error(`Failed to refresh Google token: ${tokenData.error_description || tokenData.error}`)
  }

  return tokenData.access_token
}

function createMimeMessage(emailData: EmailRequest): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const defaultFrom = Deno.env.get('DEFAULT_FROM_EMAIL') || Deno.env.get('GMAIL_FROM_EMAIL') || 'noreply@yourdomain.com'
  
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
  
  // If we have both HTML and text, use multipart
  if (emailData.html && emailData.text) {
    mimeMessage += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`
    
    // Text part
    mimeMessage += `--${boundary}\r\n`
    mimeMessage += `Content-Type: text/plain; charset=UTF-8\r\n`
    mimeMessage += `Content-Transfer-Encoding: quoted-printable\r\n\r\n`
    mimeMessage += `${emailData.text}\r\n\r\n`
    
    // HTML part
    mimeMessage += `--${boundary}\r\n`
    mimeMessage += `Content-Type: text/html; charset=UTF-8\r\n`
    mimeMessage += `Content-Transfer-Encoding: quoted-printable\r\n\r\n`
    mimeMessage += `${emailData.html}\r\n\r\n`
    
    mimeMessage += `--${boundary}--\r\n`
  } else if (emailData.html) {
    // HTML only
    mimeMessage += `Content-Type: text/html; charset=UTF-8\r\n`
    mimeMessage += `Content-Transfer-Encoding: quoted-printable\r\n\r\n`
    mimeMessage += `${emailData.html}\r\n`
  } else {
    // Text only
    mimeMessage += `Content-Type: text/plain; charset=UTF-8\r\n`
    mimeMessage += `Content-Transfer-Encoding: quoted-printable\r\n\r\n`
    mimeMessage += `${emailData.text}\r\n`
  }
  
  return mimeMessage
}

function base64UrlEncode(str: string): string {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

async function sendWithGmail(emailData: EmailRequest): Promise<EmailResponse> {
  try {
    const accessToken = await getGoogleAccessToken()
    const mimeMessage = createMimeMessage(emailData)
    const encodedMessage = base64UrlEncode(mimeMessage)
    
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        raw: encodedMessage,
      }),
    })

    const result = await response.json()

    if (!response.ok) {
      console.error('Gmail API error:', result)
      return {
        success: false,
        message: result.error?.message || 'Failed to send email via Gmail'
      }
    }

    return {
      success: true,
      message: 'Email sent successfully via Gmail',
      messageId: result.id
    }

  } catch (error) {
    console.error('Gmail sending error:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to send email via Gmail'
    }
  }
}