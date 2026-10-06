import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { openDatabase } from '../server.mjs';

const scrypt=promisify(scryptCb);
const email=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
const password=String(process.env.ADMIN_PASSWORD||'');
const name=String(process.env.ADMIN_NAME||'مدیر سامانه').trim();
if(!/^\S+@\S+\.\S+$/.test(email)||password.length<16){console.error('برای ساخت مدیر، ADMIN_EMAIL معتبر و ADMIN_PASSWORD با حداقل ۱۶ نویسه را فقط در محیط ترمینال تنظیم کنید.');process.exit(2);}
const db=openDatabase();
if(db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()){console.error('حساب مدیر از قبل ساخته شده است؛ ساخت اولیه فقط یک‌بار مجاز است.');db.close();process.exit(3);}
const salt=randomBytes(16).toString('hex');const key=(await scrypt(password,salt,64)).toString('hex');
db.prepare('INSERT INTO users(name,email,role,salt,password_hash,verified,created_at) VALUES(?,?,?,?,?,1,?)').run(name,email,'admin',salt,key,new Date().toISOString());
db.close();console.log('حساب مدیر ساخته شد. گذرواژه در پایگاه‌داده به‌صورت hash ذخیره شده است.');
