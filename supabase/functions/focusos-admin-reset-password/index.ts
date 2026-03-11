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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // Verify admin password against app_configuration
    const { data: config, error: configError } = await adminClient
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

    const emailLower = user_email.trim().toLowerCase()

    // Try to create the user first
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email: emailLower,
      password: new_password,
      email_confirm: true, // auto-confirm so they can log in immediately
    })

    if (createData?.user) {
      // User was created successfully
      return new Response(
        JSON.stringify({ success: true, message: `User created and password set for ${emailLower}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // If user already exists, find them and update password
    if (createError && createError.message?.includes('already been registered')) {
      // Look up user_id from focusos_users table
      const { data: focusUser, error: focusError } = await adminClient
        .from('focusos_users')
        .select('user_id')
        .ilike('email', emailLower)
        .limit(1)
        .single()

      if (focusError || !focusUser) {
        return new Response(
          JSON.stringify({ error: `User exists in auth but not in focusos_users: ${emailLower}. Try signing up via the app first.` }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const { error: updateError } = await adminClient.auth.admin.updateUserById(
        focusUser.user_id,
        { password: new_password }
      )

      if (updateError) {
        return new Response(
          JSON.stringify({ error: `Failed to update password: ${updateError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: true, message: `Password updated for ${emailLower}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Some other creation error
    return new Response(
      JSON.stringify({ error: `Failed: ${createError?.message || 'Unknown error'}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
