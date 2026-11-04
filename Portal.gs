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
function portalDueDate_(approvedAt){if(!approvedAt)return '';var zone=Session.getScriptTimeZone()||'Asia/Jakarta',parts=Utilities.formatDate(new Date(approvedAt),zone,'yyyy-MM-dd').split('-'),date=new Date(Date.UTC(Number(parts[0]),Number(parts[1])-1,Number(parts[2])+3));return Utilities.formatDate(date,'UTC','yyyy-MM-dd');}
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
 else{var qty=data.requestCategory==='Projek'?Number(data.projectWorkQuantity):(data.requestType==='Sales'?Number(data.salesCount):Number(data.operationalWorkQuantity||1)),unit=data.requestCategory==='Projek'?data.projectWorkUnit:(data.nonProjectUnit||({Sales:'Sales','Manage Service':'Periode',Operasional:'Pengajuan'})[data.requestType]);if(data.requestType==='Operasional'&&unit==='Hari')qty=portalOperationalDays_(data);items.push(item(data.requestType,qty,unit,null,data.requestType));}
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
function portalPrice_(invoice){if(invoice.data.operationalWorkQuantity!==undefined&&invoice.data.operationalWorkQuantity!==''){var q=Number(invoice.data.operationalWorkQuantity);if(!Number.isFinite(q)||q<=0||q>Number.MAX_SAFE_INTEGER)throw Error('QTY harus lebih dari nol.');}if(invoice.data.requestCategory==='Non Projek'){var work=portalMaster_().find(function(e){return e.kind==='work'&&e.name===invoice.data.requestType;});invoice.data.nonProjectUnit=work.unit;}invoice.items=portalItems_(invoice.data);invoice.priced=invoice.items.every(function(i){return i.price!==null;});invoice.total=invoice.priced?invoice.items.reduce(function(t,i){return t+i.amount;},0):null;if(invoice.total!==null&&!Number.isSafeInteger(invoice.total))throw Error('Total terlalu besar.');}
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
   var source=input.data||{},data={},allowed=['requestDate','projectType','requestCategory','requestType','salesPeriodStart','salesPeriodEnd','salesCount','managePeriodStart','managePeriodEnd','projectWorkDateMode','projectWorkDateStart','projectWorkDateEnd','projectWorkQuantity','projectWorkUnit','projectWorkNote','operationalWorkDateMode','operationalWorkDateStart','operationalWorkDateEnd','operationalWorkNote','operationalWorkQuantity','reimbursementItems','additionalItems'];
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
    var pdf=portalCreatePdf_(inv);inv.pdfId=pdf.getId();inv.pdfTemplateVersion=16;inv.pdfPaymentStatus=inv.status;
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
   if(['APPROVED','PAID'].indexOf(inv.status)<0||!inv.pdfId)throw Error('PDF hanya tersedia setelah disetujui.');if((inv.pdfTemplateVersion!==16||inv.pdfPaymentStatus!==inv.status)){inv.company=inv.company||portalCompany_();var updatedPdf=portalCreatePdf_(inv);inv.pdfId=updatedPdf.getId();inv.pdfTemplateVersion=16;inv.pdfPaymentStatus=inv.status;portalPut_('Invoice',inv.id,inv);}var blob=DriveApp.getFileById(inv.pdfId).getBlob();return {name:inv.number.replace(/\//g,'-')+'.pdf',base64:Utilities.base64Encode(blob.getBytes())};
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

 function periodLabel(a,b){var months=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];function full(v){var p=v.slice(0,10).split('-');return Number(p[2])+' '+months[Number(p[1])-1]+' '+p[0];}if(!b||a===b)return full(a);var p=a.split('-'),q=b.split('-');return (p[0]===q[0]?Number(p[2])+(p[1]===q[1]?'':' '+months[Number(p[1])-1]):full(a))+' s.d '+full(b);}
 function itemDescription(item){var text=String(item.description||'');text=text.replace(/[·-]?\s*Periode penagihan\s+(\d{4}-\d{2}-\d{2})(?:\s+(?:s\/d|s\.d|—)\s+(\d{4}-\d{2}-\d{2}))?/gi,function(_,a,b){return '- Periode '+periodLabel(a,b);});if(periodStart&&text.indexOf('Periode')<0&&text===inv.data.requestType)text+=' - Periode '+periodLabel(periodStart,periodEnd);return text;}
 billingPeriod='';

 return '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>'+e(inv.number)+'</title><style>@page{size:A4;margin:18mm 16mm}*{box-sizing:border-box}body{font:10pt Arial,sans-serif;color:#243c43;margin:0;line-height:1.55}table{width:100%;border-collapse:collapse}td{vertical-align:top}h1{font-size:28pt;letter-spacing:2px;margin:0;color:#123c43}h2{font-size:11pt;margin:0 0 10px}p{margin:4px 0}.muted{color:#78898d;font-size:8pt}.label{font-size:7.5pt;letter-spacing:1px;text-transform:uppercase;color:#72888a}.header td:first-child{width:45%}.header td.right{width:55%}.header{border-bottom:3px solid #148879;padding-bottom:20px;margin-bottom:22px}.right{text-align:right}.number{font-size:10pt;font-weight:bold;word-wrap:break-word}.parties{margin:24px 0}.parties td{width:50%;padding-right:24px}.name{font-size:12pt;font-weight:bold;margin:8px 0}.metadata{background:#f2f7f6;padding:14px;margin-bottom:18px}.billing-period{background:#eef6f3;border-left:4px solid #148879;padding:13px 16px;margin:0 0 22px;page-break-inside:avoid}.billing-period strong{display:block;margin-top:4px;font-size:11pt;color:#1d514b}.billing-period .label{font-size:8pt}.metadata td{padding:4px 8px;font-size:9pt}.items{margin:10px 0 16px;table-layout:fixed}.items thead{display:table-header-group}.items th{background:#143f45;color:white;text-align:left;padding:11px 9px;font-size:8pt;font-weight:normal}.items td{padding:12px 9px;border-bottom:1px solid #dfe9e6;font-size:9pt;word-wrap:break-word}.items tr{page-break-inside:avoid}.items .numeric{text-align:right}.total{width:55%;margin-left:auto;background:#eef6f3;padding:15px 18px;page-break-inside:avoid;margin-bottom:25px}.total td{vertical-align:middle}.total strong{font-size:16pt;color:#087c6c}.section{margin-top:24px}.details td{padding:6px 0;border-bottom:1px solid #edf1ef;font-size:9pt;word-wrap:break-word;white-space:pre-wrap}.details td:first-child{width:32%;color:#7a8d90;padding-right:16px}.attachments{margin-top:24px}.attachments h2{margin-bottom:6px}.attachment-table td{padding:10px 6px;border-bottom:1px solid #e1e9e6;font-size:9pt;word-wrap:break-word}.attachment-table tr{page-break-inside:avoid}.payment{border:1px solid #d5e5df;border-left:4px solid #148879;padding:16px 18px;margin:26px 0;page-break-inside:avoid}.account{font-size:14pt;font-weight:bold;letter-spacing:1px;margin:7px 0}.footer{border-top:1px solid #dce6e2;padding-top:13px;margin-top:26px;font-size:8pt;color:#72868a}.approval{font-weight:bold;color:#246b5d;margin-bottom:5px}a{color:#087c6c;text-decoration:none}@page{size:A4;margin:14mm 15mm}body{line-height:1.4}.header{padding-bottom:12px;margin-bottom:14px}.parties{margin:14px 0 18px;page-break-inside:avoid}.parties td{padding-right:18px;font-size:8pt;line-height:1.4;overflow-wrap:anywhere;word-wrap:break-word}.parties p{margin:2px 0}.parties .name{font-size:11pt;font-weight:bold;margin:5px 0}.parties .muted{font-size:8pt}.parties .label{font-size:7pt}.items{margin:8px 0 12px}.items th{padding:8px 7px}.items td{padding:8px 7px;font-size:8.5pt}.total{padding:10px 14px;margin-bottom:14px}.total strong{font-size:13pt}.payment{padding:10px 12px;margin:14px 0;font-size:8pt}.payment .label{font-size:7pt}.payment .account{font-size:10pt;letter-spacing:.3px;margin:4px 0}.payment p{margin:2px 0}.attachments{margin-top:14px}.attachment-table td{padding:6px 5px;font-size:8pt}.footer{padding-top:9px;margin-top:16px;font-size:7.5pt;page-break-inside:avoid}.footer h2{font-size:9pt;margin-bottom:6px}.footer p{margin:3px 0}.billing-title{font-size:13pt;font-weight:bold;color:#123c43;margin:16px 0 9px}.items{border:1px solid #cbdad6}.items th{font-size:9.5pt;font-weight:bold;line-height:1.35;padding:10px 8px;background:#143f45;color:#fff;border-right:1px solid #49666a}.items th:last-child{border-right:0}.items td{font-size:9pt;line-height:1.45;padding:9px 8px;border-right:1px solid #dce6e2;border-bottom:1px solid #dce6e2;color:#243c43}.items td:last-child{border-right:0}.items tbody tr:nth-child(even){background:#f5f9f7}.items th.numeric,.items td.numeric{text-align:right}.billing-title{font-size:15pt;margin:18px 0 10px}.items{border:1.5px solid #516b70}.items th{font-size:10pt;font-weight:bold;padding:11px 8px;background:#143f45;color:#fff;border:1px solid #516b70}.items td{font-size:10pt;line-height:1.5;padding:11px 8px;border:1px solid #8fa5a6;color:#132f35}.items td:first-child{font-weight:bold}.qr-attachments td{padding:6px 8px;vertical-align:middle;font-size:9pt}.qr-attachments tr{page-break-inside:avoid}.qr-attachments img{display:block}html,body,table,thead,tr,th,td{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}.items thead,.items thead tr,.items thead th{background:#12363c!important;background-color:#12363c!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color:#ffffff!important}.items thead th{opacity:1!important}.items thead th span{color:#ffffff!important}.billing-title{font-size:12pt;margin:16px 0 12px}.items{width:100%;border:0!important;border-collapse:collapse;table-layout:fixed}.items thead,.items thead tr,.items thead th{background:#edf4f3!important;color:#234650!important}.items thead th{font-size:8pt!important;font-weight:normal!important;text-transform:uppercase;letter-spacing:.3px;padding:10px 7px;border:0!important;border-bottom:1px solid #cbdcdb!important;text-align:left}.items thead th.numeric{text-align:right}.items tbody tr,.items tbody tr:nth-child(even){background:#ffffff!important}.items tbody td{font-size:9pt;font-weight:normal!important;line-height:1.45;color:#243c43;padding:12px 7px;border:0!important;border-bottom:1px solid #d9e5e3!important;word-wrap:break-word}.items tbody td:last-child{font-weight:bold!important}.items td:nth-child(2),.items td:nth-child(3){text-align:left}.total{width:100%;margin:12px 0 18px;background:transparent;padding:10px 0;page-break-inside:avoid}.total td{font-size:9pt;color:#71858a}.total td.right{color:#173940}.total strong{font-size:14pt;color:#173940}.payment-attachments{margin:14px 0;page-break-inside:avoid;table-layout:fixed}.payment-attachments>tbody>tr>td,.payment-attachments>tr>td{vertical-align:middle}.payment-attachments .payment{margin:0;padding:10px 12px}.payment-attachments .qr-attachments td{padding:4px;font-size:8pt}.payment-attachments .qr-attachments img{width:90px;height:90px}</style></head><body><div class="header"><table><tr><td><h1>INVOICE</h1></td><td class="right"><p class="label">Nomor invoice</p><p class="number">'+e(inv.number)+'</p><p class="muted">Tanggal pengajuan: '+e(date(inv.data.requestDate))+'</p><p class="muted">Jenis proyek: '+e(inv.data.projectType)+'</p><p class="muted">Jatuh tempo: '+e(date(due))+'</p></td></tr></table></div><table class="parties"><tr><td><div class="label">Diterbitkan oleh</div><p class="name">'+e(inv.profile.name)+'</p><p>'+e(inv.profile.address)+'</p><p class="muted">'+e(inv.email)+'<br>'+e(inv.profile.phone)+'</p></td><td><div class="label">Ditagihkan kepada</div><p class="name">'+e(companyName)+'</p>'+companyLines+'</td></tr></table>'+billingPeriod+'<h2 class="billing-title">Rincian tagihan</h2><table class="items"><thead><tr><th style="width:36%">Pekerjaan</th><th style="width:9%">Jumlah</th><th style="width:17%">Satuan</th><th class="numeric" style="width:19%">Harga satuan</th><th class="numeric" style="width:19%">Subtotal</th></tr></thead><tbody>'+inv.items.map(function(item){return '<tr><td>'+e(itemDescription(item))+'</td><td class="numeric">'+e(item.qty)+'</td><td>'+e(item.unit)+'</td><td class="numeric">'+e(rupiah(item.price))+'</td><td class="numeric">'+e(rupiah(item.amount))+'</td></tr>';}).join('')+'</tbody></table><div class="total"><table><tr><td>Total invoice</td><td class="right"><strong>'+e(rupiah(inv.total))+'</strong></td></tr></table></div><table class="payment-attachments"><tr><td style="width:52%;padding-right:14px"><div class="payment"><div class="label">Rekening pembayaran</div><p style="font-size:9pt;margin-top:6px"><strong>'+e(inv.profile.bank)+'</strong></p><p class="account">'+e(inv.profile.accountNumber)+'</p><p class="muted">Atas nama</p><p><strong>'+e(inv.profile.accountOwner)+'</strong></p></div></td><td style="width:48%">'+portalAttachmentQrHtml_(inv)+'</td></tr></table><div class="footer"><h2>Persetujuan dan pembayaran</h2><p class="approval">Disetujui oleh Admin Projek: '+e(inv.approvedBy)+' — tanggal '+e(date(inv.approvedAt))+'</p>'+(inv.payment?'<p class="approval">Dibayar oleh Finance: '+e(inv.payment.by)+' — tanggal '+e(date(inv.payment.recordedAt||inv.payment.date))+'</p>':'<p>Menunggu pembayaran.</p>')+'<p>Dokumen diterbitkan melalui Portal Invoice Blue Connect Indonesia berdasarkan nilai yang telah disetujui.</p><p>Tidak mencakup perhitungan pajak atau potongan otomatis.</p></div></body></html>';
}
function portalCreatePdf_(inv){
 var html=portalPdfHtml_(inv);
 var blob=HtmlService.createHtmlOutput(html).getAs('application/pdf').setName(inv.number.replace(/\//g,'-')+'.pdf');
 var root=DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('UPLOAD_FOLDER_ID')||EVIDENCE_DEFAULT_FOLDER_ID_),folders=root.getFoldersByName('Invoice Disetujui'),target=folders.hasNext()?folders.next():root.createFolder('Invoice Disetujui');return target.createFile(blob);
}

/* QR encoder by Kazuhiko Arase, MIT license; embedded for offline PDF generation. */
//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();

(function (factory) {
  if (typeof define === 'function' && define.amd) {
      define([], factory);
  } else if (typeof exports === 'object') {
      module.exports = factory();
  }
}(function () {
    return qrcode;
}));

function portalAttachmentQrHtml_(inv){
 var files=(inv.evidence||[]).filter(function(f){return /^https:\/\/drive\.google\.com\//.test(f.url||'');});
 var folder=[inv.folderUrl||''].concat(files.map(function(f){return f.folderUrl||'';})).filter(function(url){return /^https:\/\/drive\.google\.com\/(?:drive\/)?(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+/.test(url);})[0];
 var urls=folder?[folder]:files.map(function(f){return f.url;});
 if(!urls.length)return '';
 return '<table class="qr-attachments">'+urls.map(function(url){var code=qrcode(0,'M');code.addData(url,'Byte');code.make();return '<tr><td style="width:27mm"><img width="90" height="90" src="'+code.createDataURL(4,16)+'" alt="QR lampiran"></td><td><strong>Lampiran invoice</strong><p class="muted">Scan untuk membuka lampiran di Google Drive.</p></td></tr>';}).join('')+'</table>';
}
