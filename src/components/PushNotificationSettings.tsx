import { useState, useEffect } from "react";
import { Bell, BellOff, Smartphone, AlertCircle, Loader2, Clock, Calendar } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { UserPreferences } from "@/hooks/useUserPreferences";

interface PushNotificationSettingsProps {
  preferences?: UserPreferences | null;
  onSave?: (updates: Partial<UserPreferences>) => Promise<void>;
}

export function PushNotificationSettings({ preferences, onSave }: PushNotificationSettingsProps) {
  const { toast } = useToast();
  const {
    isSupported,
    isSubscribed,
    permission,
    isLoading,
    isiOS,
    isPWA,
    subscribe,
    unsubscribe
  } = usePushNotifications();
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [notifyDueDate, setNotifyDueDate] = useState(false);
  const [notifyTimer, setNotifyTimer] = useState(false);
  const [timerInterval, setTimerInterval] = useState(45);

  useEffect(() => {
    if (preferences) {
      setNotifyDueDate(preferences.notify_due_date ?? false);
      setNotifyTimer(preferences.notify_timer ?? false);
      setTimerInterval(preferences.timer_alert_interval_minutes ?? 45);
    }
  }, [preferences]);

  const handleToggle = async () => {
    try {
      if (isSubscribed) {
        await unsubscribe();
        toast({ title: "Notifications disabled" });
      } else {
        await subscribe();
        toast({ title: "Notifications enabled!" });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleSendTest = async () => {
    setIsSendingTest(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      await supabase.functions.invoke('send-push-notification', {
        body: {
          user_id: user.id,
          payload: {
            title: "Test Notification 🔔",
            body: "Push notifications are working!",
            url: "/app"
          }
        }
      });

      toast({ title: "Test notification sent!" });
    } catch (error: any) {
      toast({ title: "Failed to send test", description: error.message, variant: "destructive" });
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleDueDateToggle = async (checked: boolean) => {
    setNotifyDueDate(checked);
    if (onSave) {
      await onSave({ notify_due_date: checked } as any);
    }
  };

  const handleTimerToggle = async (checked: boolean) => {
    setNotifyTimer(checked);
    if (onSave) {
      await onSave({ notify_timer: checked } as any);
    }
  };

  const handleTimerIntervalChange = async (value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1) return;
    setTimerInterval(num);
  };

  const handleTimerIntervalBlur = async () => {
    if (onSave && timerInterval >= 1) {
      await onSave({ timer_alert_interval_minutes: timerInterval } as any);
    }
  };

  if (isiOS && !isPWA) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-muted-foreground" />
          <Label className="text-base font-semibold">Push Notifications</Label>
        </div>
        <div className="text-sm text-muted-foreground space-y-1">
          <p>To enable push notifications on iOS:</p>
          <ol className="list-decimal list-inside space-y-0.5 ml-1">
            <li>Tap the Share button in Safari</li>
            <li>Tap "Add to Home Screen"</li>
            <li>Open the app from your home screen</li>
          </ol>
        </div>
      </div>
    );
  }

  if (!isSupported) {
    return (
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-muted-foreground" />
        <Label className="font-normal text-muted-foreground">
          Push notifications not supported in this browser
        </Label>
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div className="flex items-center gap-2">
        <BellOff className="h-4 w-4 text-destructive" />
        <Label className="font-normal text-muted-foreground">
          Notifications blocked — update your browser settings
        </Label>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Master toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isSubscribed ? <Bell className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
          <div>
            <Label className="text-base font-semibold">Push Notifications</Label>
            <p className="text-sm text-muted-foreground">
              {isSubscribed ? "Enabled" : "Disabled"}
            </p>
          </div>
        </div>
        <Switch
          checked={isSubscribed}
          onCheckedChange={handleToggle}
          disabled={isLoading}
        />
      </div>

      {isSubscribed && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendTest}
            disabled={isSendingTest}
          >
            {isSendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            Send Test
          </Button>

          <Separator className="my-2" />

          {/* Due Date Reminders */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">Due Date Reminders</Label>
                <p className="text-xs text-muted-foreground">
                  Morning of due date & 1 hour before
                </p>
              </div>
            </div>
            <Switch
              checked={notifyDueDate}
              onCheckedChange={handleDueDateToggle}
            />
          </div>

          {/* Timer Alerts */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">Timer Alerts</Label>
                <p className="text-xs text-muted-foreground">
                  Notify at custom intervals while timer runs
                </p>
              </div>
            </div>
            <Switch
              checked={notifyTimer}
              onCheckedChange={handleTimerToggle}
            />
          </div>

          {notifyTimer && (
            <div className="flex items-center gap-2 ml-6">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">Every</Label>
              <Input
                type="number"
                min={1}
                max={480}
                value={timerInterval}
                onChange={(e) => handleTimerIntervalChange(e.target.value)}
                onBlur={handleTimerIntervalBlur}
                className="w-20 h-8"
              />
              <Label className="text-sm text-muted-foreground whitespace-nowrap">minutes</Label>
            </div>
          )}
        </>
      )}
    </div>
  );
}
