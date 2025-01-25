Deployment:
Clone the repository.
Navigate to react-text-to-speech directory.
Install npm-run-all in both main and server directories: npm install npm-run-all --save-dev
Inside the server directory:
Create key folder.
Add key.json inside with your API key.
Install serve package: npm install serve@11.3.0
Ensure Node.js version >= 14.
Build with: npm run build
Start backend: node ./server/server.js
Start frontend: sudo ./node_modules/.bin/serve -s build --ssl-cert ../../cert/talemate.cs.vt.edu.crt --ssl-key ../../cert/key3.pem -l 443

If you want to deploy this on a server you need to make the following changes in the files:

Server
- Remove the comments from the last few lines, this is to activate the https server
- Change all the localhost words to talemate.cs.vt.edu

Story
- Change all the localhost words to talemate.cs.vt.edu

RoleDraggable
- Change all the localhost words to talemate.cs.vt.edu

package.json (not in server)
- Change the 'start' to this: cross-env HTTPS=true react-scripts start --openssl-legacy-provider

Local:
Start frontend: npm start
Start server: node ./server/server.js
Run both: npm run dev
