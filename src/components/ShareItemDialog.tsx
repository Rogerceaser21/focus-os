import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Share2, Send } from 'lucide-react';

export type ShareItemType = 'task' | 'project' | 'meeting';

interface ShareItemDialogProps {
  itemType: ShareItemType;
  itemId: string | null;
  itemTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShared?: () => void;
}

export const ShareItemDialog = ({ itemType, itemId, itemTitle, open, onOpenChange, onShared }: ShareItemDialogProps) => {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!itemId || !email.trim()) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      toast.error('Please enter a valid email address');
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('focusos-share-item', {
        body: { itemType, itemId, recipientEmail: email.trim() },
      });

      if (error) throw error;

      toast.success(`${itemType.charAt(0).toUpperCase() + itemType.slice(1)} shared with ${email.trim()}`);
      onShared?.();
      setEmail('');
      onOpenChange(false);
    } catch (err: any) {
      console.error('Share item error:', err);
      toast.error(`Failed to share ${itemType}`);
    } finally {
      setSending(false);
    }
  };

  const typeLabel = itemType.charAt(0).toUpperCase() + itemType.slice(1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" />
            Share {typeLabel}
          </DialogTitle>
          <DialogDescription>
            Share this {itemType} with someone via email. They'll receive a notification and can accept it in Focus OS.
          </DialogDescription>
        </DialogHeader>

        {itemTitle && (
          <div className="glass-card rounded-lg p-3 my-2">
            <p className="text-sm font-semibold text-foreground">{itemTitle}</p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="share-email">Recipient Email</Label>
          <Input
            id="share-email"
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
            {sending ? 'Sharing...' : `Share ${typeLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
