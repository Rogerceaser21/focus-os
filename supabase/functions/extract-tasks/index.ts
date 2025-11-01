import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcription } = await req.json();
    
    if (!transcription) {
      throw new Error("No transcription provided");
    }

    console.log('Extracting tasks from transcription...');

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `You are a task extraction assistant. Analyze the user's voice transcription and extract:
1. A project name (if mentioned or implied)
2. Individual tasks mentioned

Special rules:
- If the user mentions "today's to do list", "today's tasks", or similar, set project name to "Today's To-Do List"
- Extract each distinct task as a separate item
- Infer reasonable project names if not explicitly stated (e.g., "Car inspiration" from "For my car inspiration project...")
- Each task should be clear and actionable`;

    const body = {
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: transcription }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "extract_project_tasks",
            description: "Extract project name and tasks from voice transcription",
            parameters: {
              type: "object",
              properties: {
                projectName: {
                  type: "string",
                  description: "The project name, either mentioned or inferred from context"
                },
                tasks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { 
                        type: "string",
                        description: "Clear, actionable task title"
                      },
                      description: {
                        type: "string",
                        description: "Optional task description with additional context"
                      },
                      priority: {
                        type: "string",
                        enum: ["low", "medium", "high", "urgent"],
                        description: "Task priority level"
                      }
                    },
                    required: ["title", "priority"],
                    additionalProperties: false
                  }
                }
              },
              required: ["projectName", "tasks"],
              additionalProperties: false
            }
          }
        }
      ],
      tool_choice: { type: "function", function: { name: "extract_project_tasks" } }
    };

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add funds to your Lovable AI workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    console.log('AI response:', JSON.stringify(data));

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("No tool call in AI response");
    }

    const extractedData = JSON.parse(toolCall.function.arguments);
    console.log('Extracted data:', extractedData);

    return new Response(
      JSON.stringify(extractedData),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Extract tasks error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
