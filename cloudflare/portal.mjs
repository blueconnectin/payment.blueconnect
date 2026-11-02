import {authEnabled,normalizeEmail,ADMIN_EMAIL,hashPassword,verifyPassword,matchesInitial,sessionCookie,readSession,clearCookie} from './auth.mjs';
const json=(data,status=200,cookie)=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})}});
async function smallJson(request,limit){
 if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))throw Error('Gunakan data JSON.');
 if(Number(request.headers.get('content-length'))>limit||!request.body)throw Error('Data terlalu besar atau kosong.');
 const reader=request.body.getReader(),chunks=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();throw Error('Data terlalu besar.');}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));
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
  try{const body=await smallJson(request,route==='/api/payment'?7*1024*1024:40000);if(route==='/api/payment'&&body.action!=='pay')return json({error:'Aksi pembayaran tidak valid.'},400);return json(await bridge('portal',body,actor));}catch(error){return json({error:error.message||'Aksi belum berhasil.'},400);}
 }
 return null;
}
export async function authenticatedActor(request,env){return authEnabled(env)?readSession(request,env):null;}
