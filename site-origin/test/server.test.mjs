import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { createServer, openDatabase } from '../server.mjs';

let app, root, base, userCookie, userCsrf, adminCookie, adminCsrf;
const userEmail='member@example.test';
const adminEmail='administrator@example.test';
const userPassword='test-only-strong-password-4821';
const adminPassword='test-only-root-password-8742';

before(async()=>{
  root=mkdtempSync(join(tmpdir(),'daroonegar-test-'));
  app=createServer({databasePath:join(root,'test.sqlite'),port:0,host:'127.0.0.1'});
  const address=await app.listen();base=`http://127.0.0.1:${address.port}`;
  const salt=randomBytes(16).toString('hex');const key=scryptSync(adminPassword,salt,64).toString('hex');
  app.db.prepare('INSERT INTO users(name,email,role,salt,password_hash,verified,created_at) VALUES(?,?,?,?,?,1,?)').run('مدیر آزمون',adminEmail,'admin',salt,key,new Date().toISOString());
});
after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});

async function request(path,{method='GET',body,cookie,csrf}={}){
  const headers={};if(body!==undefined)headers['content-type']='application/json';if(cookie)headers.cookie=cookie;if(csrf)headers['x-csrf-token']=csrf;
  const res=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});let data={};try{data=await res.json()}catch{}return {res,data};
}
function cookieFrom(res){return res.headers.get('set-cookie')?.split(';')[0]}

test('health, registration validation, role limits, and cookie login',async()=>{
  const health=await request('/api/health');assert.equal(health.res.status,200);assert.equal(health.data.storage,'sqlite');
  const forged=await request('/api/auth/register',{method:'POST',body:{name:'عضو',email:userEmail,password:userPassword,role:'admin'}});assert.equal(forged.res.status,400);
  const registered=await request('/api/auth/register',{method:'POST',body:{name:'داروساز آزمون',email:userEmail,password:userPassword,role:'pharmacist'}});assert.equal(registered.res.status,201);
  const login=await request('/api/auth/login',{method:'POST',body:{email:userEmail,password:userPassword}});assert.equal(login.res.status,200);assert.equal(login.data.user.role,'pharmacist');userCookie=cookieFrom(login.res);userCsrf=login.data.csrf;assert.ok(userCookie);assert.ok(userCsrf);
});

test('local source catalog seeds all courses and only verified shop offerings',()=>{
  const db=openDatabase(join(root,'catalog.sqlite'),{seedCourses:true});
  const courses=db.prepare("SELECT slug,image_url,source_url,body_json FROM records WHERE kind='courses' AND status='published'").all();
  const listed=courses.filter(course=>JSON.parse(course.body_json).shopListed);
  assert.equal(courses.length,19);
  assert.equal(listed.length,16);
  assert.ok(courses.every(course=>course.source_url===''&&course.image_url.startsWith('/media/courses/')));
  assert.ok(listed.every(course=>course.image_url.startsWith('/media/courses/')));
  db.close();
});

test('administrative API rejects members and only exposes published records publicly',async()=>{
  const denied=await request('/api/admin/stats',{cookie:userCookie});assert.equal(denied.res.status,403);
  const draft=await request('/api/admin/records/drugs',{method:'POST',cookie:userCookie,csrf:userCsrf,body:{title:'نمونهٔ تست',slug:'test-drug',status:'draft'}});assert.equal(draft.res.status,403);
  const listed=await request('/api/public/drugs');assert.equal(listed.res.status,200);assert.equal(listed.data.total,0);
});

test('admin can create sourced records while publishing rules are enforced',async()=>{
  const login=await request('/api/auth/login',{method:'POST',body:{email:adminEmail,password:adminPassword}});assert.equal(login.res.status,200);adminCookie=cookieFrom(login.res);adminCsrf=login.data.csrf;
  const invalid=await request('/api/admin/records/drugs',{method:'POST',cookie:adminCookie,csrf:adminCsrf,body:{title:'دارو',slug:'drug-no-source',status:'published'}});assert.equal(invalid.res.status,400);
  const created=await request('/api/admin/records/products',{method:'POST',cookie:adminCookie,csrf:adminCsrf,body:{title:'کالای آزمون',slug:'test-item',summary:'فقط دادهٔ تست',sourceUrl:'https://supplier.example/item',status:'published',price:250000,stock:4}});assert.equal(created.res.status,201);assert.equal(created.data.item.status,'published');
  const visible=await request('/api/public/products/test-item');assert.equal(visible.res.status,200);assert.equal(visible.data.price,250000);
  const localCourse=await request('/api/admin/records/courses',{method:'POST',cookie:adminCookie,csrf:adminCsrf,body:{title:'دورهٔ محلی',slug:'local-course',imageUrl:'/media/courses/course-01.png',status:'published'}});assert.equal(localCourse.res.status,201);assert.equal(localCourse.data.item.sourceUrl,'');
});

test('checkout computes order from server catalogue and never marks it paid',async()=>{
  const checkout=await request('/api/orders',{method:'POST',cookie:userCookie,csrf:userCsrf,body:{items:[{id:1,quantity:2}],recipient:'کاربر آزمون',phone:'09120000000',city:'تهران',address:'نشانی آزمایشی معتبر'}});assert.equal(checkout.res.status,201);assert.equal(checkout.data.total,500000);assert.equal(checkout.data.status,'pending_payment');assert.equal(checkout.data.payment.status,'not_configured');
  const own=await request('/api/orders',{cookie:userCookie});assert.equal(own.res.status,200);assert.equal(own.data.items.length,1);assert.equal(own.data.items[0].status,'pending_payment');
});

test('CSV import is transactional on duplicate identifiers',async()=>{
  const result=await request('/api/admin/import/articles',{method:'POST',cookie:adminCookie,csrf:adminCsrf,body:{csv:'title,slug,sourceUrl,status\nمقالهٔ یک,same,https://journal.example/1,published\nمقالهٔ دو,same,https://journal.example/2,published'}});
  assert.equal(result.res.status,400);const items=await request('/api/public/articles');assert.equal(items.data.total,0);
});
