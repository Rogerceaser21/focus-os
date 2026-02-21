import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all users who have due date notifications enabled
    const { data: notifyUsers, error: prefError } = await supabase
      .from('user_preferences')
      .select('user_id')
      .eq('notify_due_date', true);

    if (prefError || !notifyUsers || notifyUsers.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No users with due date notifications enabled', checked: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userIds = notifyUsers.map(u => u.user_id);
    const now = new Date();
    
    // Check for tasks due within the next hour
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    
    // Also check for tasks due today (for the morning reminder, fires between 8-9 AM UTC)
    const currentHour = now.getUTCHours();
    const isMorningWindow = currentHour >= 8 && currentHour < 9;

    let notificationsSent = 0;

    for (const userId of userIds) {
      // Check if user has push subscriptions
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('id')
        .eq('user_id', userId)
        .limit(1);

      if (!subs || subs.length === 0) continue;

      // Tasks due within the next hour (not already completed)
      const { data: urgentTasks } = await supabase
        .from('tasks')
        .select('id, title, due_date')
        .eq('user_id', userId)
        .neq('status', 'completed')
        .not('due_date', 'is', null)
        .gte('due_date', now.toISOString())
        .lte('due_date', oneHourFromNow.toISOString());

      if (urgentTasks && urgentTasks.length > 0) {
        const taskNames = urgentTasks.slice(0, 3).map(t => t.title).join(', ');
        const extra = urgentTasks.length > 3 ? ` and ${urgentTasks.length - 3} more` : '';

        await supabase.functions.invoke('send-push-notification', {
          body: {
            user_id: userId,
            payload: {
              title: '⏰ Task Due Soon',
              body: `${taskNames}${extra}`,
              url: '/app'
            }
          }
        });
        notificationsSent++;
      }

      // Morning digest: tasks due today
      if (isMorningWindow) {
        const todayStart = new Date(now);
        todayStart.setUTCHours(0, 0, 0, 0);
        const todayEnd = new Date(now);
        todayEnd.setUTCHours(23, 59, 59, 999);

        const { data: todayTasks } = await supabase
          .from('tasks')
          .select('id, title')
          .eq('user_id', userId)
          .neq('status', 'completed')
          .not('due_date', 'is', null)
          .gte('due_date', todayStart.toISOString())
          .lte('due_date', todayEnd.toISOString());

        if (todayTasks && todayTasks.length > 0) {
          // Only send if we didn't already send an urgent notification
          if (!urgentTasks || urgentTasks.length === 0) {
            await supabase.functions.invoke('send-push-notification', {
              body: {
                user_id: userId,
                payload: {
                  title: '📋 Tasks Due Today',
                  body: `You have ${todayTasks.length} task${todayTasks.length > 1 ? 's' : ''} due today`,
                  url: '/app'
                }
              }
            });
            notificationsSent++;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, checked: userIds.length, notificationsSent }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('[DueReminders] Error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
