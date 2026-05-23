import { useState } from 'react';
import { useNavigate } from 'react-router';
import { CandidateData } from '../CandidatePortal';
import * as Progress from '@radix-ui/react-progress';
import { CheckCircle2, AlertCircle, Loader2, Mic, MicOff } from 'lucide-react';

interface Props {
  candidateData: CandidateData;
  onComplete: (answers: string[], score: number, evaluation: any) => void;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const defaultQuestions = [
  "How would you approach designing a fault-tolerant message distribution system with less than 50ms latency using Node.js?",
  "Can you describe a specific time you identified a critical bottleneck in a React client application and how you resolved it?",
  "What is your approach to handling database replication lag in a high-throughput, globally distributed application?"
];

export function CandidateSandbox({ candidateData, onComplete }: Props) {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<boolean[]>([false, false, false]);
  const [errorMessage, setErrorMessage] = useState('');
  const [listeningIndex, setListeningIndex] = useState<number | null>(null);

  // Extract custom questions from loaded candidate or fallback
  const rawQuestions = candidateData.customQuestions && candidateData.customQuestions.length === 3
    ? candidateData.customQuestions
    : defaultQuestions;

  // Hints mapped by questions to maintain design look and feel
  const hints = [
    "We noticed your experience in engineering — share your concrete approach to service design.",
    "This probes architectural bottleneck solutions — we're curious about your hands-on methodology.",
    "This helps us understand your scalability decision-making under high-concurrency environments."
  ];

  const handleAnswerChange = (index: number, value: string) => {
    const newAnswers = [...answers];
    newAnswers[index] = value;
    setAnswers(newAnswers);
    if (value.trim().length >= 10) {
      const newErrors = [...validationErrors];
      newErrors[index] = false;
      setValidationErrors(newErrors);
    }
  };

  const handleSubmit = async () => {
    setErrorMessage('');
    const errors = answers.map(answer => answer.trim().length < 10);
    setValidationErrors(errors);
    if (errors.some(error => error)) return;

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(candidateData.email)}/sandbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json_payload()
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to submit responses.');
      }

      const data = await response.json();
      
      const score = data.evaluation?.screening_score || 80;
      onComplete(answers, score, data.evaluation);
      navigate('/candidate/feedback');
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'API connection failed. Simulating local evaluation.');
      
      // Fallback evaluation for seamless offline prototyping
      await new Promise(resolve => setTimeout(resolve, 1500));
      const avgLength = answers.reduce((sum, ans) => sum + ans.length, 0) / answers.length;
      const fallbackScore = Math.min(100, Math.round(40 + (avgLength / 10)));
      const mockEvaluation = {
        screening_score: fallbackScore,
        critiques: rawQuestions.map((q, idx) => ({
          question: q,
          critique: "Simulated review: Clear explanation demonstrating domain competency."
        })),
        upskilling_roadmap: {
          week_1: "Explore basic component caching strategies and backend architecture structures.",
          week_2: "Build simple modular units and wire them into testing validation blocks.",
          week_3: "Implement real-time notification components and secure environment configurations."
        }
      };
      onComplete(answers, fallbackScore, mockEvaluation);
      navigate('/candidate/feedback');
    } finally {
      setIsSubmitting(false);
    }
  };

  const json_payload = () => {
    return JSON.stringify({
      answers: answers,
      position_id: candidateData.jobId
    });
  };

  const handleVoiceAnswer = (index: number) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErrorMessage('Voice recognition is not supported in this browser. Please use Chrome or Edge, or type your answer.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    setListeningIndex(index);

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0]?.transcript || '')
        .join(' ')
        .trim();
      if (transcript) {
        handleAnswerChange(index, `${answers[index]} ${transcript}`.trim());
      }
    };
    recognition.onerror = () => {
      setErrorMessage('Voice recognition could not capture audio. Check microphone permission and try again.');
    };
    recognition.onend = () => setListeningIndex(null);
    recognition.start();
  };

  const allAnswersValid = answers.every(answer => answer.trim().length >= 10);
  const answeredCount = answers.filter(a => a.trim().length >= 10).length;

  return (
    <div className="min-h-screen py-12 px-6 bg-[#f7f6f3]">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <p className="text-xs tracking-[0.2em] uppercase text-[#2d6a55] mb-3 font-semibold">Interactive Warm-Up</p>
          <div className="flex items-start justify-between mb-5">
            <div>
              <h1 className="text-[#1c1c1a] mb-1 font-semibold text-2xl">Screening Sandbox</h1>
              <p className="text-sm text-[#6b7063]">
                {candidateData.name} — {candidateData.position}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl text-[#2d6a55] font-semibold">{answeredCount}/3</p>
              <p className="text-xs text-[#a8a49d]">completed</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Progress.Root className="flex-1 relative overflow-hidden bg-[#e4e1da] rounded-full h-1.5 w-full">
              <Progress.Indicator
                className="bg-[#2d6a55] h-full transition-all duration-500 ease-out"
                style={{ transform: `translateX(-${100 - (answeredCount / 3) * 100}%)`, width: '100%' }}
              />
            </Progress.Root>
            <span className="text-xs text-[#a8a49d] font-medium">{Math.round((answeredCount / 3) * 100)}%</span>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-6 p-4 bg-[#fdf2f2] border border-[#f5c2c2] text-[#b91c1c] rounded-xl text-sm">
            {errorMessage}
          </div>
        )}

        {/* Info Banner */}
        <div className="bg-white border border-[#e4e1da] rounded-2xl p-5 mb-6 flex items-start gap-4 shadow-sm">
          <div className="w-8 h-8 bg-[#e8f2ee] rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-[#2d6a55] text-sm font-semibold">i</span>
          </div>
          <div>
            <p className="text-sm text-[#1c1c1a] mb-1 font-semibold">Personalized Assessment</p>
            <p className="text-xs text-[#6b7063] leading-relaxed">
              These questions were tailored to your profile by our AI Interview Agent. They're designed as a
              collaborative warm-up — share your thought process, not just the answer. Minimum 10 characters per response.
            </p>
          </div>
        </div>

        {/* Questions */}
        <div className="space-y-5">
          {rawQuestions.map((question, index) => (
            <div
              key={index}
              className={`bg-white border rounded-2xl p-6 shadow-sm transition-colors ${
                validationErrors[index] ? 'border-[#c25a2a]/40' : 'border-[#e4e1da]'
              }`}
            >
              <div className="flex items-start gap-4 mb-4">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-semibold flex-shrink-0 ${
                  answers[index].trim().length >= 10
                    ? 'bg-[#e8f2ee] text-[#2d6a55]'
                    : 'bg-[#f0ede8] text-[#a8a49d]'
                }`}>
                  {index + 1}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-[#1c1c1a] leading-relaxed mb-2 font-medium">{question}</p>
                  <p className="text-xs text-[#a8a49d] italic leading-relaxed">{hints[index]}</p>
                </div>
              </div>

              <div className="relative">
                <textarea
                  value={answers[index]}
                  onChange={(e) => handleAnswerChange(index, e.target.value)}
                  placeholder="Share your technical reasoning here..."
                  className={`w-full px-3.5 py-3 pr-14 border rounded-xl text-sm text-[#1c1c1a] placeholder-[#a8a49d] focus:outline-none focus:ring-1 transition-colors resize-none leading-relaxed ${
                    validationErrors[index]
                      ? 'border-[#c25a2a]/40 bg-[#fdf8f6] focus:border-[#c25a2a] focus:ring-[#c25a2a]/20'
                      : 'border-[#e4e1da] bg-white focus:border-[#2d6a55] focus:ring-[#2d6a55]/20'
                  }`}
                  rows={5}
                />
                <button
                  type="button"
                  onClick={() => handleVoiceAnswer(index)}
                  className={`absolute top-3 right-3 inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${
                    listeningIndex === index
                      ? 'bg-[#fdf2f2] border-[#f0c9c9] text-[#b91c1c]'
                      : 'bg-white border-[#e4e1da] text-[#6b7063] hover:text-[#2d6a55] hover:bg-[#f7f6f3]'
                  }`}
                  title={listeningIndex === index ? 'Listening...' : 'Dictate answer'}
                >
                  {listeningIndex === index ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex items-center gap-1.5 mt-2">
                {answers[index].trim().length >= 10 ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#2d6a55]" />
                    <span className="text-xs text-[#2d6a55] font-medium">Valid response</span>
                  </>
                ) : validationErrors[index] ? (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-[#c25a2a]" />
                    <span className="text-xs text-[#c25a2a] font-medium">Minimum 10 characters required</span>
                  </>
                ) : (
                  <span className="text-xs text-[#a8a49d]">{answers[index].length} / 10 minimum</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Submit */}
        <div className="mt-6">
          <button
            onClick={handleSubmit}
            disabled={!allAnswersValid || isSubmitting}
            className="w-full py-3.5 bg-[#2d6a55] text-white rounded-xl hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 font-medium cursor-pointer shadow-sm"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Evaluating responses...
              </>
            ) : (
              'Submit Responses'
            )}
          </button>

          {isSubmitting && (
            <div className="mt-4 bg-[#f0ede8] border border-[#e4e1da] rounded-xl p-4 shadow-sm">
              <p className="text-xs text-[#a8a49d] font-semibold uppercase tracking-wider mb-2">AI Evaluation Pipeline</p>
              <ul className="text-xs text-[#6b7063] space-y-1.5 list-disc list-inside">
                <li>Interview Agent (Phase B): Analyzing responses...</li>
                <li>Report Agent: Generating upskilling roadmap...</li>
                <li>Updating status to completed...</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
