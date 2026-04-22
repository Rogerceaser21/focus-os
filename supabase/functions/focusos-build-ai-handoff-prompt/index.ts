import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface TaskInput {
  title: string;
  description?: string;
  priority?: string;
  dueDate?: string;
  projectName?: string;
}

interface RequestBody {
  task: TaskInput;
  userContext?: string;
  imageUrls?: string[];
  targetProvider?: string;
}

const SYSTEM_PROMPT = `You convert a TASK (the primary subject) plus optional user context into a high-quality prompt for an AI assistant (ChatGPT, Claude, Gemini, or Perplexity).

CRITICAL RULES:
- The TASK TITLE and TASK DESCRIPTION are the PRIMARY subject. The receiving AI must clearly understand what the user is working on.
- If a TASK DESCRIPTION is provided, you MUST quote it VERBATIM (every word, every bullet, every line) inside a "## Task description (verbatim)" section. Do NOT summarize, paraphrase, shorten, or omit any part of it. Preserve the original formatting (bullets, numbering, line breaks).
- The USER CONTEXT is supplementary — it explains what the user wants help with regarding the task. Treat it as the user's request, not as the goal itself.
- Output ONLY the final prompt text — no preamble, no commentary, no markdown code fences around the whole thing.
- Structure with these Markdown headings in order:
  ## Goal  (1–2 sentences derived from task title + user context)
  ## Background  (task title, project, priority, due date)
  ## Task description (verbatim)  (the full description, untouched — omit this section ONLY if no description was provided)
  ## What I need from you  (concrete request, derived from user context if present, otherwise inferred from the task)
  ## Images  (only if image URLs were provided — list them and tell the assistant to view them)
  ## Constraints  (any constraints, plus: ask for concrete, actionable output)
- Keep it under 2500 words total, but NEVER truncate the verbatim description to fit.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    if (!body?.task?.title) {
      return new Response(JSON.stringify({ error: "task.title is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY =
      Deno.env.get("GOOGLE_GEMINI_API_KEY") || Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GOOGLE_GEMINI_API_KEY is not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const hasDescription = !!body.task.description?.trim();
    const userPayload = [
      `Target AI: ${body.targetProvider || "general assistant"}`,
      "",
      "=== TASK (PRIMARY SUBJECT) ===",
      `Title: ${body.task.title}`,
      body.task.projectName ? `Project: ${body.task.projectName}` : null,
      body.task.priority ? `Priority: ${body.task.priority}` : null,
      body.task.dueDate ? `Due date: ${body.task.dueDate}` : null,
      "",
      hasDescription
        ? `=== TASK DESCRIPTION — QUOTE VERBATIM, DO NOT SUMMARIZE ===\n${body.task.description}\n=== END TASK DESCRIPTION ===`
        : "(no description provided)",
      "",
      "=== USER CONTEXT (supplementary — what the user wants help with) ===",
      body.userContext?.trim() || "(none provided — infer a reasonable request from the task)",
      body.imageUrls && body.imageUrls.length
        ? `\n=== IMAGE URLS (attached to task) ===\n${body.imageUrls.join("\n")}`
        : "",
      "",
      `Now produce the optimized prompt. Remember: include the task description VERBATIM under "## Task description (verbatim)"${hasDescription ? "" : " (skip this section since no description was provided)"}.`,
    ]
      .filter(Boolean)
      .join("\n");

    // Direct Gemini API call (gemini-2.5-flash) — no Lovable AI gateway.
    const geminiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
      GEMINI_API_KEY;

    const geminiResp = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          { role: "user", parts: [{ text: userPayload }] },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
        },
      }),
    });

    if (!geminiResp.ok) {
      const t = await geminiResp.text();
      console.error("Gemini error", geminiResp.status, t);
      return new Response(
        JSON.stringify({ error: `Gemini API error: ${geminiResp.status}` }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data = await geminiResp.json();
    const prompt: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Empty response from Gemini" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ prompt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("focusos-build-ai-handoff-prompt error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});