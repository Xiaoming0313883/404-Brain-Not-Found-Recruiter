import { useState } from 'react';
import { useNavigate } from 'react-router';
import { CandidateData } from '../CandidatePortal';
import * as Progress from '@radix-ui/react-progress';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface Props {
  candidateData: CandidateData;
  onComplete: (answers: string[], score: number) => void;
}

const mockQuestions = {
  invited: [
    {
      question: "Describe a distributed system you've built. What were the main challenges in ensuring consistency across services?",
      hint: "We noticed your experience with microservices — we'd love to hear about your approach to distributed transactions and data consistency."
    },
    {
      question: "How would you approach migrating a monolithic application to microservices while maintaining zero downtime?",
      hint: "This addresses a gap we identified — we're curious about your migration strategy thinking."
    },
    {
      question: "Explain your philosophy on technical debt. When is it acceptable to incur it, and how do you prioritize paying it down?",
      hint: "Leadership perspective is important for this senior role."
    }
  ],
  inbound: [
    {
      question: "Walk us through how you would debug a production performance issue. What tools and methodology would you use?",
      hint: "Based on your profile, we'd like to understand your troubleshooting approach."
    },
    {
      question: "Describe a time when you had to learn a new technology quickly to deliver a project. What was your learning strategy?",
      hint: "We're assessing your learning velocity and adaptability."
    },
    {
      question: "How do you balance writing clean, maintainable code with meeting tight deadlines?",
      hint: "This helps us understand your engineering judgment under pressure."
    }
  ]
};

export function CandidateSandbox({ candidateData, onComplete }: Props) {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<boolean[]>([false, false, false]);

  const questions = candidateData.isInvited ? mockQuestions.invited : mockQuestions.inbound;

  const handleAnswerChange = (index: number, value: string) => {
    const newAnswers = [...answers];
    newAnswers[index] = value;
    setAnswers(newAnswers);
    if (value.length >= 10) {
      const newErrors = [...validationErrors];
      newErrors[index] = false;
      setValidationErrors(newErrors);
    }
  };

  const handleSubmit = async () => {
    const errors = answers.map(answer => answer.trim().length < 10);
    setValidationErrors(errors);
    if (errors.some(error => error)) return;

    setIsSubmitting(true);
    await new Promise(resolve => setTimeout(resolve, 2500));

    const avgLength = answers.reduce((sum, ans) => sum + ans.length, 0) / answers.length;
    const score = Math.min(100, Math.round(40 + (avgLength / 10)));

    onComplete(answers, score);
    navigate('/candidate/feedback');
  };

  const allAnswersValid = answers.every(answer => answer.trim().length >= 10);
  const answeredCount = answers.filter(a => a.trim().length >= 10).length;

  return (
    <div className="min-h-screen py-12 px-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <p className="text-xs tracking-[0.2em] uppercase text-[#2d6a55] mb-3">Interactive Warm-Up</p>
          <div className="flex items-start justify-between mb-5">
            <div>
              <h1 className="text-[#1c1c1a] mb-1">Screening Sandbox</h1>
              <p className="text-sm text-[#6b7063]">
                {candidateData.name} — {candidateData.position}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl text-[#2d6a55]">{answeredCount}/3</p>
              <p className="text-xs text-[#a8a49d]">completed</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Progress.Root className="flex-1 relative overflow-hidden bg-[#e4e1da] rounded-full h-1.5">
              <Progress.Indicator
                className="bg-[#2d6a55] h-full transition-all duration-500 ease-out"
                style={{ transform: `translateX(-${100 - (answeredCount / 3) * 100}%)` }}
              />
            </Progress.Root>
            <span className="text-xs text-[#a8a49d]">{Math.round((answeredCount / 3) * 100)}%</span>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-white border border-[#e4e1da] rounded-2xl p-5 mb-6 flex items-start gap-4">
          <div className="w-8 h-8 bg-[#e8f2ee] rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-[#2d6a55] text-sm">i</span>
          </div>
          <div>
            <p className="text-sm text-[#1c1c1a] mb-1">Personalized Assessment</p>
            <p className="text-xs text-[#6b7063] leading-relaxed">
              These questions were tailored to your profile by our AI Interview Agent. They're designed as a
              collaborative warm-up — share your thought process, not just the answer. Minimum 10 characters per response.
            </p>
          </div>
        </div>

        {/* Questions */}
        <div className="space-y-5">
          {questions.map((q, index) => (
            <div
              key={index}
              className={`bg-white border rounded-2xl p-6 transition-colors ${
                validationErrors[index] ? 'border-[#c25a2a]/40' : 'border-[#e4e1da]'
              }`}
            >
              <div className="flex items-start gap-4 mb-4">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 ${
                  answers[index].length >= 10
                    ? 'bg-[#e8f2ee] text-[#2d6a55]'
                    : 'bg-[#f0ede8] text-[#a8a49d]'
                }`}>
                  {index + 1}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-[#1c1c1a] leading-relaxed mb-2">{q.question}</p>
                  <p className="text-xs text-[#a8a49d] italic leading-relaxed">{q.hint}</p>
                </div>
              </div>

              <textarea
                value={answers[index]}
                onChange={(e) => handleAnswerChange(index, e.target.value)}
                placeholder="Share your thoughts here..."
                className={`w-full px-3.5 py-3 border rounded-xl text-sm text-[#1c1c1a] placeholder-[#a8a49d] focus:outline-none focus:ring-1 transition-colors resize-none leading-relaxed ${
                  validationErrors[index]
                    ? 'border-[#c25a2a]/40 bg-[#fdf8f6] focus:border-[#c25a2a] focus:ring-[#c25a2a]/20'
                    : 'border-[#e4e1da] bg-white focus:border-[#2d6a55] focus:ring-[#2d6a55]/20'
                }`}
                rows={5}
              />

              <div className="flex items-center gap-1.5 mt-2">
                {answers[index].length >= 10 ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#2d6a55]" />
                    <span className="text-xs text-[#2d6a55]">Valid response</span>
                  </>
                ) : validationErrors[index] ? (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-[#c25a2a]" />
                    <span className="text-xs text-[#c25a2a]">Minimum 10 characters required</span>
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
            className="w-full py-3.5 bg-[#2d6a55] text-white rounded-xl hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
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
            <div className="mt-4 bg-[#f0ede8] border border-[#e4e1da] rounded-xl p-4">
              <p className="text-xs text-[#a8a49d] uppercase tracking-wider mb-2">AI Evaluation Pipeline</p>
              <ul className="text-xs text-[#6b7063] space-y-1">
                <li>Interview Agent (Phase B): Analyzing responses...</li>
                <li>Report Agent: Generating upskilling roadmap...</li>
                <li>Calculating trajectory and match scores...</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
