import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Mail, Send } from 'lucide-react';

interface SendMeetingSummaryDialogProps {
  meetingId: string | null;
  meetingTitle: string;
  hasRecording: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SendMeetingSummaryDialog = ({ meetingId, meetingTitle, hasRecording, open, onOpenChange }: SendMeetingSummaryDialogProps) => {
  const [email, setEmail] = useState('');
  const [includeRecording, setIncludeRecording] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!meetingId || !email.trim()) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      toast.error('Please enter a valid email address');
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-meeting-email', {
        body: {
          meetingId,
          recipientEmail: email.trim(),
          includeRecordingLink: includeRecording && hasRecording,
        },
      });

      if (error) throw error;

      toast.success(`Meeting summary sent to ${email.trim()}`);
      setEmail('');
      setIncludeRecording(false);
      onOpenChange(false);
    } catch (err: any) {
      console.error('Send meeting email error:', err);
      toast.error('Failed to send meeting summary');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Share Meeting Summary
          </DialogTitle>
          <DialogDescription>
            Send the overview and outline of "{meetingTitle}" via email.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="meeting-recipient-email">Recipient Email</Label>
            <Input
              id="meeting-recipient-email"
              type="email"
              placeholder="colleague@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            />
          </div>

          {hasRecording && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="include-recording"
                checked={includeRecording}
                onCheckedChange={(checked) => setIncludeRecording(checked === true)}
              />
              <Label htmlFor="include-recording" className="text-sm text-muted-foreground cursor-pointer">
                Include link to voice recording
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending || !email.trim()} className="gap-2">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? 'Sending...' : 'Send Email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
