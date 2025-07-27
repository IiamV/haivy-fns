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

    const response = await sendWithGmailServiceAccount({ to, subject, html, text, from, cc, bcc })

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

async function getServiceAccountAccessToken(): Promise<string> {
  const serviceAccountKey = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY')
  
  if (!serviceAccountKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_KEY environment variable')
  }

  let serviceAccount
  try {
    serviceAccount = JSON.parse(serviceAccountKey)
  } catch (error) {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_KEY format. Must be valid JSON.')
  }

  const now = Math.floor(Date.now() / 1000)
  const expiry = now + 3600 // 1 hour from now

  // Create JWT header
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  }

  // Create JWT payload
  const payload = {
    iss: serviceAccount.client_email,
    sub: Deno.env.get('GMAIL_USER_EMAIL'), // The Gmail user to impersonate
    scope: 'https://www.googleapis.com/auth/gmail.send',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: expiry
  }

  // Create JWT
  const jwt = await createJWT(header, payload, serviceAccount.private_key)

  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  const tokenData = await tokenResponse.json()

  if (!tokenResponse.ok) {
    throw new Error(`Failed to get service account token: ${tokenData.error_description || tokenData.error}`)
  }

  return tokenData.access_token
}

async function createJWT(header: any, payload: any, privateKey: string): Promise<string> {
  const encoder = new TextEncoder()
  
  // Encode header and payload
  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  
  const message = `${encodedHeader}.${encodedPayload}`
  const messageBytes = encoder.encode(message)
  
  // Import the private key
  const keyData = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  
  const keyBytes = Uint8Array.from(atob(keyData), c => c.charCodeAt(0))
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  )
  
  // Sign the message
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    messageBytes
  )
  
  const encodedSignature = base64UrlEncode(new Uint8Array(signature))
  
  return `${message}.${encodedSignature}`
}

function createMimeMessage(emailData: EmailRequest): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const defaultFrom = Deno.env.get('DEFAULT_FROM_EMAIL') || Deno.env.get('GMAIL_USER_EMAIL') || 'noreply@yourdomain.com'
  
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

function base64UrlEncode(input: string | Uint8Array): string {
  let str: string
  
  if (typeof input === 'string') {
    str = btoa(input)
  } else {
    str = btoa(String.fromCharCode(...input))
  }
  
  return str
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

async function sendWithGmailServiceAccount(emailData: EmailRequest): Promise<EmailResponse> {
  try {
    const accessToken = await getServiceAccountAccessToken()
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
      message: 'Email sent successfully via Gmail Service Account',
      messageId: result.id
    }

  } catch (error) {
    console.error('Gmail Service Account sending error:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to send email via Gmail Service Account'
    }
  }
}