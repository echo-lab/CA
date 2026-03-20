# TaleMate Local Setup Guide

## Prerequisites

- Node.js installed
- API keys configured in `server/.env.local`

## 1. Configure Environment Variables

### `server/.env.local`

Ensure these are set (use `.env.local.template` as reference):

```
DEVMODE=true
REACT_APP_PORT=5004
OPENAI_API_KEY=<your-key>
DEEPGRAM_API_KEY=<your-key>
GOOGLEAPI_KEY=<your-key>
GEMINI_API_KEY=<your-key>
TTS_BACKEND=gemini
```

> If using `TTS_BACKEND=vertex`, you must also set `VERTEX_PROJECT_ID` and have GCP credentials configured.

### `.env` (root)

Update these lines to point to your local server:

```
REACT_APP_TTSURL=http://localhost:5004
REACT_APP_API_BASE=http://localhost:5004
REACT_APP_PREVIEW_ONLY=false
REACT_APP_PORT=5004
```

## 2. Update `package.json` (root)

Set the proxy to match your local server:

```json
"proxy": "http://localhost:5004"
```

Optionally, remove `HTTPS=true` from the `start` script to avoid self-signed certificate warnings:

```json
"start": "react-scripts start --openssl-legacy-provider"
```

## 3. Install Dependencies

```bash
# Root (React frontend)
npm install

# Server
cd server
npm install
```

## 4. Run

Open two terminals:

**Terminal 1 — Server:**
```bash
cd server
npm start
```
Server starts on `http://localhost:5004`.

**Terminal 2 — React Frontend:**
```bash
npm start
```
Frontend starts on `http://localhost:3000` and proxies API calls to the server.

## 5. Test Endpoints

- **Full app:** http://localhost:3000
- **Categorization test page:** http://localhost:5004/test-categorize

## Notes

- `DEVMODE=true` runs the server in HTTP mode (no SSL certs needed).
- The root `.env` file has production values by default — make sure to update it before running locally.
- `KEYPATH` and `CERTPATH` can be left empty when `DEVMODE=true`.
