import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Copy, Trash2, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

interface ApiToken {
  id: string;
  name: string;
  token_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const MCP_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/focusos-mcp`;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `focusos_${hex}`;
}

export default function ApiTokensSection() {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [showDocs, setShowDocs] = useState(false);
  const [selectedClient, setSelectedClient] = useState<'code' | 'desktop'>('code');

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('focusos_api_tokens')
      .select('id, name, token_prefix, last_used_at, revoked_at, created_at')
      .order('created_at', { ascending: false });
    if (error) toast({ title: 'Could not load tokens', description: error.message, variant: 'destructive' });
    setTokens(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes?.user) throw new Error('Not signed in');
      const raw = generateToken();
      const hash = await sha256Hex(raw);
      const prefix = raw.slice(0, 16);
      const { error } = await supabase.from('focusos_api_tokens').insert({
        user_id: userRes.user.id,
        name: newName.trim(),
        token_hash: hash,
        token_prefix: prefix,
      });
      if (error) throw error;
      setJustCreated(raw);
      setNewName('');
      await load();
    } catch (e: any) {
      toast({ title: 'Could not create token', description: e.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    const { error } = await supabase
      .from('focusos_api_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      toast({ title: 'Could not revoke', description: error.message, variant: 'destructive' });
      return;
    }
    load();
  };

  const copy = async (text: string, label = 'Copied') => {
    await navigator.clipboard.writeText(text);
    toast({ title: label });
  };

  // If a token was just generated, drop it straight into the snippets so the
  // user doesn't have to hand-edit anything. Otherwise show the placeholder.
  const tokenForSnippet = justCreated ?? 'YOUR_TOKEN';
  const claudeCodeCmd = `claude mcp add --transport http -s user focusos ${MCP_URL} --header "Authorization: Bearer ${tokenForSnippet}"`;
  const desktopJson = JSON.stringify(
    {
      mcpServers: {
        focusos: {
          command: "npx",
          args: [
            "-y",
            "mcp-remote",
            MCP_URL,
            "--header",
            `Authorization: Bearer ${tokenForSnippet}`
          ]
        }
      }
    },
    null,
    2,
  );

  const activeTokens = tokens.filter((t) => !t.revoked_at);

  return (
    <div className="space-y-3">
      <Label className="text-base font-semibold">AI Access (MCP)</Label>
      <p className="text-sm text-muted-foreground">
        Connect Claude Code or Claude Desktop to Focus OS so they can read and
        write your tasks and projects. You only do this once per device.
      </p>

      {/* Step 1: name + generate */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-2">
        <p className="text-sm font-medium">Step 1 — Generate a token</p>
        <p className="text-xs text-muted-foreground">
          Give it a name so you remember where you used it (e.g. "Claude Code – laptop").
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="Token name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Generate token'}
          </Button>
        </div>
      </div>

      {/* Just-created token shown once */}
      {justCreated && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
          <p className="text-sm font-medium">
            Your token (copy it now — it will not be shown again)
          </p>
          <div className="flex gap-2">
            <Input readOnly value={justCreated} className="font-mono text-xs" />
            <Button size="sm" variant="outline" onClick={() => copy(justCreated, 'Token copied')}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The snippets in Step 2 below now have your token already filled in — just pick your AI and
            copy. When you're done, click "I've saved it" to hide the token.
          </p>
          <Button size="sm" variant="ghost" onClick={() => setJustCreated(null)}>
            I've saved it
          </Button>
        </div>
      )}

      {/* Existing tokens */}
      <div className="space-y-1.5">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : activeTokens.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active tokens yet.</p>
        ) : (
          activeTokens.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{t.name}</span>
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate">
                  {t.token_prefix}…
                </div>
                <div className="text-xs text-muted-foreground">
                  Last used: {t.last_used_at ? new Date(t.last_used_at).toLocaleString() : 'never'}
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => handleRevoke(t.id)} title="Revoke">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))
        )}
      </div>

      <Separator />

      {/* Step 2: connection guide */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowDocs((v) => !v)}
        className="w-full justify-between"
      >
        <span>Step 2 — Connect your AI (Claude Code / Desktop)</span>
        {showDocs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </Button>

      {showDocs && (
        <div className="space-y-4 text-sm">
          {!justCreated && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
              Tip: generate a token in Step 1 first and the snippets below will be pre-filled with
              it — no editing needed.
            </div>
          )}

          <div>
            <p className="font-medium mb-1">Pick your AI</p>
            <div className="flex flex-wrap gap-1">
              {[
                { id: 'code', label: 'Claude Code' },
                { id: 'desktop', label: 'Claude Desktop' },
              ].map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant={selectedClient === c.id ? 'default' : 'outline'}
                  onClick={() => setSelectedClient(c.id as any)}
                >
                  {c.label}
                </Button>
              ))}
            </div>
          </div>

          {selectedClient === 'code' && (
            <div className="space-y-2">
              <p className="font-medium">Claude Code (terminal)</p>
              <ol className="text-xs text-muted-foreground list-decimal ml-4 space-y-1">
                <li>Open your terminal (anywhere — you don't need to be in a project).</li>
                <li>Paste and run the command below. <em>This registers Focus OS globally so it's available in all directories.</em></li>
                <li>That's it! Claude Code will remember this forever. Next time you run <code>claude</code>, Focus OS tools are available — ask things like "show my Focus OS tasks for today" or "add a task to project X".</li>
              </ol>
              <pre className="rounded bg-muted p-2 text-xs overflow-x-auto whitespace-pre-wrap break-all">{claudeCodeCmd}</pre>
              <Button size="sm" variant="outline" onClick={() => copy(claudeCodeCmd, 'Command copied')}>
                <Copy className="h-3 w-3 mr-1" /> Copy command
              </Button>
            </div>
          )}

          {selectedClient === 'desktop' && (
            <div className="space-y-2">
              <p className="font-medium">Claude Desktop (Mac / Windows app)</p>
              <ol className="text-xs text-muted-foreground list-decimal ml-4 space-y-1">
                <li>Open Claude Desktop → <strong>Settings → Developer → Edit Config</strong>. A JSON file opens in your editor.</li>
                <li>Open the file. If it's empty, paste the JSON below. If it already has other MCP servers, just add the <code>focusos</code> entry inside your existing <code>mcpServers</code> object — do <strong>NOT</strong> replace the whole file.</li>
                <li>Note: You must have Node.js installed on your machine for the <code>npx</code> proxy command to run.</li>
                <li>Save the file and fully quit + reopen Claude Desktop. Focus OS will appear as a connected tool in any new chat.</li>
              </ol>
              <pre className="rounded bg-muted p-2 text-xs overflow-x-auto">{desktopJson}</pre>
              <Button size="sm" variant="outline" onClick={() => copy(desktopJson, 'Config copied')}>
                <Copy className="h-3 w-3 mr-1" /> Copy config
              </Button>
            </div>
          )}

          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
            <strong>Scope:</strong> Tokens only access your own Focus OS projects, tasks, and
            meetings. They cannot read or modify any other data. Revoke a token anytime above to
            cut off access instantly.
          </div>
        </div>
      )}
    </div>
  );
}