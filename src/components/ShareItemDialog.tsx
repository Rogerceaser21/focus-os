import { useState, useEffect, useRef, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Share2, Send, X, UserCheck, Search } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export type ShareItemType = 'task' | 'project' | 'meeting';

interface Contact {
  email: string;
  firstName?: string;
  lastName?: string;
  isFocusOSUser: boolean;
}

interface ShareItemDialogProps {
  itemType: ShareItemType;
  itemId: string | null;
  itemTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShared?: () => void;
}

export const ShareItemDialog = ({ itemType, itemId, itemTitle, open, onOpenChange, onShared }: ShareItemDialogProps) => {
  const { user } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const [recipients, setRecipients] = useState<Contact[]>([]);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0 });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch all contacts when dialog opens
  useEffect(() => {
    if (!open || !user) return;
    const fetchContacts = async () => {
      try {
        // Get all focusos profiles (readable by authenticated users)
        const { data: profiles } = await (supabase as any)
          .from('focusos_profiles')
          .select('user_id, user_email, first_name, last_name');

        // Get past recipients from shared items
        const { data: pastShares } = await (supabase as any)
          .from('focusos_shared_items')
          .select('recipient_email')
          .eq('sender_user_id', user.id);

        const contactMap = new Map<string, Contact>();

        // Add all profiles
        if (profiles) {
          for (const p of profiles) {
            if (p.user_email && p.user_id !== user.id) {
              contactMap.set(p.user_email.toLowerCase(), {
                email: p.user_email,
                firstName: p.first_name || undefined,
                lastName: p.last_name || undefined,
                isFocusOSUser: true,
              });
            }
          }
        }

        // Add past recipients not already in profiles
        if (pastShares) {
          for (const s of pastShares) {
            const key = s.recipient_email.toLowerCase();
            if (!contactMap.has(key) && s.recipient_email !== user.email) {
              contactMap.set(key, {
                email: s.recipient_email,
                isFocusOSUser: false,
              });
            }
          }
        }

        setContacts(Array.from(contactMap.values()));
      } catch (err) {
        console.error('Error fetching contacts:', err);
      }
    };
    fetchContacts();
  }, [open, user]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSearchInput('');
      setRecipients([]);
      setShowDropdown(false);
      setSendProgress({ sent: 0, total: 0 });
    }
  }, [open]);

  const filteredContacts = useMemo(() => {
    if (!searchInput.trim()) return contacts.slice(0, 8);
    const q = searchInput.toLowerCase();
    return contacts
      .filter(c => {
        const alreadyAdded = recipients.some(r => r.email.toLowerCase() === c.email.toLowerCase());
        if (alreadyAdded) return false;
        const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ').toLowerCase();
        return c.email.toLowerCase().includes(q) || fullName.includes(q);
      })
      .slice(0, 8);
  }, [searchInput, contacts, recipients]);

  const getDisplayName = (c: Contact) => {
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
    return name || c.email;
  };

  const addRecipient = (contact: Contact) => {
    if (recipients.some(r => r.email.toLowerCase() === contact.email.toLowerCase())) return;
    setRecipients(prev => [...prev, contact]);
    setSearchInput('');
    setShowDropdown(false);
    // Delay focus so onFocus doesn't immediately reopen dropdown
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const addManualEmail = () => {
    const email = searchInput.trim();
    if (!email) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error('Please enter a valid email address');
      return;
    }
    if (recipients.some(r => r.email.toLowerCase() === email.toLowerCase())) {
      toast.error('This recipient has already been added');
      return;
    }
    // Check if this email is in contacts
    const existing = contacts.find(c => c.email.toLowerCase() === email.toLowerCase());
    addRecipient(existing || { email, isFocusOSUser: false });
  };

  const removeRecipient = (email: string) => {
    setRecipients(prev => prev.filter(r => r.email.toLowerCase() !== email.toLowerCase()));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // If dropdown has filtered results, add the first one
      if (filteredContacts.length > 0 && searchInput.trim()) {
        addRecipient(filteredContacts[0]);
      } else if (searchInput.trim()) {
        addManualEmail();
      }
    }
  };

  const handleSend = async () => {
    if (!itemId || recipients.length === 0) return;

    setSending(true);
    setSendProgress({ sent: 0, total: recipients.length });
    let successCount = 0;

    try {
      for (const recipient of recipients) {
        try {
          const { error } = await supabase.functions.invoke('focusos-share-item', {
            body: { itemType, itemId, recipientEmail: recipient.email },
          });
          if (!error) successCount++;
        } catch {
          // continue with next recipient
        }
        setSendProgress(prev => ({ ...prev, sent: prev.sent + 1 }));
      }

      if (successCount === recipients.length) {
        toast.success(`${itemType.charAt(0).toUpperCase() + itemType.slice(1)} shared with ${successCount} ${successCount === 1 ? 'person' : 'people'}`);
      } else if (successCount > 0) {
        toast.warning(`Shared with ${successCount} of ${recipients.length} recipients`);
      } else {
        toast.error(`Failed to share ${itemType}`);
      }

      onShared?.();
      onOpenChange(false);
    } catch (err: any) {
      console.error('Share error:', err);
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
            Share this {itemType} with one or more people. Start typing to search for Focus OS users.
          </DialogDescription>
        </DialogHeader>

        {itemTitle && (
          <div className="glass-card rounded-lg p-3 my-2">
            <p className="text-sm font-semibold text-foreground">{itemTitle}</p>
          </div>
        )}

        {/* Search input */}
        <div className="space-y-2 relative">
          <Label htmlFor="share-email">Add Recipients</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              id="share-email"
              type="text"
              placeholder="Search by name or type an email..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onKeyDown={handleKeyDown}
              className="pl-9"
              autoComplete="off"
            />
          </div>

          {/* Autocomplete dropdown */}
          {showDropdown && (searchInput.trim() || filteredContacts.length > 0) && (
            <div
              ref={dropdownRef}
              className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-border bg-card shadow-lg max-h-48 overflow-y-auto"
            >
              {filteredContacts.map((contact, idx) => (
                <button
                  key={contact.email}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors text-left"
                  onClick={() => addRecipient(contact)}
                >
                  <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                    {getDisplayName(contact).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{getDisplayName(contact)}</p>
                    {contact.firstName && (
                      <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
                    )}
                  </div>
                  {contact.isFocusOSUser && (
                    <span className="flex items-center gap-1 text-[10px] text-green-400 font-medium shrink-0">
                      <UserCheck className="h-3 w-3" />
                      Focus OS
                    </span>
                  )}
                </button>
              ))}
              {filteredContacts.length === 0 && searchInput.trim() && (
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors text-left"
                  onClick={addManualEmail}
                >
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0 text-muted-foreground">
                    @
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">Add "{searchInput.trim()}"</p>
                    <p className="text-xs text-muted-foreground">Send to this email address</p>
                  </div>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Recipients list */}
        {recipients.length > 0 && (
          <div className="space-y-2">
            <Label className="text-muted-foreground">
              Recipients ({recipients.length})
            </Label>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {recipients.map((r) => (
                <div
                  key={r.email}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-muted/30 border border-border/50"
                >
                  <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                    {getDisplayName(r).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">{getDisplayName(r)}</p>
                    {r.firstName && (
                      <p className="text-[10px] text-muted-foreground truncate">{r.email}</p>
                    )}
                  </div>
                  {r.isFocusOSUser && (
                    <span className="flex items-center gap-1 text-[10px] text-green-400 font-medium shrink-0">
                      <UserCheck className="h-3 w-3" />
                    </span>
                  )}
                  <button
                    onClick={() => removeRecipient(r.email)}
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending || recipients.length === 0} className="gap-2">
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sharing {sendProgress.sent}/{sendProgress.total}...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Share with {recipients.length} {recipients.length === 1 ? 'person' : 'people'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
