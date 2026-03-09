import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Mail, Send } from 'lucide-react';
import { Task } from '@/types/task';

interface AssignTaskDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned?: (taskId: string, email: string) => void;
}

export const AssignTaskDialog = ({ task, open, onOpenChange, onAssigned }: AssignTaskDialogProps) => {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!task || !email.trim()) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      toast.error('Please enter a valid email address');
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('focusos-send-task-email', {
        body: { taskId: task.id, recipientEmail: email.trim() },
      });

      if (error) throw error;

      toast.success(`Task emailed to ${email.trim()}`);
      onAssigned?.(task.id, email.trim());
      setEmail('');
      onOpenChange(false);
    } catch (err: any) {
      console.error('Send task email error:', err);
      toast.error('Failed to send task email');
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
            Assign & Email Task
          </DialogTitle>
          <DialogDescription>
            Send this task to someone via email. They'll be able to mark it complete directly from the email.
          </DialogDescription>
        </DialogHeader>

        {task && (
          <div className="glass-card rounded-lg p-3 my-2">
            <p className="text-sm font-semibold text-foreground">{task.title}</p>
            {task.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="recipient-email">Recipient Email</Label>
          <Input
            id="recipient-email"
            type="email"
            placeholder="colleague@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
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
