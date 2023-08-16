Run these commands before running:
npm install react-router-dom --save
npm install @mui/icons-material 
$env:NODE_OPTIONS="--openssl-legacy-provider"
npm run to run the client
node ./server/server.js to run the server
npm run dev to run server and client


To run in the server:
Make sure the server is running : node ./server/server.js

Then run:  sudo ./node_modules/.bin/serve -s build --ssl-cert ../../cert/talemate.cs.vt.edu.crt --ssl-key ../../cert/key3.pem -l 443