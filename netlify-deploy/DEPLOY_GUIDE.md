# 🚀 คู่มือการนำขึ้นระบบ Netlify (Deployment Guide)

โฟลเดอร์นี้ (`netlify-deploy`) ได้รับการจัดเตรียมและคัดกรองเฉพาะไฟล์ที่จำเป็นสำหรับการทำงานบน Netlify โดยตัดไฟล์ชั่วคราว, แคช, และข้อมูลความลับออกเรียบร้อยแล้ว

---

## 📁 โครงสร้างไฟล์ในโฟลเดอร์นี้

```
netlify-deploy/
├── index.html                  # หน้าแรกของเว็บไซต์ (Home)
├── register.html               # หน้าลงทะเบียนออนไลน์ (Registration)
├── kathin.html                 # หน้าข้อมูลกฐินแสน / กฐินหมื่น (Kathin Portal)
├── admin.html                  # หน้าจัดการระบบสำหรับผู้ดูแล (Admin Panel)
├── css/
│   └── style.css               # สไตล์และรูปแบบการแสดงผล
├── js/
│   ├── app.js                  # สคริปต์หน้าลงทะเบียนและหน้าแรก
│   ├── kathin.js               # สคริปต์หน้ากฐิน (ค้นหา/กรอง/สลับแท็บ)
│   └── admin.js                # สคริปต์ระบบ Admin และเบิกจ่าย
├── netlify/
│   └── functions/              # Backend Serverless Functions (API 16 ฟังก์ชัน)
│       ├── lib/                # โมดูลกลาง (Google Sheets API, Validation, Auth)
│       ├── admin-data.mjs
│       ├── admin-disbursements.mjs
│       ├── admin-login.mjs
│       ├── admin-registration.mjs
│       ├── admin-temples.mjs
│       ├── admin-users.mjs
│       ├── config.mjs
│       ├── export-excel.mjs
│       ├── health.mjs
│       ├── import-excel.mjs
│       ├── person-lookup.mjs
│       ├── public-kathin.mjs
│       ├── public-list.mjs
│       ├── registration.mjs
│       ├── reports.mjs
│       └── upload.mjs
├── netlify.toml                # การตั้งค่า Netlify (Build, Redirects, Bundler)
├── package.json                # รายการไลบรารีที่จำเป็น (googleapis, xlsx)
├── package-lock.json           # ล็อกเวอร์ชันของไลบรารี
├── .gitignore                  # ป้องกันการอัปโหลด node_modules และ .env
├── .env.example                # ตัวอย่างการตั้งค่า Environment Variables
└── DEPLOY_GUIDE.md             # คู่มือนี้
```

---

## 🛠️ วิธีการ Deploy ขึ้น Netlify

### วิธีที่ 1: Deploy ผ่าน GitHub (แนะนำที่สุด - อัปเดตอัตโนมัติ)
1. นำไฟล์ในโฟลเดอร์ `netlify-deploy` นี้ขึ้น GitHub Repository (เช่น `ubasaka-kaew-system`)
2. เข้าสู่ระบบ [Netlify](https://app.netlify.com/)
3. คลิก **"Add new site"** > **"Import an existing project"**
4. เลือก GitHub และเลือก Repository ที่สร้างไว้
5. Netlify จะตรวจพบการตั้งค่าจาก `netlify.toml` อัตโนมัติ:
   - **Publish directory:** `.`
   - **Functions directory:** `netlify/functions`
6. ไปที่เมนู **Site configuration** > **Environment variables** แล้วเพิ่มตัวแปรตามตัวอย่างใน `.env.example`
7. คลิก **Deploy site**

---

### วิธีที่ 2: Deploy ผ่าน Netlify CLI (จากเครื่องของคุณ)
1. เปิด Terminal ในโฟลเดอร์ `netlify-deploy`
2. ติดตั้ง Netlify CLI (ถ้ายังไม่มี):
   ```bash
   npm install -g netlify-cli
   ```
3. เข้าสู่ระบบ:
   ```bash
   netlify login
   ```
4. สั่ง Deploy ขึ้น Production:
   ```bash
   netlify deploy --prod
   ```

---

## 🔑 ตัวแปร Environment Variables ที่ต้องตั้งค่าบน Netlify
*(ตั้งค่าที่: Netlify Dashboard > Site configuration > Environment variables)*

| ชื่อตัวแปร | คำอธิบาย | ตัวอย่าง |
|---|---|---|
| `GOOGLE_SHEET_ID` | ID ของ Google Sheets ฐานข้อมูล | `1A2B3C...` |
| `GOOGLE_CLIENT_EMAIL` | อีเมล Service Account ของ Google Cloud | `xxx@project.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | Private Key ของ Service Account | `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----` |
| `ADMIN_USERNAME` | ชื่อผู้ใช้ Master Admin | `tudongsuratmonkarm` |
| `ADMIN_PASSWORD` | รหัสผ่าน Master Admin | `monkarm` (หรือรหัสที่ต้องการ) |
| `SESSION_SECRET` | คีย์ลับสำหรับเข้ารหัส Session Token | ข้อความสุ่มยาวๆ เช่น `surat_secure_session_key_2569` |
| `DRIVE_FOLDER_ID` | (ไม่บังคับ) ID โฟลเดอร์ Google Drive สำหรับเซฟรูป | `1XYZ...` |
