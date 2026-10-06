import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const scrypt = promisify(scryptCb);
const KINDS = new Set(['drugs','compounds','products','courses','exams','events','articles','books','videos','jobs','shifts','universities','certificates','pages','downloads']);
const SHOP_COURSE_SLUGS = new Set(['autumn-compounding-school','suppelements','newbornschool','phytotherapy','fitness','cosmeticschool','179','anemia','emergency','productive','تفسیر-تست-های-آزمایشگاهی','تداخلات-و-منع-مصرف-گیاهان-دارویی','تداخلات-دارویی','تداخلات-دارودرمانی-در-بارداری-و-شیرده','بررسی-50-داروی-گیاهی-با-دکتر-توفیقی','اختلالات-جنسی-و-بیماری-های-زنان']);
const ROLES = new Set(['pharmacist','student','professor','pharmacy','company','supplier']);
const PUBLISH_REQUIRES_SOURCE = new Set(['drugs','compounds','products','exams','events','articles','books','videos','certificates']);
const COOKIE = 'daro_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const failures = new Map();

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function repairPersianJoiners(value='') {
  return String(value)
    .replace(/فرآوردههای/g,'فرآورده‌های').replace(/فرمولاسیونهای/g,'فرمولاسیون‌های')
    .replace(/فرمولهای/g,'فرمول‌های').replace(/سرفصلهای/g,'سرفصل‌های')
    .replace(/ویژگیهای/g,'ویژگی‌های').replace(/دانشگاههای/g,'دانشگاه‌های')
    .replace(/جلسات/g,'جلسات').replace(/پنجشنبهها/g,'پنجشنبه‌ها').replace(/جمعهها/g,'جمعه‌ها')
    .replace(/شنبهها/g,'شنبه‌ها').replace(/شرکتکنندگان/g,'شرکت‌کنندگان')
    .replace(/نیمهجامد/g,'نیمه‌جامد').replace(/ثبتنام/g,'ثبت‌نام').replace(/بهصورت/g,'به‌صورت')
    .replace(/میشود/g,'می‌شود').replace(/میشوند/g,'می‌شوند').replace(/میتوان/g,'می‌توان')
    .replace(/میخواهند/g,'می‌خواهند').replace(/میکند/g,'می‌کند').replace(/میکنند/g,'می‌کنند').replace(/میگیرند/g,'می‌گیرند').replace(/میگیرید/g,'می‌گیرید').replace(/پیشپرداخت/g,'پیش‌پرداخت')
    .replace(/مرحله‌ای/g,'مرحله‌ای').replace(/مرحله ای/g,'مرحله‌ای').replace(/بخشهای/g,'بخش‌های')
    .replace(/حرفهای/g,'حرفه‌ای').replace(/داروخانهای/g,'داروخانه‌ای').replace(/مهارتهای/g,'مهارت‌های')
    .replace(/بیماریهای/g,'بیماری‌های').replace(/فرصتهای/g,'فرصت‌های').replace(/آموزشهای/g,'آموزش‌های')
    .replace(/گامبهگام/g,'گام‌به‌گام').replace(/محبوبترین/g,'محبوب‌ترین').replace(/پرفروشترین/g,'پرفروش‌ترین')
    .replace(/های منتخب/g,'‌های منتخب');
}
function dbPath() { return resolve(process.env.DARO_DB_PATH || 'data/daroonegar.sqlite'); }
export function openDatabase(path = dbPath(), { seedCourses = path === dbPath() } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, role TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', price INTEGER, stock INTEGER, body_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(kind, slug));
    CREATE INDEX IF NOT EXISTS records_kind_status ON records(kind,status);
    CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL, items_json TEXT NOT NULL, total INTEGER NOT NULL, shipping_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, city TEXT NOT NULL DEFAULT '', university TEXT NOT NULL DEFAULT '', entry_year TEXT NOT NULL DEFAULT '', specialty TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', public_directory INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS submissions(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', data_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id,created_at);
    CREATE INDEX IF NOT EXISTS submissions_user ON submissions(user_id,created_at);
    CREATE INDEX IF NOT EXISTS submissions_kind_status ON submissions(kind,status);
    CREATE TABLE IF NOT EXISTS course_progress(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE, completed_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL, PRIMARY KEY(user_id,record_id));
    CREATE TABLE IF NOT EXISTS exam_attempts(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, exam_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE, score INTEGER NOT NULL, passed INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS certificates(code TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), course_id INTEGER NOT NULL REFERENCES records(id), issued_at TEXT NOT NULL, revoked_at TEXT);`);
  try { db.exec("ALTER TABLE orders ADD COLUMN shipping_json TEXT NOT NULL DEFAULT '{}'"); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }
  if(seedCourses){
    const localCourses=JSON.parse(readFileSync(new URL('./data/courses-seed.json',import.meta.url),'utf8'));
    const existingCourse=db.prepare("SELECT body_json FROM records WHERE kind='courses' AND slug=?");
    const saveCourse=db.prepare(`INSERT INTO records(kind,slug,title,summary,source_url,image_url,category,status,price,stock,body_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(kind,slug) DO UPDATE SET title=excluded.title,summary=excluded.summary,source_url='',image_url=excluded.image_url,category=excluded.category,status=excluded.status,price=excluded.price,stock=excluded.stock,body_json=excluded.body_json,updated_at=excluded.updated_at`);
    const seededAt=new Date().toISOString();
    for(const course of localCourses){const current=existingCourse.get(course.slug);if(!current||JSON.parse(current.body_json).localCatalogVersion!==6){const body={...course.body,content:repairPersianJoiners(course.body?.content||''),description:repairPersianJoiners(course.body?.description||''),shopListed:SHOP_COURSE_SLUGS.has(course.slug),localCatalog:true,localCatalogVersion:6};saveCourse.run(course.kind,course.slug,course.title,repairPersianJoiners(course.summary),'',course.imageUrl,course.category,course.status,course.price,course.stock,JSON.stringify(body),seededAt,seededAt);}}
  }
  return db;
}

function send(res, status, body, headers = {}) {
  const payload = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', ...headers });
  res.end(payload);
}
function parseCookies(header = '') { return Object.fromEntries(header.split(';').map(s => s.trim()).filter(Boolean).map(s => { const i=s.indexOf('='); return [s.slice(0,i), decodeURIComponent(s.slice(i+1))]; })); }
async function bodyJson(req, max = 5_000_000) {
  let size = 0; const chunks=[];
  for await (const chunk of req) { size += chunk.length; if (size > max) throw Object.assign(new Error('حجم درخواست بیش از حد مجاز است.'), { status: 413 }); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('بدنهٔ درخواست معتبر نیست.'), { status: 400 }); }
}
function safeUser(row) { return row && { id: row.id, name: row.name, email: row.email, role: row.role, verified: !!row.verified, createdAt: row.created_at }; }
function escapeHtmlText(value) { return String(value ?? '').trim(); }
function validSlug(value) { return /^[a-z0-9؀-ۿ][a-z0-9؀-ۿ-]{0,119}$/i.test(value); }
function validHttpUrl(value) { try { const u=new URL(value); return u.protocol==='https:' || u.protocol==='http:'; } catch { return false; } }

function parseCsv(source) {
  const rows=[]; let row=[], cell='', quoted=false;
  for (let i=0;i<source.length;i++) { const c=source[i]; if (quoted) { if(c==='"'&&source[i+1]==='"'){cell+='"';i++;} else if(c==='"') quoted=false; else cell+=c; } else if(c==='"') quoted=true; else if(c===','){row.push(cell);cell='';} else if(c==='\n'){row.push(cell.replace(/\r$/,'')); rows.push(row);row=[];cell='';} else cell+=c; }
  if (quoted) throw new Error('فایل CSV نقل‌قول بسته‌نشده دارد.');
  if (cell.length || row.length) { row.push(cell.replace(/\r$/,'')); rows.push(row); }
  const headers=(rows.shift()||[]).map(x=>x.trim());
  if (!headers.length || !headers.includes('title') || !headers.includes('slug')) throw new Error('ستون‌های title و slug الزامی هستند.');
  return rows.filter(r=>r.some(v=>v.trim())).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])));
}

function recordShape(input, kind) {
  const title=escapeHtmlText(input.title); const slug=escapeHtmlText(input.slug);
  if (!title || !validSlug(slug)) throw Object.assign(new Error('عنوان و شناسهٔ URL معتبر الزامی است.'), { status: 400 });
  const status=input.status==='published'?'published':'draft';
  const source=escapeHtmlText(input.sourceUrl);
  if (source && !validHttpUrl(source)) throw Object.assign(new Error('نشانی منبع باید HTTP یا HTTPS باشد.'), { status: 400 });
  if (status==='published' && PUBLISH_REQUIRES_SOURCE.has(kind) && !source) throw Object.assign(new Error('برای انتشار این محتوا، نشانی منبع معتبر لازم است.'), { status: 400 });
  const price=input.price==='' || input.price==null ? null : Number(input.price);
  const stock=input.stock==='' || input.stock==null ? null : Number(input.stock);
  if ((kind==='products' && (!Number.isSafeInteger(price)||price<0||!Number.isSafeInteger(stock)||stock<0)) || (stock!==null&&(!Number.isSafeInteger(stock)||stock<0))) throw Object.assign(new Error('برای کالا قیمت و موجودیِ صحیح و نامنفی لازم است.'), { status: 400 });
  const body=typeof input.body==='string'?input.body:(input.body??{});
  return { kind, title, slug, summary:escapeHtmlText(input.summary), source, image:escapeHtmlText(input.imageUrl), category:escapeHtmlText(input.category), status, price, stock, body:JSON.stringify(body) };
}
function rowRecord(row) { return { id:row.id, kind:row.kind, title:row.title, slug:row.slug, summary:row.summary, sourceUrl:row.source_url, imageUrl:row.image_url, category:row.category, status:row.status, price:row.price, stock:row.stock, body:JSON.parse(row.body_json), createdAt:row.created_at, updatedAt:row.updated_at }; }

export function createServer({ databasePath = dbPath(), port = Number(process.env.API_PORT || 4173), host = process.env.API_HOST || '127.0.0.1' } = {}) {
  const db=openDatabase(databasePath);
  const now=()=>new Date().toISOString();
  const cookieOptions=`Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS/1000}${process.env.NODE_ENV==='production'?'; Secure':''}`;
  const clearCookie='Path=/; HttpOnly; SameSite=Lax; Max-Age=0'+(process.env.NODE_ENV==='production'?'; Secure':'');
  function current(req) {
    const token=parseCookies(req.headers.cookie)[COOKIE]; if(!token) return null;
    const row=db.prepare(`SELECT s.csrf,s.expires_at,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(hash(token));
    if(!row || row.expires_at<Date.now()){ if(row)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token)); return null; }
    return { user:row, csrf:row.csrf };
  }
  function failLimit(req) { const k=`${req.socket.remoteAddress}:${(req.headers['x-forwarded-for']||'').slice(0,64)}`; const f=failures.get(k); if(f&&f.until>Date.now()&&f.count>=8)return true; if(f&&f.until<=Date.now())failures.delete(k); return false; }
  function noteFailure(req) { const k=`${req.socket.remoteAddress}:${(req.headers['x-forwarded-for']||'').slice(0,64)}`; const f=failures.get(k); if(!f||f.until<Date.now())failures.set(k,{count:1,until:Date.now()+15*60_000}); else f.count++; }
  function requireCsrf(req, session) {
    const origin=req.headers.origin; const expected=process.env.PUBLIC_ORIGIN;
    if (origin && expected && origin!==expected) throw Object.assign(new Error('درخواست از مبدأ مجاز نیست.'),{status:403});
    if (origin && !expected && process.env.NODE_ENV==='production') throw Object.assign(new Error('مبدأ عمومی پیکربندی نشده است.'),{status:403});
    if(!session || req.headers['x-csrf-token']!==session.csrf) throw Object.assign(new Error('نشست منقضی یا درخواست نامعتبر است؛ دوباره وارد شوید.'),{status:403});
  }
  function requireAdmin(session) { if(!session || session.user.role!=='admin')throw Object.assign(new Error('دسترسی مدیریتی مجاز نیست.'),{status:403}); }
  async function handler(req,res) {
    const url=new URL(req.url,'http://localhost'); const path=url.pathname; const method=req.method;
    try {
      if (!path.startsWith('/api/')) return send(res,404,{error:'مسیر API یافت نشد.'});
      if (method==='GET'&&path==='/api/health') return send(res,200,{ok:true,storage:'sqlite',version:1});
      const session=current(req);
      if(method==='GET'&&path==='/api/auth/session') return send(res,200,{user:safeUser(session?.user),csrf:session?.csrf||null});
      if(method==='POST'&&path==='/api/auth/register') {
        if(failLimit(req))return send(res,429,{error:'درخواست‌های زیادی ثبت شده؛ کمی بعد تلاش کنید.'});
        const b=await bodyJson(req); const name=escapeHtmlText(b.name), email=escapeHtmlText(b.email).toLowerCase(), password=String(b.password||''), role=String(b.role||'pharmacist');
        if(name.length<2||name.length>100||!/^\S+@\S+\.\S+$/.test(email)||password.length<12||password.length>256||!ROLES.has(role))return send(res,400,{error:'نام، ایمیل، نقش یا گذرواژه با شرایط لازم سازگار نیست. گذرواژه باید دست‌کم ۱۲ نویسه داشته باشد.'});
        const salt=randomBytes(16).toString('hex'); const key=await scrypt(password,salt,64);
        try { const created=db.prepare('INSERT INTO users(name,email,role,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(name,email,role,salt,key.toString('hex'),now());db.prepare('INSERT INTO profiles(user_id,updated_at) VALUES(?,?)').run(created.lastInsertRowid,now()); } catch { return send(res,409,{error:'برای این ایمیل حسابی وجود دارد.'}); }
        return send(res,201,{created:true,message:'حساب ساخته شد. تا اتصال سرویس تأیید ایمیل، برخی امکانات حساس محدود می‌مانند.'});
      }
      if(method==='POST'&&path==='/api/auth/login') {
        if(failLimit(req))return send(res,429,{error:'درخواست‌های زیادی ثبت شده؛ ۱۵ دقیقهٔ دیگر تلاش کنید.'});
        const b=await bodyJson(req); const email=escapeHtmlText(b.email).toLowerCase(); const password=String(b.password||''); const row=db.prepare('SELECT * FROM users WHERE email=?').get(email);
        const salt=row?.salt||'0'.repeat(32); const expected=row?.password_hash||'0'.repeat(128); const actual=(await scrypt(password,salt,64)).toString('hex');
        if(!row||!timingSafeEqual(Buffer.from(expected),Buffer.from(actual))){noteFailure(req);return send(res,401,{error:'ایمیل یا گذرواژه درست نیست.'});}
        const token=randomBytes(32).toString('base64url');const csrf=randomBytes(24).toString('base64url');
        db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').run(hash(token),row.id,csrf,Date.now()+SESSION_MS);
        return send(res,200,{user:safeUser(row),csrf},{'Set-Cookie':`${COOKIE}=${encodeURIComponent(token)}; ${cookieOptions}`});
      }
      if(method==='POST'&&path==='/api/auth/logout') { requireCsrf(req,session); db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(parseCookies(req.headers.cookie)[COOKIE])); return send(res,200,{ok:true},{'Set-Cookie':`${COOKIE}=; ${clearCookie}`}); }
      const publicMatch=path.match(/^\/api\/public\/([a-z]+)(?:\/([a-z0-9\u0600-\u06ff-]+))?$/i);
      if(method==='GET'&&publicMatch) {
        const [,kind,slug]=publicMatch; if(!KINDS.has(kind))return send(res,404,{error:'بخش شناخته‌شده نیست.'});
        if(slug){const r=db.prepare("SELECT * FROM records WHERE kind=? AND slug=? AND status='published'").get(kind,slug);return r?send(res,200,rowRecord(r)):send(res,404,{error:'محتوای منتشرشده یافت نشد.'});}
        const rows=db.prepare("SELECT * FROM records WHERE kind=? AND status='published' ORDER BY updated_at DESC LIMIT 500").all(kind);return send(res,200,{items:rows.map(rowRecord),total:rows.length});
      }
      if(path==='/api/profile'&&method==='GET'){
        if(!session||session.user.role==='admin')return send(res,401,{error:'برای دیدن پروفایل وارد حساب شوید.'});
        const p=db.prepare('SELECT city,university,entry_year,specialty,bio,public_directory,updated_at FROM profiles WHERE user_id=?').get(session.user.id);
        return send(res,200,{user:safeUser(session.user),profile:p?{city:p.city,university:p.university,entryYear:p.entry_year,specialty:p.specialty,bio:p.bio,publicDirectory:!!p.public_directory,updatedAt:p.updated_at}:null});
      }
      if(path==='/api/profile'&&method==='PUT'){
        if(!session||session.user.role==='admin')return send(res,401,{error:'برای ویرایش پروفایل وارد حساب شوید.'});requireCsrf(req,session);const b=await bodyJson(req,30_000);
        const fields=['city','university','entryYear','specialty','bio'];if(fields.some(k=>String(b[k]||'').length>(k==='bio'?1200:160)))return send(res,400,{error:'یکی از فیلدها بیش از حد مجاز طولانی است.'});
        db.prepare(`INSERT INTO profiles(user_id,city,university,entry_year,specialty,bio,public_directory,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET city=excluded.city,university=excluded.university,entry_year=excluded.entry_year,specialty=excluded.specialty,bio=excluded.bio,public_directory=excluded.public_directory,updated_at=excluded.updated_at`).run(session.user.id,...fields.slice(0,4).map(k=>escapeHtmlText(b[k])),escapeHtmlText(b.bio),b.publicDirectory?1:0,now());
        return send(res,200,{ok:true});
      }
      if(method==='GET'&&path==='/api/public/cohort'){
        const university=escapeHtmlText(url.searchParams.get('university'));const year=escapeHtmlText(url.searchParams.get('year'));if(!university||!year)return send(res,400,{error:'نام دانشگاه و سال ورود لازم است.'});
        const items=db.prepare("SELECT u.id,u.name,u.role,p.city,p.university,p.entry_year,p.specialty FROM profiles p JOIN users u ON u.id=p.user_id WHERE p.public_directory=1 AND u.verified=1 AND p.university=? AND p.entry_year=? ORDER BY u.name LIMIT 200").all(university,year);return send(res,200,{items});
      }
      const submissionKinds=new Set(['contact','shortage','job','shift','application','event-registration','course-enrollment']);const submissionMatch=path.match(/^\/api\/submissions\/([a-z-]+)$/);
      if(submissionMatch&&method==='POST'){
        const kind=submissionMatch[1];if(!submissionKinds.has(kind))return send(res,404,{error:'نوع فرم شناخته‌شده نیست.'});const protectedKinds=new Set(['shortage','job','shift','application','event-registration','course-enrollment']);
        if(protectedKinds.has(kind)&&!session)return send(res,401,{error:'برای ارسال این درخواست وارد حساب شوید.'});if(protectedKinds.has(kind)&&!session.user.verified)return send(res,403,{error:'برای ارسال درخواست، حساب باید تأیید شده باشد.'});if(session&&session.user.role==='admin')return send(res,403,{error:'این فرم برای حساب مدیریتی نیست.'});
        if(kind==='course-enrollment'&&!['pharmacist','student'].includes(session.user.role))return send(res,403,{error:'درخواست ثبت‌نام در دوره برای داروساز یا دانشجو فعال است.'});
        if(kind==='job'&&!['pharmacy','company'].includes(session.user.role))return send(res,403,{error:'ثبت آگهی برای نقش داروخانه یا شرکت فعال است.'});if(kind==='application'&&!['pharmacist','student'].includes(session.user.role))return send(res,403,{error:'ارسال درخواست شغلی برای نقش داروساز یا دانشجو فعال است.'});if(kind==='shortage'&&!['pharmacy','pharmacist'].includes(session.user.role))return send(res,403,{error:'گزارش کمبود برای داروخانه یا داروساز فعال است.'});if(kind==='shift'&&session.user.role!=='pharmacist')return send(res,403,{error:'درخواست تبادل شیفت برای داروساز فعال است.'});
        const b=await bodyJson(req,50_000);const serialized=JSON.stringify(b);if(serialized.length>20_000)return send(res,413,{error:'فرم بیش از حد مجاز است.'});if(kind==='contact'&&(!escapeHtmlText(b.name)||!/^\S+@\S+\.\S+$/.test(String(b.email||''))||String(b.message||'').length<10))return send(res,400,{error:'نام، ایمیل و پیام معتبر وارد کنید.'});
        const result=db.prepare('INSERT INTO submissions(user_id,kind,status,data_json,created_at) VALUES(?,?,?,?,?)').run(session?.user.id||null,kind,'pending',serialized,now());return send(res,201,{id:Number(result.lastInsertRowid),status:'pending',message:'درخواست برای بررسی ثبت شد.'});
      }
      if(path==='/api/user/submissions'&&method==='GET'){
        if(!session||session.user.role==='admin')return send(res,401,{error:'برای دیدن درخواست‌ها وارد حساب شوید.'});const rows=db.prepare('SELECT id,kind,status,data_json,created_at FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 200').all(session.user.id);return send(res,200,{items:rows.map(x=>({id:x.id,kind:x.kind,status:x.status,data:JSON.parse(x.data_json),createdAt:x.created_at}))});
      }
      const progressMatch=path.match(/^\/api\/courses\/([a-z0-9\u0600-\u06ff-]+)\/progress$/i);
      if(progressMatch&&(method==='GET'||method==='PUT')){
        if(!session||session.user.role==='admin')return send(res,401,{error:'برای ثبت پیشرفت وارد حساب شوید.'});if(method==='PUT')requireCsrf(req,session);
        const course=db.prepare("SELECT * FROM records WHERE kind='courses' AND slug=? AND status='published'").get(progressMatch[1]);if(!course)return send(res,404,{error:'دورهٔ منتشرشده پیدا نشد.'});
        const body=JSON.parse(course.body_json);const count=Array.isArray(body.chapters)?body.chapters.length:0;
        if(method==='GET'){const row=db.prepare('SELECT completed_json,updated_at FROM course_progress WHERE user_id=? AND record_id=?').get(session.user.id,course.id);return send(res,200,{completed:row?JSON.parse(row.completed_json):[],chapterCount:count,updatedAt:row?.updated_at||null});}
        const b=await bodyJson(req,20_000);if(!Array.isArray(b.completed)||b.completed.some(i=>!Number.isInteger(i)||i<0||i>=count))return send(res,400,{error:'شمارهٔ فصل تکمیل‌شده معتبر نیست.'});const completed=[...new Set(b.completed)];db.prepare('INSERT INTO course_progress(user_id,record_id,completed_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,record_id) DO UPDATE SET completed_json=excluded.completed_json,updated_at=excluded.updated_at').run(session.user.id,course.id,JSON.stringify(completed),now());return send(res,200,{completed,chapterCount:count});
      }
      const ordersMatch=path.match(/^\/api\/orders(?:\/(\d+))?$/);
      if(ordersMatch&&method==='GET') {
        if(!session||session.user.role==='admin')return send(res,401,{error:'برای دیدن سفارش‌ها وارد حساب کاربری شوید.'});
        const rows=ordersMatch[1]?db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(Number(ordersMatch[1]),session.user.id):null;
        const items=ordersMatch[1]?(rows?[rows]:[]):db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 100').all(session.user.id);
        return send(res,200,{items:items.map(r=>({id:r.id,status:r.status,total:r.total,items:JSON.parse(r.items_json),createdAt:r.created_at}))});
      }
      if(path==='/api/orders'&&method==='POST') {
        if(!session||session.user.role==='admin')return send(res,401,{error:'برای ثبت سفارش وارد حساب کاربری شوید.'});requireCsrf(req,session);
        const b=await bodyJson(req);if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)return send(res,400,{error:'سبد خرید خالی یا نامعتبر است.'});
        const items=[];let total=0;
        for(const x of b.items){const id=Number(x.id),qty=Number(x.quantity);if(!Number.isSafeInteger(id)||!Number.isSafeInteger(qty)||qty<1||qty>99)return send(res,400,{error:'تعداد یکی از اقلام معتبر نیست.'});const p=db.prepare("SELECT id,title,price,stock FROM records WHERE id=? AND kind='products' AND status='published'").get(id);if(!p||p.stock<qty||p.price==null)return send(res,409,{error:'کالا موجود نیست یا موجودی کافی ندارد.'});total+=p.price*qty;items.push({id:p.id,title:p.title,price:p.price,quantity:qty});}
        const shipping={recipient:escapeHtmlText(b.recipient),phone:escapeHtmlText(b.phone),city:escapeHtmlText(b.city),address:escapeHtmlText(b.address)};if(Object.values(shipping).some(v=>!v)||shipping.address.length>1500)return send(res,400,{error:'اطلاعات ارسال کامل یا معتبر نیست.'});
        const result=db.prepare('INSERT INTO orders(user_id,status,items_json,total,shipping_json,created_at) VALUES(?,?,?,?,?,?)').run(session.user.id,'pending_payment',JSON.stringify(items),total,JSON.stringify(shipping),now());return send(res,201,{id:Number(result.lastInsertRowid),status:'pending_payment',total,payment:{status:'not_configured',message:'درگاه پرداخت هنوز متصل نشده است.'}});
      }
      if(path.startsWith('/api/admin/')) {
        requireAdmin(session);
        if(method!=='GET')requireCsrf(req,session);
        if(method==='GET'&&path==='/api/admin/stats') {
          const userCount=db.prepare('SELECT count(*) n FROM users').get().n;const byKind=db.prepare('SELECT kind,count(*) total FROM records GROUP BY kind').all();const orderCount=db.prepare('SELECT count(*) n FROM orders').get().n;const revenue=db.prepare("SELECT coalesce(sum(total),0) n FROM orders WHERE status='paid'").get().n;const pending=db.prepare("SELECT count(*) n FROM submissions WHERE status='pending'").get().n;
          return send(res,200,{users:userCount,records:Object.fromEntries(byKind.map(x=>[x.kind,x.total])),orders:orderCount,paidRevenue:revenue,pendingSubmissions:pending});
        }
        if(method==='GET'&&path==='/api/admin/integrations')return send(res,200,{analytics:!!process.env.GA_MEASUREMENT_ID,searchConsole:!!process.env.SEARCH_CONSOLE_VERIFICATION,payment:!!process.env.ZARINPAL_MERCHANT_ID,sms:!!process.env.SMS_API_KEY,email:!!(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASSWORD),drugSource:!!(process.env.DRUG_DATA_API_BASE&&process.env.DRUG_DATA_API_KEY),marketplace:!!process.env.TOROB_API_KEY});
        if(method==='GET'&&path==='/api/admin/users'){const items=db.prepare('SELECT id,name,email,role,verified,created_at FROM users ORDER BY id DESC LIMIT 1000').all();return send(res,200,{items:items.map(safeUser)});}
        const verify=path.match(/^\/api\/admin\/users\/(\d+)\/verify$/);if(method==='PATCH'&&verify){const b=await bodyJson(req);db.prepare('UPDATE users SET verified=? WHERE id=?').run(b.verified?1:0,Number(verify[1]));return send(res,200,{ok:true});}
        if(method==='GET'&&path==='/api/admin/orders'){const items=db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 500').all();return send(res,200,{items:items.map(r=>({id:r.id,userId:r.user_id,status:r.status,total:r.total,items:JSON.parse(r.items_json),shipping:JSON.parse(r.shipping_json||'{}'),createdAt:r.created_at}))});}
        if(method==='PATCH'&&path==='/api/admin/orders/status'){const b=await bodyJson(req);if(!['processing','shipped','cancelled','refunded'].includes(b.status))return send(res,400,{error:'وضعیت مجاز نیست؛ وضعیت پرداخت فقط از پاسخ تأییدشدهٔ درگاه تغییر می‌کند.'});const result=db.prepare("UPDATE orders SET status=? WHERE id=? AND status!='paid'").run(b.status,Number(b.id));return send(res,result.changes?200:404,{ok:!!result.changes});}
        if(method==='GET'&&path==='/api/admin/submissions'){const kind=url.searchParams.get('kind');const rows=kind?db.prepare('SELECT * FROM submissions WHERE kind=? ORDER BY id DESC LIMIT 500').all(kind):db.prepare('SELECT * FROM submissions ORDER BY id DESC LIMIT 500').all();return send(res,200,{items:rows.map(x=>({id:x.id,userId:x.user_id,kind:x.kind,status:x.status,data:JSON.parse(x.data_json),createdAt:x.created_at}))});}
        const subStatus=path.match(/^\/api\/admin\/submissions\/(\d+)\/status$/);if(method==='PATCH'&&subStatus){const b=await bodyJson(req);if(!['reviewing','approved','rejected','resolved'].includes(b.status))return send(res,400,{error:'وضعیت درخواست مجاز نیست.'});const result=db.prepare('UPDATE submissions SET status=? WHERE id=?').run(b.status,Number(subStatus[1]));return send(res,result.changes?200:404,{ok:!!result.changes});}
        const importMatch=path.match(/^\/api\/admin\/import\/([a-z]+)$/);if(method==='POST'&&importMatch){const kind=importMatch[1];if(!KINDS.has(kind))return send(res,404,{error:'نوع داده شناخته‌شده نیست.'});const raw=await bodyJson(req,6_000_000);let rows;if(Array.isArray(raw.items))rows=raw.items;else if(typeof raw.csv==='string')rows=parseCsv(raw.csv);else return send(res,400,{error:'فهرست JSON یا متن CSV لازم است.'});if(rows.length>1000)return send(res,413,{error:'حداکثر ۱۰۰۰ ردیف در هر نوبت مجاز است.'});const insert=db.prepare('INSERT INTO records(kind,slug,title,summary,source_url,image_url,category,status,price,stock,body_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');let count=0;try{db.exec('BEGIN IMMEDIATE');for(const item of rows){const r=recordShape(item,kind);insert.run(r.kind,r.slug,r.title,r.summary,r.source,r.image,r.category,r.status,r.price,r.stock,r.body,now(),now());count++;}db.exec('COMMIT');}catch(e){try{db.exec('ROLLBACK')}catch{}return send(res,400,{error:e.message.includes('UNIQUE')?'شناسهٔ URL تکراری است؛ هیچ‌کدام از این فایل ثبت نشد.':e.message});}return send(res,201,{imported:count});}
        const list=path.match(/^\/api\/admin\/records\/([a-z]+)$/);if(method==='GET'&&list){const kind=list[1];if(!KINDS.has(kind))return send(res,404,{error:'نوع داده شناخته‌شده نیست.'});const items=db.prepare('SELECT * FROM records WHERE kind=? ORDER BY updated_at DESC LIMIT 1000').all(kind);return send(res,200,{items:items.map(rowRecord)});}
        if(method==='POST'&&list){const kind=list[1];if(!KINDS.has(kind))return send(res,404,{error:'نوع داده شناخته‌شده نیست.'});const r=recordShape(await bodyJson(req),kind);const t=now();try{const id=db.prepare('INSERT INTO records(kind,slug,title,summary,source_url,image_url,category,status,price,stock,body_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(r.kind,r.slug,r.title,r.summary,r.source,r.image,r.category,r.status,r.price,r.stock,r.body,t,t);return send(res,201,{item:rowRecord(db.prepare('SELECT * FROM records WHERE id=?').get(id.lastInsertRowid))});}catch(e){return send(res,e.message.includes('UNIQUE')?409:400,{error:e.message.includes('UNIQUE')?'شناسهٔ URL در این بخش تکراری است.':e.message});}}
        const itemMatch=path.match(/^\/api\/admin\/records\/([a-z]+)\/(\d+)$/);if(itemMatch){const kind=itemMatch[1],id=Number(itemMatch[2]);if(!KINDS.has(kind))return send(res,404,{error:'نوع داده شناخته‌شده نیست.'});if(method==='PUT'){const r=recordShape(await bodyJson(req),kind);try{const out=db.prepare('UPDATE records SET slug=?,title=?,summary=?,source_url=?,image_url=?,category=?,status=?,price=?,stock=?,body_json=?,updated_at=? WHERE id=? AND kind=?').run(r.slug,r.title,r.summary,r.source,r.image,r.category,r.status,r.price,r.stock,r.body,now(),id,kind);if(!out.changes)return send(res,404,{error:'رکورد یافت نشد.'});return send(res,200,{item:rowRecord(db.prepare('SELECT * FROM records WHERE id=?').get(id))});}catch(e){return send(res,e.message.includes('UNIQUE')?409:400,{error:e.message.includes('UNIQUE')?'شناسهٔ URL تکراری است.':e.message});}}if(method==='DELETE'){const out=db.prepare('DELETE FROM records WHERE id=? AND kind=?').run(id,kind);return send(res,out.changes?200:404,{ok:!!out.changes});}}
        return send(res,404,{error:'مسیر مدیریتی یافت نشد.'});
      }
      return send(res,404,{error:'مسیر API یافت نشد.'});
    } catch(error) { return send(res,error.status||500,{error:error.status?error.message:'خطای داخلی سامانه.'}); }
  }
  const server=http.createServer((req,res)=>{if(req.method==='OPTIONS'){res.writeHead(204,{Allow:'GET,POST,PUT,PATCH,DELETE,OPTIONS'});return res.end();}handler(req,res);});
  return { server, db, listen:()=>new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(port,host,()=>resolveListen(server.address()));}), close:()=>new Promise(resolveClose=>server.close(()=>{db.close();resolveClose();})) };
}

if (process.argv[1] && resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname.replace(/^\//,''))) {
  const app=createServer();app.listen().then(address=>console.log(`دارونگار API روی http://${address.address}:${address.port} آماده است.`));
  process.on('SIGINT',()=>app.close().then(()=>process.exit(0)));process.on('SIGTERM',()=>app.close().then(()=>process.exit(0)));
}
