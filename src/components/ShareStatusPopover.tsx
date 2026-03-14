import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Share2, Clock, CheckCircle2, XCircle, UserCheck } from 'lucide-react';

export interface SharedRecipient {
  email: string;
  name: string;
  status: string;
}

interface ShareStatusPopoverProps {
  recipients: SharedRecipient[];
  itemType: 'Task' | 'Project' | 'Meeting';
  children?: React.ReactNode;
}

const statusConfig: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
  pending: { icon: <Clock className="h-3 w-3" />, label: 'Pending', className: 'text-yellow-400' },
  accepted: { icon: <UserCheck className="h-3 w-3" />, label: 'Accepted', className: 'text-blue-400' },
  declined: { icon: <XCircle className="h-3 w-3" />, label: 'Declined', className: 'text-red-400' },
  completed: { icon: <CheckCircle2 className="h-3 w-3" />, label: 'Completed', className: 'text-green-400' },
};

export const ShareStatusPopover = ({ recipients, itemType, children }: ShareStatusPopoverProps) => {
  if (recipients.length === 0) return null;

  const trigger = children || (
    <Badge
      variant="outline"
      className="bg-purple-600/15 text-purple-400 border-purple-600/30 text-xs inline-flex items-center gap-1 cursor-pointer hover:bg-purple-600/25 transition-colors"
    >
      <Share2 className="h-3 w-3 shrink-0" />
      <span className="break-words">Shared {itemType}</span>
    </Badge>
  );

  return (
    <Popover>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-72 p-3 z-[130]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Shared with {recipients.length} {recipients.length === 1 ? 'person' : 'people'}
          </h4>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {recipients.map((r, idx) => {
              const config = statusConfig[r.status] || statusConfig.pending;
              return (
                <div key={idx} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md bg-muted/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-purple-600/20 text-purple-400 flex items-center justify-center text-[10px] font-bold shrink-0">
                      {(r.name || r.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{r.name || r.email}</p>
                      {r.name && r.name !== r.email && (
                        <p className="text-[10px] text-muted-foreground truncate">{r.email}</p>
                      )}
                    </div>
                  </div>
                  <span className={`flex items-center gap-1 text-[10px] font-medium shrink-0 ${config.className}`}>
                    {config.icon}
                    {config.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
