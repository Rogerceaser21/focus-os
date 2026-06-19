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

  const claudeCodeCmd = `claude mcp add --transport http focusos ${MCP_URL} --header "Authorization: Bearer YOUR_TOKEN"`;
  const desktopJson = JSON.stringify(
    {
      mcpServers: {
        focusos: {
          url: MCP_URL,
          headers: { Authorization: 'Bearer YOUR_TOKEN' },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="space-y-3">
      <Label className="text-base font-semibold">AI Access (MCP)</Label>
      <p className="text-sm text-muted-foreground">
        Generate a personal token to let Claude Code, Claude Desktop, Claude Web, or ChatGPT read and write
        your Focus OS tasks and projects via MCP.
      </p>

      {/* Create */}
      <div className="flex gap-2">
        <Input
          placeholder="Token name (e.g. Claude Code – laptop)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Generate'}
        </Button>
      </div>

      {/* Just-created token shown once */}
      {justCreated && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
          <p className="text-sm font-medium">
            Copy this token now — it will not be shown again.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={justCreated} className="font-mono text-xs" />
            <Button size="sm" variant="outline" onClick={() => copy(justCreated, 'Token copied')}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setJustCreated(null)}>
            I've saved it
          </Button>
        </div>
      )}

      {/* Existing tokens */}
      <div className="space-y-1.5">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tokens yet.</p>
        ) : (
          tokens.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{t.name}</span>
                  {t.revoked_at && (
                    <span className="text-xs text-destructive">revoked</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate">
                  {t.token_prefix}…
                </div>
                <div className="text-xs text-muted-foreground">
                  Last used: {t.last_used_at ? new Date(t.last_used_at).toLocaleString() : 'never'}
                </div>
              </div>
              {!t.revoked_at && (
                <Button size="icon" variant="ghost" onClick={() => handleRevoke(t.id)} title="Revoke">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      <Separator />

      {/* Connection guide */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowDocs((v) => !v)}
        className="w-full justify-between"
      >
        <span>How to connect each AI</span>
        {showDocs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </Button>

      {showDocs && (
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-medium">MCP server URL</p>
            <div className="flex gap-2 mt-1">
              <Input readOnly value={MCP_URL} className="font-mono text-xs" />
              <Button size="sm" variant="outline" onClick={() => copy(MCP_URL, 'URL copied')}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <p className="font-medium">Claude Code (CLI)</p>
            <p className="text-xs text-muted-foreground">
              Replace <code>YOUR_TOKEN</code> with the token you just generated, then run:
            </p>
            <pre className="rounded bg-muted p-2 text-xs overflow-x-auto whitespace-pre-wrap break-all">
{claudeCodeCmd}
            </pre>
            <Button size="sm" variant="outline" onClick={() => copy(claudeCodeCmd, 'Command copied')}>
              <Copy className="h-3 w-3 mr-1" /> Copy command
            </Button>
          </div>

          <div className="space-y-1">
            <p className="font-medium">Claude Desktop</p>
            <p className="text-xs text-muted-foreground">
              Settings → Developer → Edit Config, then add this entry inside <code>mcpServers</code>:
            </p>
            <pre className="rounded bg-muted p-2 text-xs overflow-x-auto">
{desktopJson}
            </pre>
            <Button size="sm" variant="outline" onClick={() => copy(desktopJson, 'Config copied')}>
              <Copy className="h-3 w-3 mr-1" /> Copy config
            </Button>
          </div>

          <div className="space-y-1">
            <p className="font-medium">Claude Web (claude.ai)</p>
            <p className="text-xs text-muted-foreground">
              Requires <strong>Pro, Max, Team, or Enterprise</strong> plan. Go to Settings →
              Connectors → <em>Add custom connector</em>, then paste:
            </p>
            <ul className="text-xs ml-4 list-disc">
              <li>URL: the MCP server URL above</li>
              <li>Auth: Bearer token = your generated token</li>
            </ul>
          </div>

          <div className="space-y-1">
            <p className="font-medium">ChatGPT</p>
            <p className="text-xs text-muted-foreground">
              Custom remote MCP connectors are available in <strong>Developer mode</strong> on Pro,
              Business, Enterprise, and Edu plans (Settings → Connectors → Advanced → Developer mode →
              Create). Free/Plus users can't currently add arbitrary MCP servers from the UI. Use the
              same URL and Bearer token as above.
            </p>
          </div>

          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
            <strong>Scope:</strong> Tokens only access your own Focus OS projects, tasks, and meetings.
            They cannot read or modify any other data.
          </div>
        </div>
      )}
    </div>
  );
}