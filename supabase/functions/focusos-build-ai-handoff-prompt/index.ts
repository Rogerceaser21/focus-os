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

const SYSTEM_PROMPT = `You convert a task + user context into a high-quality prompt for an AI assistant (ChatGPT, Claude, Gemini, or Perplexity).

Rules:
- Output ONLY the final prompt text — no preamble, no commentary, no markdown code fences.
- Structure the prompt with clear sections: Goal → Context → Task details → Specific request → Constraints.
- Use Markdown headings and bullet points for readability.
- If image URLs are provided, reference them inline and instruct the assistant to view them.
- Be specific and actionable. Ask the assistant for concrete output.
- Keep it under 1500 words.`;

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

    const userPayload = [
      `Target AI: ${body.targetProvider || "general assistant"}`,
      "",
      "=== TASK ===",
      `Title: ${body.task.title}`,
      body.task.description ? `Description:\n${body.task.description}` : null,
      body.task.priority ? `Priority: ${body.task.priority}` : null,
      body.task.dueDate ? `Due date: ${body.task.dueDate}` : null,
      body.task.projectName ? `Project: ${body.task.projectName}` : null,
      "",
      "=== USER CONTEXT (what they're trying to accomplish) ===",
      body.userContext?.trim() || "(none provided — infer reasonable goal from the task)",
      body.imageUrls && body.imageUrls.length
        ? `\n=== IMAGE URLS (attached to task) ===\n${body.imageUrls.join("\n")}`
        : "",
      "",
      "Now produce the optimized prompt.",
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