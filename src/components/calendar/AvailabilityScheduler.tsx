import { useMemo, useState } from "react";
import { format, addDays, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, Loader2, CalendarX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFreeBusy } from "@/hooks/useFreeBusy";
import { cn } from "@/lib/utils";

interface Props {
  targetUserId?: string;          // undefined = own calendar
  targetLabel?: string;           // "your" or "Ava's"
  initialDate?: Date;
  durationMinutes: number;
  timeZone?: string;
  onPick: (start: Date, end: Date) => void;
}

const HOUR_HEIGHT = 36; // px per hour

export function AvailabilityScheduler({
  targetUserId, targetLabel = "this calendar", initialDate, durationMinutes, timeZone, onPick,
}: Props) {
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [day, setDay] = useState<Date>(initialDate ?? new Date());
  const dateStr = toLocalDateString(day, tz);

  const { data, isLoading, error, refetch, isFetching } = useFreeBusy({
    targetUserId, date: dateStr, timeZone: tz, durationMinutes,
  });

  const isToday = sameLocalDay(day, new Date(), tz);

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

  if (data && !data.connected) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
        <CalendarX className="h-5 w-5" />
        <p>{targetLabel === "this calendar" ? "This user has" : `${targetLabel} hasn't`} not connected Google Calendar.</p>
        <p className="text-xs">Pick a time manually below — they'll receive an email invite.</p>
      </div>
    );
  }

  if (!data || !data.connected) return null;

  const startHour = data.workdayStartHour;
  const endHour = data.workdayEndHour;
  const totalHours = endHour - startHour;
  const windowStart = parseISO(data.windowStart);
  const windowEnd = parseISO(data.windowEnd);

  const blocks = data.busy.map((b) => {
    const s = parseISO(b.start);
    const e = parseISO(b.end);
    const startOffset = Math.max(0, (s.getTime() - windowStart.getTime()) / 3_600_000);
    const endOffset = Math.min(totalHours, (e.getTime() - windowStart.getTime()) / 3_600_000);
    return {
      top: startOffset * HOUR_HEIGHT,
      height: Math.max(8, (endOffset - startOffset) * HOUR_HEIGHT),
    };
  });

  return (
    <div className="space-y-3">
      {/* Day nav */}
      <div className="flex items-center justify-between">
        <Button size="sm" variant="ghost" onClick={() => setDay(addDays(day, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-sm font-medium flex items-center gap-2">
          {format(day, "EEEE, MMM d")}
          {!isToday && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setDay(new Date())}>
              today
            </Button>
          )}
          {isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setDay(addDays(day, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day grid */}
      <div className="relative rounded-md border border-border bg-muted/20 overflow-hidden">
        <div className="relative" style={{ height: totalHours * HOUR_HEIGHT }}>
          {/* Hour lines + labels */}
          {Array.from({ length: totalHours + 1 }).map((_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 border-t border-border/60 flex"
              style={{ top: i * HOUR_HEIGHT }}
            >
              <span className="w-12 -mt-2 pl-1 text-[10px] text-muted-foreground">
                {String(startHour + i).padStart(2, "0")}:00
              </span>
            </div>
          ))}
          {/* Busy blocks */}
          {blocks.map((b, i) => (
            <div
              key={i}
              className="absolute left-12 right-2 rounded-sm bg-primary/30 border border-primary/50"
              style={{ top: b.top, height: b.height }}
              title="Busy"
            >
              <span className="px-1 text-[10px] text-foreground/80">Busy</span>
            </div>
          ))}
        </div>
      </div>

      {/* Suggested free slots */}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">
          Free slots ≥ {durationMinutes} min
        </div>
        {data.suggested.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No free windows that fit. Try another day or shorten the duration.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.suggested.map((s, i) => {
              const ss = parseISO(s.start);
              const se = parseISO(s.end);
              const pickEnd = new Date(ss.getTime() + durationMinutes * 60_000);
              return (
                <Button
                  key={i}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => onPick(ss, pickEnd > se ? se : pickEnd)}
                >
                  {formatInTZ(ss, tz)}–{formatInTZ(se, tz)} ({fmtDur(s.durationMinutes)})
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
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
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

function fmtDur(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h${m}`;
  if (h) return `${h}h`;
  return `${m}m`;
}