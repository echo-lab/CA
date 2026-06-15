// PM2 process manager config — runs the CA frontend (static production build
// served by `serve` over HTTPS) and the Node backend together, with
// auto-restart on crash and start-on-boot via `pm2 startup` + `pm2 save`.
//
// BOTH apps need root in production (to read TLS cert/key files), so run the
// whole PM2 daemon as root (commands below use sudo).
//   - backend  : reads /home/sangwonlee/cert/* (set in server/.env.local)
//   - frontend : reads ../cert/sample.{crt,key} (relative to the repo root)
//
// Prerequisites on the VT Linux server:
//   sudo npm i -g pm2 serve      # pm2 + the `serve` static file server
//   npm run build                # produce ./build (rebuild on every deploy)
//
// One-time setup (run as root so the certs are readable):
//   sudo pm2 start ecosystem.config.js
//   sudo pm2 save
//   sudo pm2 startup systemd
//
// Day-to-day:
//   sudo pm2 status
//   sudo pm2 logs
//   sudo pm2 restart ca-frontend   # after `npm run build`
//   sudo pm2 restart all           # after pulling new code

const path = require("path");

module.exports = {
  apps: [
    {
      name: "ca-backend",
      // Equivalent to `cd server && node server.js` (paths are __dirname-based).
      script: "server.js",
      cwd: path.join(__dirname, "server"),
      autorestart: true,
      max_restarts: 10,        // give up only after 10 rapid crashes
      restart_delay: 3000,     // wait 3s between restarts to avoid hot loops
      watch: false,
      // Runs as root (inherited from the root PM2 daemon) so it can read the
      // TLS cert/key. Production HTTPS requires DEVMODE to be UNSET in
      // server/.env.local (the string "false" is truthy and stays in HTTP mode).
    },
    {
      name: "ca-frontend",
      // Mirrors:  sudo serve -s build --ssl-cert ../cert/sample.crt \
      //                --ssl-key ../cert/sample.key -l 3005
      // `serve` must be installed globally (sudo npm i -g serve). If PM2 reports
      // "script not found", replace "serve" with the absolute path from
      // `which serve` (e.g. /usr/local/bin/serve).
      script: "serve",
      args: "-s build --ssl-cert ../cert/sample.crt --ssl-key ../cert/sample.key -l 3005",
      interpreter: "none",     // run serve's own shebang, don't wrap with node
      cwd: __dirname,          // repo root: resolves `build` and `../cert/*`
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
    },
  ],
};
