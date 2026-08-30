#!/usr/bin/env python3
# O11 LIVE PROBE - archive_project on the DEPLOYED focusos-mcp must clear pinned_at.
#
# Bug (O8 skeptic advisory, fixed on redesign/liquid-glass and deployed via the
# 2026-08-30 Lovable round): the MCP archive_project cascade set archived_at but
# left pinned_at, so an archived pinned project silently held one of the 5 pin
# slots and a later restore could land 6 pinned rows.
#
# Probe shape (demo account only, everything zz-prefixed, asserted cleanup):
#   1. Demo password-grant sign-in (creds read at runtime from
#      tests/project-tree.spec.ts; anon key from src/integrations/supabase/client.ts;
#      never hardcoded, never printed).
#   2. Self-mint a focusos_api_tokens row for the DEMO user (RLS allows own
#      INSERT), so the MCP call is authed as demo - probing archive on Igor's
#      real account is forbidden, and Igor's own bearer must not touch demo rows.
#      Only the SHA-256 hash is stored; the row is deleted (asserted) at the end.
#   3. REST as demo: create zz parent + zz sub, BOTH with pinned_at set.
#   4. JSON-RPC tools/call archive_project {id: parent} with the minted bearer.
#   5. REST read-back: both rows archived_at set AND pinned_at null  <- the fix.
#   6. Cleanup: delete both projects and the token row, re-read = 0 rows each.
#
# Usage: python3 scripts/probe_o11_archive_pin.py   (exit 1 on any FAIL)
import hashlib, json, os, re, sys, uuid, urllib.request, urllib.error
from datetime import datetime, timezone

HOME = os.path.expanduser('~'); REPO = f'{HOME}/Developer/focus-os'
SB = 'https://mshlbsgsyzzfxyxramjj.supabase.co'
MCP_URL = f'{SB}/functions/v1/focusos-mcp'
R = []
def rec(name, passed, detail=''):
    R.append(passed); print(('PASS ' if passed else 'FAIL ') + name + (f'  | {detail}' if detail else ''), flush=True)

spec = open(f'{REPO}/tests/project-tree.spec.ts').read()
EM = re.search(r"DEMO_EMAIL = '([^']+)'", spec).group(1)
PW = re.search(r"DEMO_PASSWORD = '([^']+)'", spec).group(1)
ANON = re.search(r'(eyJ[A-Za-z0-9._-]+)', open(f'{REPO}/src/integrations/supabase/client.ts').read()).group(1)

def rest(method, path, tok, body=None, prefer=None):
    h = {'apikey': ANON, 'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'}
    if prefer: h['Prefer'] = prefer
    req = urllib.request.Request(f'{SB}{path}', data=json.dumps(body).encode() if body is not None else None,
                                 method=method, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=30); raw = r.read().decode(); code = r.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode(); code = e.code
    return code, (json.loads(raw) if raw.strip() else None)

# 1. demo sign-in
code, body = rest('POST', '/auth/v1/token?grant_type=password', '', {'email': EM, 'password': PW})
# password grant needs no bearer; redo without Authorization header:
req = urllib.request.Request(f'{SB}/auth/v1/token?grant_type=password',
                             data=json.dumps({'email': EM, 'password': PW}).encode(), method='POST',
                             headers={'apikey': ANON, 'Content-Type': 'application/json'})
auth = json.loads(urllib.request.urlopen(req, timeout=30).read())
DTOK, DUID = auth['access_token'], auth['user']['id']
rec('demo signed in via password grant', bool(DTOK and DUID))

token_row_id = parent_id = sub_id = None
plain = 'zz-o11-probe-' + uuid.uuid4().hex
try:
    # 2. self-mint MCP token for demo
    thash = hashlib.sha256(plain.encode()).hexdigest()
    code, rows = rest('POST', '/rest/v1/focusos_api_tokens', DTOK,
                      {'user_id': DUID, 'name': 'zz-o11-probe', 'token_hash': thash, 'token_prefix': plain[:8]},
                      prefer='return=representation')
    token_row_id = rows[0]['id'] if code == 201 and rows else None
    rec('minted a demo MCP token row', token_row_id is not None, f'HTTP {code}')

    # 3. seed zz parent + sub, both pinned
    now = datetime.now(timezone.utc).isoformat()
    code, rows = rest('POST', '/rest/v1/focusos_projects', DTOK,
                      {'user_id': DUID, 'name': 'zz-o11-parent', 'pinned_at': now}, prefer='return=representation')
    parent_id = rows[0]['id'] if code == 201 and rows else None
    code2, rows2 = rest('POST', '/rest/v1/focusos_projects', DTOK,
                        {'user_id': DUID, 'name': 'zz-o11-sub', 'parent_project_id': parent_id, 'pinned_at': now},
                        prefer='return=representation')
    sub_id = rows2[0]['id'] if code2 == 201 and rows2 else None
    rec('seeded zz parent + sub, both pinned', bool(parent_id and sub_id), f'HTTP {code}/{code2}')

    # 4. archive via the DEPLOYED MCP, authed as demo
    def rpc(method, params=None, _id=1, notify=False):
        b = {'jsonrpc': '2.0', 'method': method}
        if not notify: b['id'] = _id
        if params is not None: b['params'] = params
        h = {'Authorization': f'Bearer {plain}', 'Content-Type': 'application/json',
             'Accept': 'application/json, text/event-stream'}
        req = urllib.request.Request(MCP_URL, data=json.dumps(b).encode(), method='POST', headers=h)
        try:
            r = urllib.request.urlopen(req, timeout=40); raw = r.read().decode(); ct = r.headers.get('content-type', '')
        except urllib.error.HTTPError as e:
            raw = e.read().decode(); ct = e.headers.get('content-type', '')
        if 'text/event-stream' in ct:
            msgs = [json.loads(l[5:].strip()) for l in raw.splitlines() if l.startswith('data:') and l[5:].strip()]
            return msgs[-1] if msgs else None
        return json.loads(raw) if raw.strip() else None

    rpc('initialize', {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'o11-probe', 'version': '1'}})
    rpc('notifications/initialized', {}, notify=True)
    m = rpc('tools/call', {'name': 'archive_project', 'arguments': {'id': parent_id}}, _id=7)
    res = (m or {}).get('result', {})
    text = ''.join(c.get('text', '') for c in res.get('content', []) if c.get('type') == 'text')
    rec('MCP archive_project succeeded as demo', bool(m and not res.get('isError')), text[:200])

    # 5. read-back: archived AND unpinned - the O11 assertion
    code, rows = rest('GET', f'/rest/v1/focusos_projects?select=id,archived_at,pinned_at&id=in.({parent_id},{sub_id})', DTOK)
    by = {r['id']: r for r in (rows or [])}
    ok_arch = all(by.get(i, {}).get('archived_at') for i in (parent_id, sub_id))
    ok_pin = all(by.get(i, {}).get('pinned_at') is None for i in (parent_id, sub_id))
    rec('both rows archived by the cascade', ok_arch, json.dumps(rows))
    rec('pinned_at is NULL on both (the O11 fix, live)', ok_pin, json.dumps(rows))
finally:
    # 6. cleanup, asserted
    if sub_id: rest('DELETE', f'/rest/v1/focusos_projects?id=eq.{sub_id}', DTOK)
    if parent_id: rest('DELETE', f'/rest/v1/focusos_projects?id=eq.{parent_id}', DTOK)
    if parent_id or sub_id:
        ids = ','.join(x for x in (parent_id, sub_id) if x)
        code, rows = rest('GET', f'/rest/v1/focusos_projects?select=id&id=in.({ids})', DTOK)
        rec('cleanup read-back: 0 zz projects remain', rows == [], json.dumps(rows))
    if token_row_id:
        rest('DELETE', f'/rest/v1/focusos_api_tokens?id=eq.{token_row_id}', DTOK)
        code, rows = rest('GET', f'/rest/v1/focusos_api_tokens?select=id&id=eq.{token_row_id}', DTOK)
        rec('cleanup read-back: minted token row deleted', rows == [], json.dumps(rows))

print(f'\n{sum(R)} passed, {len(R) - sum(R)} failed')
sys.exit(0 if all(R) else 1)
