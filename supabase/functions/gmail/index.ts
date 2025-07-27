import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({
        success: false,
        message: 'Method not allowed'
      }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { to, subject, html, cc, bcc } = await req.json();

    // Validate required fields
    if (!to || !subject) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Missing required fields: to, subject'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!html) {
      return new Response(JSON.stringify({
        success: false,
        message: 'HTML content is required'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Send email using Gmail API
    const response = await sendWithGmailAPI({
      to, subject, html, cc, bcc
    });

    return new Response(JSON.stringify(response), {
      status: response.success ? 200 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Email function error:', error);
    return new Response(JSON.stringify({
      success: false,
      message: 'Internal server error',
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function sendWithGmailAPI(emailData) {
  try {
    // Get fresh access token
    const accessToken = await getAccessToken();
    
    if (!accessToken) {
      return {
        success: false,
        message: 'Failed to get access token'
      };
    }

    // Create the email message
    const rawMessage = createEmailMessage(emailData);
    
    // Send via Gmail API
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        raw: rawMessage
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Gmail API error:', errorData);
      return {
        success: false,
        message: `Gmail API error: ${errorData.error?.message || 'Unknown error'}`,
        details: errorData
      };
    }

    const result = await response.json();
    return {
      success: true,
      message: 'Email sent successfully via Gmail API',
      messageId: result.id
    };

  } catch (error) {
    console.error('Gmail API function error:', error);
    return {
      success: false,
      message: `Gmail API error: ${error.message}`
    };
  }
}

async function getAccessToken() {
  const refreshToken = Deno.env.get('GMAIL_REFRESH_TOKEN');
  const clientId = Deno.env.get('GMAIL_CLIENT_ID');
  const clientSecret = Deno.env.get('GMAIL_CLIENT_SECRET');

  if (!refreshToken || !clientId || !clientSecret) {
    console.error('Missing OAuth2 credentials');
    throw new Error('Missing OAuth2 credentials: GMAIL_REFRESH_TOKEN, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET');
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OAuth2 refresh error:', errorData);
      throw new Error(`OAuth2 error: ${errorData.error_description || errorData.error}`);
    }

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('Failed to refresh access token:', error);
    return null;
  }
}

function createEmailMessage(emailData) {
  const fromEmail = 'haivy.health@gmail.com';
  
  // Create email headers
  const headers = [
    `From: ${fromEmail}`,
    `To: ${Array.isArray(emailData.to) ? emailData.to.join(', ') : emailData.to}`,
    `Subject: ${emailData.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8'
  ];

  if (emailData.cc) {
    headers.push(`Cc: ${Array.isArray(emailData.cc) ? emailData.cc.join(', ') : emailData.cc}`);
  }

  if (emailData.bcc) {
    headers.push(`Bcc: ${Array.isArray(emailData.bcc) ? emailData.bcc.join(', ') : emailData.bcc}`);
  }

  // Use HTML content only
  const body = emailData.html;
  
  // Combine headers and body
  const email = headers.join('\r\n') + '\r\n\r\n' + body;
  
  // Base64 encode (URL-safe)
  return btoa(email)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}