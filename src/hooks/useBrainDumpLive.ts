import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { supabase } from '@/integrations/supabase/client';
import type { TaskPriority } from '@/types/task';

export interface BrainDumpTask {
  id: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  destination: 'today' | 'existing-project' | 'new-project';
  projectName?: string; // For existing or new project
  projectId?: string;   // For existing project match
  startDate?: string;   // ISO date string e.g. "2026-02-22"
  endDate?: string;
  dueDate?: string;
}

type ConnectionState = 'idle' | 'connecting' | 'listening' | 'error';

export interface ProjectInfo {
  id: string;
  name: string;
}

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

// Get today's date info for the system prompt
function getTodayDateString(): string {
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = days[now.getDay()];
  const iso = now.toISOString().split('T')[0];
  return `${iso} (${dayName})`;
}

export function useBrainDumpLive() {
  const [tasks, setTasks] = useState<BrainDumpTask[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');

  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const taskCounterRef = useRef(0);
  const projectsRef = useRef<ProjectInfo[]>([]);
  const newProjectsRef = useRef<Map<string, string>>(new Map()); // normalized name -> display name

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

  const start = useCallback(async (projects: ProjectInfo[]) => {
    setConnectionState('connecting');
    setTasks([]);
    taskCounterRef.current = 0;
    projectsRef.current = projects;
    newProjectsRef.current = new Map();

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

      // 3. Build system instruction with project list
      const projectListStr = projects.length > 0
        ? `\nExisting projects: ${projects.map(p => `"${p.name}"`).join(', ')}`
        : '\nNo existing projects yet.';

      const todayStr = getTodayDateString();

      const systemInstruction = `You are a task extraction assistant for a productivity app called "Brain Dump". The user will speak freely about tasks they need to do. Your job is to extract tasks and route them to the correct destination.
${projectListStr}

Today's date is: ${todayStr}.
When the user mentions relative dates like "next Friday", "end of the month", "in 3 days", convert them to ISO format (YYYY-MM-DD) based on today's date.

ROUTING RULES:
- If the user mentions a specific existing project name, use add_task_to_project with that project's name
- If the user says "new project" or mentions a project that doesn't exist, use create_project_and_add_task
- If no project context is given, default to add_task_to_today
- Act decisively. Do NOT ask clarifying questions. Just pick the best match.
- If a project name is close but not exact (e.g. "marketing" vs "Marketing Plan"), match to the closest existing project

TASK EXTRACTION RULES:
- Call the appropriate tool immediately when you identify a task
- Extract clear, actionable task titles (keep them concise, under 10 words)
- Add a brief description if the user provides additional context
- Assign priority based on urgency cues: "urgent", "important", "ASAP" → urgent/high; normal items → medium; "whenever", "nice to have" → low
- Do NOT wait for the user to finish speaking before extracting tasks
- If the user mentions a start date, end date, or due date, extract it as an ISO date (YYYY-MM-DD) and include start_date, end_date, and/or due_date in the tool call

CORRECTION RULES:
- If the user asks to MOVE a task from one place to another, use the move_task tool with the task_id you received when that task was created. Do NOT simulate a move by calling add_task + remove_task. That causes duplicates.
- If the user says "actually put that in [project]" or "move [task] to [project]", this is always a move_task call.
- For update_task and remove_task: always use task_id if you have it. Only fall back to searchPhrase if you do not have the task_id.
- If the user corrects or removes a task, use update_task or remove_task accordingly

SILENT MODE:
- You are in SILENT mode. Do NOT speak. Execute tools and output as little audio as possible.`;

      // 4. Define tools
      const dateProperties = {
        start_date: { type: Type.STRING, description: 'Task start date in ISO format (YYYY-MM-DD)' },
        end_date: { type: Type.STRING, description: 'Task end date in ISO format (YYYY-MM-DD)' },
        due_date: { type: Type.STRING, description: 'Task due date in ISO format (YYYY-MM-DD)' },
      };

      const tools = [{
        functionDeclarations: [
          {
            name: 'add_task_to_today',
            description: "Add a task to today's to-do list. Use when no specific project is mentioned.",
            parameters: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: 'Concise task title (under 10 words)' },
                description: { type: Type.STRING, description: 'Brief task description' },
                priority: { type: Type.STRING, description: 'Task priority: low, medium, high, or urgent' },
                ...dateProperties,
              },
              required: ['title', 'priority'],
            },
          },
          {
            name: 'add_task_to_project',
            description: 'Add a task to an existing project. Use when the user mentions a known project.',
            parameters: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: 'Concise task title (under 10 words)' },
                description: { type: Type.STRING, description: 'Brief task description' },
                priority: { type: Type.STRING, description: 'Task priority: low, medium, high, or urgent' },
                project_name: { type: Type.STRING, description: 'Name of the existing project to add the task to' },
                ...dateProperties,
              },
              required: ['title', 'priority', 'project_name'],
            },
          },
          {
            name: 'create_project_and_add_task',
            description: 'Create a new project and add a task to it. Use when the user mentions a project that does not exist or explicitly says "new project".',
            parameters: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: 'Concise task title (under 10 words)' },
                description: { type: Type.STRING, description: 'Brief task description' },
                priority: { type: Type.STRING, description: 'Task priority: low, medium, high, or urgent' },
                project_name: { type: Type.STRING, description: 'Name for the new project' },
                ...dateProperties,
              },
              required: ['title', 'priority', 'project_name'],
            },
          },
          {
            name: 'move_task',
            description: 'Move an existing task to a different destination or project. Use this instead of add+remove when the user wants to relocate a task. Never use add_task + remove_task to simulate a move.',
            parameters: {
              type: Type.OBJECT,
              properties: {
                task_id: { type: Type.STRING, description: 'The exact task_id returned when the task was created' },
                destination: { type: Type.STRING, description: 'New destination: today, existing-project, or new-project' },
                project_name: { type: Type.STRING, description: 'Name of the target project (required when destination is existing-project or new-project)' },
              },
              required: ['task_id', 'destination'],
            },
          },
          {
            name: 'update_task',
            description: 'Update an existing task if the user corrects it. Prefer task_id for precise matching.',
            parameters: {
              type: Type.OBJECT,
              properties: {
                task_id: { type: Type.STRING, description: 'The exact task_id returned when the task was created. Use this for precise matching.' },
                searchPhrase: { type: Type.STRING, description: 'A word or phrase to find the existing task — only use if task_id is not available' },
                title: { type: Type.STRING, description: 'Updated task title' },
                description: { type: Type.STRING, description: 'Updated description' },
                priority: { type: Type.STRING, description: 'Updated priority: low, medium, high, or urgent' },
                ...dateProperties,
              },
              required: [],
            },
          },
          {
            name: 'remove_task',
            description: 'Remove a task if the user says to remove or cancel it. Prefer task_id for precise matching.',
            parameters: {
              type: Type.OBJECT,
              properties: {
                task_id: { type: Type.STRING, description: 'The exact task_id returned when the task was created. Use this for precise matching.' },
                searchPhrase: { type: Type.STRING, description: 'A word or phrase to find the task to remove — only use if task_id is not available' },
              },
              required: [],
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
            if (message.toolCall) {
              const functionCalls = message.toolCall.functionCalls || [];
              for (const fc of functionCalls) {
                const args = fc.args || {};
                console.log('Tool call received:', fc.name, args);

                let result: any = { result: 'ok' };

                if (fc.name === 'add_task_to_today') {
                  const taskId = `brain-dump-${++taskCounterRef.current}`;
                  const newTask: BrainDumpTask = {
                    id: taskId,
                    title: args.title || 'Untitled Task',
                    description: args.description,
                    priority: (args.priority as TaskPriority) || 'medium',
                    destination: 'today',
                    ...(args.start_date && { startDate: args.start_date }),
                    ...(args.end_date && { endDate: args.end_date }),
                    ...(args.due_date && { dueDate: args.due_date }),
                  };
                  setTasks(prev => [...prev, newTask]);
                  result = { result: 'ok', task_id: taskId };

                } else if (fc.name === 'add_task_to_project') {
                  const projectName = args.project_name || '';
                  // Find matching project (case-insensitive)
                  const match = projectsRef.current.find(
                    p => p.name.toLowerCase() === projectName.toLowerCase()
                  );
                  const taskId = `brain-dump-${++taskCounterRef.current}`;
                  const newTask: BrainDumpTask = {
                    id: taskId,
                    title: args.title || 'Untitled Task',
                    description: args.description,
                    priority: (args.priority as TaskPriority) || 'medium',
                    destination: match ? 'existing-project' : 'today',
                    projectName: match?.name || projectName,
                    projectId: match?.id,
                    ...(args.start_date && { startDate: args.start_date }),
                    ...(args.end_date && { endDate: args.end_date }),
                    ...(args.due_date && { dueDate: args.due_date }),
                  };
                  setTasks(prev => [...prev, newTask]);
                  result = { result: 'ok', task_id: taskId, matched_project: match?.name || 'none' };

                } else if (fc.name === 'create_project_and_add_task') {
                  const projectName = args.project_name || 'New Project';
                  const normalizedName = projectName.toLowerCase().trim();
                  
                  // Track new project names for grouping
                  if (!newProjectsRef.current.has(normalizedName)) {
                    newProjectsRef.current.set(normalizedName, projectName);
                  }

                  const taskId = `brain-dump-${++taskCounterRef.current}`;
                  const newTask: BrainDumpTask = {
                    id: taskId,
                    title: args.title || 'Untitled Task',
                    description: args.description,
                    priority: (args.priority as TaskPriority) || 'medium',
                    destination: 'new-project',
                    projectName: newProjectsRef.current.get(normalizedName) || projectName,
                    ...(args.start_date && { startDate: args.start_date }),
                    ...(args.end_date && { endDate: args.end_date }),
                    ...(args.due_date && { dueDate: args.due_date }),
                  };
                  setTasks(prev => [...prev, newTask]);
                  result = { result: 'ok', task_id: taskId, new_project: projectName };

                } else if (fc.name === 'move_task') {
                  const taskId = args.task_id as string;
                  const destination = args.destination as BrainDumpTask['destination'];
                  const projectName = args.project_name as string | undefined;

                  setTasks(prev => prev.map(t => {
                    if (t.id !== taskId) return t;

                    if (destination === 'today') {
                      return { ...t, destination: 'today', projectName: undefined, projectId: undefined };
                    } else if (destination === 'existing-project' && projectName) {
                      const match = projectsRef.current.find(
                        p => p.name.toLowerCase() === projectName.toLowerCase()
                      );
                      return {
                        ...t,
                        destination: 'existing-project',
                        projectName: match?.name || projectName,
                        projectId: match?.id,
                      };
                    } else if (destination === 'new-project' && projectName) {
                      const normalizedName = projectName.toLowerCase().trim();
                      if (!newProjectsRef.current.has(normalizedName)) {
                        newProjectsRef.current.set(normalizedName, projectName);
                      }
                      return {
                        ...t,
                        destination: 'new-project',
                        projectName: newProjectsRef.current.get(normalizedName) || projectName,
                        projectId: undefined,
                      };
                    }
                    return t;
                  }));
                  result = { result: 'ok', task_id: taskId };

                } else if (fc.name === 'update_task') {
                  const taskId = args.task_id as string | undefined;
                  const searchPhrase = (args.searchPhrase || '').toLowerCase();

                  setTasks(prev => prev.map(t => {
                    // Prefer exact task_id match; fall back to searchPhrase
                    const isMatch = taskId
                      ? t.id === taskId
                      : searchPhrase && t.title.toLowerCase().includes(searchPhrase);

                    if (!isMatch) return t;

                    return {
                      ...t,
                      ...(args.title && { title: args.title }),
                      ...(args.description !== undefined && { description: args.description }),
                      ...(args.priority && { priority: args.priority as TaskPriority }),
                      ...(args.start_date !== undefined && { startDate: args.start_date || undefined }),
                      ...(args.end_date !== undefined && { endDate: args.end_date || undefined }),
                      ...(args.due_date !== undefined && { dueDate: args.due_date || undefined }),
                    };
                  }));

                } else if (fc.name === 'remove_task') {
                  const taskId = args.task_id as string | undefined;
                  const searchPhrase = (args.searchPhrase || '').toLowerCase();

                  setTasks(prev => prev.filter(t => {
                    if (taskId) {
                      return t.id !== taskId;
                    }
                    return searchPhrase ? !t.title.toLowerCase().includes(searchPhrase) : true;
                  }));
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
    taskCounterRef.current = 0;
    newProjectsRef.current = new Map();
  }, []);

  return {
    tasks,
    connectionState,
    start,
    stop,
    updateTask,
    removeTask,
    resetTasks,
  };
}
