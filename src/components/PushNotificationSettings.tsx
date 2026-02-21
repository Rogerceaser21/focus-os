import { useState } from "react";
import { Bell, BellOff, Smartphone, AlertCircle, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export function PushNotificationSettings() {
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
    <div className="space-y-3">
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
        <Button
          variant="outline"
          size="sm"
          onClick={handleSendTest}
          disabled={isSendingTest}
        >
          {isSendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
          Send Test
        </Button>
      )}
    </div>
  );
}
