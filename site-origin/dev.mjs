import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const here=process.cwd();
const children=[
  spawn(process.execPath,[resolve(here,'server.mjs')],{cwd:here,stdio:'inherit',env:process.env}),
  spawn(process.execPath,[resolve(here,'node_modules/vite/bin/vite.js')],{cwd:here,stdio:'inherit',env:process.env}),
];
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)if(!child.killed)child.kill('SIGTERM');setTimeout(()=>process.exit(code),250).unref();}
for(const child of children){child.on('error',error=>{console.error('فرآیند اجرا نشد:',error.message);stop(1);});child.on('exit',code=>{if(!stopping&&code!==null&&code!==0)stop(code);});}
process.on('SIGINT',()=>stop(0));process.on('SIGTERM',()=>stop(0));
