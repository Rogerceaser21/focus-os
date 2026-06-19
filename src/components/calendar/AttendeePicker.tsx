import { useEffect, useRef, useState } from "react";
import { Loader2, X, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface AttendeeChip {
  email: string;
  name?: string;
  userId?: string; // present if it's a Focus OS profile match
}

interface Props {
  value: AttendeeChip[];
  onChange: (next: AttendeeChip[]) => void;
  /** Called with the userId of the first internal attendee whose availability should overlay the grid. */
  onPrimaryTargetChange?: (userId: string | undefined, label: string | undefined) => void;
  excludeUserId?: string; // typically the current user — don't suggest yourself
}

interface ProfileHit {
  user_id: string;
  user_email: string | null;
  first_name: string | null;
  last_name: string | null;
}

function displayName(p: { first_name?: string | null; last_name?: string | null; user_email?: string | null }) {
  const n = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return n || p.user_email || "";
}

function initials(name: string) {
  return name.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AttendeePicker({ value, onChange, onPrimaryTargetChange, excludeUserId }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProfileHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setHits([]); return; }
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      const q = query.trim();
      const { data, error } = await supabase
        .from("focusos_profiles")
        .select("user_id,user_email,first_name,last_name")
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,user_email.ilike.%${q}%`)
        .limit(8);
      setLoading(false);
      if (error) { setHits([]); return; }
      const filtered = (data ?? []).filter((p) => p.user_id !== excludeUserId && !value.some((v) => v.userId === p.user_id || v.email === p.user_email));
      setHits(filtered as ProfileHit[]);
      setOpen(true);
    }, 200);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [query, excludeUserId, value]);

  const addChip = (chip: AttendeeChip) => {
    if (value.some((v) => v.email.toLowerCase() === chip.email.toLowerCase())) return;
    const next = [...value, chip];
    onChange(next);
    setQuery("");
    setHits([]);
    setOpen(false);
    // Notify of primary target if this is the first internal attendee
    const firstInternal = next.find((c) => c.userId);
    onPrimaryTargetChange?.(firstInternal?.userId, firstInternal?.name);
  };

  const removeChip = (email: string) => {
    const next = value.filter((v) => v.email.toLowerCase() !== email.toLowerCase());
    onChange(next);
    const firstInternal = next.find((c) => c.userId);
    onPrimaryTargetChange?.(firstInternal?.userId, firstInternal?.name);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && query.trim()) {
      e.preventDefault();
      const q = query.trim().replace(/,$/, "");
      if (EMAIL_RE.test(q)) addChip({ email: q });
    } else if (e.key === "Backspace" && !query && value.length) {
      removeChip(value[value.length - 1].email);
    }
  };

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((c) => (
            <span
              key={c.email}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs",
                c.userId ? "bg-primary/15 text-foreground border border-primary/30" : "bg-muted text-muted-foreground border border-border",
              )}
              title={c.email}
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/30 text-[9px] font-medium">
                {initials(c.name || c.email)}
              </span>
              <span className="max-w-[140px] truncate">{c.name || c.email}</span>
              <button
                type="button"
                className="opacity-60 hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); removeChip(c.email); }}
                aria-label={`Remove ${c.name || c.email}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (hits.length) setOpen(true); }}
          placeholder="Add guests — type a name or email…"
          className="h-9 text-sm"
        />
        {loading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {open && hits.length > 0 && (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-64 overflow-y-auto">
            {hits.map((p) => {
              const name = displayName(p);
              return (
                <button
                  key={p.user_id}
                  type="button"
                  className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/60"
                  onClick={(e) => { e.stopPropagation(); addChip({ email: p.user_email || "", name, userId: p.user_id }); }}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[11px] font-semibold">
                    {initials(name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{name}</span>
                    {p.user_email && <span className="block text-[11px] text-muted-foreground truncate">{p.user_email}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {open && query.trim().length >= 2 && hits.length === 0 && !loading && EMAIL_RE.test(query.trim()) && (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/60"
              onClick={(e) => { e.stopPropagation(); addChip({ email: query.trim() }); }}
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="text-sm">Add "{query.trim()}"</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
