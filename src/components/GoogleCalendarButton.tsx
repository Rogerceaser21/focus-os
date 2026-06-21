import { Button } from '@/components/ui/button';
import { CalendarPlus, CalendarCheck, Loader2, Clock } from 'lucide-react';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';
import { useEffect, useState } from 'react';
import { Task } from '@/types/task';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { AvailabilityScheduler } from '@/components/calendar/AvailabilityScheduler';
import { AttendeePicker, AttendeeChip } from '@/components/calendar/AttendeePicker';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  taskId?: string;
  meetingId?: string;
  task?: Task;
  synced: boolean;
  attendees?: string[];
  sendInvites?: boolean;
  onChange?: (synced: boolean) => void;
  variant?: 'ghost' | 'outline';
  size?: 'sm' | 'icon';
  showLabel?: boolean;
}

export function GoogleCalendarButton({
  taskId, meetingId, task, synced, attendees, sendInvites,
  onChange, variant = 'ghost', size = 'sm', showLabel = false,
}: Props) {
  const { isConnected, push } = useGoogleCalendar();
  const { user } = useAuth();
  const [working, setWorking] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [localSynced, setLocalSynced] = useState(synced);
  useEffect(() => { setLocalSynced(synced); }, [synced]);
  const defaultDate = task?.startDate || task?.dueDate || new Date();
  const defaultStart = roundToNextHalfHour(task?.startDate || new Date());
  const defaultEnd = task?.endDate || new Date(defaultStart.getTime() + 30 * 60_000);
  const [date, setDate] = useState<Date | undefined>(defaultDate);
  const [startTime, setStartTime] = useState(toTimeValue(defaultStart));
  const [duration, setDuration] = useState(String(Math.max(15, Math.round((defaultEnd.getTime() - defaultStart.getTime()) / 60_000) || 30)));
  const [allDay, setAllDay] = useState(false);
  const [chips, setChips] = useState<AttendeeChip[]>(() => (attendees ?? []).map((e) => ({ email: e })));
  const [targetUserId, setTargetUserId] = useState<string | undefined>(undefined);
  const [targetLabel, setTargetLabel] = useState<string>('this calendar');

  // Keep chips in sync if attendees prop changes while dialog is closed
  useEffect(() => {
    if (!pickerOpen) setChips((attendees ?? []).map((e) => ({ email: e })));
  }, [attendees, pickerOpen]);

  const handle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!localSynced && taskId && task) {
      setPickerOpen(true);
      return;
    }
    setWorking(true);
    const args = {
      taskIds: taskId ? [taskId] : undefined,
      meetingIds: meetingId ? [meetingId] : undefined,
      action: localSynced ? ('unsync' as const) : ('sync' as const),
      attendees,
      sendInvites,
    };
    const res = await push(args);
    setWorking(false);
    if (res.ok) {
      setLocalSynced(!localSynced);
      onChange?.(!localSynced);
    }
  };

  const scheduleTask = async () => {
    if (!taskId || !task || !date) return;
    setWorking(true);
    const start = combineDateAndTime(date, startTime);
    const mins = Math.max(15, Number(duration) || 30);
    const end = new Date(start.getTime() + mins * 60_000);
    const placement = allDay
      ? { allDay: true, date: toDateValue(date), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
      : { allDay: false, startDateTime: start.toISOString(), endDateTime: end.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };

    // Single push to the organiser's calendar with guests as native Google
    // attendees. Google sends the invitation emails when there are guests.
    const guestEmails = chips
      .map((c) => c.email)
      .filter((e): e is string => !!e && e.toLowerCase() !== (user?.email ?? '').toLowerCase());
    const hasGuests = guestEmails.length > 0;

    const res = await push({
      taskIds: [taskId],
      action: 'sync',
      calendarPlacement: placement,
      title: task.title,
      description: task.description,
      attendees: hasGuests ? guestEmails : undefined,
      sendInvites: hasGuests,
      silent: true,
    });

    setWorking(false);
    if (res.ok) {
      setLocalSynced(true);
      setPickerOpen(false);
      onChange?.(true);
      // Log a pending shared item per guest (no email — Google already sent the invite).
      if (hasGuests) {
        await Promise.all(
          guestEmails.map(async (recipientEmail) => {
            try {
              await supabase.functions.invoke('focusos-share-item', {
                body: {
                  itemType: 'task',
                  itemId: taskId,
                  recipientEmail,
                  sendEmail: false,
                },
              });
            } catch (err) {
              console.error('share-item log failed for', recipientEmail, err);
            }
          }),
        );
      }
      toast.success(
        hasGuests
          ? `Added to your calendar · invited ${guestEmails.length} guest${guestEmails.length === 1 ? '' : 's'}`
          : 'Added to your calendar',
      );
    }
  };

  if (isConnected === false) return null; // hide entirely if not connected

  const title = localSynced ? 'Synced to Google Calendar — click to remove' : 'Send to Google Calendar';

  return (
    <>
      <Button
        size={size}
        variant={variant}
        onClick={handle}
        disabled={working}
          className={`gap-1 ${localSynced ? 'text-emerald-500 hover:text-emerald-600' : 'text-muted-foreground hover:text-primary'}`}
        title={title}
      >
        {working
          ? <Loader2 className="h-3 w-3 animate-spin" />
            : localSynced
            ? <CalendarCheck className="h-3 w-3" />
            : <CalendarPlus className="h-3 w-3" />}
        {showLabel && <span className="text-xs">{localSynced ? 'Synced' : 'Google Calendar'}</span>}
      </Button>
      {task && (
        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogContent onClick={(e) => e.stopPropagation()} className="max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add to Google Calendar</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Task</Label>
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-medium">{task.title}</div>
              </div>
              <div className="space-y-1.5">
                <Label>Meet with…</Label>
                <AttendeePicker
                  value={chips}
                  onChange={setChips}
                  excludeUserId={user?.id}
                  onPrimaryTargetChange={(uid, name) => {
                    setTargetUserId(uid);
                    setTargetLabel(name || 'this calendar');
                  }}
                />
              </div>
              <div className="flex items-center justify-end gap-2 rounded-md border border-border px-3 py-2">
                <Switch id="all-day" checked={allDay} onCheckedChange={setAllDay} />
                <Label htmlFor="all-day" className="pb-0">All day</Label>
              </div>
              {!allDay && date && (
                <div className="rounded-md border border-border p-3">
                  {targetUserId && (
                    <div className="mb-2 text-[11px] text-muted-foreground">
                      Viewing <span className="font-medium text-foreground">{targetLabel}</span>'s availability
                    </div>
                  )}
                  <AvailabilityScheduler
                    targetUserId={targetUserId}
                    targetLabel={targetLabel}
                    value={date}
                    onDateChange={setDate}
                    durationMinutes={Math.max(15, Number(duration) || 30)}
                    onPick={(start) => {
                      setDate(start);
                      setStartTime(toTimeValue(start));
                    }}
                  />
                </div>
              )}
              {!allDay && (
                <div className="space-y-2">
                   <div className="grid grid-cols-2 gap-3 items-end">
                     <div className="space-y-1.5 min-w-0">
                       <Label>Start time</Label>
                       <div className="relative h-10">
                         <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
                         <div className="flex items-center h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm">
                           {(() => {
                             const [h, m] = (startTime || '00:00').split(':').map(Number);
                             const period = h >= 12 ? 'PM' : 'AM';
                             const hh = ((h + 11) % 12) + 1;
                             return `${hh}:${String(m).padStart(2, '0')} ${period}`;
                           })()}
                         </div>
                         <input
                           type="time"
                           value={startTime}
                           onChange={(e) => setStartTime(e.target.value)}
                           className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                           style={{ minWidth: 0 }}
                           aria-label="Start time"
                         />
                       </div>
                     </div>
                     <div className="space-y-1.5 min-w-0">
                       <Label>Duration (min)</Label>
                       <Input type="number" inputMode="numeric" min="15" step="15" value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full h-10 min-w-0" style={{ minWidth: 0 }} />
                     </div>
                   </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[15, 30, 45, 60, 90].map((m) => (
                      <Button
                        key={m}
                        type="button"
                        size="sm"
                        variant={String(m) === duration ? 'default' : 'outline'}
                        className="h-6 px-2 text-xs"
                        onClick={() => setDuration(String(m))}
                      >
                        {m}m
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setPickerOpen(false)} disabled={working}>Cancel</Button>
                <Button onClick={scheduleTask} disabled={working || !date}>
                  {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add to calendar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function roundToNextHalfHour(date: Date) {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  const minutes = rounded.getMinutes();
  rounded.setMinutes(minutes <= 30 ? 30 : 60);
  return rounded;
}

function toTimeValue(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function toDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function combineDateAndTime(date: Date, time: string) {
  const [hours = '9', minutes = '0'] = time.split(':');
  const combined = new Date(date);
  combined.setHours(Number(hours), Number(minutes), 0, 0);
  return combined;
}