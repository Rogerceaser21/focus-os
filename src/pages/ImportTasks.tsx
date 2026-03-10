import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

// Proper CSV parser: handles semicolons, quoted multiline fields, escaped quotes
function parseCSV(text: string, delimiter = ';'): Record<string, string>[] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        current.push(field);
        field = '';
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field);
        field = '';
        if (current.length > 1) rows.push(current);
        current = [];
        if (ch === '\r') i++;
      } else {
        field += ch;
      }
    }
  }
  // last field/row
  if (field || current.length) {
    current.push(field);
    if (current.length > 1) rows.push(current);
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (row[i] ?? '').trim(); });
    return obj;
  });
}

function cleanVal(val: string | undefined): string | null {
  if (!val || val === '' || val === '[]' || val === 'null') return null;
  return val;
}

export default function ImportTasks() {
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [inserted, setInserted] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { setStatus('Pick a file first'); return; }

    setRunning(true);
    setStatus('Reading file...');
    const text = await file.text();

    setStatus('Parsing CSV...');
    const records = parseCSV(text, ';');
    setTotal(records.length);
    setStatus(`Parsed ${records.length} tasks. Inserting...`);

    let ok = 0;
    const errs: string[] = [];
    const BATCH = 50;

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH).map(r => ({
        id: r.id,
        user_id: r.user_id,
        project_id: cleanVal(r.project_id),
        title: r.title || 'Untitled',
        description: cleanVal(r.description),
        priority: r.priority || 'medium',
        status: r.status || 'todo',
        start_date: cleanVal(r.start_date),
        end_date: cleanVal(r.end_date),
        due_date: cleanVal(r.due_date),
        timer_total_seconds: parseInt(r.timer_total_seconds) || 0,
        timer_is_running: r.timer_is_running === 'true',
        timer_start_time: cleanVal(r.timer_start_time),
        created_at: r.created_at || new Date().toISOString(),
        updated_at: r.updated_at || new Date().toISOString(),
        images: cleanVal(r.images) ? (() => { try { return JSON.parse(r.images); } catch { return null; } })() : null,
        completed_at: cleanVal(r.completed_at),
        sort_order: r.sort_order ? parseInt(r.sort_order) : null,
        meeting_id: cleanVal(r.meeting_id),
        assigned_to_email: cleanVal(r.assigned_to_email),
        share_token: cleanVal(r.share_token),
        completed_by_email: cleanVal(r.completed_by_email),
      }));

      const { error } = await (supabase as any)
        .from('focusos_tasks')
        .upsert(batch, { onConflict: 'id', ignoreDuplicates: true });

      if (error) {
        errs.push(`Batch ${i}-${i + BATCH}: ${error.message}`);
        // Try one by one for failed batch
        for (const row of batch) {
          const { error: e2 } = await (supabase as any)
            .from('focusos_tasks')
            .upsert([row], { onConflict: 'id', ignoreDuplicates: true });
          if (e2) {
            errs.push(`Row ${row.id}: ${e2.message}`);
          } else {
            ok++;
          }
        }
      } else {
        ok += batch.length;
      }

      setInserted(ok);
      setErrors([...errs]);
      setProgress(Math.round(((i + BATCH) / records.length) * 100));
    }

    setProgress(100);
    setStatus(`Done! ${ok} tasks inserted. ${errs.length} errors.`);
    setRunning(false);
  };

  return (
    <div className="min-h-screen bg-background p-8 flex items-center justify-center">
      <Card className="max-w-xl w-full p-8 space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Import Tasks from CSV</h1>
        <p className="text-muted-foreground text-sm">
          Pick the exported tasks CSV file. It will parse and insert all tasks directly.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="block w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-primary file:text-primary-foreground file:cursor-pointer"
        />

        <Button onClick={handleImport} disabled={running} className="w-full">
          {running ? 'Importing...' : 'Start Import'}
        </Button>

        {total > 0 && (
          <div className="space-y-2">
            <Progress value={progress} className="h-3" />
            <p className="text-sm text-muted-foreground">
              {inserted} / {total} tasks inserted ({progress}%)
            </p>
          </div>
        )}

        {status && <p className="text-sm font-medium text-foreground">{status}</p>}

        {errors.length > 0 && (
          <div className="max-h-40 overflow-y-auto bg-destructive/10 rounded p-3 text-xs text-destructive space-y-1">
            {errors.slice(0, 50).map((e, i) => <div key={i}>{e}</div>)}
            {errors.length > 50 && <div>...and {errors.length - 50} more</div>}
          </div>
        )}
      </Card>
    </div>
  );
}
