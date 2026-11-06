import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
// Publish only the browser application, never repository files or credentials.
await fs.mkdir('public',{recursive:true});
await fs.writeFile('public/index.html',await fs.readFile('Index.html'));
await fs.writeFile('public/portal.html',await fs.readFile('Portal.html'));
let commit = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA;
if (!commit) {try {commit = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();} catch {commit = 'local';}}
await fs.writeFile('public/version.json',JSON.stringify({commit})+'\n');
await fs.writeFile('public/_headers',`/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/version.json
  Cache-Control: no-store
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; frame-src 'self' https://drive.google.com https://onesignal.com https://*.onesignal.com
`);
console.log('Built application, release version, and security headers.');
