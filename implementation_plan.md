# Implementation Plan - Streaming Progress Updates for Auto-Sourcing

Add real-time progress updates to the automatic candidate sourcing pipeline. Sourcing runs slow because it triggers remote scraper runs and runs sequential LLM agents (matching debate, interview question generator, outreach pitch generator). We will use Server-Sent Events (SSE) to stream progress logs from the backend FastAPI server to the React frontend.

## User Review Required

> [!NOTE]
> The backend `/candidates/auto-source` POST endpoint will be refactored to return a chunked `StreamingResponse` (content type `text/event-stream`) instead of a static JSON list. The React frontend will read the response stream line-by-line using a `TextDecoder` and a stream reader to update the UI progress console in real time.

## Proposed Changes

### Routes (Backend)

#### [MODIFY] [candidates.py](file:///c:/Users/User/404-Brain-Not-Found-Recruiter/backend/app/routes/candidates.py)
- Import `StreamingResponse` from `fastapi.responses`.
- In [auto_source_candidates](file:///c:/Users/User/404-Brain-Not-Found-Recruiter/backend/app/routes/candidates.py#L1763):
  - Refactor to define an inner generator function `event_generator()` that yields progress logs (`yield f"data: {json.dumps({'log': '...'})}\n\n"`).
  - During the Apify search and scraper execution, yield status updates (e.g., "Starting Apify Actor...", "Scraped profile URLs...").
  - During candidate evaluation, yield updates indicating which candidate is being processed (e.g., "Evaluating Hovhannes Shitikyan...").
  - At the end, yield the final staged candidates list (`yield f"data: {json.dumps({'result': generated})}\n\n"`).
  - Return `StreamingResponse(event_generator(), media_type="text/event-stream")`.

### Components (Frontend)

#### [MODIFY] [LinkedInScraper.tsx](file:///c:/Users/User/404-Brain-Not-Found-Recruiter/src/app/components/hiring-manager/LinkedInScraper.tsx)
- Refactor [handleAutoSource](file:///c:/Users/User/404-Brain-Not-Found-Recruiter/src/app/components/hiring-manager/LinkedInScraper.tsx#L52) to read the response body as a readable stream reader.
- Use `TextDecoder` to decode chunks of stream bytes and split them by `\n` to process each SSE line.
- Parse JSON data from lines starting with `data: ` and update the `processingLogs` state in real time for `{'log': ...}` events.
- On receipt of `{'result': ...}` event, map and set the candidates into the staged list and display the success notification.

---

## Verification Plan

### Automated Tests
- Run a dry-run test using Python to execute the FastAPI streaming endpoint and print the yielded stream events to check formatting and output.

### Manual Verification
- Deploy and click the "Run Automatic Agent Search" button in the browser to verify the progress logs stream in real time during the 2-minute execution.
