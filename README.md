# TM3 / CA — TaleMate TTS App

A React + Express application for interactive children's story reading with Vertex AI (Gemini) text-to-speech.

---

## Prerequisites

- Node.js >= 14
- npm
- A Google Cloud service account with Vertex AI access

---

## Installation

1. Clone the repository.
2. Navigate to the React app directory:
   ```
   cd react-text-to-speech
   ```
3. Install dependencies in the main and server directories:
   ```
   npm install && npm install npm-run-all --save-dev
   cd server && npm install && cd ..
   ```

---

## Service Account Setup

Place your Google Cloud service account JSON key at:
```
react-text-to-speech/server/key/service-account.json
```
This directory is gitignored and will not be committed.

---

## Environment Setup

Copy the template and fill in your values:
```
cp .env.local.example .env.local
```

**Local development values:**

```bash
DEVMODE=true
KEYPATH=                                              # leave blank for local dev
CERTPATH=                                             # leave blank for local dev
GOOGLE_APPLICATION_CREDENTIALS=./server/key/service-account.json
VERTEX_PROJECT_ID=project-name
VERTEX_LOCATION=us-central1
VERTEX_MODEL=gemini-2.5-flash-tts
REACT_APP_PORT=8000
REACT_APP_API_BASE=http://localhost:8000
REACT_APP_PREVIEW_ONLY=false
```

For production, set `DEVMODE=false` and provide `KEYPATH`/`CERTPATH` pointing to your SSL certificate files.

---

## Local Development

```
npm run dev
```

Runs the React frontend and Express backend in parallel.
- Frontend: `https://localhost:3000`
- Backend: `http://localhost:8000`

---

## Production Deployment

1. Set `DEVMODE=false` and fill in `KEYPATH`/`CERTPATH` in `.env.local`.
2. Install the serve package:
   ```
   npm install serve@11.3.0
   ```
3. Build the frontend:
   ```
   npm run build
   ```
4. Start the backend:
   ```
   node ./server/server.js
   ```
5. Start the frontend (requires sudo for port 443):
   ```
   sudo ./node_modules/.bin/serve -s build \
     --ssl-cert ../../cert/talemate.cs.vt.edu.crt \
     --ssl-key ../../cert/key3.pem \
     -l 443
   ```
