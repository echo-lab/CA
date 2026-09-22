// PM2 process manager config — runs the CA frontend (static production build
// served by `serve` over HTTPS) and the Node backend together, with
// auto-restart on crash and start-on-boot via `pm2 startup` + `pm2 save`.
//
// Runs as your normal user — no sudo. Both ports are >1024 (backend 5004,
// frontend 3004), so root is never needed to run either app. The TLS cert/key
// in ~/cert must be owned by you; a root-owned ~/cert (left by an old root PM2
// daemon) is what forces sudo. Reclaim it once:
//   sudo chown -R $USER:$USER ~/cert
//   chmod 700 ~/cert && chmod 600 ~/cert/*.key && chmod 644 ~/cert/*.crt
//   - backend  : reads $KEYPATH / $CERTPATH from server/.env.local
//   - frontend : reads ~/cert/talemate.cs.vt.edu.{crt,key} (CERT_DIR below)
//
// Prerequisites on the VT Linux server:
//   sudo npm i -g pm2 serve      # global install is the only sudo step
//   npm run build                # produce ./build (rebuild on every deploy)
//
// One-time setup:
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup systemd          # prints one sudo line to paste — run it
//
// Migrating off a root daemon (run once, then the setup above):
//   sudo pm2 delete all && sudo pm2 unstartup systemd && sudo pm2 kill
//
// Day-to-day (no sudo):
//   pm2 status
//   pm2 logs
//   pm2 restart ca-frontend   # after `npm run build`
//   pm2 restart all           # after pulling new code

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
      // Needs read access to the TLS cert/key (see the header). Production
      // HTTPS requires DEVMODE to be UNSET in server/.env.local (the string
      // "false" is truthy and stays in HTTP mode).
    },
    {
      name: "TM5-frontend",
      // Mirrors:  sudo serve -s build --ssl-cert ../cert/talemate.cs.vt.edu.crt \
      //                --ssl-key ../cert/talemate.cs.vt.edu.key -l 3004
      // `serve` must be installed globally (sudo npm i -g serve). If PM2 reports
      // "script not found", replace "serve" with the absolute path from
      // `which serve` (e.g. /usr/local/bin/serve).
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
