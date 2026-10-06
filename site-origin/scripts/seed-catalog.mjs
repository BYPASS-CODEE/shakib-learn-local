import { openDatabase } from '../server.mjs';

const db=openDatabase();
const count=db.prepare("SELECT COUNT(*) AS count FROM records WHERE kind='courses' AND status='published'").get().count;
db.close();
console.log(`${Number(count).toLocaleString('fa-IR')} دوره از کاتالوگ همراه پروژه آماده است.`);
