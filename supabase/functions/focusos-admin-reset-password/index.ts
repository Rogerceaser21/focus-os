import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

serve(async (req) => {
  console.log('=== Admin Password Reset Function Started ===');

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userEmail, newPassword } = await req.json();
    console.log('Processing password reset for user:', userEmail);

    if (!userEmail || !newPassword) {
      throw new Error('User email and new password are required');
    }

    // Find user by email with pagination handling
    let targetUser = null;
    let page = 1;
    const perPage = 1000;

    while (!targetUser) {
      const { data: users, error: userError } = await supabase.auth.admin.listUsers({
        page,
        perPage
      });

      if (userError) {
        console.error('Error fetching users:', userError);
        throw new Error('Failed to fetch users');
      }

      targetUser = users.users.find(user => user.email === userEmail);

      if (users.users.length < perPage && !targetUser) {
        break;
      }

      page++;
    }

    if (!targetUser) {
      throw new Error(`User with email ${userEmail} not found`);
    }

    console.log('Found target user:', targetUser.id);

    const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(
      targetUser.id,
      { password: newPassword }
    );

    if (updateError) {
      console.error('Error updating password:', updateError);
      throw new Error(`Failed to update password: ${updateError.message}`);
    }

    console.log('Password updated successfully for user:', targetUser.id);

    return new Response(JSON.stringify({
      success: true,
      message: `Password updated successfully for ${userEmail}`,
      userId: targetUser.id
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('=== PASSWORD RESET ERROR ===');
    console.error('Error message:', error.message);

    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
