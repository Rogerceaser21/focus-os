import { Button } from '@/components/ui/button';
import { CalendarPlus, CalendarCheck, Loader2, CalendarIcon, Clock } from 'lucide-react';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';
import { useState } from 'react';
import { Task } from '@/types/task';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

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
  const [working, setWorking] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const defaultDate = task?.startDate || task?.dueDate || new Date();
  const defaultStart = roundToNextHalfHour(task?.startDate || new Date());
  const defaultEnd = task?.endDate || new Date(defaultStart.getTime() + 30 * 60_000);
  const [date, setDate] = useState<Date | undefined>(defaultDate);
  const [startTime, setStartTime] = useState(toTimeValue(defaultStart));
  const [duration, setDuration] = useState(String(Math.max(15, Math.round((defaultEnd.getTime() - defaultStart.getTime()) / 60_000) || 30)));
  const [allDay, setAllDay] = useState(false);

  const handle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!synced && taskId && task) {
      setPickerOpen(true);
      return;
    }
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

  const scheduleTask = async () => {
    if (!taskId || !task || !date) return;
    setWorking(true);
    const start = combineDateAndTime(date, startTime);
    const mins = Math.max(15, Number(duration) || 30);
    const end = new Date(start.getTime() + mins * 60_000);
    const placement = allDay
      ? { allDay: true, date: toDateValue(date), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
      : { allDay: false, startDateTime: start.toISOString(), endDateTime: end.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    const res = await push({
      taskIds: [taskId],
      action: 'sync',
      attendees,
      sendInvites,
      calendarPlacement: placement,
      title: task.title,
      description: task.description,
    });
    setWorking(false);
    if (res.ok) {
      setPickerOpen(false);
      onChange?.(true);
    }
  };

  if (isConnected === false) return null; // hide entirely if not connected

  const title = synced ? 'Synced to Google Calendar — click to remove' : 'Send to Google Calendar';

  return (
    <>
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
      {task && (
        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogContent onClick={(e) => e.stopPropagation()} className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add to Google Calendar</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Task</Label>
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-medium">{task.title}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn('w-full justify-start gap-2 text-left font-normal', !date && 'text-muted-foreground')}>
                        <CalendarIcon className="h-4 w-4" />
                        {date ? format(date, 'MMM d, yyyy') : 'Pick date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={date} onSelect={setDate} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex items-end gap-2 rounded-md border border-border px-3 py-2">
                  <Switch checked={allDay} onCheckedChange={setAllDay} />
                  <Label className="pb-0.5">All day</Label>
                </div>
              </div>
              {!allDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Start time</Label>
                    <div className="relative">
                      <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="pl-9" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Duration minutes</Label>
                    <Input type="number" min="15" step="15" value={duration} onChange={(e) => setDuration(e.target.value)} />
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