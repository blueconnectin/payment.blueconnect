import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Preserve the remote manifest and unrelated source files instead of replacing
// the whole Apps Script project with the three local application files.
export async function prepareStage(stage, source) {
  const manifest = JSON.parse(await fs.readFile(path.join(stage, 'appsscript.json'), 'utf8'));
  if (manifest.runtimeVersion !== 'V8') throw new Error('Enable V8 in the Apps Script editor before syncing.');
  async function inspect(dir) {
    for (const entry of await fs.readdir(dir, {withFileTypes:true})) {
      const file=path.join(dir,entry.name);
      if(entry.isSymbolicLink()) throw new Error('Unexpected symlink in the remote project.');
      if(entry.isDirectory()) await inspect(file);
      else if (/\.(?:js|gs)$/i.test(entry.name) && file !== path.join(stage,'Code.js')) {
        const text=await fs.readFile(file,'utf8');
        if(/\bfunction\s+(?:doGet|doPost)\s*\(|\b(?:const|let|var)\s+(?:doGet|doPost)\s*=/.test(text)) {
          throw new Error('Another remote script defines doGet/doPost. Resolve the entry point in Apps Script before syncing.');
        }
      }
    }
  }
  await inspect(stage);
  await fs.copyFile(path.join(source,'Code.gs'),path.join(stage,'Code.js'));
  await fs.copyFile(path.join(source,'Portal.gs'),path.join(stage,'Portal.js'));
  await fs.copyFile(path.join(source,'Index.html'),path.join(stage,'Index.html'));
}

async function main() {
  const {CLASP_AUTH_JSON,CLASP_BIN,APPS_SCRIPT_ID,APPS_SCRIPT_DEPLOYMENT_ID,PUBLISH_WEB_APP,GITHUB_SHA}=process.env;
  if(!CLASP_AUTH_JSON) throw new Error('Add the CLASP_AUTH_JSON GitHub Actions secret first. See CONNECT_APPS_SCRIPT.md.');
  if(!CLASP_BIN || !APPS_SCRIPT_ID) throw new Error('Missing clasp binary or target Script ID.');
  if(PUBLISH_WEB_APP === 'true' && !APPS_SCRIPT_DEPLOYMENT_ID) throw new Error('Set APPS_SCRIPT_DEPLOYMENT_ID, or run without publishing.');
  let credentials;
  try {credentials=JSON.parse(CLASP_AUTH_JSON);} catch {throw new Error('CLASP_AUTH_JSON must contain the complete clasp OAuth JSON file.');}
  if(!credentials.tokens?.default?.refresh_token) throw new Error('Run clasp 3.4.1 login using the default user and save the resulting complete OAuth file as CLASP_AUTH_JSON.');
  const work=await fs.mkdtemp(path.join(os.tmpdir(),'blueconnect-sync-'));
  await fs.chmod(work,0o700);
  const auth=path.join(work,'.clasprc.json');
  const source=process.cwd();
  try {
    await fs.writeFile(auth,JSON.stringify(credentials),{mode:0o600});
    // Never pass the secret to child processes via their environment or arguments.
    const childEnv={...process.env};delete childEnv.CLASP_AUTH_JSON;
    function clasp(args,cwd,json=false) {
      const result=spawnSync(CLASP_BIN,['--auth',auth,...(json?['--json']:[]),...args],{cwd,env:childEnv,encoding:'utf8',timeout:120000});
      if(result.error || result.status !== 0) {
        // Do not echo provider response bodies or credential-bearing diagnostics.
        const diagnostic=String(result.stderr||'')+' '+String(result.stdout||'');const reason=/maximum|too many versions|version limit|versions.*limit|200 versions/i.test(diagnostic)?'Apps Script version limit reached':/quota|rate limit|too many requests/i.test(diagnostic)?'Google API quota or rate limit':/invalid_grant|unauthorized|permission|access denied/i.test(diagnostic)?'Google authorization or permission failure':/description.*long|length|characters/i.test(diagnostic)?'Version description length rejected':'Provider rejected command (unclassified)';throw new Error(`clasp ${args[0]} failed: ${reason}.`);
      }
      if(json) {try{return JSON.parse(result.stdout);}catch{throw new Error(`Unexpected JSON response from clasp ${args[0]}.`);}}
    }
    const stage=path.join(work,'stage');await fs.mkdir(stage);
    clasp(['clone',APPS_SCRIPT_ID],stage);
    await prepareStage(stage,source);
    const backup=clasp(['create-version',`Before GitHub sync ${(GITHUB_SHA || 'manual').slice(0,12)}`],stage,true);
    if(!Number.isInteger(backup.versionNumber)) throw new Error('Backup version was not confirmed; sync stopped.');
    console.log(`Recoverable Apps Script source snapshot: version ${backup.versionNumber}.`);
    clasp(['push'],stage);
    // A noninteractive clasp push may exit zero after skipping a manifest prompt.
    // Read back the target to verify the intended application really was saved.
    const verify=path.join(work,'verify');await fs.mkdir(verify);
    clasp(['clone',APPS_SCRIPT_ID],verify);
    for(const [local,remote] of [['Code.gs','Code.js'],['Portal.gs','Portal.js'],['Index.html','Index.html']]) {
      if((await fs.readFile(path.join(source,local),'utf8')) !== (await fs.readFile(path.join(verify,remote),'utf8'))) throw new Error('Remote source verification failed; Web App deployment was not updated.');
    }
    console.log('Apps Script source synced and verified.');
    if(PUBLISH_WEB_APP === 'true') {
      const version=clasp(['create-version',`GitHub ${(GITHUB_SHA || 'manual').slice(0,12)}`],stage,true);
      if(!Number.isInteger(version.versionNumber)) throw new Error('Release version was not confirmed.');
      const deployment=clasp(['update-deployment',APPS_SCRIPT_DEPLOYMENT_ID,'--versionNumber',String(version.versionNumber),'--description',`Blue Connect ${(GITHUB_SHA || 'manual').slice(0,12)}`],stage,true);
      if(deployment.versionNumber !== version.versionNumber) throw new Error('Deployment version was not confirmed.');
      console.log(`Existing Web App updated to version ${version.versionNumber}. Test the /exec URL and WhatsApp navigation.`);
    } else console.log('Source only. Existing Web App deployment has not been changed.');
  } finally {await fs.rm(work,{recursive:true,force:true});}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
