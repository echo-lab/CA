const express = require('express');
const fs = require('fs');
const cors = require('cors');
const https = require('https');
require('dotenv').config({ path: '.env.local' });
const { registerLiveTtsRoutes } = require('./liveTTS'); 

const { startPruner } = require('./cache/prune');
startPruner();

const keyPath = process.env.KEYPATH;
const certPath = process.env.CERTPATH;
console.log(keyPath);
console.log(certPath);
const corsOptions = {
	origin: ['https://talemate.cs.vt.edu', 'https://128.173.237.12','https://localhost:3000', 'https://talemate.cs.vt.edu:3001', 'https://talemate.cs.vt.edu:5001', 'https://talemate.cs.vt.edu:3002'],
    methods: 'POST',
    credentials: true
  };

const app = express();
app.use(cors(corsOptions));
app.use(express.json());
registerLiveTtsRoutes(app);



if(process.env.DEVMODE){
    const port = process.env.REACT_APP_PORT || 5001;
    app.listen(port, () => console.log(`Server started on port ${port}`));
}
else{

    const port = process.env.REACT_APP_PORT || 5001;
    const httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    };

    https.createServer(httpsOptions, app).listen(port, () => {
        console.log(`Server started on https://localhost:${port}`);
    });
}
