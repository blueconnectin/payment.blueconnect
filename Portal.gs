/** Private portal persistence and authorization. Called only after signed bridge verification. */
function portalBook_() {var id=PropertiesService.getScriptProperties().getProperty('SUBMISSION_SPREADSHEET_ID');if(!id)throw new Error('Aktifkan catatan Sheets terlebih dahulu.');return SpreadsheetApp.openById(id);}
function portalTable_(name){var book=portalBook_(),sheet=book.getSheetByName('Portal_'+name);if(!sheet){sheet=book.insertSheet('Portal_'+name);sheet.appendRow(['Key','JSON']);sheet.setFrozenRows(1);}var head=sheet.getRange(1,1,1,2).getValues()[0];if(head[0]!=='Key'||head[1]!=='JSON')throw Error('Header portal berbeda.');return sheet;}
function portalRows_(name){var sheet=portalTable_(name);return sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues().map(function(row){return {key:row[0],value:JSON.parse(row[1])};}):[];}
function portalGet_(name,key){var row=portalRows_(name).find(function(r){return r.key===key;});return row?row.value:null;}
function portalPut_(name,key,value){var text=JSON.stringify(value);if(text.length>44000)throw Error('Data portal terlalu besar.');var sheet=portalTable_(name),rows=portalRows_(name),index=rows.findIndex(function(r){return r.key===key;}),target=index<0?sheet.getLastRow()+1:index+2;sheet.getRange(target,1,1,2).setNumberFormat('@').setValues([["'"+key,"'"+text]]);SpreadsheetApp.flush();}
function portalRole_(account){return account.role|| (account.email==='blueconecin@gmail.com'?'ADMIN':'PEMOHON');}
function portalAdmin_(account){return portalRole_(account)==='ADMIN';}
function portalFinance_(account){return portalRole_(account)==='FINANCE';}
function portalRoleInput_(role){if(['ADMIN','FINANCE','PEMOHON'].indexOf(role)<0)throw Error('Role akun tidak valid.');return role;}
function portalAccountView_(account){var view=portalPublic_(account);view.disabled=!!account.disabled;view.createdAt=account.createdAt;return view;}
function portalRequireAdmin_(actor){var account=portalActor_(actor);if(!portalAdmin_(account))throw Error('Hanya admin yang dapat mengelola akun.');return account;}
function portalHashInput_(input){if(!/^[A-Za-z0-9_-]{16,100}$/.test(input.salt||'')||!/^[A-Za-z0-9_-]{40,100}$/.test(input.verifier||'')||input.algorithm!=='pbkdf2-sha256-100000+hmac-v1')throw Error('Hash password tidak valid.');}
function portalAccountEmail_(value){var email=recordText_(value,'Email',254).trim().toLowerCase();if(!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Email tidak valid.');return email;}
function portalSaveAccount_(input,actor){
 portalRequireAdmin_(actor);var user=portalGet_('Akun',portalAccountEmail_(input.email));if(!user)throw Error('Akun tidak ditemukan.');
 var role=portalRoleInput_(input.role),name=recordText_(input.name,'Nama',120);if(typeof input.disabled!=='boolean')throw Error('Status akun tidak valid.');
 if(portalAdmin_(user)&&!user.disabled&&(role!=='ADMIN'||input.disabled)&&!portalRows_('Akun').some(function(r){return r.value.id!==user.id&&portalAdmin_(r.value)&&!r.value.disabled;}))throw Error('Minimal satu Admin aktif harus dipertahankan.');
 user.role=role;user.name=name;user.disabled=input.disabled;user.sessionVersion=(user.sessionVersion||1)+1;user.updatedAt=new Date().toISOString();user.updatedBy=actor.email;portalPut_('Akun',user.email,user);return portalAccountView_(user);
}
function portalPublic_(account){return {id:account.id,email:account.email,name:account.name,role:portalRole_(account),profile:account.profile||null};}
function portalComplete_(profile){return !!(profile&&profile.name&&profile.phone&&profile.address&&profile.bank&&profile.accountNumber&&profile.accountOwner);}
function portalActor_(actor){if(!actor||!actor.id||!actor.email)throw Error('Silakan masuk kembali.');var a=portalGet_('Akun',actor.email);if(!a||a.id!==actor.id||(a.sessionVersion||1)!==actor.sessionVersion||a.disabled)throw Error('Sesi tidak berlaku.');return a;}
function portalOwn_(account,invoice){if(!invoice||invoice.status==='DELETED'||(!portalAdmin_(account)&&!(portalFinance_(account)&&invoice.status!=='DRAFT')&&invoice.owner!==account.id))throw Error('Pengajuan tidak ditemukan.');return invoice;}
function portalHistory_(invoice,account,action,note){invoice.updatedAt=new Date().toISOString();invoice.history=invoice.history||[];invoice.history.push({at:invoice.updatedAt,by:account.email,action:action,note:note||''});}
function portalDueDate_(approvedAt){if(!approvedAt)return '';var zone=Session.getScriptTimeZone()||'Asia/Jakarta',parts=Utilities.formatDate(new Date(approvedAt),zone,'yyyy-MM-dd').split('-'),date=new Date(Date.UTC(Number(parts[0]),Number(parts[1])-1,Number(parts[2])+7));return Utilities.formatDate(date,'UTC','yyyy-MM-dd');}
function portalInvoiceDueDate_(invoice){return invoice.dueAt||(invoice.approvedAt?portalDueDate_(invoice.approvedAt):'');}
function portalCredential_(input){var email=recordText_(input.email,'Email',254).toLowerCase();return portalGet_('Akun',email);}
function portalAuth_(action,input){
 var lock=action==='lookup'?null:(action==='throttle'||action==='attempt'?LockService.getUserLock():LockService.getScriptLock());if(lock)lock.waitLock(30000);
 try {
  var props=PropertiesService.getScriptProperties();
  if(action==='lookup')return portalCredential_(input);
  // Keep the old action during the Apps Script -> Worker rollout.
  if(action==='attempt'){
   var legacyKey='portal-attempt-'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(input.email))),legacyCache=CacheService.getScriptCache(),legacyCount=Number(legacyCache.get(legacyKey)||0);
   if(legacyCount>=(String(input.email).indexOf('ip:')===0?60:8))throw Error('Terlalu banyak percobaan. Coba kembali 15 menit lagi.');legacyCache.put(legacyKey,String(legacyCount+1),900);return {allowed:true};
  }
  if(action==='throttle'){
   var cache=CacheService.getScriptCache(),keys=input.keys,event=input.event,now=Date.now(),windowMs=900000;
   if(!Array.isArray(keys)||keys.length!==2||keys.some(function(key){return typeof key!=='string'||key.length>600;})||['check','failure','success'].indexOf(event)<0)throw Error('Data pembatasan login tidak valid.');
   var entries=keys.map(function(value){var key='portal-login-v2-'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value)),stored=JSON.parse(cache.get(key)||'null');return {key:key,state:stored&&stored.expiresAt>now?stored:{count:0,expiresAt:now+windowMs}};});
   if(event==='success'){cache.remove(entries[1].key);return {allowed:true};}
   if(event==='failure'){entries.forEach(function(entry){entry.state.count++;cache.put(entry.key,JSON.stringify(entry.state),Math.max(1,Math.ceil((entry.state.expiresAt-now)/1000)));});return {allowed:true};}
   var retry=0;entries.forEach(function(entry,index){if(entry.state.count>=(index===0?60:8))retry=Math.max(retry,Math.ceil((entry.state.expiresAt-now)/1000));});
   return {allowed:retry===0,retryAfter:retry};
  }
  if(action==='createAccount'||action==='resetPassword'){
   portalRequireAdmin_(input.actor);portalHashInput_(input);var email=portalAccountEmail_(input.email),target=portalGet_('Akun',email);
   if(action==='createAccount'){
    if(target)throw Error('Email sudah terdaftar.');
    target={id:Utilities.getUuid(),email:email,name:recordText_(input.name,'Nama',120),role:portalRoleInput_(input.role),sessionVersion:1,createdAt:new Date().toISOString()};
   }else{if(!target)throw Error('Akun tidak ditemukan.');target.sessionVersion=(target.sessionVersion||1)+1;}
   target.salt=input.salt;target.verifier=input.verifier;target.algorithm=input.algorithm;target.updatedAt=new Date().toISOString();target.updatedBy=input.actor.email;portalPut_('Akun',email,target);return portalAccountView_(target);
  }
  if(action==='password'){
   var user=portalActor_(input.actor);
   if(!/^[A-Za-z0-9_-]{16,100}$/.test(input.salt||'')||!/^[A-Za-z0-9_-]{40,100}$/.test(input.verifier||'')||input.algorithm!=='pbkdf2-sha256-100000+hmac-v1')throw Error('Hash password tidak valid.');
   user.salt=input.salt;user.verifier=input.verifier;user.algorithm=input.algorithm;user.sessionVersion=(user.sessionVersion||1)+1;portalPut_('Akun',user.email,user);return {id:user.id,email:user.email,name:user.name,sessionVersion:user.sessionVersion};
  }
  if(action==='register'){
   var existing=portalCredential_(input);if(existing)throw Error('Email sudah terdaftar.');
   if(!/^[A-Za-z0-9_-]{16,100}$/.test(input.salt||'')||!/^[A-Za-z0-9_-]{40,100}$/.test(input.verifier||'')||input.algorithm!=='pbkdf2-sha256-100000+hmac-v1')throw Error('Data akun tidak valid.');
   var account={id:Utilities.getUuid(),email:input.email.toLowerCase(),name:recordText_(input.name,'Nama',120),salt:input.salt,verifier:input.verifier,algorithm:input.algorithm,sessionVersion:1,createdAt:new Date().toISOString()};
   account.role=account.email==='blueconecin@gmail.com'?'ADMIN':'PEMOHON';portalPut_('Akun',account.email,account);props.setProperty('PORTAL_AUTH_REQUIRED','true');return portalPublic_(account);
  }
  throw Error('Aksi autentikasi tidak dikenal.');
 }finally{if(lock)lock.releaseLock();}
}
function portalMasterDefaults_(){
 var result=[{kind:'company',name:'Profil perusahaan',active:true,companyName:'PT Blue Connect Indonesia',companyAddress:'',companyEmail:'',companyPhone:'',companyNpwp:''}];
 ['FTTH','FWA'].forEach(function(name){result.push({kind:'project',name:name,active:true});});
 ['Instalasi ODC','Instalasi ODP','Instalasi Closure','Join Core','Instalasi OTB','Penarikan Kabel Feeder','Penarikan Kabel Precon','Pemasangan Tiang','Pemasangan Aksesoris KU','Pemasangan X Frame 40 X 40','Pemasangan X Frame 80 X 80','Permit'].forEach(function(name){result.push({kind:'work',name:name,category:'Projek',active:true});});
 ['Sales','Manage Service','Reimburst','Operasional'].forEach(function(name){result.push({kind:'work',name:name,category:'Non Projek',unit:({Sales:'HC','Manage Service':'Periode',Reimburst:'Pengeluaran',Operasional:'Hari'})[name],active:true});});
 ['Pcs','Meter','Buah','HC','Hari','Sales','Periode','Pengajuan','Pengeluaran'].forEach(function(name){result.push({kind:'unit',name:name,decimal:name==='Meter',projectUnit:['Pcs','Meter','Buah','HC','Hari'].indexOf(name)>=0,active:true});});return result;
}
function portalMaster_(){var entries=portalMasterDefaults_();if(PropertiesService.getScriptProperties().getProperty('SUBMISSION_SPREADSHEET_ID'))portalRows_('Master').forEach(function(row){var index=entries.findIndex(function(entry){return entry.kind===row.value.kind&&entry.name===row.value.name;});if(index>=0)entries[index]=Object.assign({},entries[index],row.value);else entries.push(row.value);});
 var props=PropertiesService.getScriptProperties();
 if(props.getProperty('SUBMISSION_SPREADSHEET_ID')&&props.getProperty('PORTAL_WORK_UNITS_V2')!=='true'){
  ['HC','Hari'].forEach(function(name){var unit=entries.find(function(e){return e.kind==='unit'&&e.name===name;});if(!unit.active){unit.active=true;portalPut_('Master',JSON.stringify(['unit',name]),unit);}});
  [{name:'Sales',unit:'HC'},{name:'Operasional',unit:'Hari'}].forEach(function(setting){var work=entries.find(function(e){return e.kind==='work'&&e.name===setting.name;});work.unit=setting.unit;portalPut_('Master',JSON.stringify(['work',work.name]),work);});
  props.setProperty('PORTAL_WORK_UNITS_V2','true');
 }
 return entries;}
function portalCompany_(){return portalMaster_().find(function(entry){return entry.kind==='company'&&entry.name==='Profil perusahaan';})||{companyName:'PT Blue Connect Indonesia',companyAddress:'',companyEmail:'',companyPhone:'',companyNpwp:''};}
function portalSaveCompany_(input,account){
 if(!portalAdmin_(account))throw Error('Hanya Admin yang dapat mengelola data perusahaan.');var source=input.company||{},companyName=recordText_(source.companyName,'Nama perusahaan',120).trim(),companyAddress=String(source.companyAddress||'').trim(),companyEmail=String(source.companyEmail||'').trim().toLowerCase(),companyPhone=String(source.companyPhone||'').trim(),companyNpwp=String(source.companyNpwp||'').trim();
 if(companyAddress.length>500||companyEmail.length>160||companyPhone.length>40||companyNpwp.length>40)throw Error('Data perusahaan melebihi batas karakter.');if(companyEmail&&!/^\S+@[^\s@]+\.[^\s@]+$/.test(companyEmail))throw Error('Email perusahaan tidak valid.');if(companyPhone&&!/^\+?[0-9 ()-]{8,40}$/.test(companyPhone))throw Error('Nomor telepon perusahaan tidak valid.');
 var profile={kind:'company',name:'Profil perusahaan',active:true,companyName:companyName,companyAddress:companyAddress,companyEmail:companyEmail,companyPhone:companyPhone,companyNpwp:companyNpwp,updatedAt:new Date().toISOString(),updatedBy:account.email};portalPut_('Master',JSON.stringify(['company','Profil perusahaan']),profile);return profile;
}
function portalMasterNames_(kind,active){return portalMaster_().filter(function(entry){return entry.kind===kind&&(!active||entry.active);}).map(function(entry){return entry.name;});}
function portalSaveMaster_(input,account){
 if(!portalAdmin_(account))throw Error('Hanya Admin yang dapat mengelola master data.');var m=input.entry||{},kind=m.kind,name=recordText_(m.name,'Nama',80),entries=portalMaster_();
 if(['project','work','unit'].indexOf(kind)<0||typeof m.active!=='boolean')throw Error('Master data tidak valid.');
 var existing=entries.find(function(entry){return entry.kind===kind&&entry.name.toLowerCase()===name.toLowerCase();});
 if(existing&&existing.name!==name)throw Error('Nama sudah tersedia. Gunakan nama yang terdaftar.');
 if(!existing&&entries.filter(function(entry){return entry.kind===kind;}).length>=100)throw Error('Maksimal 100 pilihan per kelompok.');
 var entry=existing?JSON.parse(JSON.stringify(existing)):{kind:kind,name:name};entry.active=m.active;
 if(kind==='work'){var category=m.category||entry.category||'Projek';if(['Projek','Non Projek'].indexOf(category)<0)throw Error('Kategori pekerjaan tidak valid.');if(existing&&category!==existing.category)throw Error('Kategori pekerjaan tersimpan tidak dapat diganti. Tambahkan pekerjaan baru.');entry.category=category;}
 if(!existing&&kind==='unit'){if(typeof m.decimal!=='boolean')throw Error('Pilih aturan jumlah satuan.');entry.decimal=m.decimal;entry.projectUnit=true;}
 if(kind==='work'&&entry.category==='Non Projek'){
  if(m.unit===undefined)m.unit=entry.unit;
  if(entry.name==='Reimburst'&&m.unit!=='Pengeluaran')throw Error('Reimburst menggunakan satuan Pengeluaran.');
  if(entry.active&&!entries.some(function(e){return e.kind==='unit'&&e.name===m.unit&&e.active;}))throw Error('Pilih satuan aktif dari master data.');entry.unit=m.unit;
 }
 if(kind==='unit'&&!m.active&&entries.some(function(e){return e.kind==='work'&&e.active&&e.category==='Non Projek'&&e.unit===name;}))throw Error('Satuan masih dipakai pekerjaan Non Projek aktif. Ubah satuan pekerjaan terlebih dahulu.');
 if(!m.active&&entries.filter(function(other){return other.kind===kind&&other.name!==name&&other.active&&(kind!=='work'||other.category===entry.category)&&(kind!=='unit'||other.projectUnit);}).length===0)throw Error('Minimal satu pilihan aktif harus tersedia.');
 entry.updatedAt=new Date().toISOString();entry.updatedBy=account.email;portalPut_('Master',JSON.stringify([kind,name]),entry);return entry;
}
function portalValidateMaster_(data){
 var entries=portalMaster_();
 function active(kind,name){return entries.find(function(e){return e.kind===kind&&e.name===name&&e.active;});}
 function check(category,type,unit){var work=active('work',type);if(!work||work.category!==category)throw Error('Jenis pekerjaan sudah tidak aktif. Pilih ulang dari Master.');if(category==='Non Projek'){if(!active('unit',work.unit)||unit!==work.unit)throw Error('Satuan pekerjaan Non Projek tidak aktif atau tidak sesuai Master.');}else{var selected=active('unit',unit);if(!selected||!selected.projectUnit)throw Error('Satuan tidak aktif. Pilih ulang satuan pekerjaan.');}return work;}
 if(!active('project',data.projectType))throw Error('Jenis proyek sudah tidak aktif. Pilih ulang dari Master.');
 var primary=check(data.requestCategory,data.requestType,data.requestCategory==='Projek'?data.projectWorkUnit:data.nonProjectUnit||portalMaster_().find(function(e){return e.kind==='work'&&e.name===data.requestType;})?.unit);
 if(data.additionalItems!==undefined&&!Array.isArray(data.additionalItems))throw Error('Daftar produk/jasa tidak valid.');
 (data.additionalItems||[]).forEach(function(item,index){if(!item||typeof item!=='object')throw Error('Produk/jasa ke-'+(index+2)+' tidak valid.');var work=check(item.category,item.type,item.unit);if(work.name==='Reimburst'){var amount=Number(item.amount);if(!recordText_(item.object,'Objek pengeluaran',200)||!Number.isSafeInteger(amount)||amount<1)throw Error('Nominal/objek pengeluaran ke-'+(index+2)+' tidak valid.');return;}var quantity=Number(item.quantity),unit=active('unit',item.unit);if(!Number.isFinite(quantity)||quantity<=0||quantity>Number.MAX_SAFE_INTEGER||(!unit.decimal&&!Number.isSafeInteger(quantity)))throw Error('Jumlah produk/jasa ke-'+(index+2)+' tidak valid.');var start=recordDate_(item.dateStart),end=item.dateEnd?recordDate_(item.dateEnd):start;if(end<start)throw Error('Tanggal selesai produk/jasa ke-'+(index+2)+' tidak boleh sebelum tanggal mulai.');if(['Sales','Manage Service'].indexOf(work.name)>=0&&!item.dateEnd)throw Error('Periode penagihan produk/jasa ke-'+(index+2)+' harus diisi lengkap.');if(work.category==='Projek'||work.name==='Operasional')recordText_(item.note,'Keterangan pekerjaan',1000);});
}
function portalOperationalDays_(data){var start=recordDate_(data.operationalWorkDateStart),end=data.operationalWorkDateMode==='range'?recordDate_(data.operationalWorkDateEnd):start;if(end<start)throw Error('Tanggal selesai tidak boleh sebelum tanggal mulai.');return Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;}
function portalItems_(data){
 var tariffs=portalRows_('Tarif').map(function(r){return r.value;});
 function item(description,qty,unit,amount,type){var rate=amount;if(rate==null){var found=tariffs.find(function(t){return t.projectType===data.projectType&&t.type===(type||data.requestType)&&t.unit===unit;});rate=found?found.price:null;}var total=rate==null?null:Math.round(qty*rate);if(total!==null&&(!Number.isSafeInteger(total)||total<=0))throw Error('Nilai invoice di luar batas.');return {description:description,qty:qty,unit:unit,price:rate,amount:total};}
 var items=[];
 if(data.requestType==='Reimburst')(data.reimbursementItems||[]).forEach(function(r){items.push(item(r.object,1,'Pengeluaran',Number(r.amount),'Reimburst'));});
 else{var qty=data.requestCategory==='Projek'?Number(data.projectWorkQuantity):(data.requestType==='Sales'?Number(data.salesCount):1),unit=data.requestCategory==='Projek'?data.projectWorkUnit:(data.nonProjectUnit||({Sales:'Sales','Manage Service':'Periode',Operasional:'Pengajuan'})[data.requestType]);if(data.requestType==='Operasional'&&unit==='Hari')qty=portalOperationalDays_(data);items.push(item(data.requestType,qty,unit,null,data.requestType));}
 (data.additionalItems||[]).forEach(function(extra){
  var quantity=Number(extra.quantity),unit=extra.unit,description=extra.type;
  if(extra.type==='Reimburst'){description=extra.object;quantity=1;items.push(item(description,quantity,'Pengeluaran',Number(extra.amount),'Reimburst'));return;}
  if(extra.type==='Operasional'&&unit==='Hari'){var start=recordDate_(extra.dateStart),end=extra.dateEnd?recordDate_(extra.dateEnd):start;if(end<start)throw Error('Tanggal selesai tidak boleh sebelum tanggal mulai.');quantity=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;}
  if(extra.dateStart)description+=' · '+(extra.category==='Non Projek'&&['Sales','Manage Service','Operasional'].indexOf(extra.type)>=0?'Periode penagihan ':'Tanggal pekerjaan ')+extra.dateStart+(extra.dateEnd&&extra.dateEnd!==extra.dateStart?' s/d '+extra.dateEnd:'');
  if(extra.note)description+=' · '+extra.note;
  items.push(item(description,quantity,unit,null,extra.type));
 });
 var total=items.reduce(function(sum,line){return sum+(line.amount==null?0:line.amount);},0);if(!Number.isSafeInteger(total))throw Error('Total invoice terlalu besar.');
 return items;
}
function portalPrice_(invoice){if(invoice.data.requestCategory==='Non Projek'){var work=portalMaster_().find(function(e){return e.kind==='work'&&e.name===invoice.data.requestType;});invoice.data.nonProjectUnit=work.unit;}invoice.items=portalItems_(invoice.data);invoice.priced=invoice.items.every(function(i){return i.price!==null;});invoice.total=invoice.priced?invoice.items.reduce(function(t,i){return t+i.amount;},0):null;if(invoice.total!==null&&!Number.isSafeInteger(invoice.total))throw Error('Total terlalu besar.');}
function portalEvidence_(input,existing,owner,invoiceId){
 if(!input.folderUrl)return existing&&Array.isArray(existing.evidence)?existing.evidence:[];
 var match=String(input.folderUrl||'').match(/^https:\/\/drive\.google\.com\/drive\/folders\/([A-Za-z0-9_-]+)$/);if(!match)throw Error('Folder bukti tidak valid.');
 var folder=DriveApp.getFolderById(match[1]),parents=folder.getParents(),ok=false,root=PropertiesService.getScriptProperties().getProperty('UPLOAD_FOLDER_ID')||EVIDENCE_DEFAULT_FOLDER_ID_;
 while(parents.hasNext())if(parents.next().getId()===root)ok=true;if(!ok)throw Error('Folder bukti tidak sesuai.');
 var binding=portalGet_('Bukti',match[1]);if(binding&&(binding.owner!==owner||binding.invoiceId!==invoiceId))throw Error('Folder bukti sudah dipakai pengajuan lain.');
 if(existing&&existing.folderUrl===input.folderUrl)return existing.evidence;
 var cache=CacheService.getScriptCache();if(cache.get('evidence-owner-'+match[1])!==input.uploadRequestId)throw Error('Bukti bukan milik sesi unggah ini.');
 var manifest=JSON.parse(cache.get('evidence-files-'+match[1])||'null');if(!manifest||!manifest.length)throw Error('Sesi bukti kedaluwarsa. Unggah ulang.');
 var evidence=manifest.map(function(m){var file=DriveApp.getFileById(m.id);return {fileId:m.id,name:file.getName(),url:file.getUrl(),folderUrl:folder.getUrl()};});
 portalPut_('Bukti',match[1],{owner:owner,invoiceId:invoiceId});return evidence;
}
function portalDuplicateKey_(invoice){var d=invoice.data,record={},keys=['applicant','requestDate','projectType','requestCategory','requestType','bank','accountNumber','accountOwner','nonProjectUnit','additionalItems'];if(d.requestType==='Sales')keys=keys.concat(['salesPeriodStart','salesPeriodEnd','salesCount']);else if(d.requestType==='Manage Service')keys=keys.concat(['managePeriodStart','managePeriodEnd']);else if(d.requestType==='Reimburst')keys.push('reimbursementItems');else{var prefix=d.requestCategory==='Projek'?'projectWork':'operationalWork';keys=keys.concat([prefix+'DateMode',prefix+'DateStart',prefix+'Note']);if(d[prefix+'DateMode']==='range')keys.push(prefix+'DateEnd');if(prefix==='projectWork')keys=keys.concat(['projectWorkQuantity','projectWorkUnit']);}keys.forEach(function(key){var value=d[key];if(key==='salesCount'||key==='projectWorkQuantity')value=Number(value);if(key==='reimbursementItems'&&Array.isArray(value))value=value.map(function(item){return {object:String(item.object||'').trim(),amount:Number(item.amount)};});record[key]=typeof value==='string'?value.trim():value===undefined?null:value;});function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object'){var sorted={};Object.keys(value).sort().forEach(function(key){sorted[key]=canonical(value[key]);});return sorted;}return value;}return JSON.stringify(canonical({owner:invoice.owner,data:record,profile:invoice.profile,items:invoice.items,total:invoice.total}));}
function portalAssertUnique_(invoice,account){var matches=portalDuplicates_(invoice,account);if(matches.length)throw Error('Pengajuan duplikat: data pengajuan dan nilai tagihan identik dengan '+(matches[0].number||'pengajuan yang sudah tersimpan')+'. Periksa pengajuan sebelumnya.');}
function portalDuplicates_(invoice,account){var key=portalDuplicateKey_(invoice);return portalRows_('Invoice').map(function(row){return row.value;}).filter(function(other){return other.id!==invoice.id&&['DRAFT','REJECTED','DELETED'].indexOf(other.status)<0&&(portalAdmin_(account)||portalFinance_(account)||other.owner===account.id)&&portalDuplicateKey_(other)===key;}).map(function(other){return {id:other.id,number:other.number||'',status:other.status,requestDate:other.data.requestDate,total:other.total};});}
function portalEnsureNumber_(invoice){
 if(invoice.number)return false;
 var date=recordDate_(invoice.data.requestDate),month=Number(date.slice(5,7)),roman=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
 var props=PropertiesService.getScriptProperties(),sequence=Number(props.getProperty('PORTAL_INVOICE_SEQUENCE')||0)+1;
 if(!Number.isSafeInteger(sequence)||sequence<1)throw Error('Urutan nomor invoice tidak valid.');
 props.setProperty('PORTAL_INVOICE_SEQUENCE',String(sequence));
 invoice.number='INV'+String(sequence).padStart(3,'0')+'/'+invoice.data.projectType+'/'+roman[month-1]+'/'+date.slice(0,4);return true;
}
function portalDispatch_(action,input,actor){
 var readOnly=['me','list','get','accounts','tariffs','archive'].indexOf(action)>=0;
 var lock=readOnly?null:LockService.getScriptLock();if(lock)lock.waitLock(30000);
 try {
  var account=portalActor_(actor),admin=portalAdmin_(account);input=input||{};
  if(action==='me')return portalPublic_(account);
  if(action==='accounts'){portalRequireAdmin_(actor);return portalRows_('Akun').map(function(r){return portalAccountView_(r.value);});}
  if(action==='saveAccount')return portalSaveAccount_(input,actor);
  if(action==='profile'){
   var p=input.profile||{},profile={name:recordText_(p.name,'Nama penerbit',120),phone:recordText_(p.phone,'WhatsApp',30),address:recordText_(p.address,'Alamat',500),bank:recordText_(p.bank,'Bank',80),accountNumber:recordText_(p.accountNumber,'Nomor rekening',40),accountOwner:recordText_(p.accountOwner,'Nama pemilik rekening',120)};
   if(!/^\d{1,40}$/.test(profile.accountNumber)||!/^\+?[0-9 ()-]{8,30}$/.test(profile.phone))throw Error('Rekening atau nomor WhatsApp tidak valid.');account.profile=profile;account.name=profile.name;portalPut_('Akun',account.email,account);return portalPublic_(account);
  }
  if(action==='masterData')return portalMaster_();
  if(action==='saveMaster')return portalSaveMaster_(input,account);
  if(action==='saveCompany')return portalSaveCompany_(input,account);
  if(action==='tariffs')return portalRows_('Tarif').map(function(r){return r.value;});
  if(action==='saveTariff'){
   if(!admin)throw Error('Hanya admin proyek.');var t=input.tariff||{};
   var master=portalMaster_(),work=master.find(function(e){return e.kind==='work'&&e.name===t.type&&e.active;});

   if(!work||(t.category!==undefined&&t.category!==work.category)||work.name==='Reimburst'||portalMasterNames_('project',true).indexOf(t.projectType)<0||!master.some(function(e){return e.kind==='unit'&&e.name===t.unit&&e.active&&(work.category!=='Projek'||e.projectUnit);})||!Number.isSafeInteger(Number(t.price))||Number(t.price)<=0)throw Error('Tarif tidak valid. Pilih proyek, pekerjaan, dan satuan aktif.');
   t={projectType:t.projectType,category:work.category,type:recordText_(t.type,'Jenis pekerjaan',80),unit:t.unit,price:Number(t.price),updatedBy:account.email,updatedAt:new Date().toISOString()};portalPut_('Tarif',JSON.stringify([t.projectType,t.type,t.unit]),t);if(work.category==='Non Projek'&&work.unit!==t.unit)portalSaveMaster_({entry:{kind:'work',name:work.name,category:work.category,active:work.active,unit:t.unit}},account);return t;
  }
  if(action==='list')return portalRows_('Invoice').map(function(r){return r.value;}).filter(function(i){return i.status!=='DELETED'&&(!admin||i.status!=='DRAFT')&&(admin||(portalFinance_(account)&&i.status!=='DRAFT')||i.owner===account.id);}).map(function(i){return {id:i.id,number:i.number||'',applicant:i.profile.name,type:i.data.requestType,category:i.data.requestCategory,requestDate:i.data.requestDate,projectType:i.data.projectType,paymentDate:i.payment&&i.payment.date||'',dueDate:portalInvoiceDueDate_(i),status:i.status,total:i.total,updatedAt:i.updatedAt};}).sort(function(a,b){return b.updatedAt.localeCompare(a.updatedAt);});
  if(action==='archive'){if(!admin)throw Error('Hanya Admin yang dapat melihat arsip.');return portalRows_('Invoice').map(function(row){return row.value;}).filter(function(i){return i.status==='DELETED';}).map(function(i){var event=(i.history||[]).filter(function(h){return h.action==='DELETE';}).pop();return {id:i.id,number:i.number||'',applicant:i.profile.name,type:i.data.requestType,total:i.total,previousStatus:i.previousStatus,deletedAt:i.deletedAt,deletedBy:i.deletedBy,reason:event?event.note:''};}).sort(function(a,b){return String(b.deletedAt).localeCompare(String(a.deletedAt));});}
  if(action==='restore'){if(!admin)throw Error('Hanya Admin yang dapat memulihkan invoice.');var archived=portalGet_('Invoice',input.id);if(!archived||archived.status!=='DELETED'||['DRAFT','SUBMITTED','REVISION','CONFIRMATION','APPROVED','REJECTED','PAID'].indexOf(archived.previousStatus)<0)throw Error('Invoice arsip tidak ditemukan.');var restoreNote=recordText_(input.note,'Alasan pemulihan',1000);archived.status=archived.previousStatus;portalHistory_(archived,account,'RESTORE',restoreNote);portalPut_('Invoice',archived.id,archived);return {id:archived.id,status:archived.status};}
  if(action==='draft'){
   if(portalRole_(account)!=='PEMOHON')throw Error('Pembuatan invoice menggunakan akun Pemohon.');
   if(!portalComplete_(account.profile))throw Error('Lengkapi Profil Saya terlebih dahulu.');
   if(!/^[a-f0-9-]{36}$/i.test(input.id||''))throw Error('ID draft tidak valid.');
   var old=portalGet_('Invoice',input.id);if(old&&(old.owner!==account.id||['DRAFT','REVISION'].indexOf(old.status)<0))throw Error('Draft tidak dapat diubah.');
   var source=input.data||{},data={},allowed=['requestDate','projectType','requestCategory','requestType','salesPeriodStart','salesPeriodEnd','salesCount','managePeriodStart','managePeriodEnd','projectWorkDateMode','projectWorkDateStart','projectWorkDateEnd','projectWorkQuantity','projectWorkUnit','projectWorkNote','operationalWorkDateMode','operationalWorkDateStart','operationalWorkDateEnd','operationalWorkNote','reimbursementItems','additionalItems'];
   allowed.forEach(function(key){if(Object.prototype.hasOwnProperty.call(source,key))data[key]=JSON.parse(JSON.stringify(source[key]));});
   if(Array.isArray(data.reimbursementItems))data.reimbursementItems=data.reimbursementItems.map(function(item){return {object:recordText_(item.object,'Objek Reimburst',200),amount:Number(item.amount)};});if(Array.isArray(data.additionalItems))data.additionalItems=data.additionalItems.map(function(item){return {category:item.category,type:recordText_(item.type,'Jenis pekerjaan',80),quantity:Number(item.quantity),unit:recordText_(item.unit,'Satuan',80),dateStart:String(item.dateStart||''),dateEnd:String(item.dateEnd||''),note:String(item.note||'').trim(),object:item.object?recordText_(item.object,'Objek pengeluaran',200):'',amount:Number(item.amount||0)};});
   data.applicant=account.profile.name;data.bank=account.profile.bank;data.accountNumber=account.profile.accountNumber;data.accountOwner=account.profile.accountOwner;portalValidateMaster_(data);normalizeRecord_(data);
   var draftChanged=!old||JSON.stringify(old.data)!==JSON.stringify(data)||(input.folderUrl&&input.folderUrl!==old.folderUrl),invoice=old||{id:input.id,owner:account.id,status:'DRAFT',createdAt:new Date().toISOString(),history:[]};
   var evidence=portalEvidence_(input,old,account.id,invoice.id);invoice.data=data;invoice.profile=JSON.parse(JSON.stringify(account.profile));invoice.email=account.email;invoice.folderUrl=input.folderUrl||old&&old.folderUrl||'';invoice.evidence=evidence;
   if(invoice.folderUrl&&evidence.length){var folder=DriveApp.getFolderById(invoice.folderUrl.match(/\/folders\/([A-Za-z0-9_-]+)/)[1]),folderName=evidenceFolderName_({applicant:data.applicant,requestType:data.requestType,requestDate:data.requestDate});
   renameEvidenceBatch_(folder,folderName,evidenceFileManifest_(evidence));invoice.evidence.forEach(function(file,index){file.name=evidenceFileName_(folderName,index,file.name.split('.').pop());});}
   portalPrice_(invoice);invoice.priceConfirmed=false;if(draftChanged)portalHistory_(invoice,account,'SAVE_DRAFT');portalPut_('Invoice',invoice.id,invoice);return invoice;
  }
  var inv=portalOwn_(account,portalGet_('Invoice',input.id));
  if(action==='get'){var view=JSON.parse(JSON.stringify(inv));view.company=view.company||portalCompany_();view.dueAt=portalInvoiceDueDate_(view);view.displayDetails=portalDetailLines_(inv.data);view.duplicates=portalDuplicates_(inv,account);return view;}
  if(action==='editValues'){
   if(!admin)throw Error('Hanya Admin yang dapat mengubah nilai invoice.');if(['APPROVED','PAID'].indexOf(inv.status)>=0)throw Error('Nilai invoice yang telah disetujui tidak dapat diubah.');var reason=recordText_(input.note,'Alasan perubahan nilai',1000);
   if(!Array.isArray(input.prices)||input.prices.length!==inv.items.length)throw Error('Rincian harga tidak sesuai.');
   var revised=inv.items.map(function(item,index){var price=Number(input.prices[index]),amount=Math.round(item.qty*price);if(!Number.isSafeInteger(price)||price<1||!Number.isSafeInteger(amount)||amount<1)throw Error('Harga atau subtotal tidak valid.');var copy=JSON.parse(JSON.stringify(item));copy.price=price;copy.amount=amount;return copy;}),total=revised.reduce(function(sum,item){return sum+item.amount;},0);if(!Number.isSafeInteger(total))throw Error('Total invoice terlalu besar.');
   inv.valueRevisions=inv.valueRevisions||[];inv.valueRevisions.push({at:new Date().toISOString(),by:account.email,note:reason,items:inv.items,total:inv.total,status:inv.status,approvedAt:inv.approvedAt||null,approvedBy:inv.approvedBy||null,dueAt:inv.dueAt||null,pdfId:inv.pdfId||null});inv.items=revised;inv.total=total;inv.priced=true;inv.priceConfirmed=false;if(['DRAFT','REVISION'].indexOf(inv.status)<0)inv.status='CONFIRMATION';inv.pdfId=null;inv.approvedAt=null;inv.approvedBy=null;inv.dueAt=null;portalHistory_(inv,account,'EDIT_VALUES',reason);
  } else if(action==='delete'){if(!admin)throw Error('Hanya Admin yang dapat menghapus invoice.');var reason=recordText_(input.note,'Alasan penghapusan',1000);inv.previousStatus=inv.status;inv.status='DELETED';inv.deletedAt=new Date().toISOString();inv.deletedBy=account.email;portalHistory_(inv,account,'DELETE',reason);
  } else if(action==='submit'){
   if(portalRole_(account)!=='PEMOHON'||inv.owner!==account.id||['DRAFT','REVISION'].indexOf(inv.status)<0)throw Error('Pengajuan tidak dapat diajukan.');
   if(!inv.folderUrl||!Array.isArray(inv.evidence)||!inv.evidence.length)throw Error('Lampirkan bukti pengajuan sebelum mengirim invoice.');
   // Prices shown in the draft are the ones the applicant submits, not a new live tariff.
   portalAssertUnique_(inv,account);portalEnsureNumber_(inv);inv.status='SUBMITTED';inv.priceConfirmed=inv.priced;portalHistory_(inv,account,'SUBMIT');
  } else if(action==='confirm'){
   if(portalRole_(account)!=='PEMOHON'||inv.owner!==account.id||inv.status!=='CONFIRMATION'||!inv.priced)throw Error('Konfirmasi tidak tersedia.');portalAssertUnique_(inv,account);inv.priceConfirmed=true;inv.status='SUBMITTED';portalHistory_(inv,account,'CONFIRM_PRICE');
  } else if(action==='review'){
   if(!admin||inv.status!=='SUBMITTED')throw Error('Pengajuan tidak dapat direview.');
   var decision=input.decision,note=input.note||'';
   if(decision==='REVISION'||decision==='REJECTED'){inv.status=decision;note=recordText_(note,'Catatan admin',1000);}
   else if(decision==='APPROVED'){
    if(!inv.priced||!inv.priceConfirmed)throw Error('Tarif dan nilai harus dikonfirmasi pemohon terlebih dahulu.');
    portalEnsureNumber_(inv);inv.status='APPROVED';inv.approvedAt=new Date().toISOString();inv.approvedBy=account.email;inv.dueAt=portalDueDate_(inv.approvedAt);inv.company=portalCompany_();
    var pdf=portalCreatePdf_(inv);inv.pdfId=pdf.getId();inv.pdfTemplateVersion=8;inv.pdfPaymentStatus=inv.status;
   } else throw Error('Keputusan tidak valid.');portalHistory_(inv,account,decision,note);
  } else if(action==='reprice'){
   if(!admin||inv.status!=='SUBMITTED')throw Error('Nilai tidak dapat diubah.');var reason=recordText_(input.note,'Catatan perubahan',1000);
   if(input.salesCount!==undefined&&inv.data.requestType==='Sales'){var quantity=Number(input.salesCount);if(!Number.isSafeInteger(quantity)||quantity<1)throw Error('Jumlah sales tidak valid.');inv.data.salesCount=String(quantity);}
   portalPrice_(inv);if(!inv.priced)throw Error('Lengkapi tarif sebelum menghitung ulang.');inv.priceConfirmed=false;inv.status='CONFIRMATION';portalHistory_(inv,account,'REPRICE',reason);
  } else if(action==='pay'){
   if(!portalFinance_(account)||inv.status!=='APPROVED')throw Error('Hanya Finance yang dapat menandai invoice disetujui sebagai Paid.');
   var paymentDate=recordDate_(input.paymentDate);
   var reference=recordText_(input.reference,'Referensi pembayaran',200),proof=null;
   if(input.paymentFile){var file=input.paymentFile;if(!/\.(png|jpe?g|pdf)$/i.test(file.name||''))throw Error('Bukti pembayaran harus JPG, PNG, atau PDF.');proof=uploadEvidence_({requestId:inv.id,metadata:{applicant:inv.profile.name,requestType:'Pembayaran '+(inv.number||'invoice'),requestDate:paymentDate},files:[file]},true)[0];}
   inv.payment={date:paymentDate,reference:reference,amount:inv.total,by:account.email,recordedAt:new Date().toISOString(),proof:proof};
   inv.status='PAID';portalHistory_(inv,account,'PAID',inv.payment.reference);
  } else if(action==='pdf'){
   if(['APPROVED','PAID'].indexOf(inv.status)<0||!inv.pdfId)throw Error('PDF hanya tersedia setelah disetujui.');if((inv.pdfTemplateVersion!==8||inv.pdfPaymentStatus!==inv.status)){inv.company=inv.company||portalCompany_();var updatedPdf=portalCreatePdf_(inv);inv.pdfId=updatedPdf.getId();inv.pdfTemplateVersion=8;inv.pdfPaymentStatus=inv.status;portalPut_('Invoice',inv.id,inv);}var blob=DriveApp.getFileById(inv.pdfId).getBlob();return {name:inv.number.replace(/\//g,'-')+'.pdf',base64:Utilities.base64Encode(blob.getBytes())};
  } else throw Error('Aksi portal tidak dikenal.');
  try {portalPut_('Invoice',inv.id,inv);}catch(error){if(action==='review'&&inv.pdfId&&inv.status==='APPROVED'){try{DriveApp.getFileById(inv.pdfId).setTrashed(true);}catch(cleanup){}}throw error;}
  return inv;
 }finally{if(lock)lock.releaseLock();}
}
function portalDetailLines_(data) {
 var d=normalizeRecord_(data).details,lines=[['Tanggal pengajuan',data.requestDate],['Jenis proyek',data.projectType],['Kategori',data.requestCategory],['Jenis pengajuan',data.requestType]];
 function period(value){return value.tanggal||value.mulai+' s/d '+value.selesai;}
 if(data.requestType==='Sales'){lines.push(['Periode penagihan',period(d.periode)],['Jumlah sales',String(d.jumlahSales)],['Catatan',d.catatan]);}
 else if(data.requestType==='Manage Service')lines.push(['Periode penagihan',period(d.periodePenagihan)]);
 else if(data.requestType==='Reimburst')d.rincian.forEach(function(item,i){lines.push(['Rincian '+(i+1),item.objek+' — Rp '+item.nominal.toLocaleString('id-ID')]);});
 else {lines.push([data.requestType==='Operasional'?'Periode penagihan':'Tanggal pekerjaan',period(d.tanggal)]);if(data.requestCategory==='Projek')lines.push(['QTY/Jumlah',String(d.jumlah)+' '+d.satuan]);lines.push(['Keterangan',d.keterangan]);}
 if(data.requestCategory==='Non Projek'&&data.nonProjectUnit)lines.push(['Satuan',data.nonProjectUnit]);if(data.requestType==='Operasional'&&data.nonProjectUnit==='Hari')lines.push(['Jumlah hari',String(portalOperationalDays_(data))]);(data.additionalItems||[]).forEach(function(item,index){var text=item.type;if(item.type==='Reimburst')text=item.object+' — Rp '+Number(item.amount).toLocaleString('id-ID');else{text+=' · '+item.quantity+' '+item.unit;if(item.dateStart)text+=' · '+item.dateStart+(item.dateEnd&&item.dateEnd!==item.dateStart?' s/d '+item.dateEnd:'');if(item.note)text+=' · '+item.note;}lines.push(['Produk/jasa '+(index+2),text]);});
 return lines;
}
function portalEscape_(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function portalPdfHtml_(inv){
 var e=portalEscape_,rupiah=function(n){return 'Rp '+Number(n).toLocaleString('id-ID');},date=function(value){if(!value)return '—';if(String(value).indexOf('T')>=0)return Utilities.formatDate(new Date(value),'Asia/Jakarta','dd/MM/yyyy · HH:mm')+' WIB';var parts=value.slice(0,10).split('-');return parts[2]+'/'+parts[1]+'/'+parts[0];},due=portalInvoiceDueDate_(inv),company=inv.company||portalCompany_(),companyName=company.companyName||'PT Blue Connect Indonesia',companyLines=[company.companyAddress,company.companyEmail,company.companyPhone,company.companyNpwp?'NPWP '+company.companyNpwp:''].filter(function(value){return !!value;}).map(function(value){return '<p>'+e(value)+'</p>';}).join('');var periodStart='',periodEnd='',billingPeriod='';if(inv.data.requestType==='Sales'){periodStart=inv.data.salesPeriodStart;periodEnd=inv.data.salesPeriodEnd;}else if(inv.data.requestType==='Manage Service'){periodStart=inv.data.managePeriodStart;periodEnd=inv.data.managePeriodEnd;}else if(inv.data.requestType==='Operasional'){periodStart=inv.data.operationalWorkDateStart;if(inv.data.operationalWorkDateMode==='range')periodEnd=inv.data.operationalWorkDateEnd;}if(periodStart){var periodText=date(periodStart)+(periodEnd&&periodEnd!==periodStart?' — '+date(periodEnd):'');billingPeriod='<div class="billing-period"><span class="label">Periode penagihan</span><strong>'+e(periodText)+'</strong></div>';}

 return '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>'+e(inv.number)+'</title><style>@page{size:A4;margin:18mm 16mm}*{box-sizing:border-box}body{font:10pt Arial,sans-serif;color:#243c43;margin:0;line-height:1.55}table{width:100%;border-collapse:collapse}td{vertical-align:top}h1{font-size:28pt;letter-spacing:2px;margin:0;color:#123c43}h2{font-size:11pt;margin:0 0 10px}p{margin:4px 0}.muted{color:#78898d;font-size:8pt}.label{font-size:7.5pt;letter-spacing:1px;text-transform:uppercase;color:#72888a}.header td:first-child{width:45%}.header td.right{width:55%}.header{border-bottom:3px solid #148879;padding-bottom:20px;margin-bottom:22px}.right{text-align:right}.number{font-size:10pt;font-weight:bold;word-wrap:break-word}.parties{margin:24px 0}.parties td{width:50%;padding-right:24px}.name{font-size:12pt;font-weight:bold;margin:8px 0}.metadata{background:#f2f7f6;padding:14px;margin-bottom:18px}.billing-period{background:#eef6f3;border-left:4px solid #148879;padding:13px 16px;margin:0 0 22px;page-break-inside:avoid}.billing-period strong{display:block;margin-top:4px;font-size:11pt;color:#1d514b}.billing-period .label{font-size:8pt}.metadata td{padding:4px 8px;font-size:9pt}.items{margin:10px 0 16px;table-layout:fixed}.items thead{display:table-header-group}.items th{background:#143f45;color:white;text-align:left;padding:11px 9px;font-size:8pt;font-weight:normal}.items td{padding:12px 9px;border-bottom:1px solid #dfe9e6;font-size:9pt;word-wrap:break-word}.items tr{page-break-inside:avoid}.items .numeric{text-align:right}.total{width:55%;margin-left:auto;background:#eef6f3;padding:15px 18px;page-break-inside:avoid;margin-bottom:25px}.total td{vertical-align:middle}.total strong{font-size:16pt;color:#087c6c}.section{margin-top:24px}.details td{padding:6px 0;border-bottom:1px solid #edf1ef;font-size:9pt;word-wrap:break-word;white-space:pre-wrap}.details td:first-child{width:32%;color:#7a8d90;padding-right:16px}.attachments{margin-top:24px}.attachments h2{margin-bottom:6px}.attachment-table td{padding:10px 6px;border-bottom:1px solid #e1e9e6;font-size:9pt;word-wrap:break-word}.attachment-table tr{page-break-inside:avoid}.payment{border:1px solid #d5e5df;border-left:4px solid #148879;padding:16px 18px;margin:26px 0;page-break-inside:avoid}.account{font-size:14pt;font-weight:bold;letter-spacing:1px;margin:7px 0}.footer{border-top:1px solid #dce6e2;padding-top:13px;margin-top:26px;font-size:8pt;color:#72868a}.approval{font-weight:bold;color:#246b5d;margin-bottom:5px}a{color:#087c6c;text-decoration:none}</style></head><body><div class="header"><table><tr><td><h1>INVOICE</h1><p class="muted">Tagihan kepada '+e(companyName)+'</p></td><td class="right"><p class="label">Nomor invoice</p><p class="number">'+e(inv.number)+'</p><p class="muted">Tanggal pengajuan: '+e(date(inv.data.requestDate))+'</p><p class="muted">Jenis proyek: '+e(inv.data.projectType)+'</p><p class="muted">Jatuh tempo: '+e(date(due))+'</p></td></tr></table></div><table class="parties"><tr><td><div class="label">Diterbitkan oleh</div><p class="name">'+e(inv.profile.name)+'</p><p>'+e(inv.profile.address)+'</p><p class="muted">'+e(inv.email)+'<br>'+e(inv.profile.phone)+'</p></td><td><div class="label">Ditagihkan kepada</div><p class="name">'+e(companyName)+'</p>'+companyLines+'</td></tr></table>'+billingPeriod+'<h2>Rincian tagihan</h2><table class="items"><thead><tr><th style="width:34%">Pekerjaan / rincian</th><th class="numeric" style="width:11%">Jumlah</th><th style="width:12%">Satuan</th><th class="numeric" style="width:21%">Harga satuan</th><th class="numeric" style="width:22%">Subtotal</th></tr></thead><tbody>'+inv.items.map(function(item){return '<tr><td>'+e(item.description)+'</td><td class="numeric">'+e(item.qty)+'</td><td>'+e(item.unit)+'</td><td class="numeric">'+e(rupiah(item.price))+'</td><td class="numeric">'+e(rupiah(item.amount))+'</td></tr>';}).join('')+'</tbody></table><div class="total"><table><tr><td>Total invoice</td><td class="right"><strong>'+e(rupiah(inv.total))+'</strong></td></tr></table></div><div class="payment"><table><tr><td style="width:42%;padding-right:20px"><div class="label">Pembayaran melalui transfer</div><p style="font-size:14pt;margin-top:10px"><strong>'+e(inv.profile.bank)+'</strong></p></td><td><div class="label">Nomor rekening</div><p class="account">'+e(inv.profile.accountNumber)+'</p><p class="muted">Atas nama</p><p><strong>'+e(inv.profile.accountOwner)+'</strong></p></td></tr></table></div><div class="attachments"><h2>Lampiran invoice</h2><p class="muted">Dokumen pendukung pengajuan. Akses mengikuti izin Google Drive.</p>'+((inv.evidence||[]).filter(function(file){return /^https:\/\/drive\.google\.com\//.test(file.url||'');}).length?'<table class="attachment-table">'+(inv.evidence||[]).filter(function(file){return /^https:\/\/drive\.google\.com\//.test(file.url||'');}).map(function(file,index){return '<tr><td style="width:8%">'+(index+1)+'</td><td><strong>'+e(file.name)+'</strong><br><a href="'+e(file.url)+'">Buka lampiran '+(index+1)+'</a></td></tr>';}).join('')+'</table>':'')+'</div><div class="footer"><h2>Persetujuan dan pembayaran</h2><p class="approval">Disetujui oleh Admin Projek: '+e(inv.approvedBy)+' — tanggal '+e(date(inv.approvedAt))+'</p>'+(inv.payment?'<p class="approval">Dibayar oleh Finance: '+e(inv.payment.by)+' — tanggal '+e(date(inv.payment.recordedAt||inv.payment.date))+'</p>':'<p>Menunggu pembayaran.</p>')+'<p>Dokumen diterbitkan melalui Portal Invoice Blue Connect Indonesia berdasarkan nilai yang telah disetujui.</p><p>Tidak mencakup perhitungan pajak atau potongan otomatis.</p></div></body></html>';
}
function portalCreatePdf_(inv){
 var html=portalPdfHtml_(inv);
 var blob=HtmlService.createHtmlOutput(html).getAs('application/pdf').setName(inv.number.replace(/\//g,'-')+'.pdf');
 var root=DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('UPLOAD_FOLDER_ID')||EVIDENCE_DEFAULT_FOLDER_ID_),folders=root.getFoldersByName('Invoice Disetujui'),target=folders.hasNext()?folders.next():root.createFolder('Invoice Disetujui');return target.createFile(blob);
}
