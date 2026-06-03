import { HelpCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

interface KnowledgeTooltipProps {
  label: string;
  children: ReactNode;
}

export function KnowledgeTooltip({ label, children }: KnowledgeTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#d8d2c7] bg-white text-[#6b7063] transition-colors hover:border-[#2d6a55] hover:text-[#2d6a55]"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={8} className="max-w-xs bg-[#1c1c1a] text-white leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
