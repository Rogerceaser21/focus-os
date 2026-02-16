import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { supabase } from '@/integrations/supabase/client';
import type { TaskPriority } from '@/types/task';

export interface BrainDumpTask {
  id: string;
  title: string;
  description?: string;
  priority: TaskPriority;
}

type ConnectionState = 'idle' | 'connecting' | 'listening' | 'error';

// Audio helpers
function createPcmBlob(float32Data: Float32Array): { mimeType: string; data: string } {
  const pcm16 = new Int16Array(float32Data.length);
  for (let i = 0; i < float32Data.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Data[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const uint8 = new Uint8Array(pcm16.buffer);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return { mimeType: 'audio/pcm;rate=16000', data: btoa(binary) };
}

export function useBrainDumpLive() {
  const [tasks, setTasks] = useState<BrainDumpTask[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [transcript, setTranscript] = useState('');

  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const taskCounterRef = useRef(0);

  const cleanup = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    sessionRef.current = null;
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
      // 1. Get API key from edge function
      const { data, error } = await supabase.functions.invoke('get-brain-dump-config');
      if (error || !data?.apiKey) {
        throw new Error(error?.message || 'Failed to get config');
      }
      const { apiKey, model: configModel } = data;

      // 2. Get mic access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      // 3. Build system instruction based on mode
      const modeInstructions = mode === 'new-project'
        ? 'The user is brain-dumping ideas for a NEW project. Extract individual tasks. Use add_task for each task you identify.'
        : mode === 'today'
        ? 'The user is brain-dumping tasks for their today to-do list. Use add_task for each task you identify. Focus on actionable daily tasks.'
        : 'The user is adding tasks to an existing project. Use add_task for each task you identify.';

      const systemInstruction = `You are a task extraction assistant for a productivity app called "Brain Dump". ${modeInstructions}

IMPORTANT RULES:
- Call add_task immediately when you identify a task from the user's speech
- Extract clear, actionable task titles (keep them concise, under 10 words)
- Add a brief description if the user provides additional context
- Assign priority based on urgency cues: "urgent", "important", "ASAP" → urgent/high; normal items → medium; "whenever", "nice to have" → low
- Do NOT wait for the user to finish speaking before extracting tasks
- You are in SILENT mode. Do NOT speak unless absolutely necessary to clarify an ambiguity. Execute tools and output as little audio as possible.
- If the user corrects or removes a task, use update_task or remove_task accordingly`;

      // 4. Define tools using SDK types
      const tools = [{
        functionDeclarations: [
          {
            name: 'add_task',
            description: 'Add a new task identified from the user\'s speech',
            parameters: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: 'Concise task title (under 10 words)' },
                description: { type: Type.STRING, description: 'Brief task description with additional context' },
                priority: { type: Type.STRING, description: 'Task priority: low, medium, high, or urgent' },
              },
              required: ['title', 'priority'],
            },
          },
          {
            name: 'update_task',
            description: 'Update an existing task if the user corrects it',
            parameters: {
              type: Type.OBJECT,
              properties: {
                searchPhrase: { type: Type.STRING, description: 'A word or phrase to find the existing task' },
                title: { type: Type.STRING, description: 'Updated task title' },
                description: { type: Type.STRING, description: 'Updated description' },
                priority: { type: Type.STRING, description: 'Updated priority: low, medium, high, or urgent' },
              },
              required: ['searchPhrase'],
            },
          },
          {
            name: 'remove_task',
            description: 'Remove a task if the user says to remove or cancel it',
            parameters: {
              type: Type.OBJECT,
              properties: {
                searchPhrase: { type: Type.STRING, description: 'A word or phrase to find the task to remove' },
              },
              required: ['searchPhrase'],
            },
          },
        ],
      }];

      // 5. Connect using the SDK
      const ai = new GoogleGenAI({ apiKey });

      const session = await ai.live.connect({
        model: configModel || 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          tools,
        },
        callbacks: {
          onopen: () => {
            console.log('Gemini Live connected');
            setConnectionState('listening');

            // Start audio capture
            if (!streamRef.current) return;
            const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            inputAudioContextRef.current = inputCtx;

            const src = inputCtx.createMediaStreamSource(streamRef.current);
            sourceRef.current = src;

            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              if (sessionRef.current) {
                sessionRef.current.sendRealtimeInput({ media: pcmBlob });
              }
            };

            src.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (message: any) => {
            // Handle tool calls
            if (message.toolCall) {
              const functionCalls = message.toolCall.functionCalls || [];
              for (const fc of functionCalls) {
                const args = fc.args || {};
                console.log('Tool call received:', fc.name, args);

                let result: any = { result: 'ok' };

                if (fc.name === 'add_task') {
                  const taskId = `brain-dump-${++taskCounterRef.current}`;
                  const newTask: BrainDumpTask = {
                    id: taskId,
                    title: args.title || 'Untitled Task',
                    description: args.description,
                    priority: (args.priority as TaskPriority) || 'medium',
                  };
                  setTasks(prev => [...prev, newTask]);
                  result = { result: 'ok', task_id: taskId };
                } else if (fc.name === 'update_task') {
                  const searchPhrase = (args.searchPhrase || '').toLowerCase();
                  setTasks(prev => prev.map(t => {
                    if (t.title.toLowerCase().includes(searchPhrase)) {
                      return {
                        ...t,
                        ...(args.title && { title: args.title }),
                        ...(args.description !== undefined && { description: args.description }),
                        ...(args.priority && { priority: args.priority as TaskPriority }),
                      };
                    }
                    return t;
                  }));
                } else if (fc.name === 'remove_task') {
                  const searchPhrase = (args.searchPhrase || '').toLowerCase();
                  setTasks(prev => prev.filter(t => !t.title.toLowerCase().includes(searchPhrase)));
                }

                // Send tool response back
                if (sessionRef.current) {
                  sessionRef.current.sendToolResponse({
                    functionResponses: {
                      id: fc.id,
                      name: fc.name,
                      response: result,
                    },
                  });
                }
              }
            }
          },
          onclose: () => {
            console.log('Gemini Live session closed');
            setConnectionState(prev => prev === 'connecting' ? 'error' : 'idle');
          },
          onerror: (err: any) => {
            console.error('Gemini Live error:', err);
            setConnectionState('error');
            cleanup();
          },
        },
      });

      sessionRef.current = session;
    } catch (error: any) {
      console.error('Brain dump start error:', error);
      setConnectionState('error');
      cleanup();
      throw error;
    }
  }, [cleanup]);

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
