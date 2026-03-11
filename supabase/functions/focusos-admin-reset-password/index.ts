import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { admin_password, user_email, new_password } = await req.json()

    if (!admin_password || !user_email || !new_password) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create a client with anon key to read app_configuration
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const anonClient = createClient(supabaseUrl, supabaseAnonKey)

    // Verify admin password against app_configuration
    const { data: config, error: configError } = await anonClient
      .from('app_configuration')
      .select('settings_password')
      .limit(1)
      .single()

    if (configError || !config) {
      return new Response(
        JSON.stringify({ error: 'Could not verify admin credentials' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (admin_password !== config.settings_password) {
      return new Response(
        JSON.stringify({ error: 'Invalid admin password' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Use service role to find user by email and update password
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // Find the user by email via direct query (avoids listUsers() bug)
    const { data: userData, error: userError } = await adminClient
      .rpc('dreamlit_auth_admin_executor', {
        command: `-- noop`
      })

    // Query auth.users directly using service role
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/dreamlit_auth_admin_executor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ command: `SELECT id FROM auth.users WHERE email = '${user_email.replace(/'/g, "''")}' LIMIT 1` })
    })

    // Alternative: use the auth admin API with a filter
    const { data: listData, error: listError } = await adminClient.auth.admin.listUsers({
      filter: `email.eq.${user_email.toLowerCase()}`,
      page: 1,
      perPage: 1,
    })

    let targetUserId: string | null = null

    if (!listError && listData?.users?.length > 0) {
      targetUserId = listData.users[0].id
    }

    if (!targetUserId) {
      // Fallback: query focusos_users table
      const { data: focusUser, error: focusError } = await adminClient
        .from('focusos_users')
        .select('user_id')
        .ilike('email', user_email)
        .limit(1)
        .single()

      if (focusError || !focusUser) {
        return new Response(
          JSON.stringify({ error: `No user found with email: ${user_email}` }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      targetUserId = focusUser.user_id
    }

    if (!targetUserId) {
      return new Response(
        JSON.stringify({ error: `No user found with email: ${user_email}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Reset the password
    const { error: updateError } = await adminClient.auth.admin.updateUserById(
      targetUser.id,
      { password: new_password }
    )

    if (updateError) {
      return new Response(
        JSON.stringify({ error: `Failed to update password: ${updateError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true, message: `Password reset for ${user_email}` }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
