import { useState } from 'react';
import { Calendar, momentLocalizer, Views } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { CalendarCheck, Clock, MapPin, User, AlertTriangle, Send, Loader2, CheckCircle2, X, Mail, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { ScrapedCandidate } from '../HiringManagerPortal';
import { Job } from '../HiringManagerPortal';

const getCandidatePhase = (status: string, answers?: string[]): string => {
  if (status === 'hired') return 'Hired';
  if (status === 'rejected') return 'Rejected';
  if (status === 'interview_scheduled') return 'Interview In Progress';
  if (status === 'completed') return 'Waiting for Interview';
  if (status === 'screening' || (answers && answers.length > 0)) return 'Screening Completed';
  return 'Waiting for Screening';
};

const localizer = momentLocalizer(moment);

interface InterviewSlot {
  date: string;
  time: string;
  location: string;
  notes: string;
}

interface Props {
  jobs: Job[];
  candidates: ScrapedCandidate[];
  onScheduleInterview: (email: string, positionId: number | undefined, date: string, time: string, location: string, notes?: string) => Promise<any>;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: {
    candidate: ScrapedCandidate;
    slot: InterviewSlot;
    job?: Job;
    isConflict?: boolean;
  };
}

export function InterviewCalendar({ jobs, candidates, onScheduleInterview }: Props) {
  const [activeTab, setActiveTab] = useState<'schedule' | 'calendar'>('schedule');
  const [selectedEmail, setSelectedEmail] = useState('');
  const [interviewDate, setInterviewDate] = useState('');
  const [interviewTime, setInterviewTime] = useState('');
  const [interviewLocation, setInterviewLocation] = useState('');
  const [interviewNotes, setInterviewNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [editTarget, setEditTarget] = useState<ScrapedCandidate | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Candidates eligible for scheduling (screening or completed)
  const eligibleCandidates = candidates.filter(c =>
    c.status === 'screening' || c.status === 'completed' || c.status === 'applied'
  );

  // Candidates already scheduled
  const scheduledCandidates = candidates.filter(c =>
    c.status === 'interview_scheduled' && c.interviewSlot
  );

  // Build calendar events with conflict detection
  const events: CalendarEvent[] = [];
  const slotMap = new Map<string, number>(); // key=date+time → count
  scheduledCandidates.forEach(c => {
    if (!c.interviewSlot) return;
    const slotKey = `${c.interviewSlot.date}|${c.interviewSlot.time}`;
    slotMap.set(slotKey, (slotMap.get(slotKey) || 0) + 1);
  });

  scheduledCandidates.forEach(c => {
    if (!c.interviewSlot) return;
    const slot = c.interviewSlot;
    const job = jobs.find(j => j.id === c.jobId);
    const slotKey = `${slot.date}|${slot.time}`;
    const isConflict = (slotMap.get(slotKey) || 0) > 1;

    const [h, m] = slot.time.split(':').map(Number);
    const startDate = new Date(slot.date);
    startDate.setHours(h, m || 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setHours(startDate.getHours() + 1);

    events.push({
      id: `${c.email}-${c.applicationId}`,
      title: `${c.name}${isConflict ? ' ⚠' : ''}`,
      start: startDate,
      end: endDate,
      resource: { candidate: c, slot, job, isConflict }
    });
  });

  const handleSchedule = async () => {
    if (!selectedEmail || !interviewDate || !interviewTime) {
      const message = 'Please select a candidate, date, and time.';
      setErrorMessage(message);
      toast.warning(message);
      return;
    }
    const candidate = candidates.find(c => c.email === selectedEmail);
    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const result = await onScheduleInterview(selectedEmail, candidate?.jobId, interviewDate, interviewTime, interviewLocation || 'To be confirmed', interviewNotes);
      const message = result?.interview_email_sent
        ? `Interview scheduled for ${candidate?.name}. A notification email has been sent.`
        : result?.smtp_configured === false
          ? `Interview scheduled for ${candidate?.name}. SMTP is not configured, so no email was sent.`
          : `Interview scheduled for ${candidate?.name}. Email delivery was not confirmed.`;
      setSuccessMessage(message);
      toast.success(message);
      setSelectedEmail('');
      setInterviewDate('');
      setInterviewTime('');
      setInterviewLocation('');
      setInterviewNotes('');
    } catch (err: any) {
      const message = err.message || 'Failed to schedule interview.';
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditInterview = (candidate: ScrapedCandidate) => {
    const slot = candidate.interviewSlot;
    if (!slot) return;
    setSelectedEvent(null);
    setEditTarget(candidate);
    setEditDate(slot.date || '');
    setEditTime(slot.time || '');
    setEditLocation(slot.location || 'To be confirmed');
    setEditNotes(slot.notes || '');
    setErrorMessage('');
  };

  const closeEditInterview = () => {
    if (isEditing) return;
    setEditTarget(null);
    setEditDate('');
    setEditTime('');
    setEditLocation('');
    setEditNotes('');
  };

  const handleUpdateInterview = async () => {
    if (!editTarget || !editDate || !editTime) {
      const message = 'Please choose a date and time before saving.';
      setErrorMessage(message);
      toast.warning(message);
      return;
    }
    setIsEditing(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const email = editTarget.managementEmail || editTarget.email;
      const result = await onScheduleInterview(email, editTarget.jobId, editDate, editTime, editLocation || 'To be confirmed', editNotes);
      const message = result?.interview_email_sent
        ? `Interview updated for ${editTarget.name}. A notification email has been sent.`
        : result?.smtp_configured === false
          ? `Interview updated for ${editTarget.name}. SMTP is not configured, so no email was sent.`
          : `Interview updated for ${editTarget.name}. Email delivery was not confirmed.`;
      setSuccessMessage(message);
      toast.success(message);
      setEditTarget(null);
      setEditDate('');
      setEditTime('');
      setEditLocation('');
      setEditNotes('');
    } catch (err: any) {
      const message = err.message || 'Failed to update interview.';
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsEditing(false);
    }
  };

  const eventStyleGetter = (event: CalendarEvent) => ({
    style: {
      backgroundColor: event.resource.isConflict ? '#d97706' : '#2d6a55',
      borderColor: event.resource.isConflict ? '#b45309' : '#245747',
      color: 'white',
      borderRadius: '6px',
      fontSize: '12px',
      fontWeight: 500,
      cursor: 'pointer'
    }
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-[#1c1c1a] text-xl font-semibold">Interview Calendar</h2>
        <p className="text-sm text-[#6b7063] mt-1">Schedule interviews and view the master calendar.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#f0ede8] p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'schedule' ? 'bg-white text-[#1c1c1a] shadow-sm' : 'text-[#6b7063] hover:text-[#1c1c1a]'}`}
        >
          Schedule Interview
        </button>
        <button
          onClick={() => setActiveTab('calendar')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'calendar' ? 'bg-white text-[#1c1c1a] shadow-sm' : 'text-[#6b7063] hover:text-[#1c1c1a]'}`}
        >
          Master Calendar
          {scheduledCandidates.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 bg-[#2d6a55] text-white text-xs rounded-full">{scheduledCandidates.length}</span>
          )}
        </button>
      </div>

      {/* Schedule Interview Tab */}
      {activeTab === 'schedule' && (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Form */}
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
                <CalendarCheck className="w-4 h-4 text-[#2d6a55]" />
              </div>
              <div>
                <h3 className="text-[#1c1c1a] font-semibold">Schedule New Interview</h3>
                <p className="text-xs text-[#6b7063]">Notify the candidate via email and portal.</p>
              </div>
            </div>

            {successMessage && (
              <div className="mb-4 flex items-center gap-2 p-3 bg-[#e8f2ee] border border-[#2d6a55]/20 rounded-xl text-sm text-[#2d6a55]">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                {successMessage}
              </div>
            )}
            {errorMessage && (
              <div className="mb-4 p-3 bg-[#fdf2f2] border border-[#f5c2c2] rounded-xl text-sm text-[#b91c1c]">{errorMessage}</div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-[#a8a49d] mb-1 font-medium">Candidate *</label>
                <select
                  value={selectedEmail}
                  onChange={e => setSelectedEmail(e.target.value)}
                  className="w-full px-3 py-2.5 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55] bg-white"
                >
                  <option value="">Select a candidate...</option>
                  {eligibleCandidates.map(c => (
                    <option key={c.email} value={c.email}>
                      {c.name} — {jobs.find(j => j.id === c.jobId)?.title || `Position #${c.jobId}`}
                    </option>
                  ))}
                </select>
                {eligibleCandidates.length === 0 && (
                  <p className="text-xs text-[#a8a49d] mt-1">No candidates at screening/applied stage.</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#a8a49d] mb-1 font-medium">Date *</label>
                  <input
                    type="date"
                    value={interviewDate}
                    onChange={e => setInterviewDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2.5 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#a8a49d] mb-1 font-medium">Time *</label>
                  <input
                    type="time"
                    value={interviewTime}
                    onChange={e => setInterviewTime(e.target.value)}
                    className="w-full px-3 py-2.5 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-[#a8a49d] mb-1 font-medium">Location</label>
                <input
                  type="text"
                  value={interviewLocation}
                  onChange={e => setInterviewLocation(e.target.value)}
                  placeholder="e.g. Google Meet, Office Room A, Zoom link..."
                  className="w-full px-3 py-2.5 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
                />
              </div>

              <div>
                <label className="block text-xs text-[#a8a49d] mb-1 font-medium">Notes</label>
                <textarea
                  value={interviewNotes}
                  onChange={e => setInterviewNotes(e.target.value)}
                  placeholder="e.g. Bring portfolio, panel interview with 3 members..."
                  rows={3}
                  className="w-full px-3 py-2.5 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55] resize-none"
                />
              </div>

              <button
                onClick={handleSchedule}
                disabled={isSubmitting || !selectedEmail || !interviewDate || !interviewTime}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#2d6a55] text-white rounded-xl hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed text-sm font-medium transition-colors"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {isSubmitting ? 'Scheduling...' : 'Schedule & Notify Candidate'}
              </button>
            </div>
          </div>

          {/* Upcoming Interviews List */}
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm">
            <h3 className="text-[#1c1c1a] font-semibold mb-4">Upcoming Interviews ({scheduledCandidates.length})</h3>
            {scheduledCandidates.length === 0 ? (
              <p className="text-sm text-[#a8a49d] text-center py-8">No interviews scheduled yet.</p>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {scheduledCandidates
                  .filter(c => c.interviewSlot)
                  .sort((a, b) => {
                    const da = new Date(`${a.interviewSlot!.date}T${a.interviewSlot!.time}`);
                    const db = new Date(`${b.interviewSlot!.date}T${b.interviewSlot!.time}`);
                    return da.getTime() - db.getTime();
                  })
                  .map(c => {
                    const slot = c.interviewSlot!;
                    const job = jobs.find(j => j.id === c.jobId);
                    const slotKey = `${slot.date}|${slot.time}`;
                    const isConflict = (slotMap.get(slotKey) || 0) > 1;
                    return (
                      <button
                        key={c.email}
                        type="button"
                        onClick={() => openEditInterview(c)}
                        className={`w-full text-left border rounded-xl p-4 transition-colors hover:border-[#2d6a55] hover:bg-[#f0f9f4] focus:outline-none focus:ring-2 focus:ring-[#2d6a55]/20 ${isConflict ? 'border-[#d97706] bg-[#fffbeb]' : 'border-[#e4e1da] bg-[#f7f6f3]'}`}
                        aria-label={`Edit interview for ${c.name}`}
                      >
                        {isConflict && (
                          <div className="flex items-center gap-1.5 text-xs text-[#d97706] font-semibold mb-2">
                            <AlertTriangle className="w-3.5 h-3.5" /> Time conflict detected
                          </div>
                        )}
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-[#1c1c1a]">{c.name}</p>
                            <p className="text-xs text-[#6b7063]">{job?.title || `Position #${c.jobId}`}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-[#6b7063]">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{slot.date} {slot.time}</span>
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{slot.location}</span>
                        </div>
                        <p className="mt-2 text-[11px] font-semibold text-[#2d6a55]">Click to edit date, time, location, or notes</p>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Master Calendar Tab */}
      {activeTab === 'calendar' && (
        <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm">
          {events.some(e => e.resource.isConflict) && (
            <div className="mb-4 flex items-center gap-2 p-3 bg-[#fffbeb] border border-[#d97706]/30 rounded-xl text-sm text-[#d97706]">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>⚠ Conflicting interview slots detected — highlighted in amber.</span>
            </div>
          )}
          <div style={{ height: 600 }}>
            <Calendar
              localizer={localizer}
              events={events}
              defaultView={Views.WEEK}
              views={[Views.MONTH, Views.WEEK, Views.DAY]}
              startAccessor="start"
              endAccessor="end"
              eventPropGetter={eventStyleGetter}
              onSelectEvent={(event) => openEditInterview((event as CalendarEvent).resource.candidate)}
              tooltipAccessor={(event) => {
                const e = event as CalendarEvent;
                return `${e.resource.candidate.name} — ${e.resource.slot.date} at ${e.resource.slot.time}${e.resource.isConflict ? ' ⚠ Conflict' : ''}`;
              }}
              style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px' }}
            />
          </div>

          {/* Event Detail Popup */}
          {selectedEvent && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelectedEvent(null)}>
              <div className="bg-white rounded-2xl p-6 shadow-xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#e8f2ee] rounded-xl flex items-center justify-center text-[#2d6a55] font-semibold text-lg flex-shrink-0">
                      {selectedEvent.resource.candidate.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-[#1c1c1a]">{selectedEvent.resource.candidate.name}</p>
                      {(() => {
                        const phase = getCandidatePhase(selectedEvent.resource.candidate.status, selectedEvent.resource.candidate.answers);
                        const classes = 
                          phase === 'Waiting for Screening' ? 'bg-[#f0ede8] text-[#6b7063]' :
                          phase === 'Screening Completed' ? 'bg-[#fff7ed] text-[#c2410c]' :
                          phase === 'Waiting for Interview' ? 'bg-[#fef9c3] text-[#854d0e]' :
                          phase === 'Interview In Progress' ? 'bg-[#e0e7ff] text-[#3730a3]' :
                          phase === 'Rejected' ? 'bg-[#b91c1c] text-white border border-[#991b1b]' :
                          phase === 'Hired' ? 'bg-[#dcfce7] text-[#15803d]' :
                          'bg-[#f0ede8] text-[#6b7063]';
                        return (
                          <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-xs font-semibold ${classes}`}>
                            {phase}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <button onClick={() => setSelectedEvent(null)} className="text-[#a8a49d] hover:text-[#1c1c1a] transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2.5 text-sm">
                  {selectedEvent.resource.job && (
                    <div className="flex items-center gap-2 text-[#6b7063]">
                      <User className="w-4 h-4 text-[#2d6a55] flex-shrink-0" />
                      <span className="font-medium text-[#1c1c1a]">{selectedEvent.resource.job.title}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-[#6b7063]">
                    <CalendarCheck className="w-4 h-4 text-[#2d6a55] flex-shrink-0" />
                    <span>{selectedEvent.resource.slot.date} at {selectedEvent.resource.slot.time}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#6b7063]">
                    <MapPin className="w-4 h-4 text-[#2d6a55] flex-shrink-0" />
                    <span>{selectedEvent.resource.slot.location}</span>
                  </div>

                  {/* Contact Details */}
                  <div className="border-t border-[#e4e1da] pt-2.5 mt-2.5 space-y-2">
                    <p className="text-[10px] text-[#a8a49d] uppercase tracking-wider font-semibold">Contact Details</p>
                    <div className="flex items-center gap-2 text-[#6b7063]">
                      <Mail className="w-4 h-4 text-[#2d6a55] flex-shrink-0" />
                      <span className="text-xs truncate">{selectedEvent.resource.candidate.managementEmail || selectedEvent.resource.candidate.email}</span>
                    </div>
                    {selectedEvent.resource.candidate.phone && (
                      <div className="flex items-center gap-2 text-[#6b7063]">
                        <Phone className="w-4 h-4 text-[#2d6a55] flex-shrink-0" />
                        <span className="text-xs">{selectedEvent.resource.candidate.phone}</span>
                      </div>
                    )}
                  </div>

                  {selectedEvent.resource.slot.notes && (
                    <p className="text-xs text-[#a8a49d] mt-2 border-t border-[#e4e1da] pt-2">{selectedEvent.resource.slot.notes}</p>
                  )}
                  {selectedEvent.resource.isConflict && (
                    <div className="flex items-center gap-1.5 text-xs text-[#d97706] font-semibold mt-2">
                      <AlertTriangle className="w-3.5 h-3.5" /> Time slot conflict — another interview is scheduled at this time
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {editTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={closeEditInterview}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full border border-[#e4e1da]" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 p-5 border-b border-[#e4e1da] bg-[#f7f6f3] rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
                  <CalendarCheck className="w-4 h-4 text-[#2d6a55]" />
                </div>
                <div>
                  <h3 className="text-[#1c1c1a] font-semibold">Edit Interview</h3>
                  <p className="text-xs text-[#6b7063]">
                    {editTarget.name} - {jobs.find(j => j.id === editTarget.jobId)?.title || `Position #${editTarget.jobId}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeEditInterview}
                disabled={isEditing}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#a8a49d] transition-colors hover:bg-white hover:text-[#1c1c1a] disabled:opacity-50"
                aria-label="Close edit interview dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {errorMessage && (
                <div className="p-3 bg-[#fdf2f2] border border-[#f5c2c2] rounded-xl text-sm text-[#b91c1c]">{errorMessage}</div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#a8a49d] mb-1 font-medium">Date *</label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={e => setEditDate(e.target.value)}
                    className="w-full px-3 py-2.5 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#a8a49d] mb-1 font-medium">Time *</label>
                  <input
                    type="time"
                    value={editTime}
                    onChange={e => setEditTime(e.target.value)}
                    className="w-full px-3 py-2.5 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[#a8a49d] mb-1 font-medium">Location</label>
                <input
                  type="text"
                  value={editLocation}
                  onChange={e => setEditLocation(e.target.value)}
                  placeholder="Google Meet, Zoom link, office room..."
                  className="w-full px-3 py-2.5 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#a8a49d] mb-1 font-medium">Notes</label>
                <textarea
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  rows={3}
                  placeholder="Panel details, preparation notes, meeting instructions..."
                  className="w-full px-3 py-2.5 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55] resize-none"
                />
              </div>
            </div>

            <div className="flex gap-2 p-5 pt-0">
              <button
                type="button"
                onClick={closeEditInterview}
                disabled={isEditing}
                className="flex-1 px-4 py-2.5 bg-white border border-[#e4e1da] text-[#6b7063] rounded-lg hover:bg-[#f7f6f3] text-sm font-medium transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpdateInterview}
                disabled={isEditing || !editDate || !editTime}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
              >
                {isEditing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
                {isEditing ? 'Saving...' : 'Save Interview'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
