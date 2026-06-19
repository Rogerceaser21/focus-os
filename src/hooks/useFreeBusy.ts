import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FreeBusyResponse =
  | { connected: false; reason?: string }
  | {
      connected: true;
      date: string;
      timeZone: string;
      workdayStartHour: number;
      workdayEndHour: number;
      windowStart: string;
      windowEnd: string;
      busy: { start: string; end: string; summary?: string }[];
      free: { start: string; end: string; durationMinutes: number }[];
      suggested: { start: string; end: string; durationMinutes: number }[];
    };

interface Args {
  targetUserId?: string;
  date: string; // YYYY-MM-DD
  timeZone: string;
  durationMinutes?: number;
  enabled?: boolean;
  workdayStartHour?: number;
  workdayEndHour?: number;
}

export function useFreeBusy({ targetUserId, date, timeZone, durationMinutes = 30, enabled = true, workdayStartHour = 7, workdayEndHour = 18 }: Args) {
  return useQuery<FreeBusyResponse>({
    queryKey: ["freebusy", targetUserId ?? "self", date, timeZone, durationMinutes, workdayStartHour, workdayEndHour],
    enabled: enabled && !!date && !!timeZone,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("focusos-calendar-freebusy", {
        body: { targetUserId, date, timeZone, durationMinutes, workdayStartHour, workdayEndHour },
      });
      if (error) throw error;
      return data as FreeBusyResponse;
    },
  });
}