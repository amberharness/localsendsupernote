# LocalSend Layer 4 Placer for Supernote (Chauvet 3.31.45+)

A React Native (`0.79.2`) + `sn-plugin-lib` plugin for the **Supernote Manta** running **Chauvet 3.31.45**. It captures the newest image sent from your phone via the official **[LocalSend](https://github.com/localsend/localsend)** app (`org.localsend.localsend_app`), lets you **rotate**, **crop**, and **resize** it on an E-Ink-optimized modal, and pastes it directly into **Layer 4** of your open note.

---

## 1. One-Time LocalSend Setup on Supernote Manta

Supernote's plugin sandbox restricts plugin file reads to shared user directories (`INBOX`, `EXPORT`, `Document`, `MyStyle`, `Note`, `SCREENSHOT`) and blocks `/storage/emulated/0/Download`.

1. Open **LocalSend** (`org.localsend.localsend_app`) on your Supernote Manta.
2. Go to **Settings → Receive → Destination**.
3. Set the save directory to **`/storage/emulated/0/INBOX`** (or `EXPORT`).

---

## 2. Building the `.snplg` Package

Supernote `.snplg` files are compiled React Native + Android native archives built with the official Supernote Plugin SDK (`buildPlugin.sh`).

### Option A: Automated Build via GitHub Actions (Recommended)
1. Push this repository to GitHub (`main` branch).
2. Open the **Actions** tab → **Build Supernote Plugin (.snplg)** → download the compiled `LocalSendLayer4Placer-snplg` artifact.

### Option B: Local Build (Node 18+, JDK 19+, Android SDK 35)
1. Copy `android/` and `buildPlugin.sh` from the official Supernote Plugin Template into this folder.
2. Run:
   ```bash
   npm install
   ./buildPlugin.sh   # Pass 1 generates Gradle autolinking
   ./buildPlugin.sh   # Pass 2 compiles the .snplg output
   ```

---

## 3. Installing on Supernote Manta (Chauvet 3.31.45)

1. Send the compiled `.snplg` file to your Supernote via LocalSend (it will save into `INBOX`).
2. Open **Settings → Apps → Plugin** (or **My Device → Plugins**), tap **Install**, and select the `.snplg` file from **INBOX**.
3. Open any `.note` file, tap **LocalSend L4** on the note toolbar, adjust rotation/crop/scale, and tap **Paste Into Layer 4**.
