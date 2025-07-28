import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Only fetch tokens where gg_token_status is true (active)
    const { data: userTokens, error: fetchError } = await supabase
      .from('user_tokens')
      .select('*')
      .eq('gg_token_status', true)

    if (fetchError) {
      console.error('Error fetching user tokens:', fetchError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch user tokens' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!userTokens || userTokens.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No active tokens to refresh' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const refreshResults = []

    for (const tokenRecord of userTokens) {
      try {
        // Attempt to refresh the Google token
        const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
            client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
            refresh_token: tokenRecord.gg_refresh_token,
            grant_type: 'refresh_token',
          }),
        })

        if (refreshResponse.ok) {
          const tokenData = await refreshResponse.json()
          
          // Update the access token in the database
          const { error: updateError } = await supabase
            .from('user_tokens')
            .update({
              gg_access_token: tokenData.access_token,
              // If Google provides a new refresh token, update it too
              ...(tokenData.refresh_token && { gg_refresh_token: tokenData.refresh_token }),
            })
            .eq('id', tokenRecord.id)

          if (updateError) {
            console.error(`Error updating token for user ${tokenRecord.user_id}:`, updateError)
            refreshResults.push({
              user_id: tokenRecord.user_id,
              status: 'update_failed',
              error: updateError.message
            })
          } else {
            refreshResults.push({
              user_id: tokenRecord.user_id,
              status: 'success'
            })
          }
        } else {
          // Token refresh failed - set gg_token_status to false
          console.error(`Token refresh failed for user ${tokenRecord.user_id}:`, refreshResponse.status)
          
          const { error: statusUpdateError } = await supabase
            .from('user_tokens')
            .update({
              gg_token_status: false
            })
            .eq('id', tokenRecord.id)

          if (statusUpdateError) {
            console.error(`Error updating token status for user ${tokenRecord.user_id}:`, statusUpdateError)
          }

          refreshResults.push({
            user_id: tokenRecord.user_id,
            status: 'refresh_failed',
            error: `HTTP ${refreshResponse.status}: ${await refreshResponse.text()}`
          })
        }
      } catch (error) {
        console.error(`Exception refreshing token for user ${tokenRecord.user_id}:`, error)
        
        // On exception, also set gg_token_status to false
        const { error: statusUpdateError } = await supabase
          .from('user_tokens')
          .update({
            gg_token_status: false
          })
          .eq('id', tokenRecord.id)

        if (statusUpdateError) {
          console.error(`Error updating token status for user ${tokenRecord.user_id}:`, statusUpdateError)
        }

        refreshResults.push({
          user_id: tokenRecord.user_id,
          status: 'exception',
          error: error.message
        })
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Token refresh job completed',
        results: refreshResults,
        processed: userTokens.length
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})