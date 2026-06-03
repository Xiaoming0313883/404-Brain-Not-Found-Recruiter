import { Bot, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';

export interface AgentActivityEvent {
  node?: string;
  event_type?: string;
  message?: string;
  reason?: string;
  decision_reason?: string;
  payload?: {
    tool?: string;
    reason?: string;
    decision_reason?: string;
    [key: string]: any;
  };
}

interface AgentActivityFeedProps {
  events: AgentActivityEvent[];
  currentMessage?: string;
  progress?: number;
  title?: string;
}

export function AgentActivityFeed({ events, currentMessage, progress, title = 'Agent Activity' }: AgentActivityFeedProps) {
  const visibleEvents = events.slice(-6);
  return (
    <div className="rounded-xl border border-[#e4e1da] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-[#2d6a55]" />
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6b7063]">{title}</p>
        </div>
        {typeof progress === 'number' && (
          <span className="text-xs font-semibold text-[#2d6a55]">{progress}%</span>
        )}
      </div>
      {currentMessage && (
        <p className="mb-3 rounded-lg bg-[#f7f6f3] px-3 py-2 text-xs font-medium leading-relaxed text-[#1c1c1a]">
          {currentMessage}
        </p>
      )}
      <div className="space-y-2">
        {visibleEvents.map((event, index) => {
          const blocked = event.event_type === 'blocked' || event.event_type === 'failed';
          const completed = event.event_type === 'completed' || event.event_type === 'final' || event.event_type === 'passed';
          const Icon = blocked ? ShieldAlert : completed ? CheckCircle2 : Loader2;
          const reason = event.reason || event.decision_reason || event.payload?.reason || event.payload?.decision_reason;
          return (
            <div key={`${event.node}-${event.event_type}-${index}`} className="flex items-start gap-2 text-xs text-[#6b7063]">
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${blocked ? 'text-[#b91c1c]' : completed ? 'text-[#2d6a55]' : 'animate-spin text-[#a66b2b]'}`} />
              <div className="min-w-0">
                <p className="leading-relaxed text-[#1c1c1a]">{event.message || 'Agent event received.'}</p>
                {reason && (
                  <p className="mt-1 rounded-md bg-[#f7f6f3] px-2 py-1 leading-relaxed text-[#52574e]">
                    Reason: {reason}
                  </p>
                )}
                <p className="mt-0.5 uppercase tracking-wide text-[#a8a49d]">
                  {[event.node, event.payload?.tool].filter(Boolean).join(' / ') || 'agent graph'}
                </p>
              </div>
            </div>
          );
        })}
        {!visibleEvents.length && (
          <p className="text-xs text-[#a8a49d]">Waiting for the first graph event...</p>
        )}
      </div>
    </div>
  );
}
