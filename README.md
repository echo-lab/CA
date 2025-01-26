**Installation**

- Clone the repository.
- Navigate to react-text-to-speech directory.
- Install `npm-run-all` in both main and server directories: `npm install npm-run-all --save-dev
- you need .env.local file and include the following
  - KEYPATH=[path to the key file]
  - CERTPATH=[path to the certificate file]
  - GOOGLEAPI_KEY=[Ask Sang for Google API Key]
  - REACT_APP_PORT=8000
  - REACT_APP_TTSURL=[http://localhost for local development] or [https://talemate.cs.vt.edu for production]
  - DEVMODE=[true if local development, false for production]

The following instructions are for Production Server 
- Install serve package: npm install serve@11.3.0
- Ensure Node.js version >= 14.
- Build with: `npm run build`
- Start backend: `node ./server/server.js`
- Start frontend: `sudo ./node_modules/.bin/serve -s build --ssl-cert ../../cert/talemate.cs.vt.edu.crt --ssl-key ../../cert/key3.pem -l 443`

The following instructions are for Local Development.
- Run both: npm run dev
