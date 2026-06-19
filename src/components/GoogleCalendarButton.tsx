import { Button } from '@/components/ui/button';
import { CalendarPlus, CalendarCheck, Loader2 } from 'lucide-react';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';
import { useState } from 'react';

interface Props {
  taskId?: string;
  meetingId?: string;
  synced: boolean;
  attendees?: string[];
  sendInvites?: boolean;
  onChange?: (synced: boolean) => void;
  variant?: 'ghost' | 'outline';
  size?: 'sm' | 'icon';
  showLabel?: boolean;
}

export function GoogleCalendarButton({
  taskId, meetingId, synced, attendees, sendInvites,
  onChange, variant = 'ghost', size = 'sm', showLabel = false,
}: Props) {
  const { isConnected, push } = useGoogleCalendar();
  const [working, setWorking] = useState(false);

  const handle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setWorking(true);
    const args = {
      taskIds: taskId ? [taskId] : undefined,
      meetingIds: meetingId ? [meetingId] : undefined,
      action: synced ? ('unsync' as const) : ('sync' as const),
      attendees,
      sendInvites,
    };
    const res = await push(args);
    setWorking(false);
    if (res.ok) onChange?.(!synced);
  };

  if (isConnected === false) return null; // hide entirely if not connected

  const title = synced ? 'Synced to Google Calendar — click to remove' : 'Send to Google Calendar';

  return (
    <Button
      size={size}
      variant={variant}
      onClick={handle}
      disabled={working}
      className={`gap-1 ${synced ? 'text-emerald-500 hover:text-emerald-600' : 'text-muted-foreground hover:text-primary'}`}
      title={title}
    >
      {working
        ? <Loader2 className="h-3 w-3 animate-spin" />
        : synced
          ? <CalendarCheck className="h-3 w-3" />
          : <CalendarPlus className="h-3 w-3" />}
      {showLabel && <span className="text-xs">{synced ? 'Synced' : 'Google Calendar'}</span>}
    </Button>
  );
}