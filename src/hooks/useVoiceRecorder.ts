import { useState, useRef, useCallback } from 'react';

const getSupportedMimeType = (): string | undefined => {
  const types = [
    'audio/webm',
    'audio/mp4',
    'audio/ogg',
    'audio/wav',
  ];
  
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  
  return undefined; // Let browser choose default
};

export const useVoiceRecorder = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Get supported mime type
      const mimeType = getSupportedMimeType();
      
      // Create MediaRecorder with supported type or no type specified
      const options = mimeType ? { mimeType } : {};
      const mediaRecorder = new MediaRecorder(stream, options);
      
      console.log('Using mimeType:', mimeType || 'browser default');

      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Use the actual mimeType from the MediaRecorder
        const actualMimeType = mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: actualMimeType });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      throw error;
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  const reset = useCallback(() => {
    setAudioBlob(null);
    chunksRef.current = [];
  }, []);

  return {
    isRecording,
    audioBlob,
    startRecording,
    stopRecording,
    reset,
  };
};
