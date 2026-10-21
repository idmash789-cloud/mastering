# Mastering Audio

Aplikasi web statis untuk **mastering audio + mencampur backsound**, berjalan 100% lokal di browser (Web Audio API). Tidak ada backend, tidak ada build step, tidak ada file yang diunggah ke server mana pun.

Cocok untuk merapikan narasi, dongeng pengantar tidur, podcast sederhana, dan audio sejenis — termasuk menyamakan level antar file dalam satu paket.

## Fitur

**Dua track**
- Track utama: upload MP3/WAV/M4A/OGG, waveform, play/pause, seek (klik waveform), info durasi & level (peak sebelum/sesudah).
- Track backsound: upload musik latar, **volume terpisah 0–100%**, loop otomatis bila lebih pendek, fade-in & fade-out 0–15 detik, mute per track.

**Rantai mastering (urutan tetap, hanya untuk track utama)**
1. Noise — high-pass filter + noise gate sederhana
2. EQ 3-band — Bass / Middle / Treble (−15 s.d. +15 dB)
3. Compressor halus
4. Echo — delay + feedback ringan (default mati)
5. Lebar Stereo — pelebaran mid-side
6. Limiter + Normalisasi level (pendekatan RMS/peak, target konsisten antar file)

**Preset**
- **HypnoKids Lembut** (andalan): treble dijinakkan agar tidak cempreng, mid hangat, kompresi lembut, normalisasi sedang.
- Jernih Cerita · Hangat Malam · Musik Ringan · Asli (bypass)
- Preset racikan sendiri bisa disimpan (tersimpan di localStorage browser).

**Preview & Export**
- Tombol banding **Asli vs Master** seketika saat memutar.
- Export via render offline: **Mix (Master + Backsound)** atau **Mastering Saja**.
- Format **MP3** (128/192/320 kbps, encoder lamejs lokal di folder `vendor/`) atau **WAV**.
- Nama file hasil otomatis: `nama-asli_master.mp3` / `nama-asli_mix.wav`, dsb.

## Cara Pakai

1. Buka `index.html` (atau halaman GitHub Pages-nya).
2. Muat **audio utama** → pilih preset (mulai dari *HypnoKids Lembut* untuk narasi anak).
3. Geser slider Bass/Middle/Treble/Echo/Noise/Lebar sambil memutar; bandingkan **Asli vs Master**.
4. (Opsional) Muat **backsound**, atur volumenya (umumnya 15–30%), fade in/out, dan loop.
5. Di bagian Export: pilih isi (Mix / Mastering Saja), format & bitrate → **Render & Siapkan Unduhan** → klik tombol unduh. Selama render, jangan tutup tab.

## Deploy ke GitHub Pages

1. Buat repo baru di GitHub, push seluruh isi folder ini (termasuk folder `vendor/`).
2. Di repo: **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save.
3. Tunggu ±1 menit, situs live di `https://<username>.github.io/<nama-repo>/`.
4. Semua dependensi lokal (tidak ada CDN), jadi halaman bekerja mandiri. Situs harus diakses lewat `https` atau `localhost` agar Web Audio API & decode berjalan normal — GitHub Pages sudah https secara bawaan.

## Privasi

Semua pemrosesan (decode, mastering, mixing, render, encode) terjadi **di perangkat Anda** lewat Web Audio API. File audio Anda tidak dikirim ke server mana pun. Preset custom hanya disimpan di localStorage browser Anda sendiri.

## Batas Jujur

- Pengurang noise bersifat **dasar** (high-pass + gate), bukan denoise AI seperti aplikasi studio profesional. Sumber rekaman yang bersih tetap yang utama.
- Normalisasi memakai pendekatan **RMS/peak**, bukan pengukuran LUFS studio yang presisi — cukup untuk menyamakan level antar file secara praktis.
- Export merender ulang secara offline; file panjang (7–10 menit) bisa butuh waktu tergantung perangkat. Render MP3 stereo memakai lamejs lokal; bila library gagal termuat, aplikasi otomatis memberikan WAV.
- Lebar stereo memakai pemrosesan mid-side sederhana; pada sumber mono hasilnya netral.

## Struktur File

```
index.html        — halaman & UI (Bahasa Indonesia)
style.css         — tema gelap responsif
app.js            — mesin Web Audio: pemutar, rantai mastering, export
vendor/lame.all.js— encoder MP3 lamejs 1.2.1 (lokal, tanpa CDN)
README.md         — dokumen ini
```
