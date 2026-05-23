# Intelligent Recruiter Workspace: Hybrid Dual-Portal Platform

A fully decoupled recruiting platform featuring a 6-Agent AI Core that automatically sources candidates from LinkedIn, neutralizes biases during the matching process, and creates dynamic sandbox environments for candidates to prove their skills instead of standard interviews.

## System Architecture

The platform separates the user interfaces and APIs into distinct frontend and backend services:

### Backend Structure
Built with **FastAPI** to provide a fast, asynchronous API for the frontend components.
- **Relational Storage:** A thread-safe lock-protected flat file (`backend/data/recruiting_db.json`) is utilized as the database.
- **Agent Pipelines:** A sequence of 6 distinct AI agents (`app/services/agents/`) that orchestrate operations autonomously:
  1. **Resume Agent:** Parses CVs and standardizes unstructured text into a JSON schema, applying prestige neutralization.
  2. **Employer Requirement Agent:** Translates job descriptions into structured pillars and builds optimized boolean search queries for active sourcing.
  3. **Matching Agent:** Generates an AI committee debate with a *Critical Recruiter* vs *Talent Advocate* persona to rank "Core Match Fit" and "Trajectory Slope".
  4. **Interview Agent:** Dynamically produces sandbox screening questions (Phase A) tailored to the candidate's core competency gaps, then evaluates and grades the submitted answers (Phase B).
  5. **Report Agent:** Synthesizes an executive "Why This Person?" pitch, crafts personalized outreach emails, and generates a post-screening 3-week upskilling roadmap.
- **External Interfaces:** Includes local PDF parsing (`pypdf`) and an outbound SMTP email gateway.

### Frontend Structure
Built with **React & Vite** and styled using **Tailwind CSS**.
- **Hiring Manager Portal:** An analytics dashboard that tracks the active candidate pipeline. Provides interactive scatter plot (`Recharts`) visualizations of candidate learning trajectories vs their core match percentages, alongside dynamic Bias Mitigation Controls.
- **Candidate Portal:** A private environment for invited (or inbound) candidates. Features an interactive PDF resume uploader and an assessment sandbox where candidates tackle the dynamically generated technical questions.

## Setup & Deployment Instructions

## Project Layout

```text
backend/          FastAPI API, agents, routes, and runtime data
docs/             System specification and implementation plan
src/              React/Vite frontend
guidelines/       Local design and implementation guidelines
```

### Prerequisites
- Node.js & npm (v18+)
- Python 3.9+
- An active OpenAI API Key
- An active SMTP App-Specific Password (e.g., from a Gmail account)

### 1. Environment Configuration

You must set up two separate environment files.

**Backend Configuration (`backend/.env`)**
Create `.env` in the `backend/` directory:
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

**Frontend Configuration (`.env.local`)**
Create `.env.local` in the project root:
```env
VITE_API_URL=http://localhost:8000/api/v1
```

### 2. Backend Initialization
Open a terminal inside the `backend/` directory:
1. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Start the FastAPI backend server:
   ```bash
   python -m uvicorn main:app --reload
   ```

### 3. Frontend Initialization
Open a separate terminal in the root directory:
1. Install Node modules:
   ```bash
   npm install
   ```
2. Start the Vite development server:
   ```bash
   npm run dev
   ```

### 4. Exploring the Portals
Once both servers are actively running:
- Open `http://localhost:5173/` in your browser.
- Select **Hiring Manager Portal** to explore the pipeline, plot data, toggle bias neutralizers, or run the integrated LinkedIn search engine simulator.
- Select **Candidate Experience Portal** to simulate a candidate logging in with their email, uploading their resume, and completing the AI-curated sandbox technical assessment.
