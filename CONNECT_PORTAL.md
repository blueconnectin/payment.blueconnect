# Portal invoice: login manual, profil, tarif, review dan PDF

Implementasi ini memakai **email dan password**, sesuai perubahan keputusan pengguna. Google OAuth Client ID/Client Secret tidak diperlukan. Alamat tetap https://payment.blueconnect.id. Portal dinonaktifkan secara default agar formulir yang sedang dipakai tidak langsung berubah sebelum konfigurasi selesai.

## Aktivasi

1. Pastikan workflow Deploy application berhasil memasang `Portal.gs` bersama backend Google dan kode Cloudflare terbaru. Akses Sheets serta Drive yang telah diotorisasi tetap digunakan. Tab portal dibuat di spreadsheet catatan yang sudah dikonfigurasi; tab Pengajuan lama tidak dihapus, dipindahkan, atau diubah skemanya.
2. Di GitHub **Settings → Secrets and variables → Actions → Secrets**, tambahkan:
   - **AUTH_SECRET**: kunci acak minimal 32 karakter. Bisa dibuat sekali di PowerShell dengan `Set-Clipboard -Value (([guid]::NewGuid().ToString('N')) + ([guid]::NewGuid().ToString('N')))`, lalu tempel ke GitHub Secret.
   - **ADMIN_INITIAL_PASSWORD**: password awal pilihan pemilik akun admin, minimal 12 dan maksimal 128 karakter. Jangan gunakan password akun Google dan jangan kirim nilainya ke chat.
3. Jangan mengubah/menghapus secret Cloudflare/Google yang sudah berhasil: `BRIDGE_SECRET`, `CLASP_AUTH_JSON`, `CLOUDFLARE_API_TOKEN`, dan `CLOUDFLARE_ACCOUNT_ID`.
4. Di GitHub **Variables**, tambahkan **PORTAL_ENABLED=true**. Jalankan workflow **Deploy application** pada main dengan publish dicentang. Workflow menerapkan flag dan kedua secret runtime ke Worker yang sudah ada. DNS dan Custom Domain tidak perlu diubah.
5. Buka payment.blueconnect.id. Masuk dengan **blueconecin@gmail.com** dan ADMIN_INITIAL_PASSWORD yang Anda pilih. Akun admin dibuat pada login pertama yang berhasil. Email tersebut tidak boleh didaftarkan dari formulir pemohon.
6. Masuk **Profil Saya → Ganti password** untuk mengganti password admin. Setelah berhasil, password bootstrap tidak digunakan lagi selama akun admin tetap ada. Anda dapat menghapus ADMIN_INITIAL_PASSWORD dari GitHub dan Cloudflare setelah bootstrap; AUTH_SECRET tetap wajib disimpan.
7. Buat akun pemohon uji dari tab Daftar pemohon, lalu lengkapi profil. Uji proses lengkap sebelum mengundang semua pemohon.

**AUTH_SECRET harus stabil.** Kunci ini dipakai sebagai akar kunci sesi dan pepper password; menggantinya sembarangan membuat sesi dan verifikasi password yang tersimpan tidak berlaku. Rotasi memerlukan prosedur migrasi/reset password. Simpan salinan aman melalui password manager, bukan dalam repositori atau spreadsheet.

## Akun dan akses

- Pendaftaran mandiri hanya menghasilkan Pemohon. Email login belum diverifikasi melalui email; pendaftaran tidak membuktikan kepemilikan alamat email. Tidak ada login Google atau pengiriman email otomatis.
- Password disimpan sebagai verifier PBKDF2-SHA256 (100.000 iterasi) dengan salt acak dan HMAC pepper server. Hash disimpan pada tab Portal_Akun; pepper berada di Worker Secret, bukan di spreadsheet atau browser. Parameter mengikuti batas PBKDF2 native runtime Worker. Perlindungan tambahan berupa pembatasan percobaan login di cache backend.
- Sesi delapan jam memakai cookie Secure, HttpOnly, SameSite=Lax. Tidak ada token autentikasi di localStorage. Perubahan password menaikkan versi sesi sehingga sesi lama ditolak server.
- Role selalu ditetapkan server. Data role, total, profil penerbit, atau harga yang dikirim browser tidak menentukan kewenangan/nilai akhir invoice.
- Admin pertama ditentukan sebagai blueconecin@gmail.com. Tidak ada pemilihan role saat pendaftaran. Admin tidak membuat invoice melalui akun admin; gunakan akun pemohon terpisah bila admin juga perlu mengajukan.
- Profil pemohon menyimpan nama penerbit, WhatsApp, alamat, bank, rekening, dan nama pemilik rekening. Data rekening diisi otomatis serta readonly pada formulir. Setiap draft menyimpan snapshot profil; perubahan profil berikutnya tidak mengubah invoice yang sudah diajukan/disetujui.
- Tab Portal_Akun berisi hash dan data profil. Batasi spreadsheet hanya bagi admin yang dipercaya. Jangan mempublikasikan atau membagikannya kepada seluruh pemohon. Portal tidak menyediakan endpoint pembacaan akun lain kepada pemohon.
- Pemulihan lupa password melalui email, verifikasi email, dan MFA belum tersedia. Pengguna diminta menghubungi admin untuk penanganan akses; jangan mengubah hash spreadsheet tanpa prosedur pemulihan yang benar.

Setelah akun portal pertama dibuat, backend menutup endpoint mutasi Google Apps Script lama yang tidak membawa identitas sesi. Pembukaan langsung URL Apps Script diarahkan untuk memakai domain portal. Menonaktifkan flag Cloudflare sesudah aktivasi **tidak membuka kembali akses anonim** pada backend. Untuk rollback, rencanakan pemulihan versi dan akses; jangan mematikan pemeriksaan autentikasi agar formulir lama bisa menulis lagi.

## Alur invoice

1. Pemohon melengkapi profil, membuka Buat invoice, lalu mengisi formulir kategori/jenis pekerjaan yang sudah ada. Bukti tetap diunggah ke subfolder Drive.
2. Periksa Pengajuan menyimpan **DRAFT** pada Portal_Invoice dan menampilkan nilai dari tarif server. Pemohon boleh mengedit draft miliknya sendiri; role/identitas profil diperiksa lagi di backend.
3. Tombol **Ajukan invoice** mengubahnya menjadi **SUBMITTED** dan mengunci pengeditan. Portal mode ini tidak mengirim WhatsApp; alur chat lama hanya berlaku pada formulir sebelum portal diaktifkan.
4. Admin membuka Review pengajuan, memeriksa data/bukti, lalu Setujui, Minta revisi, atau Tolak. Revisi/penolakan wajib mempunyai catatan.
5. Revisi menggunakan formulir yang sama, dengan data dan bukti sebelumnya dipakai kembali. Koreksi diajukan ulang dengan riwayat tetap tersimpan.
6. Jika nilai belum tersedia atau jumlah Sales perlu direkonsiliasi, admin mengatur tarif lalu menggunakan Perbarui tarif/hasil rekon dengan catatan. Status menjadi CONFIRMATION; pemohon harus mengonfirmasi nilai baru sebelum admin dapat menyetujui.
7. Persetujuan menghasilkan nomor invoice unik `INV/BCI/YYYYMM/NNNNNN`, snapshot final dan file PDF private di folder Invoice Disetujui. Invoice disetujui tidak dapat diedit atau dihitung ulang. Bila penerbitan gagal sebelum catatan final tersimpan, nomor dapat berlubang; nomor yang sudah diterbitkan tidak dipakai ulang.
8. Pemohon yang memiliki invoice tersebut, Admin, dan Finance dapat mengunduh PDF melalui API yang memeriksa sesi dan status persetujuan. Pengguna lain tidak dapat mengunduhnya. File tidak dibagikan publik oleh aplikasi.

Data Portal_Invoice adalah sumber proses baru; catatan anonim lama di tab Pengajuan tidak otomatis diklaim sebagai milik akun tertentu. Riwayat keputusan disimpan bersama data invoice. Tab tarif, profil, dan invoice memakai JSON per baris dengan batas ukuran sel; jangan mengedit struktur kolom secara manual.

## Tarif

Admin mengisi daftar tarif berdasarkan FTTH/FWA, jenis pekerjaan, dan satuan:

- Sales: QTY yang diajukan, satuan Sales.
- Manage Service: satu periode, satuan Periode.
- Operasional: satu pengajuan, satuan Pengajuan.
- Projek: QTY pekerjaan, satuan Pcs, Meter, atau Buah sesuai pilihan pemohon.
- Reimburst: nominal setiap objek pengeluaran dari pemohon, bukan daftar tarif.

Harga dalam Rupiah bulat positif, total setiap baris dibulatkan ke Rupiah terdekat. Draft tanpa tarif dapat diajukan untuk dilengkapi admin; persetujuan ditolak sampai tarif lengkap dan nilainya dikonfirmasi pemohon. Perubahan tarif tidak memperbarui invoice disetujui. PPN/pajak, potongan, jatuh tempo, pembatalan invoice disetujui dan integrasi transfer bank otomatis belum diimplementasikan. PDF ini bukan implementasi faktur pajak.

## Pengujian sebelum digunakan

```sh
npm ci
npm run test:bridge
npm run build
node tests/portal.browser.cjs
npx wrangler deploy --dry-run
```

Tes lokal memakai layanan Google/Drive tiruan dan memeriksa autentikasi, cookie, akses lintas akun, penetapan tarif, rekonsiliasi, revisi, penguncian persetujuan, dan pembatasan PDF. Uji nyata setelah aktivasi dengan akun admin dan dua akun pemohon: pastikan profil/rekening otomatis, pemohon tidak melihat invoice pengguna lain, admin memberi revisi/persetujuan, perubahan tarif meminta konfirmasi, dan PDF final benar-benar dapat diunduh. Jangan memakai invoice uji sebagai tagihan nyata.

## Role dan pengelolaan akun

- **Admin** mengelola semua akun melalui **Kelola akun**: membuat Pemohon/Finance/Admin, mengubah nama dan role, menonaktifkan/mengaktifkan akun, serta mereset password. Email akun tetap sebagai identitas login. Akun dinonaktifkan untuk mencabut akses tanpa menghapus riwayat invoice.
- **Pemohon** dapat mendaftar mandiri, mengelola profil/rekening, membuat dan mengajukan invoice sendiri, serta melihat status pembayaran. Pendaftaran mandiri selalu menghasilkan Pemohon, walaupun request browser menyertakan role lain.
- **Finance** dibuat oleh Admin, melihat invoice yang sudah diajukan, mengunduh PDF final, dan mencatat pembayaran invoice yang telah disetujui. Finance tidak mengelola akun, tarif, atau persetujuan.

Role disimpan pada akun dan diperiksa ulang di Apps Script pada setiap aksi. Akun lama tanpa field role tetap dikenali: email admin awal sebagai Admin, akun lainnya sebagai Pemohon. Perubahan akun dan reset password membatalkan sesi lama; pengguna harus masuk kembali. Minimal satu Admin aktif harus dipertahankan.

Pada rincian invoice **Disetujui**, Finance mengisi tanggal dan referensi pembayaran, lalu memilih **Tandai Paid** setelah transfer dilakukan. Server menyimpan nominal sesuai invoice yang disetujui, identitas Finance, waktu pencatatan, dan riwayat; status menjadi **PAID**. Invoice Paid tetap dapat dilihat pemilik, Admin, dan Finance; PDF final tetap dapat diunduh. Pembayaran hanya dapat dicatat sekali dan tidak mengubah nominal/PDF yang disetujui. Fitur ini mencatat pembayaran yang telah dilakukan di luar aplikasi; tidak melakukan transfer bank.

Tes tambahan: `node tests/account-roles.browser.cjs` menguji menu Admin dan pencatatan Paid Finance dengan API tiruan.

## Pembatasan login gagal

Pembatasan menghitung sandi yang salah, bukan login berhasil: maksimal 8 kegagalan untuk kombinasi akun dan IP, serta 60 kegagalan lintas akun pada IP yang sama, dalam jendela tetap 15 menit. Login berhasil mereset hitungan akun pada IP tersebut; hitungan kegagalan IP bersama tetap dipertahankan. Percobaan saat diblokir tidak memperpanjang masa tunggu. Respons HTTP 429 menyertakan sisa waktu tunggu dan header Retry-After. Counter versi baru terpisah dari counter lama yang ikut menghitung login berhasil; sandi, akun, dan sesi tidak diubah oleh perbaikan ini.

## Master data jenis proyek, pekerjaan, dan satuan

Admin membuka tab **Master** untuk menambah pilihan atau mengaktifkan/menonaktifkan pilihan yang sudah ada. Pilih kelompok **Jenis pekerjaan**, **Satuan**, atau **Jenis proyek**, isi nama, lalu **Tambah pilihan**. Kategori pekerjaan dipilih pada form yang sama: **Projek** atau **Non Projek**. Pekerjaan Projek menggunakan rincian tanggal, jumlah, satuan, dan keterangan. Satuan baru dapat memakai bilangan bulat atau pecahan; aturan ini tetap setelah dibuat agar invoice lama tidak berubah. Nama tetap sebagai identitas; untuk nama berbeda, tambahkan pilihan baru dan nonaktifkan yang lama.

Pilihan awal ditambah **Permit** dan **HC** (bilangan bulat). Nilai harga belum ditetapkan: buka **Tarif**, pilih jenis proyek, pekerjaan **Permit**, satuan **HC**, isi harga satuan sesuai ketentuan perusahaan, lalu simpan. Total dihitung jumlah HC × harga satuan. Pekerjaan Non Projek tetap memakai alur khusus Sales, Manage Service, Reimburst, dan Operasional; satuan khususnya mengikuti jenis pengajuan.

Master kustom tersimpan pada tab **Portal_Master** di spreadsheet portal. Formulir pengajuan dan menu tarif mengambil pilihan aktif dari sumber yang sama. Pilihan nonaktif tidak tersedia untuk draft baru/perubahan draft, tetapi invoice tersimpan dan PDF lama tetap dapat dibaca. Muat ulang formulir yang telah terbuka setelah perubahan master. Tarif serta invoice lama tidak dihapus atau diubah otomatis ketika master berubah.

Validasi tambahan: `node tests/master-data.browser.cjs` memeriksa penambahan/nonaktivasi master, tarif Permit/HC, dan formulir Pemohon dengan layanan tiruan.

## Kategori pekerjaan pada Master dan Tarif

Pengaturan pekerjaan menggunakan satu form **Master**. Pilih kelompok **Jenis pekerjaan**, pilih kategori **Projek / Non Projek**, lalu isi nama. Untuk Non Projek pilih satuan dari Master pada form yang sama. Pekerjaan Projek menggunakan tanggal, jumlah, satuan, dan keterangan; pekerjaan Non Projek tambahan menggunakan tanggal/keterangan dan jumlah satu. Alur khusus Sales, Manage Service, dan Reimburst tetap tersedia.

Untuk mengganti satuan Sales, pilih **Master → Jenis pekerjaan → Non Projek**, klik **Ubah** pada baris Sales, pilih satuan, lalu **Simpan perubahan**. Tidak ada bidang pengaturan terpisah. Nama dan kategori pekerjaan yang sudah tersimpan dipertahankan agar invoice lama tetap dapat dibaca; tambahkan pekerjaan baru untuk kategori berbeda.

Pada **Tarif**, pilih **Kategori pekerjaan** untuk memfilter jenis pekerjaannya. Kolom kategori juga ditampilkan pada daftar Master dan daftar tarif. Satuan tarif Non Projek menampilkan satuan aktif dari Master dan dapat dipilih langsung. Menyimpan tarif dengan satuan berbeda menyelaraskan satuan pekerjaan di Master. Setelah mengganti satuan, isi harga satuannya untuk setiap jenis proyek yang digunakan. Sales tetap menggunakan jumlah penjualan (bilangan bulat); Manage Service menggunakan jumlah satu untuk periode terkait. Operasional dengan satuan Hari menghitung jumlah hari secara otomatis, termasuk tanggal mulai dan akhir. Reimburst mengikuti rincian pengeluaran.

Invoice lama mempertahankan satuan dan nilai sebelumnya. Aksi **Perbarui tarif / hasil rekon** memakai pengaturan terbaru dan meminta konfirmasi Pemohon kembali. Satuan yang dipakai pekerjaan Non Projek aktif harus diganti pada pekerjaan tersebut sebelum dinonaktifkan.

## Sales HC dan Operasional Hari

Satuan awal **Sales = HC** dan **Operasional = Hari** diterapkan satu kali pada Master, termasuk konfigurasi lama. Setelah itu Admin tetap dapat mengubahnya melalui Master atau saat menyimpan Tarif. Tarif lama dan invoice tersimpan tidak diubah otomatis. Isi harga per HC/per Hari pada tab Tarif sesuai kebijakan perusahaan.

Operasional dengan satu tanggal menggunakan jumlah 1 Hari. Rentang 30 Oktober sampai 1 November menggunakan jumlah 3 Hari. Total = jumlah hari × harga per Hari. Jumlah hari ditampilkan pada formulir dan ringkasan serta dihitung ulang di server. Perubahan harga/satuan terhadap pengajuan tersimpan hanya berlaku melalui perhitungan ulang dan konfirmasi Pemohon.

## Format nomor invoice

Nomor diberikan saat invoice pertama kali diajukan: **INV001/FTTH/XI/2026**. Urutan memakai minimal tiga digit (001, 002, …, 1000) dan berlanjut secara global, tanpa reset bulanan/tahunan. Jenis proyek, bulan Romawi, dan tahun diambil dari data tanggal pengajuan saat nomor diterbitkan. Nomor tetap selama revisi, persetujuan, dan pembayaran; PDF final memakai nomor yang sama. Draft belum memiliki nomor. Pengajuan lama yang belum bernomor memperoleh nomor saat diajukan ulang atau disetujui. Membuka daftar/rincian hanya membaca data. Nomor lama yang sudah terbit dipertahankan agar konsisten dengan PDF/arsip sebelumnya.

## Tahap peningkatan: bukti pembayaran, duplikasi, dan arsip

Finance dapat melampirkan satu bukti pembayaran JPG/JPEG, PNG, atau PDF, maksimal 5 MB, pada form **Catat pembayaran**. Lampiran opsional agar transaksi historis tetap kompatibel. Server memeriksa format, isi biner dasar, ukuran, role Finance dan status APPROVED sebelum menyimpan ke Drive. Bukti terlihat pada rincian pembayaran setelah Paid. Pengunggahan dan pencatatan berjalan melalui endpoint JSON terbatas `/api/payment`; hak akses Drive tetap diwarisi dari folder induk.

Pengajuan baru diblokir jika data identik dengan pengajuan aktif milik akun yang sama: tanggal pengajuan, proyek/kategori/pekerjaan, periode atau tanggal pekerjaan, rincian aktif, rekening dan profil penerbit, serta nilai/baris tagihan dibandingkan. Identitas file Drive, nomor invoice, dan waktu pencatatan bukan pembeda data pengajuan. Draft, Ditolak, dan arsip tidak menjadi kandidat pembanding. Rincian invoice menampilkan pengajuan identik yang sudah tersimpan agar Admin dapat menelusurinya. Perubahan data atau nominal yang berbeda tidak diblokir sebagai identik.

Admin membuka **Kelola akun → Arsip invoice** untuk melihat invoice yang dihapus, status sebelumnya, pelaku, waktu, dan alasan penghapusan. **Pulihkan** membutuhkan alasan dan mengembalikan status, nomor, nilai, pembayaran serta lampiran sebelumnya. Pemohon dan Finance tidak mempunyai akses arsip/pemulihan. Riwayat RESTORE dicatat; file Drive tidak dihapus saat invoice diarsipkan.

Tes tambahan: `node tests/phase-one.browser.cjs` menggunakan API tiruan untuk peringatan duplikasi, arsip/pemulihan, dan unggah bukti pembayaran. Tes backend memeriksa penolakan pengajuan identik, hak akses, pemulihan status Paid dan metadata pembayaran.
