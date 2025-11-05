import { parseLinks } from '@/lib/utils';

interface LinkifiedTextProps {
  text: string;
  className?: string;
}

export const LinkifiedText = ({ text, className = '' }: LinkifiedTextProps) => {
  const parts = parseLinks(text);
  
  return (
    <span className={className}>
      {parts.map((part, index) => {
        if (part.type === 'link') {
          return (
            <a
              key={index}
              href={part.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline"
              onClick={(e) => e.stopPropagation()}
            >
              {part.content}
            </a>
          );
        }
        return <span key={index}>{part.content}</span>;
      })}
    </span>
  );
};
