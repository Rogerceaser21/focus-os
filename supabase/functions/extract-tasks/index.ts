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
    const { transcription, mode = "project" } = await req.json();
    
    if (!transcription) {
      throw new Error("No transcription provided");
    }

    console.log('Extracting tasks from transcription...', { mode });

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    // Different system prompts based on mode
    const systemPrompt = mode === "tasks-only" 
      ? `You are a task extraction assistant. Extract individual tasks from the transcription.
     
Rules:
- Extract each distinct task as a separate item
- Each task should be clear and actionable
- Do NOT extract or infer a project name
- Focus only on the tasks mentioned`
      : `You are a task extraction assistant. Analyze the user's voice transcription and extract:
1. A project name (if mentioned or implied)
2. Individual tasks mentioned

Special rules:
- If the user mentions "today's to do list", "today's tasks", or similar, set project name to "Today's To-Do List"
- Extract each distinct task as a separate item
- Infer reasonable project names if not explicitly stated (e.g., "Car inspiration" from "For my car inspiration project...")
- Each task should be clear and actionable`;

    // Task schema for both modes
    const taskSchema = {
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
    };

    // Different function schemas based on mode
    const functionSchema = mode === "tasks-only"
      ? {
          name: "extract_tasks",
          description: "Extract tasks from voice transcription",
          parameters: {
            type: "object",
            properties: {
              tasks: {
                type: "array",
                items: taskSchema
              }
            },
            required: ["tasks"],
          }
        }
      : {
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
                items: taskSchema
              }
            },
            required: ["projectName", "tasks"],
          }
        };

    const body = {
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: systemPrompt + "\n\n" + transcription }] }
      ],
      tools: [
        {
          functionDeclarations: [
            {
              name: functionSchema.name,
              description: functionSchema.description,
              parameters: functionSchema.parameters
            }
          ]
        }
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [functionSchema.name]
        }
      }
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: {
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
    console.log('Gemini response:', JSON.stringify(data));

    const functionCall = data.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall)?.functionCall;
    if (!functionCall) {
      throw new Error("No function call in Gemini response");
    }

    const extractedData = functionCall.args;
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
