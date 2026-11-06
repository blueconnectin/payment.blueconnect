import {authEnabled,normalizeEmail,ADMIN_EMAIL,hashPassword,verifyPassword,matchesInitial,sessionCookie,readSession,clearCookie} from './auth.mjs';
const json=(data,status=200,cookie)=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})}});
async function smallJson(request,limit){
 if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))throw Error('Gunakan data JSON.');
 if(Number(request.headers.get('content-length'))>limit||!request.body)throw Error('Data terlalu besar atau kosong.');
 const reader=request.body.getReader(),chunks=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();throw Error('Data terlalu besar.');}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
const ONE_SIGNAL_APP_ID='4108705f-30dc-4603-960d-8241e0e67f12';
async function sendInvoicePush(env,bridge,actor,input,result){
 if(!env.ONESIGNAL_REST_API_KEY||!['submit','review','reprice','confirm','pay'].includes(input.action)||!result?.id)return;
 try{const target=await bridge('portal',{action:'pushTargets',id:result.id},actor);
 const messages={SUBMITTED:'Ada pengajuan invoice baru untuk ditinjau.',APPROVED:'Invoice telah disetujui dan siap dibayar.',REVISION:'Invoice memerlukan revisi. Silakan periksa catatan Admin.',REJECTED:'Invoice ditolak. Silakan periksa catatan Admin.',CONFIRMATION:'Nilai tagihan diperbarui dan memerlukan konfirmasi.',PAID:'Pembayaran invoice telah dicatat.'};
 if(!messages[target.status]||!target.ids?.length)return;
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(target.id+'|'+target.status+'|'+target.updatedAt)));digest[6]=(digest[6]&15)|64;digest[8]=(digest[8]&63)|128;const hex=Array.from(digest.slice(0,16),b=>b.toString(16).padStart(2,'0')).join(''),key=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
 const response=await fetch('https://api.onesignal.com/notifications',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Key '+env.ONESIGNAL_REST_API_KEY},body:JSON.stringify({app_id:ONE_SIGNAL_APP_ID,target_channel:'push',include_aliases:{external_id:target.ids},headings:{en:'Blue Connect Invoice'},contents:{en:messages[target.status]},url:'https://payment.blueconnect.id/#page=detail&id='+encodeURIComponent(target.id),idempotency_key:key}),signal:AbortSignal.timeout(5000)});
 if(!response.ok)console.warn('OneSignal notification delivery failed: HTTP '+response.status);
 }catch{console.warn('OneSignal notification delivery unavailable; invoice action was saved.');}
}
export async function portalRoute(request,env,bridge){
 const url=new URL(request.url),route=url.pathname.replace(/\/+$/,'')||'/';
 if(route==='/api/auth/config')return json({enabled:authEnabled(env),method:'password'});
 if(!authEnabled(env))return null;
 if(!env.AUTH_SECRET||env.AUTH_SECRET.length<32)return json({error:'Admin perlu mengatur AUTH_SECRET sebelum mengaktifkan portal.'},503);
 const authPaths=['/api/auth/login','/api/auth/register','/api/auth/logout','/api/auth/password'];
 if(authPaths.includes(route)){
  if(request.method!=='POST')return json({error:'Gunakan POST.'},405);
  if(request.headers.get('origin')!==url.origin)return json({error:'Asal permintaan ditolak.'},403);
  if(route==='/api/auth/logout')return json({ok:true},200,clearCookie());
  if(Number(request.headers.get('content-length'))>8192)return json({error:'Data terlalu besar.'},413);
  let input;try{input=await smallJson(request,8192);}catch{return json({error:'Data login tidak valid.'},400);}
  let throttleKeys;
  const throttle=async event=>bridge('portalAuth',{action:'throttle',keys:throttleKeys,event});
  const blocked=result=>{const response=json({error:'Terlalu banyak percobaan login gagal. Coba kembali dalam '+Math.ceil(result.retryAfter/60)+' menit.',retryAfter:result.retryAfter},429);response.headers.set('Retry-After',String(result.retryAfter));return response;};
  try {
   const email=route==='/api/auth/password'?(await readSession(request,env))?.email:normalizeEmail(input.email);
   if(!email)return json({error:'Silakan masuk.'},401);
   const ip=request.headers.get('cf-connecting-ip')||'unknown';throttleKeys=['ip:'+ip,'account:'+ip+':'+email];
   const limit=await throttle('check');if(!limit.allowed)return blocked(limit);
   if(route==='/api/auth/password') {
    const actor=await readSession(request,env);if(!actor)return json({error:'Silakan masuk.'},401);
    await bridge('portal',{action:'me'},actor);
    const stored=await bridge('portalAuth',{action:'lookup',email:actor.email});
    if(!await verifyPassword(input.currentPassword,stored,env.AUTH_SECRET)){await throttle('failure');return json({error:'Password saat ini tidak sesuai.'},400);}
    const credentials=await hashPassword(input.newPassword,env.AUTH_SECRET);
    const account=await bridge('portalAuth',{action:'password',actor,...credentials});
    await throttle('success');return json({ok:true},200,await sessionCookie(account,env));
   }
   if(route==='/api/auth/register'){
    if(email===ADMIN_EMAIL)return json({error:'Akun admin tidak dapat didaftarkan sebagai pemohon.'},403);
    const credentials=await hashPassword(input.password,env.AUTH_SECRET);
    const account=await bridge('portalAuth',{action:'register',email,name:input.name,...credentials});
    await throttle('success');return json(account,201,await sessionCookie(account,env));
   }
   let account=await bridge('portalAuth',{action:'lookup',email});
   if(!account&&email===ADMIN_EMAIL&&await matchesInitial(input.password,env.ADMIN_INITIAL_PASSWORD,env.AUTH_SECRET)){
    account=await bridge('portalAuth',{action:'register',email,name:'Admin Proyek',...await hashPassword(input.password,env.AUTH_SECRET)});
   } else if(!account||account.disabled||!await verifyPassword(input.password,account,env.AUTH_SECRET)){await throttle('failure');return json({error:'Email atau password tidak sesuai.'},401);}
   const cookie=await sessionCookie(account,env),actor=await readSession(new Request(request.url,{headers:{cookie:cookie.split(';')[0]}}),env);
   const me=await bridge('portal',{action:'me'},actor);await throttle('success');return json(me,200,cookie);
  }catch(error){if(throttleKeys&&route==='/api/auth/register')await throttle('failure').catch(()=>{});return json({error:error.message || 'Login belum berhasil.'},400);}
 }
 if(route==='/api/accounts'){
  const actor=await readSession(request,env);if(!actor)return json({error:'Silakan masuk terlebih dahulu.'},401);
  try{
   const me=await bridge('portal',{action:'me'},actor);if(me.role!=='ADMIN')return json({error:'Hanya admin yang dapat mengelola akun.'},403);
   if(request.method==='GET')return json(await bridge('portal',{action:'accounts'},actor));
   if(request.method!=='POST')return json({error:'Gunakan POST.'},405);
   if(request.headers.get('origin')!==url.origin)return json({error:'Asal permintaan ditolak.'},403);
   const input=await smallJson(request,8192),email=normalizeEmail(input.email);
   if(input.action==='update')return json(await bridge('portal',{action:'saveAccount',email,name:input.name,role:input.role,disabled:input.disabled},actor));
   if(input.action!=='create'&&input.action!=='password')return json({error:'Aksi akun tidak dikenal.'},400);
   const credentials=await hashPassword(input.password,env.AUTH_SECRET);
   return json(await bridge('portalAuth',{action:input.action==='create'?'createAccount':'resetPassword',actor,email,name:input.name,role:input.role,...credentials}),input.action==='create'?201:200);
  }catch(error){return json({error:error.message||'Pengelolaan akun gagal.'},400);}
 }
 if(route==='/api/me'||route==='/api/portal'||route==='/api/payment'){
  const actor=await readSession(request,env);if(!actor)return json({error:'Silakan masuk terlebih dahulu.'},401);
  if(route==='/api/me'){
   if(request.method!=='GET')return json({error:'Metode tidak didukung.'},405);
   try{return json(await bridge('portal',{action:'me'},actor));}catch(error){if(/Sesi tidak berlaku|Silakan masuk kembali/.test(error.message||''))return json({error:'Sesi tidak berlaku. Silakan masuk lagi.'},401,clearCookie());return json({error:'Sesi belum dapat diperiksa. Silakan coba kembali.'},503);}
  }
  if(request.method!=='POST')return json({error:'Metode tidak didukung.'},405);
  if(request.headers.get('origin')!==url.origin)return json({error:'Asal permintaan ditolak.'},403);
  try{const body=await smallJson(request,route==='/api/payment'?7*1024*1024:40000);if(route==='/api/payment'&&body.action!=='pay')return json({error:'Aksi pembayaran tidak valid.'},400);if(body.action==='pushTargets')return json({error:'Aksi internal tidak tersedia.'},403);const result=await bridge('portal',body,actor);await sendInvoicePush(env,bridge,actor,body,result);return json(result);}catch(error){return json({error:error.message||'Aksi belum berhasil.'},400);}
 }
 return null;
}
export async function authenticatedActor(request,env){return authEnabled(env)?readSession(request,env):null;}
