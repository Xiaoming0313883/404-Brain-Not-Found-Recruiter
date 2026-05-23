# 404 Brain Not Found Recruiter

An AI-assisted dual-portal recruitment workspace for hiring managers and candidates. The system helps hiring managers define roles through an adaptive Requirement Agent, source and review candidates, store uploaded resumes, analyze candidate-role fit, and run candidate screening sessions. Candidates can register, upload a resume, verify extracted profile details, apply to open positions, and complete AI-generated interview questions.

## Table Of Contents

- [What This Project Does](#what-this-project-does)
- [Core Features](#core-features)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Install From Zero](#install-from-zero)
- [Run The Project](#run-the-project)
- [Login And Demo Data](#login-and-demo-data)
- [Main Workflows](#main-workflows)
- [AI Agents](#ai-agents)
- [Resume Upload And OCR Notes](#resume-upload-and-ocr-notes)
- [API Reference](#api-reference)
- [Data Storage](#data-storage)
- [Useful Commands](#useful-commands)
- [Troubleshooting](#troubleshooting)
- [Production Notes](#production-notes)

## What This Project Does

This project simulates a modern recruitment platform with two portals:

1. **Hiring Manager Portal**
   - Build job positions with an adaptive AI intake.
   - Generate job descriptions and requirements from manager answers.
   - Source candidates through the LinkedIn sourcing simulator.
   - Review candidate dashboards by position.
   - View uploaded resumes, resume text, extracted basic information, scores, and AI analysis.

2. **Candidate Portal**
   - Register or log in with email and password.
   - Upload a PDF resume.
   - Let the Resume Agent extract profile details.
   - Verify or complete required details before applying.
   - Apply once per position.
   - Complete an AI-generated screening sandbox.
   - View results, feedback, and upskilling roadmap.

The project is intentionally local-first and uses a JSON file as the database, making it easy to run for demos, coursework, and prototyping.

## Core Features

- Dual portal routing for hiring managers and candidates.
- Adaptive Requirement Agent for job builder intake.
- AI-generated job descriptions, requirements, sourcing summaries, and Boolean search profiles.
- Candidate resume upload and storage.
- Resume PDF viewing from the hiring manager dashboard.
- Resume Agent profile extraction.
- Candidate information verification before applications.
- Per-position candidate application tracking.
- Duplicate application prevention.
- Candidate screening sandbox with generated questions.
- Screening score, critique, and roadmap generation.
- Hiring manager candidate analytics by position.
- Scatter chart for match score vs trajectory score.
- Bias mitigation controls and anonymized review mode.
- Local JSON database with thread-safe file access.

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
  | Routes
  v
backend/app/routes
  |
  | Agent orchestration + storage helpers
  v
backend/app/services
  |
  | JSON data + uploaded files
  v
backend/data/recruiting_db.json
backend/uploads/
```

### Frontend

The frontend is a Vite React app. It uses React Router for portal routing, Tailwind-style utility classes for styling, Radix UI primitives for controls, Lucide icons, and Recharts for charts.

### Backend

The backend is a FastAPI app. It exposes REST endpoints under `/api/v1`, stores data in `backend/data/recruiting_db.json`, stores uploaded resumes in `backend/uploads/resumes`, and runs local/LLM-powered agent functions.

## Tech Stack

### Frontend

- React
- Vite
- TypeScript
- Tailwind CSS
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
- Pillow
- pytesseract
- python-multipart

### Storage

- JSON flat-file database: `backend/data/recruiting_db.json`
- Uploaded files: `backend/uploads/`

## Project Structure

```text
.
├── backend/
│   ├── app/
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── routes/
│   │   │   ├── candidates.py
│   │   │   ├── jobs.py
│   │   │   └── settings.py
│   │   └── services/
│   │       ├── agents/
│   │       │   ├── base_agent.py
│   │       │   ├── requirement_agent.py
│   │       │   ├── resume_agent.py
│   │       │   ├── matching_agent.py
│   │       │   ├── interview_agent.py
│   │       │   └── report_agent.py
│   │       ├── job_windows.py
│   │       ├── linkedin_profiles.py
│   │       └── mailer.py
│   ├── data/
│   │   └── recruiting_db.json
│   ├── uploads/
│   │   ├── resumes/
│   │   └── profile_pictures/
│   ├── main.py
│   ├── requirements.txt
│   └── .env.example
├── docs/
├── guidelines/
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   └── components/
│   │       ├── CandidatePortal.tsx
│   │       ├── HiringManagerPortal.tsx
│   │       ├── PortalSelector.tsx
│   │       ├── candidate/
│   │       └── hiring-manager/
│   ├── main.tsx
│   └── styles/
├── package.json
├── vite.config.ts
└── README.md
```

## Prerequisites

Install these first:

- Node.js 18 or newer
- npm
- Python 3.10 or newer
- pip

Optional but recommended for image-only resume PDFs:

- Tesseract OCR executable installed and available in `PATH`

The Python packages `Pillow` and `pytesseract` are listed in `backend/requirements.txt`, but `pytesseract` still needs the external Tesseract program for local OCR. Without Tesseract, normal text PDFs still work; image-only PDFs may require manual verification unless your configured AI model supports vision.

## Environment Setup

### Backend Environment

Create `backend/.env` from `backend/.env.example`.

```powershell
Copy-Item backend\.env.example backend\.env
```

Example:

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
SMTP_PASSWORD=your_app_specific_password
```

Do not commit real API keys, SMTP passwords, or personal secrets.

### Frontend Environment

Create `.env.local` in the project root:

```env
VITE_API_URL=http://localhost:8000/api/v1
```

The frontend reads this value when calling FastAPI.

## Install From Zero

From the project root:

```powershell
npm install
```

Then install backend dependencies:

```powershell
python -m pip install -r backend\requirements.txt
```

If Playwright is needed for future browser automation:

```powershell
python -m playwright install
```

## Run The Project

You need two terminals.

### Terminal 1: Backend

From the project root:

```powershell
python -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload
```

Alternative:

```powershell
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Health check:

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

### Terminal 2: Frontend

From the project root:

```powershell
npm run dev
```

Open the Vite URL shown in the terminal, usually:

```text
http://localhost:5173/
```

## Login And Demo Data

### Hiring Manager Demo Accounts

Use either account:

```text
admin@company.com
password
```

```text
hiring@company.com
password
```

### Candidate Accounts

Candidates are created through the Candidate Portal.

Flow:

1. Open Candidate Portal.
2. Enter a valid email address.
3. Create a password.
4. Upload a PDF resume.
5. Enter the prototype email verification code.
6. Verify extracted information.
7. Apply to an open position.

## Main Workflows

### Hiring Manager: Create A Position

1. Sign in to Hiring Manager Portal.
2. Open **Job Builder**.
3. Click **New Position**.
4. Enter:
   - job title
   - department
   - open time
   - end time
   - status
5. Continue to AI Intake.
6. The Requirement Agent asks adaptive follow-up questions.
7. Once the agent has enough context, publish the position.
8. The backend generates:
   - job description
   - requirements
   - sourcing criteria
   - Boolean query
   - skill pillars
   - behavioral/domain pillars

The frontend does not use fixed intake questions. It calls:

```text
POST /api/v1/jobs/intake
```

The Requirement Agent decides the next question based on previous answers.

### Hiring Manager: Source Candidates

1. Open **LinkedIn Sourcing**.
2. Select a position.
3. Use auto-source or LinkedIn URL scraping.
4. Review staged candidate details.
5. Send invitation.

### Hiring Manager: Review Candidate Pipeline

1. Open **Candidate Pipeline**.
2. Select all positions or one position dashboard.
3. Review:
   - total candidates
   - completed screenings
   - average match score
   - scatter chart
   - candidate resume
   - extracted profile fields
   - AI committee analysis
   - screening score

### Candidate: Register And Verify Profile

1. Open Candidate Portal.
2. Enter a valid email address.
3. Create a password and upload a PDF resume.
4. The backend creates a prototype email verification code and attempts SMTP delivery.
5. Candidate enters the verification code before continuing.
6. Resume Agent extracts:
   - name
   - age, if visible
   - address
   - came from
   - phone number
   - working experience
   - qualification
   - grade/results
   - awards
   - skills
7. Candidate reviews and completes missing fields.
8. Candidate saves details.
9. Candidate can apply to an open position.

The candidate cannot apply until email verification and required profile information are completed. In prototype mode, the backend returns `prototype_verification_code` so the flow can be tested locally before real email delivery is implemented.

### Candidate: Apply And Complete Screening

1. Choose an available position.
2. Click Apply.
3. Complete generated screening questions.
4. Submit answers.
5. View result, critique, and upskilling roadmap.

Candidates cannot apply to the same position twice.

## AI Agents

### Resume Agent

File:

```text
backend/app/services/agents/resume_agent.py
```

Responsibilities:

- Parse raw resume text into structured profile data.
- Extract candidate basics and qualifications.
- Avoid inventing fake schools, employers, or experience.
- Apply prestige neutralization when requested.
- Provide fallback parsing when LLM access is unavailable.

### Requirement Agent

File:

```text
backend/app/services/agents/requirement_agent.py
```

Responsibilities:

- Ask adaptive job-builder questions.
- Decide when enough role context has been collected.
- Generate job description and requirements.
- Generate Boolean sourcing search strings.
- Extract skill and behavioral pillars.

### Matching Agent

File:

```text
backend/app/services/agents/matching_agent.py
```

Responsibilities:

- Compare candidate profile with job requirements.
- Generate score categories.
- Produce a debate-style analysis:
  - Talent Advocate
  - Critical Recruiter

### Interview Agent

File:

```text
backend/app/services/agents/interview_agent.py
```

Responsibilities:

- Generate screening questions.
- Evaluate answers.
- Score candidate screening performance.

### Report Agent

File:

```text
backend/app/services/agents/report_agent.py
```

Responsibilities:

- Generate sourcing pitch.
- Generate outreach email.
- Generate candidate roadmap after screening.

## Resume Upload And OCR Notes

Resume uploads use:

```text
POST /api/v1/candidates/signup
```

Uploaded files are saved under:

```text
backend/uploads/resumes/
```

The backend first tries normal PDF text extraction with `pypdf`. If the PDF is image-only, it attempts image extraction. Local OCR needs:

- `Pillow`
- `pytesseract`
- Tesseract executable installed on the machine

If Tesseract is not installed and the configured AI model does not support vision input, image-only resumes may not fully prefill. The candidate can still manually verify details on the Information Details page.

Recommended resume formats for best extraction:

- Text-based PDF exported from Word, Google Docs, Canva, or LaTeX.
- Avoid scanned screenshots if OCR is not configured.
- Keep contact and education fields visible as selectable text.

## API Reference

Base URL:

```text
http://localhost:8000/api/v1
```

### Jobs

```text
GET /jobs
```

Returns all positions.

```text
GET /jobs?active_only=true
```

Returns currently open positions.

```text
POST /jobs/intake
```

Gets the next adaptive Requirement Agent question or final generated role context.

Body:

```json
{
  "title": "Chef",
  "department": "Product",
  "chat_messages": [
    { "role": "agent", "content": "What outcomes should this role own?" },
    { "role": "manager", "content": "Prepare Sichuan dishes for a Chinese restaurant." }
  ]
}
```

```text
POST /jobs
```

Creates a position.

```text
PATCH /jobs/{job_id}
```

Updates a position.

### Candidates

```text
GET /candidates
```

Returns candidate/application rows.

```text
GET /candidates?neutralize=true
```

Returns neutralized candidate data.

```text
GET /candidates/lookup?email={email}
```

Finds a candidate by email.

```text
POST /candidates/signup
```

Creates a candidate profile with resume upload, validates the email address, creates a verification code, and attempts to send a verification email.

Form fields:

- `name`
- `email`
- `password`
- `resume`

Prototype response fields include:

- `email_verified`
- `verification_sent`
- `prototype_verification_code`

```text
POST /candidates/{email}/verify-email
```

Verifies the candidate email address.

Body:

```json
{
  "code": "123456"
}
```

```text
POST /candidates/{email}/resend-verification
```

Generates and sends a new prototype verification code.

```text
PATCH /candidates/{email}/profile
```

Saves verified candidate profile details.

```text
POST /candidates/{email}/apply-position
```

Applies a candidate to a position.

```text
POST /candidates/{email}/sandbox
```

Submits screening answers.

```text
GET /candidates/{email}/resume
```

Downloads or views the original uploaded resume.

```text
POST /candidates/scrape
```

Creates a staged candidate from a LinkedIn URL/profile simulator.

```text
POST /candidates/auto-source
```

Generates sample sourced candidates for a position.

```text
POST /candidates/invite
```

Marks a candidate as invited and attempts email delivery.

```text
PATCH /candidates/{email}/status
```

Updates candidate/application status.

```text
DELETE /candidates/{email}
```

Deletes a candidate.

## Data Storage

The project uses a local JSON file:

```text
backend/data/recruiting_db.json
```

The database stores:

- positions
- candidate profiles
- applications
- match results
- screening answers
- evaluations
- resume paths

Database access is protected by a Python thread lock in:

```text
backend/app/database.py
```

This is suitable for demos and coursework, not high-concurrency production.

## Useful Commands

### Start backend from root

```powershell
python -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload
```

### Start backend from backend folder

```powershell
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Start frontend

```powershell
npm run dev
```

### Build frontend

```powershell
npm run build
```

### Compile-check backend

```powershell
python -m compileall backend\app
```

### Install backend dependencies

```powershell
python -m pip install -r backend\requirements.txt
```

### Check backend health

```powershell
Invoke-WebRequest http://localhost:8000/ -UseBasicParsing
```

## Troubleshooting

### Uvicorn says: Could not import module `main`

You are probably running Uvicorn from the project root without telling it where `backend/main.py` lives.

Use:

```powershell
python -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload
```

Or:

```powershell
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend says `Failed to fetch`

The backend is not reachable.

Check:

```powershell
Invoke-WebRequest http://localhost:8000/ -UseBasicParsing
```

If it times out, start the backend.

### Job Builder cannot ask AI intake questions

Check:

```powershell
Invoke-WebRequest http://localhost:8000/api/v1/jobs/intake `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"title":"Software Engineer","department":"Engineering","chat_messages":[]}' `
  -UseBasicParsing
```

If this fails, the backend is not running or the route import failed.

### Resume fields do not prefill

Possible causes:

- The PDF is image-only.
- Tesseract OCR is not installed.
- The configured AI model does not support vision.
- The resume has unusual formatting.

Fixes:

- Upload a text-based PDF.
- Install Tesseract and ensure it is available in `PATH`.
- Manually complete the Information Details form.

### Candidate cannot apply

Candidates must verify required fields first:

- name
- age
- address
- came from
- phone number
- working experience
- qualification
- grade/results

Candidates also cannot apply to the same position more than once.

### Port 8000 is already in use

Find the owning process:

```powershell
Get-NetTCPConnection -LocalPort 8000
```

Stop a Python/Uvicorn process if needed:

```powershell
Get-Process python
Stop-Process -Id <process_id>
```

### Large Vite chunk warning

`npm run build` may warn that one JS chunk is larger than 500 kB. This is a build optimization warning, not a failure. Future improvements could split routes with dynamic imports.

## Production Notes

Before production:

- Replace mock hiring-manager login with real authentication.
- Move JSON storage to PostgreSQL, MySQL, or another database.
- Store uploads in managed object storage.
- Add access controls for resume files.
- Restrict CORS origins in `backend/main.py`.
- Remove demo credentials.
- Add audit logs for candidate status changes.
- Add server-side validation for all candidate profile fields.
- Use a production WSGI/ASGI deployment strategy.
- Add test coverage for routes and agents.
- Configure a reliable OCR service for scanned resumes.

## Verification Checklist

After setup, verify:

- Backend health check returns online status.
- Frontend opens at the Vite dev URL.
- Hiring manager can sign in.
- Requirement Agent asks a dynamic question in Job Builder.
- A new position can be published.
- Candidate can register and upload a resume.
- Candidate information page is populated or manually editable.
- Candidate can verify details.
- Candidate can apply to an open position.
- Hiring manager can see the candidate in the position dashboard.
- Hiring manager can open the candidate resume.

## License

This project is intended for coursework, demos, and prototype use. Add your chosen license before public release.
