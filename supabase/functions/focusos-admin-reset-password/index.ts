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
      console.error('Config error:', configError)
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

    // Step 1: Check if user already exists by querying auth.users directly via REST API
    // We use the admin API's listUsers with a workaround
    // Actually, let's query focusos_users first, then fall back to creating
    const { data: existingUser, error: lookupError } = await adminClient
      .from('focusos_users')
      .select('user_id')
      .ilike('email', emailLower)
      .limit(1)
      .maybeSingle()

    if (existingUser?.user_id) {
      // User exists - update password directly by ID (bypasses broken email lookup)
      console.log(`Found user in focusos_users: ${existingUser.user_id}, updating password`)
      const { error: updateError } = await adminClient.auth.admin.updateUserById(
        existingUser.user_id,
        { password: new_password }
      )

      if (updateError) {
        console.error('Update error:', updateError)
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

    // User not in focusos_users - try to create them fresh
    console.log(`User not found in focusos_users, attempting to create: ${emailLower}`)
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email: emailLower,
      password: new_password,
      email_confirm: true,
    })

    if (createData?.user) {
      return new Response(
        JSON.stringify({ success: true, message: `User created and password set for ${emailLower}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Creation failed - maybe user exists in auth but not in focusos_users
    // Try to get their ID via the admin getUserByEmail equivalent using listUsers
    console.error('Create failed:', createError?.message)
    
    // Last resort: use the Supabase Management API or direct SQL
    // Since we can't query auth.users via the client, let's use a different approach
    // We'll use the REST API directly to find the user
    const listResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'apikey': supabaseServiceKey,
      }
    })

    if (listResponse.ok) {
      const listData = await listResponse.json()
      const users = listData.users || []
      const foundUser = users.find((u: any) => u.email?.toLowerCase() === emailLower)
      
      if (foundUser) {
        console.log(`Found user via admin API: ${foundUser.id}, updating password`)
        const { error: updateError } = await adminClient.auth.admin.updateUserById(
          foundUser.id,
          { password: new_password }
        )

        if (updateError) {
          console.error('Update error:', updateError)
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
    }

    return new Response(
      JSON.stringify({ error: `Could not find or create user: ${emailLower}. Error: ${createError?.message || 'Unknown'}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
