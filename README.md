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

### Keeping it up across reboots (pm2)

`ecosystem.config.js` in `react-text-to-speech/` defines both processes
(`talemate-api`, `talemate-web`). Do steps 1-4 above (`.env.local`, `npm run build`)
first, then add them to the pm2 list that already runs on this VM:

```
cd react-text-to-speech
pm2 start ecosystem.config.js
pm2 save          # snapshot the whole list -- run it while the other apps are up
```

`pm2 save` is what survives the reboot; re-run it after any `pm2 start`/`delete`.
`pm2 startup` is already installed on this VM, so don't re-run it.

One catch: `talemate-web` binds :443, which a non-root pm2 daemon can't do. Rather
than starting a second pm2 daemon under root (separate list, separate `pm2 save`,
separate startup unit), grant the port to node once:

```
sudo setcap cap_net_bind_service=+ep "$(readlink -f "$(which node)")"
```

Redo that after a node upgrade -- if :443 starts failing with `EACCES`, that's why.

Useful afterwards: `pm2 ls`, `pm2 logs talemate-api`,
`pm2 restart talemate-api talemate-web` (picks up a new `npm run build` / `.env.local`).
