import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.3';
import { clientKey, registerAttempt, recordSuccess } from '../_shared/passwordThrottle.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const { userEmail, newPassword, adminPassword, verifyOnly } = await req.json();

    if (!adminPassword || typeof adminPassword !== 'string') {
      return json(400, { success: false, error: 'Admin password is required' });
    }
    const { data: cfg, error: cfgError } = await supabase
      .from('app_configuration').select('settings_password').limit(1).single();
    if (cfgError || !cfg) return json(500, { success: false, error: 'Server configuration error' });
    // Count this attempt BEFORE comparing, so every attempt counts against the
    // cap, not just failures. Fails closed: an RPC error or an already-tripped
    // lock both turn into 429, and the compare below never runs.
    const key = clientKey(req);
    if (!(await registerAttempt(supabase, key))) {
      return json(429, { success: false, error: 'Too many attempts. Try again in 15 minutes.' });
    }
    if (!safeEqual(adminPassword, cfg.settings_password ?? '')) {
      // Slow down guessing on a mismatch.
      await new Promise(r => setTimeout(r, 500));
      return json(403, { success: false, error: 'Invalid admin password' });
    }
    await recordSuccess(supabase, key);
    if (verifyOnly) return json(200, { success: true, verified: true });

    if (!userEmail || !newPassword) {
      return json(400, { success: false, error: 'User email and new password are required' });
    }

    const { error: patchError } = await supabase.rpc('dreamlit_auth_admin_executor', {
      command: "UPDATE auth.users SET email_change = '' WHERE email_change IS NULL"
    });
    if (patchError) console.warn('Self-healing patch warning (non-fatal):', patchError.message);

    let targetUser = null; let page = 1; const perPage = 1000;
    while (!targetUser) {
      const { data: users, error: userError } = await supabase.auth.admin.listUsers({ page, perPage });
      if (userError) throw new Error('Failed to fetch users');
      targetUser = users.users.find(u => u.email === userEmail);
      if (users.users.length < perPage && !targetUser) break;
      page++;
    }
    if (!targetUser) throw new Error(`User with email ${userEmail} not found`);

    const { error: updateError } = await supabase.auth.admin.updateUserById(targetUser.id, { password: newPassword });
    if (updateError) throw new Error(`Failed to update password: ${updateError.message}`);

    return json(200, { success: true, message: `Password updated successfully for ${userEmail}`, userId: targetUser.id });
  } catch (error) {
    return json(400, { success: false, error: error.message });
  }
});
