export type AIProvider = 'chatgpt' | 'claude' | 'gemini' | 'perplexity';
export type ImageMode = 'public_link' | 'clipboard' | 'skip';

export const PROVIDERS: Record<AIProvider, { label: string; url: (q: string) => string; short: string }> = {
  chatgpt: {
    label: 'ChatGPT',
    short: 'GPT',
    url: (q) => `https://chat.openai.com/?q=${encodeURIComponent(q)}`,
  },
  claude: {
    label: 'Claude',
    short: 'C',
    url: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}`,
  },
  gemini: {
    label: 'Gemini',
    short: 'G',
    url: (q) => `https://gemini.google.com/app?q=${encodeURIComponent(q)}`,
  },
  perplexity: {
    label: 'Perplexity',
    short: 'P',
    url: (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`,
  },
};

const URL_LIMIT = 6000;

/**
 * Open an AI provider with the given prompt. If the prompt is too long,
 * copy it to the clipboard and open a blank chat instead.
 * Returns true if the prompt was copied to the clipboard (caller should toast).
 */
export async function openProviderWithPrompt(
  provider: AIProvider,
  prompt: string
): Promise<{ copied: boolean }> {
  const cfg = PROVIDERS[provider];
  const fullUrl = cfg.url(prompt);

  if (fullUrl.length > URL_LIMIT) {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch (e) {
      console.error('Clipboard write failed', e);
    }
    const stub = cfg.url('See clipboard — paste your prompt here.');
    window.open(stub, '_blank', 'noopener,noreferrer');
    return { copied: true };
  }

  window.open(fullUrl, '_blank', 'noopener,noreferrer');
  return { copied: false };
}

/**
 * Copy an image (by URL) to the user's clipboard as a PNG.
 * Many browsers only allow PNG via ClipboardItem.
 */
export async function copyImageUrlToClipboard(imageUrl: string): Promise<void> {
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  // Convert to PNG if needed via canvas
  if (blob.type === 'image/png') {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return;
  }
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas context');
  ctx.drawImage(bitmap, 0, 0);
  const pngBlob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  );
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
}

/** Build a fallback prompt locally if the AI builder fails. */
export function buildFallbackPrompt(args: {
  title: string;
  description?: string;
  priority?: string;
  dueDate?: string;
  projectName?: string;
  userContext?: string;
  imageUrls?: string[];
}): string {
  const lines: string[] = [];
  lines.push(`# Task: ${args.title}`);
  if (args.userContext?.trim()) {
    lines.push('', '## What I am trying to accomplish', args.userContext.trim());
  }
  if (args.description?.trim()) {
    lines.push('', '## Task details', args.description.trim());
  }
  const meta: string[] = [];
  if (args.priority) meta.push(`Priority: ${args.priority}`);
  if (args.dueDate) meta.push(`Due: ${args.dueDate}`);
  if (args.projectName) meta.push(`Project: ${args.projectName}`);
  if (meta.length) lines.push('', '## Context', meta.map((m) => `- ${m}`).join('\n'));
  if (args.imageUrls && args.imageUrls.length) {
    lines.push('', '## Attached images', ...args.imageUrls.map((u) => `- ${u}`));
    lines.push('', 'Please view the attached images above.');
  }
  lines.push('', '## Request', 'Please help me complete this task.');
  return lines.join('\n');
}