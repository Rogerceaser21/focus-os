import { useEffect, useMemo, useRef, useState } from "react";
import { format, addDays, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, Loader2, CalendarX, CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFreeBusy } from "@/hooks/useFreeBusy";
import { cn } from "@/lib/utils";

interface Props {
  targetUserId?: string;          // undefined = own calendar
  targetLabel?: string;
  value?: Date;                   // controlled current day (optional)
  initialDate?: Date;
  durationMinutes: number;
  timeZone?: string;
  onPick: (start: Date, end: Date) => void;
  onDateChange?: (date: Date) => void;
  gridStartHour?: number;         // scrollable range start
  gridEndHour?: number;           // scrollable range end
  workdayStartHour?: number;      // working window highlight
  workdayEndHour?: number;
}

const HOUR_HEIGHT = 44; // px per hour (touch-friendly)

export function AvailabilityScheduler({
  targetUserId, targetLabel = "this calendar", value, initialDate, durationMinutes, timeZone, onPick, onDateChange,
  gridStartHour = 6, gridEndHour = 22, workdayStartHour = 7, workdayEndHour = 18,
}: Props) {
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [internalDay, setInternalDay] = useState<Date>(initialDate ?? new Date());
  const day = value ?? internalDay;
  const setDay = (d: Date) => {
    if (!value) setInternalDay(d);
    onDateChange?.(d);
  };
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dateStr = toLocalDateString(day, tz);

  const { data, isLoading, error, refetch, isFetching } = useFreeBusy({
    targetUserId, date: dateStr, timeZone: tz, durationMinutes,
    workdayStartHour, workdayEndHour,
  });

  const isToday = sameLocalDay(day, new Date(), tz);

  // Live "now" tick (every minute) for the red current-time line
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Auto-scroll: if today, center the red "now" line; else scroll to working-hours start.
  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    if (isToday) {
      const nowHours = now.getHours() + now.getMinutes() / 60;
      const nowTop = (nowHours - gridStartHour) * HOUR_HEIGHT;
      el.scrollTop = Math.max(0, nowTop - el.clientHeight / 2);
    } else {
      const target = (workdayStartHour - gridStartHour) * HOUR_HEIGHT - 8;
      el.scrollTop = Math.max(0, target);
    }
    // Only auto-center on day change / first load, not every minute tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr, workdayStartHour, gridStartHour, data?.connected]);

  // Day-grid math (full scrollable range) — must run before any early return to keep hook order stable
  const totalHours = gridEndHour - gridStartHour;
  const gridHeight = totalHours * HOUR_HEIGHT;

  const gridAnchor = useMemo(() => {
    if (data && data.connected) {
      const ws = parseISO(data.windowStart);
      return new Date(ws.getTime() - (workdayStartHour - gridStartHour) * 3_600_000);
    }
    const anchor = new Date(day);
    anchor.setHours(gridStartHour, 0, 0, 0);
    return anchor;
  }, [data, day, gridStartHour, workdayStartHour]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading availability…
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2 py-6 text-center">
        <p className="text-sm text-destructive">Could not load availability.</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const notConnected = data && !data.connected;

  const busyBlocks = (data && data.connected ? data.busy : []).map((b) => {
    const s = parseISO(b.start);
    const e = parseISO(b.end);
    const startOffset = Math.max(0, (s.getTime() - gridAnchor.getTime()) / 3_600_000);
    const endOffset = Math.min(totalHours, (e.getTime() - gridAnchor.getTime()) / 3_600_000);
    if (endOffset <= 0 || startOffset >= totalHours) return null;
    return {
      top: startOffset * HOUR_HEIGHT,
      height: Math.max(10, (endOffset - startOffset) * HOUR_HEIGHT),
      start: s, end: e,
    };
  }).filter(Boolean) as { top: number; height: number; start: Date; end: Date }[];

  function handleGridClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const hoursFromAnchor = y / HOUR_HEIGHT;
    // snap to 15 min
    const snappedMinutes = Math.round(hoursFromAnchor * 4) * 15;
    const start = new Date(gridAnchor.getTime() + snappedMinutes * 60_000);
    // Reject if inside a busy block
    const collides = busyBlocks.some(
      (b) => start.getTime() >= b.start.getTime() && start.getTime() < b.end.getTime(),
    );
    if (collides) return;
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    onPick(start, end);
  }

  const workingTop = (workdayStartHour - gridStartHour) * HOUR_HEIGHT;
  const workingHeight = (workdayEndHour - workdayStartHour) * HOUR_HEIGHT;

  const nowHours = now.getHours() + now.getMinutes() / 60;
  const nowTop = (nowHours - gridStartHour) * HOUR_HEIGHT;
  const showNowLine = isToday && nowHours >= gridStartHour && nowHours <= gridEndHour;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="space-y-3">
      {/* Day nav */}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={(e) => { stop(e); setDay(addDays(day, -1)); }}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2 flex-1 justify-center">
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs sm:text-sm font-medium" onClick={stop}>
                <CalendarIcon className="h-3.5 w-3.5" />
                {format(day, "EEE, MMM d")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="center" onClick={stop}>
              <Calendar
                mode="single"
                selected={day}
                onSelect={(d) => { if (d) { setDay(d); setDatePickerOpen(false); } }}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          {!isToday && (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={(e) => { stop(e); setDay(new Date()); }}>
              Today
            </Button>
          )}
          {isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={(e) => { stop(e); setDay(addDays(day, 1)); }}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {notConnected && (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <CalendarX className="h-3.5 w-3.5" />
          <span>{targetLabel}'s Google Calendar isn't connected — pick a time manually; they'll get an email invite.</span>
        </div>
      )}

      {/* Day grid (scrollable) */}
      <div
        ref={scrollRef}
        className="relative rounded-md border border-border bg-muted/10 overflow-y-auto"
        style={{ maxHeight: 360 }}
      >
        <div
          className="relative cursor-pointer select-none"
          style={{ height: gridHeight }}
          onClick={handleGridClick}
        >
          {/* Working window highlight */}
          <div
            className="absolute left-12 right-0 bg-background"
            style={{ top: workingTop, height: workingHeight }}
          />
          {/* Hour lines + labels */}
          {Array.from({ length: totalHours + 1 }).map((_, i) => {
            const hr = gridStartHour + i;
            return (
              <div
                key={i}
                className="absolute left-0 right-0 border-t border-border/50 flex pointer-events-none"
                style={{ top: i * HOUR_HEIGHT }}
              >
                <span className="w-12 -mt-2 pl-1 text-[10px] text-muted-foreground">
                  {formatHourLabel(hr)}
                </span>
              </div>
            );
          })}
          {/* Half-hour ticks */}
          {Array.from({ length: totalHours }).map((_, i) => (
            <div
              key={`half-${i}`}
              className="absolute left-12 right-0 border-t border-border/20 pointer-events-none"
              style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
            />
          ))}
          {/* Busy blocks */}
          {busyBlocks.map((b, i) => (
            <div
              key={i}
              className="absolute left-12 right-1 rounded-sm bg-primary/25 border border-primary/40 pointer-events-none"
              style={{ top: b.top, height: b.height }}
              title="Busy"
            >
              <span className="px-1 text-[10px] text-foreground/70 leading-tight block truncate">
                Busy · {formatInTZ(b.start, tz)}
              </span>
            </div>
          ))}
          {/* Current time indicator */}
          {showNowLine && (
            <div
              className="absolute left-10 right-0 pointer-events-none z-10"
              style={{ top: nowTop }}
            >
              <div className="relative">
                <div className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full bg-red-500 shadow" />
                <div className="h-[2px] w-full bg-red-500" />
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground -mt-1">
        Tap any empty time to schedule a {durationMinutes} min slot. Working hours {formatHourLabel(workdayStartHour)}–{formatHourLabel(workdayEndHour)}.
      </p>
    </div>
  );
}

function formatHourLabel(hour: number) {
  const h12 = ((hour + 11) % 12) + 1;
  const ampm = hour < 12 || hour === 24 ? "AM" : "PM";
  return `${h12} ${ampm}`;
}

function toLocalDateString(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  return parts; // en-CA gives YYYY-MM-DD
}

function sameLocalDay(a: Date, b: Date, tz: string) {
  return toLocalDateString(a, tz) === toLocalDateString(b, tz);
}

function formatInTZ(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
}

function fmtDur(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h${m}`;
  if (h) return `${h}h`;
  return `${m}m`;
}