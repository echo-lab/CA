// PM2 config: runs the static frontend (serve, HTTPS :3004) and backend (:5004) as your user with auto-restart; setup: pm2 start ecosystem.config.js && pm2 save && pm2 startup systemd.

const path = require("path");
const CERT_DIR = path.join(require("os").homedir(), "cert");

module.exports = {
  apps: [
    {
      name: "TM5-backend",
      // Equivalent to `cd server && node server.js` (paths are __dirname-based).
      script: "server.js",
      cwd: path.join(__dirname, "server"),
      autorestart: true,
      max_restarts: 10,        // give up only after 10 rapid crashes within min_uptime
      restart_delay: 3000,     // wait 3s between restarts to avoid hot loops
      min_uptime: "10s",       // must stay up 10s to count as a successful start
      watch: false,
      // Production HTTPS needs DEVMODE unset in server/.env.local (the string "false" is truthy).
    },
    {
      name: "TM5-frontend",
      // Equivalent to `serve -s build --ssl-cert ... --ssl-key ... -l 3004`; if PM2 cannot find `serve`, use the path from `which serve`.
      script: "/usr/bin/serve",
      args: `-s build --ssl-cert ${path.join(CERT_DIR, "talemate.cs.vt.edu.crt")} --ssl-key ${path.join(CERT_DIR, "talemate.cs.vt.edu.key")} -l 3004`,
      interpreter: "none",     // run serve's own shebang, don't wrap with node
      cwd: __dirname,          // repo root: resolves `build`
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      min_uptime: "10s",       // must stay up 10s to count as a successful start
      watch: false,
    },
  ],
};
