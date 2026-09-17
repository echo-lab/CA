// pm2 process list for the deployed VM: `pm2 start ecosystem.config.js` from this
// directory, then `pm2 save`. See README for the :443 / setcap note.
require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });

if (!process.env.KEYPATH || !process.env.CERTPATH) {
  throw new Error('KEYPATH/CERTPATH must be set in .env.local — serve needs them for :443');
}

module.exports = {
  apps: [
    {
      name: 'talemate-api',
      script: './server/server.js',
      cwd: __dirname,
      time: true,
    },
    {
      name: 'talemate-web',
      // serve@11.3.0 — a newer serve puts its entry at build/main.js instead
      script: './node_modules/serve/bin/serve.js',
      cwd: __dirname,
      args: ['-s', 'build', '-l', '443',
             '--ssl-cert', process.env.CERTPATH, '--ssl-key', process.env.KEYPATH],
      time: true,
    },
  ],
};
