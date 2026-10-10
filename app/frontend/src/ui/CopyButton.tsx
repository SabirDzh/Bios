import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from './Button';

interface CopyButtonProps {
  value: string;
  label?: string;
  size?: 'md' | 'sm';
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

export function CopyButton({ value, label = 'Копировать', size = 'sm' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy(): Promise<void> {
    try {
      await writeClipboard(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button
      size={size}
      onClick={copy}
      icon={copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
    >
      {copied ? 'Скопировано' : label}
    </Button>
  );
}
