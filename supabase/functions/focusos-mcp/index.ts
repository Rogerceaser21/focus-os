// Focus OS MCP Server
// Hard-allowlisted to focusos_* tables only. Every query is scoped by user_id
// resolved from the bearer token's SHA-256 hash in focusos_api_tokens.

import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ───────── OAuth (WorkOS AuthKit) constants ─────────
const WORKOS_ISSUER = "https://premier-lamb-33-staging.authkit.app";
const WORKOS_JWKS_URL = `${WORKOS_ISSUER}/oauth2/jwks`;
const WORKOS_USERINFO_URL = `${WORKOS_ISSUER}/oauth2/userinfo`;
const RESOURCE_URL = "https://mshlbsgsyzzfxyxramjj.supabase.co/functions/v1/focusos-mcp";
const AS_METADATA_URL = `${WORKOS_ISSUER}/.well-known/oauth-authorization-server`;
const PROTECTED_RESOURCE_METADATA_URL = `${RESOURCE_URL}/.well-known/oauth-protected-resource`;
const WWW_AUTHENTICATE = `Bearer resource_metadata="${PROTECTED_RESOURCE_METADATA_URL}"`;

const JWKS = createRemoteJWKSet(new URL(WORKOS_JWKS_URL));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

// Service role client used ONLY to look up the token hash and run queries
// scoped to the resolved user_id. Never used for cross-user access.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function resolveUserIdFromToken(token: string): Promise<string | null> {
  const hash = await sha256Hex(token);
  const { data, error } = await admin
    .from("focusos_api_tokens")
    .select("id, user_id, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  // best-effort last_used update; don't await failures
  admin
    .from("focusos_api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {});
  return data.user_id as string;
}

async function resolveUserIdFromWorkOSToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: WORKOS_ISSUER,
      audience: RESOURCE_URL,
    });
    console.log("[mcp-oauth] jwt ok. iss=", (payload as any).iss, "aud=", JSON.stringify((payload as any).aud), "sub=", (payload as any).sub, "email_claim=", (payload as any).email);
    let email: string | undefined =
      typeof (payload as any).email === "string" ? ((payload as any).email as string) : undefined;
    if (!email) {
      const sub = typeof (payload as any).sub === "string" ? ((payload as any).sub as string) : null;
      const workosKey = Deno.env.get("WORKOS_API_KEY");
      if (!workosKey) {
        console.error("[mcp-oauth] WORKOS_API_KEY is not set; cannot resolve email from sub");
        return null;
      }
      if (!sub) {
        console.error("[mcp-oauth] no sub in verified token; cannot resolve email");
        return null;
      }
      const res = await fetch(`https://api.workos.com/user_management/users/${sub}`, {
        headers: {
          Authorization: `Bearer ${workosKey}`,
          Accept: "application/json",
        },
      });
      const info = await res.json().catch(() => null);
      const resolved = info && typeof info.email === "string" && info.email ? info.email : null;
      console.log("[mcp-oauth] workos mgmt status=", res.status, "email=", resolved ?? "(none)");
      if (!resolved) return null;
      email = resolved;
    }
    if (!email) return null;
    console.log("[mcp-oauth] matching email=", email.toLowerCase());
    const { data, error } = await admin
      .from("focusos_users")
      .select("user_id")
      .eq("email", email.toLowerCase())
      .maybeSingle();
    console.log("[mcp-oauth] focusos_users match=", data?.user_id ?? "(none)", "error=", error?.message ?? "(none)");
    if (error || !data) return null;
    return data.user_id as string;
  } catch (e) {
    console.error("[mcp-oauth] verify/resolve threw:", (e as any)?.message ?? e);
    return null;
  }
}

function ok(text: unknown) {
  return {
    content: [
      { type: "text" as const, text: typeof text === "string" ? text : JSON.stringify(text, null, 2) },
    ],
  };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

// ───────── Image helpers ─────────
const BUCKET = "focusos-task-images";
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_BYTES = 10 * 1024 * 1024;

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    default: return "bin";
  }
}

function publicUrlFor(path: string): string {
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function isBase64Entry(src: string): boolean {
  return typeof src === "string" && src.startsWith("data:");
}

function base64ToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const [header, data] = dataUrl.split(",");
  if (!header || data === undefined) throw new Error("Invalid base64 data URL");
  const mime = header.match(/:(.*?);/)?.[1] ?? "application/octet-stream";
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

function buildStoragePath(userId: string, ext: string): string {
  const rand = Math.random().toString(36).substring(2, 8);
  return `${userId}/${Date.now()}-${rand}.${ext}`;
}

function previewBase64Path(src: string): string {
  return src.slice(0, 32) + "…";
}

// ───────── MCP server ─────────
const mcp = new McpServer({
  name: "focusos",
  version: "1.0.0",
  schemaAdapter: (schema) => z.toJSONSchema(schema as z.ZodType),
});

function getUserId(ctx: any): string {
  return ctx?.authInfo?.extra?.userId as string;
}

// ── READ TOOLS ────────────────────────────────────────────────────────────────
mcp.tool("list_projects", {
  description: "List all projects owned by the authenticated Focus OS user.",
  inputSchema: z.object({}),
  handler: async (_args, ctx) => {
    const userId = getUserId(ctx);
    const { data, error } = await admin
      .from("focusos_projects")
      .select("id, name, color, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) return err(error.message);
    return ok(data ?? []);
  },
});

mcp.tool("list_tasks", {
  description:
    "List tasks for the authenticated user. Optional filters: project_id, status, due_today, limit.",
  inputSchema: z.object({
    project_id: z.string().optional(),
    status: z.enum(["todo", "in-progress", "completed"]).optional(),
    due_today: z.boolean().optional(),
    limit: z.number().optional(),
  }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    let q = admin
      .from("focusos_tasks")
      .select("id, title, description, status, priority, due_date, project_id, created_at, completed_at")
      .eq("user_id", userId);
    if (args?.project_id) q = q.eq("project_id", args.project_id);
    if (args?.status) q = q.eq("status", args.status);
    if (args?.due_today) q = q.eq("due_date", new Date().toISOString().slice(0, 10));
    q = q.order("created_at", { ascending: false }).limit(Math.min(Math.max(args?.limit ?? 50, 1), 200));
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok(data ?? []);
  },
});

mcp.tool("get_task", {
  description: "Get a single task by id (must belong to the authenticated user).",
  inputSchema: z.object({ id: z.string() }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    const { data, error } = await admin
      .from("focusos_tasks")
      .select("*")
      .eq("user_id", userId)
      .eq("id", args.id)
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("Task not found");
    const images: string[] = Array.isArray((data as any).images) ? (data as any).images : [];
    const image_urls = images.map((entry) =>
      isBase64Entry(entry) ? "[legacy-base64-image]" : publicUrlFor(entry),
    );
    return ok({ ...data, image_urls });
  },
});

mcp.tool("list_meetings", {
  description: "List the user's meetings (most recent first). Optional limit (default 20, max 100).",
  inputSchema: z.object({ limit: z.number().optional() }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    const { data, error } = await admin
      .from("focusos_meetings")
      .select("id, title, status, created_at, summary")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(args?.limit ?? 20, 1), 100));
    if (error) return err(error.message);
    return ok(data ?? []);
  },
});

mcp.tool("get_meeting", {
  description: "Get a single meeting by id (must belong to the authenticated user).",
  inputSchema: z.object({ id: z.string() }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    const { data, error } = await admin
      .from("focusos_meetings")
      .select("*")
      .eq("user_id", userId)
      .eq("id", args.id)
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("Meeting not found");
    return ok(data);
  },
});

mcp.tool("search", {
  description: "Search the user's tasks and projects by case-insensitive substring on title/name.",
  inputSchema: z.object({ query: z.string() }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    const like = `%${String(args.query).replace(/%/g, "")}%`;
    const [tasks, projects] = await Promise.all([
      admin
        .from("focusos_tasks")
        .select("id, title, status, project_id")
        .eq("user_id", userId)
        .ilike("title", like)
        .limit(50),
      admin
        .from("focusos_projects")
        .select("id, name, color")
        .eq("user_id", userId)
        .ilike("name", like)
        .limit(50),
    ]);
    return ok({ tasks: tasks.data ?? [], projects: projects.data ?? [] });
  },
});

// ── WRITE TOOLS ───────────────────────────────────────────────────────────────
mcp.tool("create_project", {
  description: "Create a new project for the authenticated user.",
  inputSchema: z.object({
    name: z.string(),
    color: z.string().optional().describe("Hex color like #3b82f6"),
  }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    const { data, error } = await admin
      .from("focusos_projects")
      .insert({ user_id: userId, name: args.name, color: args.color ?? "#3b82f6" })
      .select()
      .single();
    if (error) return err(error.message);
    return ok(data);
  },
});

mcp.tool("create_task", {
  description: "Create a task. due_date format YYYY-MM-DD.",
  inputSchema: z.object({
    title: z.string(),
    project_id: z.string().optional(),
    description: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    due_date: z.string().optional(),
    status: z.enum(["todo", "in-progress", "completed"]).optional(),
  }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    const row: Record<string, unknown> = {
      user_id: userId,
      title: args.title,
      status: args.status ?? "todo",
      priority: args.priority ?? "medium",
    };
    if (args.project_id) row.project_id = args.project_id;
    if (args.description) row.description = args.description;
    if (args.due_date) row.due_date = args.due_date;
    const { data, error } = await admin.from("focusos_tasks").insert(row).select().single();
    if (error) return err(error.message);
    return ok(data);
  },
});

mcp.tool("update_task", {
  description: "Update fields on a task you own. Only provided fields are changed.",
  inputSchema: z.object({
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    due_date: z.string().optional(),
    status: z.enum(["todo", "in-progress", "completed"]).optional(),
    project_id: z.string().optional(),
  }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    const { id, ...rest } = args as any;
    const patch: Record<string, unknown> = {};
    for (const k of ["title", "description", "priority", "due_date", "status", "project_id"]) {
      if (rest[k] !== undefined) patch[k] = rest[k];
    }
    if (Object.keys(patch).length === 0) return err("No fields to update");
    const { data, error } = await admin
      .from("focusos_tasks")
      .update(patch)
      .eq("user_id", userId)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("Task not found");
    return ok(data);
  },
});

mcp.tool("complete_task", {
  description: "Mark a task as completed.",
  inputSchema: z.object({ id: z.string() }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    const { data, error } = await admin
      .from("focusos_tasks")
      .update({ status: "completed" })
      .eq("user_id", userId)
      .eq("id", args.id)
      .select()
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("Task not found");
    return ok(data);
  },
});

mcp.tool("delete_task", {
  description: "Delete a task you own.",
  inputSchema: z.object({ id: z.string() }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    const { error } = await admin
      .from("focusos_tasks")
      .delete()
      .eq("user_id", userId)
      .eq("id", args.id);
    if (error) return err(error.message);
    return ok({ deleted: true, id: args.id });
  },
});

// ── TIMER TOOLS ───────────────────────────────────────────────────────────────
function withCurrentSeconds(row: any) {
  const total = Number(row.timer_total_seconds ?? 0);
  const running = !!row.timer_is_running;
  const start = row.timer_start_time ? Number(row.timer_start_time) : null;
  const current_seconds =
    total + (running && start ? Math.floor((Date.now() - start) / 1000) : 0);
  return { ...row, current_seconds };
}

async function fetchTask(userId: string, id: string) {
  return await admin
    .from("focusos_tasks")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
}

mcp.tool("start_task_timer", {
  description:
    "Start (or resume) the timer on a task you own. No-op if already running. Returns the task row with computed current_seconds.",
  inputSchema: z.object({ id: z.string() }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    const { data: task, error: selErr } = await fetchTask(userId, args.id);
    if (selErr) return err(selErr.message);
    if (!task) return err("Task not found");
    if (task.timer_is_running) return ok(withCurrentSeconds(task));
    const { data, error } = await admin
      .from("focusos_tasks")
      .update({ timer_is_running: true, timer_start_time: Date.now() })
      .eq("user_id", userId)
      .eq("id", args.id)
      .select()
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("Task not found");
    return ok(withCurrentSeconds(data));
  },
});

mcp.tool("stop_task_timer", {
  description:
    "Pause the timer on a task you own, preserving accumulated time. No-op if not running. Returns the task row with computed current_seconds.",
  inputSchema: z.object({ id: z.string() }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    const { data: task, error: selErr } = await fetchTask(userId, args.id);
    if (selErr) return err(selErr.message);
    if (!task) return err("Task not found");
    if (!task.timer_is_running) return ok(withCurrentSeconds(task));
    const start = task.timer_start_time ? Number(task.timer_start_time) : Date.now();
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const newTotal = Number(task.timer_total_seconds ?? 0) + Math.max(0, elapsed);
    const { data, error } = await admin
      .from("focusos_tasks")
      .update({
        timer_total_seconds: newTotal,
        timer_is_running: false,
        timer_start_time: null,
      })
      .eq("user_id", userId)
      .eq("id", args.id)
      .select()
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("Task not found");
    return ok(withCurrentSeconds(data));
  },
});

mcp.tool("reset_task_timer", {
  description:
    "Reset the timer on a task you own to zero and stopped. Returns the task row with computed current_seconds.",
  inputSchema: z.object({ id: z.string() }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    const { data, error } = await admin
      .from("focusos_tasks")
      .update({
        timer_total_seconds: 0,
        timer_is_running: false,
        timer_start_time: null,
      })
      .eq("user_id", userId)
      .eq("id", args.id)
      .select()
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("Task not found");
    return ok(withCurrentSeconds(data));
  },
});

// ── IMAGE TOOLS ───────────────────────────────────────────────────────────────
mcp.tool("get_task_images", {
  description:
    "List images attached to a task. Returns [{ path, url, legacy }]. Storage-backed entries include a public URL; legacy base64 entries return url=null and a truncated path preview.",
  inputSchema: z.object({ id: z.string() }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    const { data, error } = await admin
      .from("focusos_tasks")
      .select("id, images")
      .eq("user_id", userId)
      .eq("id", args.id)
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("Task not found");
    const images: string[] = Array.isArray((data as any).images) ? (data as any).images : [];
    const out = images.map((entry) =>
      isBase64Entry(entry)
        ? { path: previewBase64Path(entry), url: null, legacy: true }
        : { path: entry, url: publicUrlFor(entry), legacy: false },
    );
    return ok(out);
  },
});

mcp.tool("add_task_image", {
  description:
    "Attach an image to a task. Provide exactly one of image_url (https URL) or image_base64 (data URL). Max 10MB. Allowed mime: image/png, image/jpeg, image/webp, image/gif.",
  inputSchema: z.object({
    task_id: z.string(),
    image_url: z.string().url().optional(),
    image_base64: z.string().optional(),
    filename: z.string().optional(),
  }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    const hasUrl = !!args.image_url;
    const hasB64 = !!args.image_base64;
    if (hasUrl === hasB64) {
      return err("Provide exactly one of image_url or image_base64");
    }

    // Verify task ownership
    const { data: task, error: taskErr } = await admin
      .from("focusos_tasks")
      .select("id, images")
      .eq("user_id", userId)
      .eq("id", args.task_id)
      .maybeSingle();
    if (taskErr) return err(taskErr.message);
    if (!task) return err("Task not found");

    // Resolve bytes + mime
    let bytes: Uint8Array;
    let mime: string;
    try {
      if (hasUrl) {
        const resp = await fetch(args.image_url!);
        if (!resp.ok) return err(`Fetch failed: HTTP ${resp.status}`);
        mime = (resp.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        const buf = await resp.arrayBuffer();
        bytes = new Uint8Array(buf);
      } else {
        const decoded = base64ToBytes(args.image_base64!);
        bytes = decoded.bytes;
        mime = decoded.mime.toLowerCase();
      }
    } catch (e) {
      return err(`Could not read image: ${(e as Error).message}`);
    }

    if (!ALLOWED_MIME.has(mime)) {
      return err(`Unsupported mime type: ${mime || "unknown"}`);
    }
    if (bytes.byteLength === 0) return err("Empty image");
    if (bytes.byteLength > MAX_BYTES) {
      return err(`Image too large: ${bytes.byteLength} bytes (max ${MAX_BYTES})`);
    }

    const path = buildStoragePath(userId, extFromMime(mime));
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: mime,
      cacheControl: "3600",
      upsert: false,
    });
    if (upErr) return err(`Upload failed: ${upErr.message}`);

    const existing: string[] = Array.isArray((task as any).images) ? (task as any).images : [];
    const next = [...existing, path];
    const { error: updErr } = await admin
      .from("focusos_tasks")
      .update({ images: next })
      .eq("user_id", userId)
      .eq("id", args.task_id);
    if (updErr) {
      // Best-effort cleanup to avoid orphan
      await admin.storage.from(BUCKET).remove([path]).catch(() => {});
      return err(`Attach failed: ${updErr.message}`);
    }

    return ok({ path, url: publicUrlFor(path) });
  },
});

mcp.tool("remove_task_image", {
  description:
    "Detach and delete an image from a task. The path must start with the authenticated user's id prefix.",
  inputSchema: z.object({ task_id: z.string(), path: z.string() }),
  handler: async (args, ctx) => {
    const userId = getUserId(ctx);
    if (!args.path.startsWith(`${userId}/`)) {
      return err("Path is outside your user folder");
    }

    const { data: task, error: taskErr } = await admin
      .from("focusos_tasks")
      .select("id, images")
      .eq("user_id", userId)
      .eq("id", args.task_id)
      .maybeSingle();
    if (taskErr) return err(taskErr.message);
    if (!task) return err("Task not found");

    const existing: string[] = Array.isArray((task as any).images) ? (task as any).images : [];
    if (!existing.includes(args.path)) {
      return err("Image is not attached to this task");
    }

    const { error: rmErr } = await admin.storage.from(BUCKET).remove([args.path]);
    if (rmErr && !/not\s*found/i.test(rmErr.message)) {
      return err(`Storage remove failed: ${rmErr.message}`);
    }

    const next = existing.filter((p) => p !== args.path);
    const { error: updErr } = await admin
      .from("focusos_tasks")
      .update({ images: next })
      .eq("user_id", userId)
      .eq("id", args.task_id);
    if (updErr) return err(`Detach failed: ${updErr.message}`);

    return ok({ removed: true, path: args.path });
  },
});

// ── HTTP wrapper ──────────────────────────────────────────────────────────────
const transport = new StreamableHttpTransport();
const httpHandler = transport.bind(mcp);
const app = new Hono();

app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  await next();
  for (const [k, v] of Object.entries(corsHeaders)) c.res.headers.set(k, v);
});

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": WWW_AUTHENTICATE,
    },
  });
}

app.all("/*", async (c) => {
  // Public OAuth discovery — matched by suffix because Supabase mounts this
  // function under /functions/v1/focusos-mcp, so Hono sees the prefixed path.
  const path = c.req.path;
  if (path.endsWith("/.well-known/oauth-protected-resource")) {
    return c.json({
      resource: RESOURCE_URL,
      authorization_servers: [WORKOS_ISSUER],
      bearer_methods_supported: ["header"],
    });
  }
  if (path.endsWith("/.well-known/oauth-authorization-server")) {
    try {
      const res = await fetch(AS_METADATA_URL);
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      return c.json({ error: "Failed to fetch authorization server metadata" }, 502);
    }
  }

  const authHeader = c.req.header("authorization") ?? "";
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return unauthorized("Missing bearer token");
  }
  const token = m[1].trim();
  // Try WorkOS JWT first; fall back to static focusos_api_tokens bearer.
  let userId = await resolveUserIdFromWorkOSToken(token);
  if (!userId) userId = await resolveUserIdFromToken(token);
  if (!userId) {
    return unauthorized("Invalid or revoked token");
  }
  // Pass userId to every tool handler via authInfo.extra.
  return await httpHandler(c.req.raw, {
    authInfo: { token, scopes: [], extra: { userId } },
  });
});

Deno.serve(app.fetch);