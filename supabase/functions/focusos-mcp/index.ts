// Focus OS MCP Server
// Hard-allowlisted to focusos_* tables only. Every query is scoped by user_id
// resolved from the bearer token's SHA-256 hash in focusos_api_tokens.

import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    return ok(data);
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
    priority: z.enum(["low", "medium", "high"]).optional(),
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
    priority: z.enum(["low", "medium", "high"]).optional(),
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

// ── HTTP wrapper ──────────────────────────────────────────────────────────────
const transport = new StreamableHttpTransport();
const httpHandler = transport.bind(mcp);
const app = new Hono();

app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  await next();
  for (const [k, v] of Object.entries(corsHeaders)) c.res.headers.set(k, v);
});

app.all("/*", async (c) => {
  const authHeader = c.req.header("authorization") ?? "";
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return c.json({ error: "Missing bearer token" }, 401);
  }
  const token = m[1].trim();
  const userId = await resolveUserIdFromToken(token);
  if (!userId) {
    return c.json({ error: "Invalid or revoked token" }, 401);
  }
  // Pass userId to every tool handler via authInfo.extra.
  return await httpHandler(c.req.raw, {
    authInfo: { token, scopes: [], extra: { userId } },
  });
});

Deno.serve(app.fetch);