var EVIDENCE_DEFAULT_FOLDER_ID_ = '1t3eqlI9VK7y4Gt157bP4_YLKuyfSsM8B';

/** Serves the WhatsApp request form as a Google Apps Script Web App. */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Formulir pengajuan Invoice · Blue Connect')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function evidenceFolderName_(metadata) {
  var name = recordText_(metadata.applicant,'Nama pemohon',120);
  var type = recordText_(metadata.requestType,'Jenis pengajuan',80);
  var date = recordDate_(metadata.requestDate);
  function clean(value) {return value.replace(/[\\/:*?"<>|\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim();}
  name = clean(name);type = clean(type);
  if (!name || !type) throw new Error('Nama pemohon atau jenis pengajuan tidak valid untuk nama folder.');
  return name + ' - ' + type + ' - ' + date;
}

function assertEvidenceEditable_(folderId) {
  if (PropertiesService.getScriptProperties().getProperty('PORTAL_AUTH_REQUIRED') !== 'true') return;
  var binding=portalGet_('Bukti',folderId);
  if (binding) {var invoice=portalGet_('Invoice',binding.invoiceId);if(invoice&&['DRAFT','REVISION'].indexOf(invoice.status)<0)throw new Error('Bukti pengajuan yang telah diajukan tidak dapat diubah.');}
}
function evidenceFileName_(folderName,index,extension) {
  return folderName + ' - Lampiran ' + ('0' + (index+1)).slice(-2) + '.' + extension.toLowerCase();
}
function evidenceFileManifest_(result) {
  return result.map(function(item) {
    var match = String(item.url || '').match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    var id = item.fileId || (match && match[1]);
    var extension = item.name.split('.').pop().toLowerCase();
    if (!id || ['jpg','jpeg','png','webp','pdf','docx','xlsx'].indexOf(extension) < 0) throw new Error('Data urutan lampiran tidak valid. Pilih ulang lampiran.');
    return {id:id,extension:extension};
  });
}
function renameEvidenceBatch_(folder,name,manifest) {
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 10) throw new Error('Sesi urutan lampiran kedaluwarsa. Pilih ulang lampiran.');
  var files = manifest.map(function(item) {
    var file = DriveApp.getFileById(item.id), parents = file.getParents(), belongs = false;
    while (parents.hasNext()) if (parents.next().getId() === folder.getId()) belongs = true;
    if (!belongs) throw new Error('Lampiran telah dipindahkan dari folder pengajuan.');
    return file;
  });
  files.forEach(function(file,index) {file.setName(evidenceFileName_(name,index,manifest[index].extension));});
  folder.setName(name);
}

/** Uploads evidence into the admin-configured folder. Never grants public access. */
function uploadEvidence(input) {
  if (PropertiesService.getScriptProperties().getProperty('PORTAL_AUTH_REQUIRED') === 'true') throw new Error('Silakan gunakan portal payment.blueconnect.id dan masuk ke akun Anda.');
  return uploadEvidence_(input);
}
function uploadEvidence_(input, alreadyLocked) {
  if (PropertiesService.getScriptProperties().getProperty('EVIDENCE_UPLOADS_READY') !== 'true') throw new Error('Admin perlu menjalankan authorizeEvidenceStorage terlebih dahulu.');
  var maxFile = 5 * 1024 * 1024, maxTotal = 10 * 1024 * 1024;
  if (!input || !/^[a-f0-9-]{36}$/i.test(input.requestId || '') || !Array.isArray(input.files) || input.files.length < 1 || input.files.length > 10) {
    throw new Error('Pilih 1–10 lampiran dengan total maksimal 10 MB.');
  }
  var requestedFolderName = input.metadata ? evidenceFolderName_(input.metadata) : 'Pengajuan-' + new Date().toISOString().slice(0,10) + '-' + input.requestId;
  var folderId = PropertiesService.getScriptProperties().getProperty('UPLOAD_FOLDER_ID') || EVIDENCE_DEFAULT_FOLDER_ID_;
  if (!folderId) throw new Error('Folder bukti belum dikonfigurasi oleh admin.');
  var total = 0;
  var formats = {
    jpg:['image/jpeg','jpeg'], jpeg:['image/jpeg','jpeg'], png:['image/png','png'],
    webp:['image/webp','webp'], pdf:['application/pdf','pdf'],
    docx:['application/vnd.openxmlformats-officedocument.wordprocessingml.document','zip'],
    xlsx:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','zip']
  };
  var files = input.files.map(function(file) {
    if (!file || typeof file.name !== 'string' || file.name.length > 180 || typeof file.data !== 'string' || file.data.length > Math.ceil(maxFile / 3) * 4) throw new Error('Lampiran tidak valid atau lebih dari 5 MB.');
    var ext = file.name.split('.').pop().toLowerCase(), format = formats[ext];
    if (!format || (file.type && file.type !== format[0])) throw new Error('Gunakan JPG, PNG, WEBP, PDF, DOCX, atau XLSX.');
    if (!file.data || file.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) throw new Error('Data lampiran tidak valid.');
    var bytes = Utilities.base64Decode(file.data), unsigned = bytes.slice(0,12).map(function(b) {return b & 255;});
    if (!bytes.length || bytes.length > maxFile) throw new Error('Ukuran per file maksimal 5 MB.');
    total += bytes.length;
    var magic = format[1], valid = false;
    if (magic === 'jpeg') valid = unsigned[0] === 255 && unsigned[1] === 216 && unsigned[2] === 255;
    if (magic === 'png') valid = [137,80,78,71,13,10,26,10].every(function(b,i) {return unsigned[i] === b;});
    if (magic === 'pdf') valid = [37,80,68,70,45].every(function(b,i) {return unsigned[i] === b;});
    if (magic === 'zip') valid = unsigned[0] === 80 && unsigned[1] === 75 && unsigned[2] === 3 && unsigned[3] === 4;
    if (magic === 'webp') valid = [82,73,70,70].every(function(b,i) {return unsigned[i] === b;}) && [87,69,66,80].every(function(b,i) {return unsigned[i+8] === b;});
    if (!valid) throw new Error('Isi file tidak cocok dengan format lampiran.');
    return {name:file.name.replace(/[\\/\r\n\x00-\x1f]/g,'_'), type:format[0], bytes:bytes};
  });
  if (total > maxTotal) throw new Error('Total lampiran maksimal 10 MB.');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(input.files));
  var cacheKey = 'evidence-folder-v2-' + input.requestId + '-' + Utilities.base64EncodeWebSafe(digest);
  var lock = alreadyLocked ? null : LockService.getScriptLock(); if(lock)lock.waitLock(30000);
  var created = [], batchFolder;
  try {
    var cache = CacheService.getScriptCache(), previous = cache.get(cacheKey);
    if (previous) {
      var cached = JSON.parse(previous);
      if (input.metadata) {
        var cachedFolderId = cached[0].folderUrl.match(/\/folders\/([A-Za-z0-9_-]+)/)[1];
        assertEvidenceEditable_(cachedFolderId);
        var cachedManifest = evidenceFileManifest_(cached);
        renameEvidenceBatch_(DriveApp.getFolderById(cachedFolderId),requestedFolderName,cachedManifest);
        cached.forEach(function(item,index) {item.name = evidenceFileName_(requestedFolderName,index,cachedManifest[index].extension);});
        cache.put('evidence-files-' + cachedFolderId,JSON.stringify(cachedManifest),21600);
        cache.put('evidence-owner-' + cachedFolderId,input.requestId,21600);
        cache.put(cacheKey,JSON.stringify(cached),21600);
      }
      return cached;
    }
    var folder;
    try {folder = DriveApp.getFolderById(folderId); folder.getName();}
    catch (error) {throw new Error('Folder bukti tidak dapat diakses. Admin perlu memeriksa UPLOAD_FOLDER_ID dan izin Drive.');}
    batchFolder = folder.createFolder(requestedFolderName);
    var folderUrl = batchFolder.getUrl();
    var result = files.map(function(file,index) {
      var storedName = evidenceFileName_(requestedFolderName,index,file.name.split('.').pop());
      var stored = batchFolder.createFile(Utilities.newBlob(file.bytes,file.type,storedName));
      created.push(stored);
      return {name:storedName,fileId:stored.getId(),url:stored.getUrl(),folderUrl:folderUrl};
    });
    cache.put('evidence-files-' + batchFolder.getId(),JSON.stringify(evidenceFileManifest_(result)),21600);
    cache.put('evidence-owner-' + batchFolder.getId(),input.requestId,21600);
    cache.put(cacheKey,JSON.stringify(result),21600);
    return result;
  } catch (error) {
    created.forEach(function(file) {try {file.setTrashed(true);} catch (cleanupError) { /* Owner can remove partial files from the folder. */ }});
    if (batchFolder) {try {batchFolder.setTrashed(true);} catch (cleanupFolderError) { /* Owner can remove incomplete batch folders. */ }}
    throw new Error('Unggah bukti gagal. Periksa konfigurasi folder dan otorisasi Drive, lalu coba lagi.');
  } finally {if(lock)lock.releaseLock();}
}

/** Renames only a recently uploaded folder owned by this unguessable upload session. */
function updateEvidenceFolder(input) {
  if (PropertiesService.getScriptProperties().getProperty('PORTAL_AUTH_REQUIRED') === 'true') throw new Error('Silakan gunakan portal payment.blueconnect.id dan masuk ke akun Anda.');
  return updateEvidenceFolder_(input);
}
function updateEvidenceFolder_(input) {
  if (!input || !/^[a-f0-9-]{36}$/i.test(input.requestId || '')) throw new Error('Sesi unggah tidak valid.');
  var match = String(input.folderUrl || '').match(/^https:\/\/drive\.google\.com\/drive\/folders\/([A-Za-z0-9_-]+)(?:\?.*)?$/);
  if (!match) throw new Error('Tautan folder bukti tidak valid.');
  var name = evidenceFolderName_(input.metadata || {});
  var lock = LockService.getScriptLock();lock.waitLock(30000);
  try {
    if (CacheService.getScriptCache().get('evidence-owner-' + match[1]) !== input.requestId) throw new Error('Sesi unggah kedaluwarsa. Pilih ulang lampiran agar nama folder dapat diperbarui.');
    var folder = DriveApp.getFolderById(match[1]), parents = folder.getParents(), allowed = false;
    var root = PropertiesService.getScriptProperties().getProperty('UPLOAD_FOLDER_ID') || EVIDENCE_DEFAULT_FOLDER_ID_;
    while (parents.hasNext()) if (parents.next().getId() === root) allowed = true;
    if (!allowed) throw new Error('Folder tidak berada di penyimpanan bukti pengajuan.');
    assertEvidenceEditable_(match[1]);
    var manifest = CacheService.getScriptCache().get('evidence-files-' + match[1]);
    if (!manifest) throw new Error('Sesi urutan lampiran kedaluwarsa. Pilih ulang lampiran.');
    renameEvidenceBatch_(folder,name,JSON.parse(manifest));
    return {folderUrl:folder.getUrl()};
  } finally {lock.releaseLock();}
}

/** Run once from the Apps Script editor as the deployment owner to authorize Drive. */
function authorizeEvidenceStorage() {
  var folderId = PropertiesService.getScriptProperties().getProperty('UPLOAD_FOLDER_ID') || EVIDENCE_DEFAULT_FOLDER_ID_;
  if (!folderId) throw new Error('Isi UPLOAD_FOLDER_ID di Script Properties terlebih dahulu.');
  DriveApp.getFolderById(folderId).getName();
  PropertiesService.getScriptProperties().setProperties({UPLOAD_FOLDER_ID:folderId, EVIDENCE_UPLOADS_READY:'true'});
}

/** Non-sensitive capability flag; Drive is not accessed before owner authorization. */
function getEvidenceConfiguration() {
  var props = PropertiesService.getScriptProperties();
  return {enabled:props.getProperty('EVIDENCE_UPLOADS_READY') === 'true',recordingEnabled:props.getProperty('SUBMISSION_LOG_READY') === 'true' && !!props.getProperty('SUBMISSION_SPREADSHEET_ID')};
}

/** Receives only requests signed by the Cloudflare server, not browser secrets. */
function doPost(event) {
  var response;
  try {
    var raw = event && event.postData && event.postData.contents;
    if (!raw || raw.length > 21 * 1024 * 1024) throw new Error('Permintaan tidak valid.');
    var envelope = JSON.parse(raw);
    var secret = PropertiesService.getScriptProperties().getProperty('CLOUDFLARE_BRIDGE_SECRET');
    if (!secret || secret.length < 32) throw new Error('Koneksi domain belum diaktifkan oleh admin.');
    if (typeof envelope.timestamp !== 'number' || Math.abs(Date.now() - envelope.timestamp) > 180000 || !/^[a-f0-9-]{36}$/i.test(envelope.nonce || '') || typeof envelope.payload !== 'string' || !/^[a-f0-9]{64}$/i.test(envelope.signature || '')) throw new Error('Permintaan tidak sah atau kedaluwarsa.');
    var message = envelope.timestamp + '\n' + envelope.nonce + '\n' + envelope.payload;
    var expected = Utilities.computeHmacSha256Signature(message,secret).map(function(byte) {return ('0' + (byte & 255).toString(16)).slice(-2);}).join('');
    var mismatch = 0;
    for (var i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ envelope.signature.toLowerCase().charCodeAt(i);
    if (mismatch) throw new Error('Tanda tangan permintaan tidak valid.');
    var payload = JSON.parse(envelope.payload);
    if (payload.action === 'portalAuth') return portalJson_(portalAuth_(payload.input.action,payload.input));
    if (payload.action === 'portal') return portalJson_(portalDispatch_(payload.input.action,payload.input,payload.actor));
    var actor = null;
    if (payload.actor) actor = portalActor_(payload.actor);
    else if (payload.action !== 'config' && PropertiesService.getScriptProperties().getProperty('PORTAL_AUTH_REQUIRED') === 'true') throw new Error('Silakan masuk melalui portal.');
    if (actor && payload.action !== 'config') {
      if (portalRole_(actor) !== 'PEMOHON') throw new Error('Hanya Pemohon yang dapat mengunggah bukti pengajuan.');
      if (!portalComplete_(actor.profile)) throw new Error('Lengkapi Profil Saya terlebih dahulu.');
      if (payload.input.metadata) payload.input.metadata.applicant = actor.profile.name;
    }
    if (payload.action === 'config') {
      var config = getEvidenceConfiguration();
      config.portalAuthRequired = PropertiesService.getScriptProperties().getProperty('PORTAL_AUTH_REQUIRED') === 'true';
      if (actor) {config.portalEnabled=true;config.profile=actor.profile;config.recordingEnabled=false;config.masterData=portalMaster_();}
      response = {ok:true,data:config};
    }
    else if (payload.action === 'upload') response = {ok:true,data:uploadEvidence_(payload.input)};
    else if (payload.action === 'record' && !actor) response = {ok:true,data:saveSubmissionRecord_(payload.input)};
    else if (payload.action === 'renameEvidence') response = {ok:true,data:updateEvidenceFolder_(payload.input)};
    else throw new Error('Aksi tidak didukung.');
  } catch (error) {
    response = {ok:false,error:String(error.message || 'Permintaan gagal.')};
  }
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

function submissionHeaders_() {
  return ['ID Pengajuan','Waktu Catat UTC','Terakhir Diperbarui UTC','Status Catatan','Status WhatsApp','Nama Pemohon','Tanggal Pengajuan','Jenis Proyek','Kategori','Jenis Pengajuan','Detail Pengajuan','Nama Bank','Nomor Rekening','Pemilik Rekening','Folder Bukti','Jumlah Lampiran'];
}
function submissionSheet_(book) {
  var headers = submissionHeaders_(), sheet = book.getSheetByName('Pengajuan');
  if (!sheet) sheet = book.insertSheet('Pengajuan');
  if (!sheet.getLastRow()) {sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.setFrozenRows(1);}
  else {
    var actual = sheet.getRange(1,1,1,headers.length).getValues()[0];
    if (JSON.stringify(actual) !== JSON.stringify(headers)) throw new Error('Header tab Pengajuan berbeda. Gunakan spreadsheet kosong atau tab khusus.');
  }
  return sheet;
}
/** Run once as deployment owner; this requests Sheets consent without recording a submission. */
function authorizeSubmissionLog() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('SUBMISSION_SPREADSHEET_ID');
  id = id || '1A6hKNV7NCqQ8D5Vdiu5KTWi1FydTemvSJsF2YdcM2Lo';
  var book = SpreadsheetApp.openById(id);
  props.setProperty('SUBMISSION_SPREADSHEET_ID',book.getId());
  submissionSheet_(book);
  props.setProperty('SUBMISSION_LOG_READY','true');
  console.log('Spreadsheet catatan pengajuan: ' + book.getUrl());
}
function recordText_(value,label,max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(label + ' wajib diisi dan tidak boleh terlalu panjang.');
  return value.trim();
}
function recordDate_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('Tanggal pengajuan/pekerjaan tidak valid.');
  return value;
}
function recordRange_(start,end) {
  start = recordDate_(start);end = recordDate_(end);
  if (end < start) throw new Error('Tanggal selesai tidak boleh sebelum tanggal mulai.');
  return {mulai:start,selesai:end};
}
function normalizeRecord_(data) {
  if (!data || typeof data !== 'object') throw new Error('Data pengajuan tidak valid.');
  var result = {applicant:recordText_(data.applicant,'Nama pemohon',120),requestDate:recordDate_(data.requestDate),projectType:data.projectType,category:data.requestCategory,type:data.requestType,bank:recordText_(data.bank,'Nama bank',80),account:recordText_(data.accountNumber,'Nomor rekening',40),owner:recordText_(data.accountOwner,'Pemilik rekening',120),details:{}};
  var master=typeof portalMaster_==='function'?portalMaster_():null;
  if ((master?master.filter(function(e){return e.kind==='project';}).map(function(e){return e.name;}):['FTTH','FWA']).indexOf(result.projectType) < 0 || !/^\d+$/.test(result.account)) throw new Error('Jenis proyek atau nomor rekening tidak valid.');
  var projectTypes = ['Instalasi ODC','Instalasi ODP','Instalasi Closure','Join Core','Instalasi OTB','Penarikan Kabel Feeder','Penarikan Kabel Precon','Pemasangan Tiang','Pemasangan Aksesoris KU','Pemasangan X Frame 40 X 40','Pemasangan X Frame 80 X 80'];
  if(master)projectTypes=master.filter(function(e){return e.kind==='work'&&e.category==='Projek';}).map(function(e){return e.name;});
  if (result.category !== 'Non Projek') {var categoryTypes=result.category==='Maintenance'?projectTypes:(master?master.filter(function(e){return e.kind==='work'&&e.category===result.category;}).map(function(e){return e.name;}):projectTypes);if(categoryTypes.indexOf(result.type)<0)throw new Error('Jenis pekerjaan pada kategori terpilih tidak valid.');}
  else if (result.category === 'Non Projek') {if ((master?master.filter(function(e){return e.kind==='work'&&e.category==='Non Projek';}).map(function(e){return e.name;}):['Sales','Manage Service','Reimburst','Operasional']).indexOf(result.type) < 0) throw new Error('Jenis pengajuan Non Projek tidak valid.');}
  else throw new Error('Kategori pengajuan tidak valid.');
  if (result.type === 'Sales') {
    result.details.periode = recordRange_(data.salesPeriodStart,data.salesPeriodEnd);
    var count = Number(data.salesCount);if (!Number.isSafeInteger(count) || count < 1) throw new Error('Jumlah sales tidak valid.');
    result.details.jumlahSales = count;result.details.catatan = 'Jumlah aktual dihitung berdasarkan rekonsiliasi dengan admin proyek.';
  } else if (result.type === 'Manage Service') result.details.periodePenagihan = recordRange_(data.managePeriodStart,data.managePeriodEnd);
  else if (result.type === 'Reimburst') {
    if (!Array.isArray(data.reimbursementItems) || !data.reimbursementItems.length) throw new Error('Rincian Reimburst tidak valid.');
    var total = 0;
    result.details.rincian = data.reimbursementItems.map(function(item) {
      var amount = Number(item.amount);if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Nominal Reimburst tidak valid.');
      total += amount;return {objek:recordText_(item.object,'Objek Reimburst',200),nominal:amount};
    });
    if (!Number.isSafeInteger(total)) throw new Error('Total Reimburst terlalu besar.');result.details.total = total;
  } else {
    var prefix = result.category === 'Projek' ? 'projectWork' : 'operationalWork';
    if (['single','range'].indexOf(data[prefix+'DateMode']) < 0) throw new Error('Pilihan tanggal pekerjaan tidak valid.');
    result.details.tanggal = data[prefix+'DateMode'] === 'range' ? recordRange_(data[prefix+'DateStart'],data[prefix+'DateEnd']) : {tanggal:recordDate_(data[prefix+'DateStart'])};
    result.details.keterangan = recordText_(data[prefix+'Note'],'Keterangan',1000);
    if (result.category === 'Projek') {
      var qty = Number(data.projectWorkQuantity), unit = data.projectWorkUnit;
      var unitEntry=master?master.find(function(e){return e.kind==='unit'&&e.projectUnit&&e.name===unit;}):null;
      if (!isFinite(qty) || qty <= 0 || qty > Number.MAX_SAFE_INTEGER || (master?!unitEntry:['Pcs','Meter','Buah'].indexOf(unit) < 0) || (!(master?unitEntry&&unitEntry.decimal:unit==='Meter') && !Number.isSafeInteger(qty))) throw new Error('QTY atau satuan tidak valid.');
      result.details.jumlah = qty;result.details.satuan = unit;
    }
  }
  return result;
}
/** Idempotent upsert of a reviewed draft. It does not claim a WhatsApp message was sent. */
function saveSubmissionRecord(input) {
  if (PropertiesService.getScriptProperties().getProperty('PORTAL_AUTH_REQUIRED') === 'true') throw new Error('Silakan gunakan portal payment.blueconnect.id dan masuk ke akun Anda.');
  return saveSubmissionRecord_(input);
}
function saveSubmissionRecord_(input) {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('SUBMISSION_SPREADSHEET_ID');
  if (!id || props.getProperty('SUBMISSION_LOG_READY') !== 'true') throw new Error('Catatan Sheets belum diaktifkan oleh admin.');
  if (!input || !/^[a-f0-9-]{36}$/i.test(input.id || '') || JSON.stringify(input).length > 40000) throw new Error('Data catatan tidak valid atau terlalu besar.');
  var record = normalizeRecord_(input.data);
  var folderId = String(input.folderUrl || '').match(/^https:\/\/drive\.google\.com\/drive\/folders\/([A-Za-z0-9_-]+)(?:\?.*)?$/);
  if (!folderId || !Number.isInteger(input.fileCount) || input.fileCount < 1 || input.fileCount > 10) throw new Error('Bukti pengajuan tidak valid.');
  var folder = DriveApp.getFolderById(folderId[1]), parents = folder.getParents(), allowed = false;
  var rootId = props.getProperty('UPLOAD_FOLDER_ID') || EVIDENCE_DEFAULT_FOLDER_ID_;
  while (parents.hasNext()) if (parents.next().getId() === rootId) allowed = true;
  if (!allowed) throw new Error('Folder bukti tidak berada di folder pengajuan.');
  var lock = LockService.getScriptLock();lock.waitLock(30000);
  try {
    var sheet = submissionSheet_(SpreadsheetApp.openById(id)), last = sheet.getLastRow(), target = last+1, created = new Date().toISOString();
    if (last > 1) {
      var existing = sheet.getRange(2,1,last-1,2).getValues();
      for (var i=0;i<existing.length;i++) if (existing[i][0] === input.id) {target=i+2;created=existing[i][1];break;}
    }
    var now = new Date().toISOString();
    // Explicit text keeps leading zeroes and prevents user input becoming formulas.
    var values = [input.id,created,now,'TERSIMPAN','PENGIRIMAN_BELUM_DIKONFIRMASI',record.applicant,record.requestDate,record.projectType,record.category,record.type,JSON.stringify(record.details),record.bank,record.account,record.owner,folder.getUrl(),String(input.fileCount)];
    var row = sheet.getRange(target,1,1,values.length);row.setNumberFormat('@');row.setValues([values.map(function(value,index) {return index < 5 ? value : "'" + value;})]);
    SpreadsheetApp.flush();return {id:input.id,savedAt:now};
  } finally {lock.releaseLock();}
}

function portalJson_(data) {return ContentService.createTextOutput(JSON.stringify({ok:true,data:data})).setMimeType(ContentService.MimeType.JSON);}
