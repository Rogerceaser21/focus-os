import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { TaskPriority } from '@/types/task';

export interface BrainDumpTask {
  id: string;
  title: string;
  description?: string;
  priority: TaskPriority;
}

type ConnectionState = 'idle' | 'connecting' | 'listening' | 'error';

export function useBrainDumpLive() {
  const [tasks, setTasks] = useState<BrainDumpTask[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [transcript, setTranscript] = useState('');
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const taskCounterRef = useRef(0);

  const cleanup = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const start = useCallback(async (mode: 'new-project' | 'existing-project' | 'today') => {
    setConnectionState('connecting');
    setTasks([]);
    setTranscript('');
    taskCounterRef.current = 0;

    try {
      // 1. Get config from edge function
      const { data, error } = await supabase.functions.invoke('get-brain-dump-config');
      if (error || !data?.apiKey) {
        throw new Error(error?.message || 'Failed to get config');
      }

      const { apiKey, wsUrl, model } = data;

      // 2. Get mic access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      // 3. Connect WebSocket to Gemini Live
      const fullUrl = `${wsUrl}?key=${apiKey}`;
      const ws = new WebSocket(fullUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Send setup message
        const modeInstructions = mode === 'new-project'
          ? 'The user is brain-dumping ideas for a NEW project. Extract a project name and individual tasks. Use add_task for each task you identify. Listen carefully and extract actionable tasks from what the user says.'
          : mode === 'today'
          ? 'The user is brain-dumping tasks for their today to-do list. Use add_task for each task you identify. Focus on actionable daily tasks.'
          : 'The user is adding tasks to an existing project. Use add_task for each task you identify. Focus on actionable tasks.';

        const setupMessage = {
          setup: {
            model,
            generationConfig: {
              responseModalities: ["TEXT"],
              temperature: 0.3,
            },
            systemInstruction: {
              parts: [{
                text: `You are a task extraction assistant for a productivity app called "Brain Dump". ${modeInstructions}

IMPORTANT RULES:
- Call add_task immediately when you identify a task from the user's speech
- Extract clear, actionable task titles (keep them concise, under 10 words)
- Add a brief description if the user provides additional context
- Assign priority based on urgency cues: "urgent", "important", "ASAP" → urgent/high; normal items → medium; "whenever", "nice to have" → low
- Do NOT wait for the user to finish speaking before extracting tasks - extract them as soon as you identify them
- Do NOT speak back or generate audio - only use tool calls
- If the user corrects or removes a task, use update_task or remove_task accordingly`
              }]
            },
            tools: [{
              functionDeclarations: [
                {
                  name: "add_task",
                  description: "Add a new task identified from the user's speech",
                  parameters: {
                    type: "OBJECT",
                    properties: {
                      title: { type: "STRING", description: "Concise task title (under 10 words)" },
                      description: { type: "STRING", description: "Brief task description with additional context" },
                      priority: { type: "STRING", enum: ["low", "medium", "high", "urgent"], description: "Task priority" },
                    },
                    required: ["title", "priority"],
                  },
                },
                {
                  name: "update_task",
                  description: "Update an existing task if the user corrects it",
                  parameters: {
                    type: "OBJECT",
                    properties: {
                      task_id: { type: "STRING", description: "The task ID to update" },
                      title: { type: "STRING", description: "Updated task title" },
                      description: { type: "STRING", description: "Updated description" },
                      priority: { type: "STRING", enum: ["low", "medium", "high", "urgent"], description: "Updated priority" },
                    },
                    required: ["task_id"],
                  },
                },
                {
                  name: "remove_task",
                  description: "Remove a task if the user says to remove or cancel it",
                  parameters: {
                    type: "OBJECT",
                    properties: {
                      task_id: { type: "STRING", description: "The task ID to remove" },
                    },
                    required: ["task_id"],
                  },
                },
              ],
            }],
          },
        };

        ws.send(JSON.stringify(setupMessage));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Handle setup complete
          if (msg.setupComplete) {
            setConnectionState('listening');
            startAudioCapture(ws, stream);
            return;
          }

          // Handle server content with tool calls
          if (msg.serverContent) {
            // Extract any text parts for transcript
            const parts = msg.serverContent?.modelTurn?.parts || [];
            for (const part of parts) {
              if (part.text) {
                setTranscript(prev => prev + part.text);
              }
            }
          }

          // Handle tool calls
          if (msg.toolCall) {
            const functionCalls = msg.toolCall.functionCalls || [];
            const functionResponses: any[] = [];

            for (const fc of functionCalls) {
              const args = fc.args || {};

              if (fc.name === 'add_task') {
                const taskId = `brain-dump-${++taskCounterRef.current}`;
                const newTask: BrainDumpTask = {
                  id: taskId,
                  title: args.title || 'Untitled Task',
                  description: args.description,
                  priority: (args.priority as TaskPriority) || 'medium',
                };
                setTasks(prev => [...prev, newTask]);
                functionResponses.push({
                  id: fc.id,
                  name: fc.name,
                  response: { result: "ok", task_id: taskId },
                });
              } else if (fc.name === 'update_task') {
                setTasks(prev => prev.map(t => {
                  if (t.id === args.task_id) {
                    return {
                      ...t,
                      ...(args.title && { title: args.title }),
                      ...(args.description !== undefined && { description: args.description }),
                      ...(args.priority && { priority: args.priority as TaskPriority }),
                    };
                  }
                  return t;
                }));
                functionResponses.push({
                  id: fc.id,
                  name: fc.name,
                  response: { result: "ok" },
                });
              } else if (fc.name === 'remove_task') {
                setTasks(prev => prev.filter(t => t.id !== args.task_id));
                functionResponses.push({
                  id: fc.id,
                  name: fc.name,
                  response: { result: "ok" },
                });
              }
            }

            // Send tool responses back
            if (functionResponses.length > 0 && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                toolResponse: { functionResponses },
              }));
            }
          }
        } catch (e) {
          console.error('Error parsing Gemini message:', e);
        }
      };

      ws.onerror = (e) => {
        console.error('WebSocket error:', e);
        setConnectionState('error');
      };

      ws.onclose = () => {
        if (connectionState !== 'idle') {
          setConnectionState('idle');
        }
      };
    } catch (error: any) {
      console.error('Brain dump start error:', error);
      setConnectionState('error');
      cleanup();
      throw error;
    }
  }, [cleanup, connectionState]);

  const startAudioCapture = useCallback(async (ws: WebSocket, stream: MediaStream) => {
    try {
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      // Use ScriptProcessorNode as fallback (AudioWorklet requires serving a separate file)
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        // Convert float32 to int16 PCM
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Convert to base64
        const uint8 = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < uint8.length; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        const base64 = btoa(binary);

        // Send to Gemini
        ws.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{
              mimeType: "audio/pcm;rate=16000",
              data: base64,
            }],
          },
        }));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (error) {
      console.error('Audio capture error:', error);
      setConnectionState('error');
    }
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setConnectionState('idle');
  }, [cleanup]);

  const updateTask = useCallback((taskId: string, updates: Partial<BrainDumpTask>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
  }, []);

  const removeTask = useCallback((taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
  }, []);

  const resetTasks = useCallback(() => {
    setTasks([]);
    setTranscript('');
    taskCounterRef.current = 0;
  }, []);

  return {
    tasks,
    connectionState,
    transcript,
    start,
    stop,
    updateTask,
    removeTask,
    resetTasks,
  };
}
