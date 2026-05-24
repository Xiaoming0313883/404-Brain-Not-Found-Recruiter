# 404Hire

404Hire is an AI-assisted recruitment workspace built for hiring managers and candidates. It combines job intake, LinkedIn-style sourcing, resume validation, candidate account management, profile completion, screening questions, match scoring, and hiring-manager feedback in one local-first prototype.

The project was built for coursework, demos, and rapid product validation. It uses a React/Vite frontend, a FastAPI backend, OpenAI-compatible agent services, local JSON storage, and local file uploads.

![404Hire logo](src/assets/404hire-logo.jpeg)

## Table Of Contents

- [Product Overview](#product-overview)
- [Core Capabilities](#core-capabilities)
- [User Roles](#user-roles)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Installation](#installation)
- [Running Locally](#running-locally)
- [Demo Accounts](#demo-accounts)
- [Key Workflows](#key-workflows)
- [AI Agent Design](#ai-agent-design)
- [API Reference](#api-reference)
- [Data And Upload Storage](#data-and-upload-storage)
- [Validation And Safety Rules](#validation-and-safety-rules)
- [Useful Commands](#useful-commands)
- [Troubleshooting](#troubleshooting)
- [Production Readiness Notes](#production-readiness-notes)

## Product Overview

404Hire provides two coordinated portals:

1. Hiring Manager Portal
   - Build and manage job positions.
   - Use an adaptive Requirement Agent to gather role context.
   - Run automatic prototype candidate sourcing.
   - Analyze manual LinkedIn profile URLs.
   - Review candidates by position and pipeline status.
   - Manage candidate accounts on a dedicated account page.
   - Schedule interviews, reject candidates, complete screening, and mark hires.

2. Candidate Portal
   - Enter an email and verify it before profile creation.
   - Upload a valid PDF resume.
   - Let the Resume Agent extract structured profile details.
   - Complete missing required information.
   - Apply to open positions.
   - Complete AI-generated screening questions.
   - Review score, feedback, and upskilling guidance.

The system is intentionally transparent in prototype mode. When SMTP is not configured, 404Hire shows the prototype email verification code directly on the page so the flow remains testable.

## Core Capabilities

- Dual-portal React application.
- Hiring manager login with demo accounts.
- Candidate email lookup, account creation, login, and password setup.
- Prototype-first email verification before candidate profile creation.
- Resume upload with PDF validation and text extraction.
- Resume Agent profile extraction with manual completion flow.
- Required candidate information verification before applications.
- Position creation with open and close application windows.
- Adaptive job intake using the Requirement Agent.
- LinkedIn URL normalization for common profile link formats.
- Automatic prototype candidate sourcing based on selected job requirements.
- Matching Agent scoring and debate-style analysis.
- Interview Agent screening question generation and answer evaluation.
- Detailed AI feedback for hiring managers, including evidence, risks, notes, and follow-up probes.
- Candidate account management on a separate hiring-manager page.
- Pagination for candidate pipeline, candidate accounts, candidate application history, and candidate positions.
- Bias mitigation and neutralized candidate review.
- Local JSON database and upload directory for simple development.

## User Roles

### Hiring Manager

Hiring managers create jobs, source candidates, inspect candidate records, review match analysis, and manage candidate progress through the recruiting funnel.

Main pages:

- Job Builder
- LinkedIn Sourcing
- Candidate Pipeline
- Candidate Accounts
- Interview Calendar

### Candidate

Candidates verify their email, upload resumes, complete profile details, apply to available positions, answer screening questions, and review feedback.

Main pages:

- Candidate Login
- Candidate Home
- Candidate Screening Sandbox
- Candidate Feedback

## System Architecture

```text
Browser
  |
  | React + Vite frontend
  v
src/app
  |
  | HTTP requests to VITE_API_URL
  v
FastAPI backend
  |
  | /api/v1 routes
  v
backend/app/routes
  |
  | service orchestration
  v
backend/app/services
  |
  | agents, mailer, LinkedIn helpers, job windows
  v
backend/data/recruiting_db.json
backend/uploads/
```

### Frontend

The frontend is a Vite React application. It uses React Router for portal routing, utility CSS classes for styling, Radix UI primitives for interaction controls, Lucide React for icons, Recharts for charts, and Motion for small UI transitions.

### Backend

The backend is a FastAPI application. It exposes REST routes under `/api/v1`, stores candidate and job data in a local JSON database, stores uploaded resumes on disk, and calls agent services for resume parsing, requirement intake, matching, interview evaluation, and reporting.

## Tech Stack

### Frontend

- React
- TypeScript
- Vite
- Tailwind-style utility classes
- Radix UI
- Lucide React
- Recharts
- Motion

### Backend

- Python
- FastAPI
- Uvicorn
- Pydantic
- OpenAI-compatible chat completions client
- pypdf
- PyMuPDF and pdfminer fallbacks when available
- Pillow, pytesseract, and RapidOCR when available

### Storage

- Local JSON file: `backend/data/recruiting_db.json`
- Uploaded resumes: `backend/uploads/resumes/`
- Extracted profile images: `backend/uploads/profile_pictures/`

## Project Structure

```text
.
|-- backend/
|   |-- app/
|   |   |-- config.py
|   |   |-- database.py
|   |   |-- routes/
|   |   |   |-- candidates.py
|   |   |   |-- jobs.py
|   |   |   `-- settings.py
|   |   `-- services/
|   |       |-- agents/
|   |       |   |-- base_agent.py
|   |       |   |-- requirement_agent.py
|   |       |   |-- resume_agent.py
|   |       |   |-- matching_agent.py
|   |       |   |-- interview_agent.py
|   |       |   `-- report_agent.py
|   |       |-- job_windows.py
|   |       |-- linkedin_profiles.py
|   |       `-- mailer.py
|   |-- main.py
|   |-- requirements.txt
|   `-- .env.example
|-- src/
|   |-- assets/
|   |   `-- 404hire-logo.jpeg
|   |-- app/
|   |   |-- App.tsx
|   |   `-- components/
|   |       |-- BrandLogo.tsx
|   |       |-- CandidatePortal.tsx
|   |       |-- HiringManagerPortal.tsx
|   |       |-- PortalSelector.tsx
|   |       |-- candidate/
|   |       `-- hiring-manager/
|   |-- main.tsx
|   `-- styles/
|-- index.html
|-- package.json
|-- vite.config.ts
`-- README.md
```

## Prerequisites

Install the following:

- Node.js 20 or newer
- npm 10 or newer
- Python 3.10 or newer
- pip

Optional for scanned or image-only resumes:

- Tesseract OCR executable in `PATH`
- Python OCR dependencies from `backend/requirements.txt`

Text-based PDF resumes work best. Image-only PDFs may require OCR or manual candidate profile completion.

## Environment Variables

### Backend

Create `backend/.env` from the example file:

```powershell
Copy-Item backend\.env.example backend\.env
```

Example backend configuration:

```env
HOST=0.0.0.0
PORT=8000
DEBUG=True
DATABASE_PATH=data/recruiting_db.json

OPENAI_API_KEY=your_openai_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini

RESUME_AGENT_TEMP=0.1
REQUIREMENT_AGENT_TEMP=0.2
MATCHING_AGENT_TEMP=0.4
INTERVIEW_AGENT_TEMP=0.3
REPORT_AGENT_TEMP=0.3

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password
```

Do not commit real API keys, SMTP passwords, or personal secrets.

### Frontend

Create `.env.local` in the project root:

```env
VITE_API_URL=http://localhost:8000/api/v1
```

## Installation

This repository uses npm for the frontend. Use the committed `package-lock.json`; do not mix in pnpm or Yarn lockfiles.

Install frontend dependencies:

```powershell
npm install
```

For a clean GitHub clone or CI install, you can also use:

```powershell
npm ci
```

Install backend dependencies:

```powershell
python -m pip install -r backend\requirements.txt
```

If browser automation dependencies are needed later:

```powershell
python -m playwright install
```

## Running Locally

Run the backend in one terminal:

```powershell
python -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload
```

Run the frontend in another terminal:

```powershell
npm run dev
```

Open the Vite URL shown in the terminal, usually:

```text
http://localhost:5173/
```

Backend health check:

```powershell
Invoke-WebRequest http://localhost:8000/ -UseBasicParsing
```

Expected response:

```json
{
  "status": "online",
  "service": "Intelligent Recruiter Workspace API",
  "version": "1.0.0"
}
```

## Demo Accounts

Hiring manager demo accounts:

```text
admin@company.com
password
```

```text
hiring@company.com
password
```

Candidates are created through the Candidate Portal.

## Key Workflows

### Hiring Manager: Create A Position

1. Sign in to the Hiring Manager Portal.
2. Open Job Builder.
3. Create a new position.
4. Enter title, department, application window, and status.
5. Continue to Requirement Agent intake.
6. Answer adaptive follow-up questions.
7. Review generated description and requirements.
8. Publish the position.

The Requirement Agent generates:

- Candidate-facing job description
- Requirements
- Skill or domain pillars
- Behavioral signals
- Boolean sourcing query
- Sourcing criteria used by matching and auto-source

### Hiring Manager: Source Candidates

1. Open LinkedIn Sourcing.
2. Select a target position.
3. Choose Automatic Agent Search or Manual URL Scrape.
4. Review staged candidate analysis.
5. Edit outreach email if needed.
6. Send invitation.

Manual LinkedIn URLs support common copied formats, including:

- `linkedin.com/in/name`
- `https://linkedin.com/in/name?utm_source=share`
- `https://my.linkedin.com/in/name/`
- old `/pub/name/...` links

LinkedIn often blocks unauthenticated scraping, so 404Hire stores source warnings and asks hiring managers to verify profile details before outreach.

### Hiring Manager: Review Pipeline

1. Open Candidate Pipeline.
2. Scope the dashboard to all positions or a selected position.
3. Review KPIs, charting, fit scores, and candidate rows.
4. Open a candidate to inspect resume, profile details, match debate, and screening feedback.
5. Mark screening, schedule interview, reject, complete, or hire.

Candidate lists include pagination to keep large datasets usable.

### Hiring Manager: Manage Candidate Accounts

1. Open Candidate Accounts.
2. Search by name or email.
3. Filter by verification or password state.
4. Verify/unverify email.
5. Verify/pending profile.
6. Reset password.
7. Delete account if needed.

This page is separate from the pipeline so account administration does not clutter position review.

### Candidate: Create Profile

1. Open Candidate Portal.
2. Enter email.
3. Verify the prototype code shown on the page.
4. Create password.
5. Upload a valid PDF resume.
6. Review extracted profile details.
7. Complete missing required fields.
8. Apply to available positions.

The candidate cannot continue profile creation until email verification is complete.

### Candidate: Complete Screening

1. Apply to an open position.
2. Answer generated screening questions.
3. Submit answers.
4. Review feedback and roadmap.

The backend evaluates answers against the selected position, not against generic interview criteria.

## AI Agent Design

### Requirement Agent

File:

```text
backend/app/services/agents/requirement_agent.py
```

Purpose:

- Conduct adaptive hiring-manager intake.
- Ask one relevant question at a time.
- Avoid fixed scripts and repeated questions.
- Generate job requirements that match the actual role family.
- Avoid inventing technical requirements for non-technical roles.

### Resume Agent

File:

```text
backend/app/services/agents/resume_agent.py
```

Purpose:

- Convert resume text into structured candidate profile data.
- Extract name, email, phone, location, education, work experience, skills, awards, and qualifications.
- Fall back to rule-based parsing when LLM access is unavailable.
- Support prestige neutralization when requested.

### Matching Agent

File:

```text
backend/app/services/agents/matching_agent.py
```

Purpose:

- Compare candidate profile against the selected job.
- Score technical/domain evidence, success signals, culture, and trajectory.
- Produce Talent Advocate and Critical Recruiter perspectives.

### Interview Agent

File:

```text
backend/app/services/agents/interview_agent.py
```

Purpose:

- Generate role-specific screening questions.
- Evaluate candidate answers.
- Provide score breakdowns.
- Produce detailed hiring-manager feedback, including evidence, risks, opinion, and suggested follow-up probes.

### Report Agent

File:

```text
backend/app/services/agents/report_agent.py
```

Purpose:

- Generate sourcing pitch.
- Generate outreach email.
- Generate candidate upskilling roadmap.

## API Reference

Base URL:

```text
http://localhost:8000/api/v1
```

### Jobs

```text
GET /jobs
GET /jobs?active_only=true
POST /jobs/intake
POST /jobs
PATCH /jobs/{job_id}
DELETE /jobs/{job_id}
```

Example intake body:

```json
{
  "title": "Bakery Assistant",
  "department": "Kitchen",
  "chat_messages": [
    { "role": "agent", "content": "What products or duties will this person handle most often?" },
    { "role": "manager", "content": "Bread preparation, oven timing, food hygiene, and early shift prep." }
  ]
}
```

### Candidates

```text
GET /candidates
GET /candidates?neutralize=true
GET /candidates/lookup?email={email}
POST /candidates/start-email-verification
POST /candidates/verify-pending-email
POST /candidates/signup
POST /candidates/login
POST /candidates/{email}/password
POST /candidates/{email}/reset-password
POST /candidates/{email}/verify-email
POST /candidates/{email}/resend-verification
PATCH /candidates/{email}/profile
PATCH /candidates/{email}/account
POST /candidates/{email}/apply-position
POST /candidates/{email}/sandbox
GET /candidates/{email}/resume
POST /candidates/scrape
POST /candidates/auto-source
POST /candidates/invite
PATCH /candidates/{email}/status
POST /candidates/{email}/reject
POST /candidates/{email}/schedule-interview
GET /candidates/interview-calendar
DELETE /candidates/{email}
```

### Candidate Email Verification

Start verification:

```text
POST /candidates/start-email-verification
```

```json
{
  "email": "candidate@example.com"
}
```

Verify pending email:

```text
POST /candidates/verify-pending-email
```

```json
{
  "email": "candidate@example.com",
  "code": "123456"
}
```

### Candidate Signup

```text
POST /candidates/signup
```

Form fields:

- `name`
- `email`
- `password`
- `resume`

Rules:

- Email must already be verified through pending verification.
- Resume must be a valid PDF.
- Resume text must look like a readable resume.
- Existing candidate accounts are rejected with a conflict response.

### LinkedIn Sourcing

Manual URL scrape:

```text
POST /candidates/scrape
```

```json
{
  "position_id": 1,
  "linkedin_url": "https://www.linkedin.com/in/example-profile"
}
```

Automatic prototype sourcing:

```text
POST /candidates/auto-source
```

```json
{
  "position_id": 1,
  "count": 3
}
```

Auto-source profiles are generated from the selected job context and calibrated for prototype demonstration. They are not real LinkedIn profiles.

## Data And Upload Storage

The local database is:

```text
backend/data/recruiting_db.json
```

Uploaded resumes are stored in:

```text
backend/uploads/resumes/
```

Profile pictures extracted from PDFs are stored in:

```text
backend/uploads/profile_pictures/
```

This storage model is easy to inspect during development, but it is not intended for production-scale use.

## Validation And Safety Rules

404Hire includes several validation controls:

- Email format validation.
- Prototype email verification before candidate profile creation.
- Password minimum length enforcement.
- PDF-only resume upload.
- Resume file size limit.
- Resume text validity check before Resume Agent processing.
- Duplicate candidate account prevention.
- Duplicate application prevention per position.
- Required candidate profile fields before applying.
- Agent fallback warnings shown to users when fallback logic is used.
- Hiring-manager action lock to prevent accidental double-click status changes.

## Useful Commands

Start backend:

```powershell
python -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload
```

Start frontend:

```powershell
npm run dev
```

Build frontend:

```powershell
npm run build
```

Compile-check backend:

```powershell
python -m compileall backend\app
```

Check backend health:

```powershell
Invoke-WebRequest http://localhost:8000/ -UseBasicParsing
```

Install backend packages:

```powershell
python -m pip install -r backend\requirements.txt
```

## Troubleshooting

### Backend cannot import `main`

Use the root command with `--app-dir backend`:

```powershell
python -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload
```

### Frontend shows API connection errors

Check that the backend is running:

```powershell
Invoke-WebRequest http://localhost:8000/ -UseBasicParsing
```

Confirm `.env.local` contains:

```env
VITE_API_URL=http://localhost:8000/api/v1
```

### `npm install` fails

Use Node.js 20 or newer and npm 10 or newer:

```powershell
node -v
npm -v
```

Then reinstall from the npm lockfile:

```powershell
npm install
```

If the local dependency folder came from an older install attempt, remove `node_modules` and run `npm install` again. The project is intentionally npm-only, so avoid generating `pnpm-lock.yaml` or `yarn.lock`.

### Resume upload fails validation

The uploaded PDF may not contain readable resume text.

Recommended fixes:

- Export the resume as a text-based PDF.
- Avoid screenshots or scanned-only PDFs.
- Install Tesseract OCR if scanned resumes must be supported.
- Confirm the file is below the upload limit.

### Candidate cannot apply

Check:

- Email is verified.
- Required profile fields are complete.
- The position is open for applications.
- The candidate has not already applied to the same position.

### LinkedIn profile URL is rejected

Use a profile URL containing `/in/username` or `/pub/username`. The backend normalizes common copied formats, but it does not accept company pages, job pages, feed posts, or search result URLs.

### Automatic sourcing returns prototype profiles

This is expected. Auto-source is a prototype search simulation. It builds sample profiles from the selected job requirements so hiring managers can test sourcing, scoring, outreach, and invitation workflows without live LinkedIn access.

### Large Vite chunk warning

`npm run build` may warn that a JavaScript chunk is larger than 500 kB. This is a build optimization warning, not a build failure. Route-level code splitting can reduce the warning later.

## Production Readiness Notes

Before production, replace or improve the following:

- Replace demo hiring-manager login with real authentication.
- Move JSON storage to PostgreSQL, MySQL, or another database.
- Store resumes in managed object storage.
- Add signed URLs or authorization checks for resume downloads.
- Restrict CORS origins in `backend/main.py`.
- Remove prototype verification-code display.
- Configure reliable SMTP or transactional email.
- Add audit logs for candidate status changes.
- Add route-level automated tests.
- Add rate limits for signup, login, and email verification.
- Add production OCR or document parsing service.
- Add monitoring and structured logging.

## Verification Checklist

After setup, verify:

- Backend health check returns online status.
- Frontend opens at the Vite dev URL.
- 404Hire logo appears on the landing page and portal login screens.
- Hiring manager can sign in.
- Requirement Agent asks an adaptive question.
- Position can be created and published.
- Automatic sourcing returns candidates with position-relevant scores.
- LinkedIn URL scrape accepts common profile URL formats.
- Candidate can verify email before signup.
- Candidate can upload a valid resume.
- Candidate can complete missing profile details.
- Candidate can apply to an open position.
- Candidate can submit screening answers.
- Hiring manager can review detailed AI feedback.
- Candidate accounts page supports account administration.

## License

This project is intended for coursework, demos, and prototype use. Add a formal license before public release.
