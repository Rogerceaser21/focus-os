import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Share2, Clock, CheckCircle2, XCircle, UserCheck, AlertTriangle, Activity } from 'lucide-react';
import { RecipientWorkModal } from '@/components/RecipientWorkModal';

export interface SharedRecipient {
  email: string;
  name: string;
  status: string;
  sharedItemId?: string;
}

interface ShareStatusPopoverProps {
  recipients: SharedRecipient[];
  itemType: 'Task' | 'Project' | 'Meeting';
  children?: React.ReactNode;
  /** Called when sender clicks "Move to Done" for a specific completed recipient */
  onMoveToDone?: (recipientEmail: string) => void;
  /** Called when sender clicks "Changes Needed" for a specific completed recipient */
  onRequestChanges?: (recipientEmail: string) => void;
  /** Whether all recipients have completed — controls whether global Move to Done is possible */
  allCompleted?: boolean;
  /** Called when sender clicks the global "Move All to Done" when all recipients completed */
  onMoveAllToDone?: () => void;
}

const statusConfig: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
  pending: { icon: <Clock className="h-3 w-3" />, label: 'Pending', className: 'text-yellow-400' },
  accepted: { icon: <UserCheck className="h-3 w-3" />, label: 'Accepted', className: 'text-blue-400' },
  declined: { icon: <XCircle className="h-3 w-3" />, label: 'Declined', className: 'text-red-400' },
  completed: { icon: <CheckCircle2 className="h-3 w-3" />, label: 'Completed', className: 'text-green-400' },
};

export const ShareStatusPopover = ({ recipients, itemType, children, onMoveToDone, onRequestChanges, allCompleted, onMoveAllToDone }: ShareStatusPopoverProps) => {
  const [viewWorkRecipient, setViewWorkRecipient] = useState<SharedRecipient | null>(null);

  if (recipients.length === 0) return null;

  const everyoneCompleted = recipients.every(r => r.status === 'completed');

  const buildStatusSummary = () => {
    if (recipients.length === 1) {
      return `Shared with ${recipients[0].name || recipients[0].email}`;
    }
    if (everyoneCompleted) {
      return `Shared ${itemType} Completed (${recipients.length})`;
    }
    const counts: Record<string, number> = {};
    recipients.forEach(r => {
      const s = r.status || 'pending';
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([status, count]) => `${count} ${status.charAt(0).toUpperCase() + status.slice(1)}`)
      .join(', ');
  };

  const badgeText = buildStatusSummary();

  const trigger = children || (
    <Badge
      variant="outline"
      className={`${everyoneCompleted ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-purple-600/15 text-purple-400 border-purple-600/30'} text-xs inline-flex items-center gap-1 cursor-pointer hover:opacity-80 transition-colors`}
    >
      <Share2 className="h-3 w-3 shrink-0" />
      <span className="break-words">{badgeText}</span>
    </Badge>
  );

  return (
    <>
      <Popover>
        <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
          <button className="inline-flex" type="button">
            {trigger}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="w-80 p-3 z-[130]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Shared with {recipients.length} {recipients.length === 1 ? 'person' : 'people'}
            </h4>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {recipients.map((r, idx) => {
                const config = statusConfig[r.status] || statusConfig.pending;
                const isCompleted = r.status === 'completed';
                const canViewWork = (r.status === 'accepted' || r.status === 'completed') && r.sharedItemId;
                return (
                  <div key={idx} className="py-1.5 px-2 rounded-md bg-muted/30">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {canViewWork ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 shrink-0 text-purple-400 hover:text-foreground hover:bg-purple-500/20"
                            title="View Work"
                            onClick={(e) => { e.stopPropagation(); setViewWorkRecipient(r); }}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        ) : (
                          <div className="w-6 h-6 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{r.name || r.email}</p>
                          {r.name && r.name !== r.email && (
                            <p className="text-[10px] text-muted-foreground truncate">{r.email}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`flex items-center gap-1 text-[10px] font-medium ${config.className}`}>
                          {config.icon}
                          {config.label}
                        </span>
                      </div>
                    </div>
                    {/* Per-person actions when this recipient has completed */}
                    {isCompleted && (onMoveToDone || onRequestChanges) && (
                      <div className="flex items-center gap-1.5 mt-1.5 ml-8">
                        {onMoveToDone && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-[10px] h-5 px-2 border-green-500/30 text-green-400 hover:bg-green-500/20"
                            onClick={(e) => { e.stopPropagation(); onMoveToDone(r.email); }}
                          >
                            <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                            Acknowledge
                          </Button>
                        )}
                        {onRequestChanges && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-[10px] h-5 px-2 border-orange-500/30 text-orange-400 hover:bg-orange-500/20"
                            onClick={(e) => { e.stopPropagation(); onRequestChanges(r.email); }}
                          >
                            <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                            Changes
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Global Move to Done only when ALL have completed */}
            {allCompleted && onMoveAllToDone && (
              <div className="pt-2 border-t border-border">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs h-7 border-green-500/30 text-green-400 hover:bg-green-500/20"
                  onClick={(e) => { e.stopPropagation(); onMoveAllToDone(); }}
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Move to Done (All Completed)
                </Button>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {viewWorkRecipient && viewWorkRecipient.sharedItemId && (
        <RecipientWorkModal
          open={!!viewWorkRecipient}
          onOpenChange={(open) => { if (!open) setViewWorkRecipient(null); }}
          sharedItemId={viewWorkRecipient.sharedItemId}
          recipientEmail={viewWorkRecipient.email}
          recipientName={viewWorkRecipient.name}
        />
      )}
    </>
  );
};
