import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface LinkPart {
  type: 'text' | 'link';
  content: string;
  href?: string;
}

export function parseLinks(text: string): LinkPart[] {
  const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/g;
  const parts: LinkPart[] = [];
  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    // Add text before the URL
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: text.slice(lastIndex, match.index)
      });
    }

    // Add the URL as a link
    const url = match[0];
    const href = url.startsWith('http') ? url : `https://${url}`;
    
    parts.push({
      type: 'link',
      content: url,
      href
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after the last URL
  if (lastIndex < text.length) {
    parts.push({
      type: 'text',
      content: text.slice(lastIndex)
    });
  }

  return parts.length > 0 ? parts : [{ type: 'text', content: text }];
}
