#!/usr/bin/env node
/**
 * 广西科技大学 正方教务 · 课表抓取工具
 *
 * 用法：
 *   node jwxt.mjs                 # 交互式输入学号密码
 *   node jwxt.mjs --user 2023xxxx # 只带学号
 *   JWC_PWD=xxx node jwxt.mjs --user 2023xxxx   # 密码走环境变量（慎用，会进 history）
 *
 * 说明：
 *   - 密码只在本机内存里用一次，RSA 加密后发给学校教务系统，不会写入任何文件
 *   - 登录成功后只保留 cookie（存 .session.json），密码立刻丢弃
 *   - 产出的 timetable.json 可以直接导入 App（我的 → 备份/恢复）
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const BASE = 'https://jwxt.gxust.edu.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(DIR, '.session.json');

/* ---------- 参数 ---------- */
function parseArgs(argv){
  const out = { user:'', year:'', term:'', year2:'' };
  for(let i=0;i<argv.length;i++){
    const a = argv[i];
    if(a === '--user')  out.user  = argv[++i] || '';
    else if(a === '--year') out.year = argv[++i] || '';
    else if(a === '--term') out.term = argv[++i] || '';
    else if(a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

/* ---------- 交互输入 ---------- */
function ask(question){
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, ans => { rl.close(); res(ans.trim()); }));
}
function askPassword(question){
  return new Promise(resolve => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if(!stdin.isTTY){
      // 非 TTY（被管道调用）时直接读一行
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', c => { buf += c; });
      stdin.on('end', () => resolve(buf.split('\n')[0].trim()));
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let pw = '';
    const onData = ch => {
      if(ch === '\r' || ch === '\n'){
        stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData);
        process.stdout.write('\n'); resolve(pw);
      }else if(ch === '\u0003'){
        stdin.setRawMode(false); process.stdout.write('\n'); process.exit(0);
      }else if(ch === '\u007f' || ch === '\b'){
        if(pw.length){ pw = pw.slice(0,-1); process.stdout.write('\b \b'); }
      }else{
        pw += ch; process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

/* ---------- 会话 ---------- */
const jar = new Map();
const cookieHeader = () => [...jar].map(([k,v])=>`${k}=${v}`).join('; ');
function absorb(res){
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  raw.forEach(c=>{
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    if(i > 0) jar.set(kv.slice(0,i).trim(), kv.slice(i+1).trim());
  });
}
function saveSession(){
  fs.writeFileSync(SESSION_FILE, JSON.stringify({
    cookies: [...jar],
    savedAt: new Date().toISOString()
  }, null, 2), 'utf8');
}
function loadSession(){
  try{
    const s = JSON.parse(fs.readFileSync(SESSION_FILE,'utf8'));
    (s.cookies||[]).forEach(([k,v])=>jar.set(k,v));
    return s;
  }catch(e){ return null; }
}

async function req(url, opts={}){
  const res = await fetch(url, {
    ...opts,
    redirect: 'manual',
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Cookie': cookieHeader(),
      ...(opts.headers || {})
    }
  });
  absorb(res);
  return res;
}

/* ---------- 登录 ---------- */
async function login(user, pwd, log){
  // 1. 登录页拿 csrftoken
  let res = await req(`${BASE}/xtgl/login_slogin.html`);
  const html = await res.text();
  const csrf = (html.match(/id="csrftoken"[^>]*value="([^"]+)"/)||[])[1];
  if(!csrf) throw new Error('登录页没有 csrftoken，学校可能改版了');

  // 2. 取 RSA 公钥（每次会话都不同，必须现取）
  res = await req(`${BASE}/xtgl/login_getPublicKey.html?time=${Date.now()}`, {
    headers: { 'Referer': `${BASE}/xtgl/login_slogin.html` }
  });
  const key = await res.json();

  // 3. RSA(PKCS#1 v1.5) 加密密码
  const pub = crypto.createPublicKey({
    key: {
      kty:'RSA',
      n: Buffer.from(key.modulus,'base64').toString('base64url'),
      e: Buffer.from(key.exponent,'base64').toString('base64url')
    },
    format:'jwk'
  });
  const enc = crypto.publicEncrypt(
    { key: pub, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(pwd, 'utf8')
  ).toString('base64');

  // 4. 提交（表单里 mm 出现两次，且 action 必须带 ?time=）
  const body = new URLSearchParams();
  body.append('csrftoken', csrf);
  body.append('language', 'zh_CN');
  body.append('ydType', '0');
  body.append('yhm', user);
  body.append('mm', enc);
  body.append('mm', enc);

  res = await req(`${BASE}/xtgl/login_slogin.html?time=${Date.now()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE}/xtgl/login_slogin.html`,
      'Origin': BASE
    },
    body: body.toString()
  });

  const loc = res.headers.get('location') || '';
  if(res.status === 302 && /index_initMenu|index_top|Main/.test(loc)){
    return { ok: true };
  }

  const page = await res.text();
  const err = page.match(/id="tips"[^>]*>([\s\S]{0,200}?)<\/p>/);
  const msg = err ? err[1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim() : '';
  return { ok: false, message: msg || '登录失败（服务端未返回明确原因）' };
}

/* ---------- 会话有效性 ---------- */
async function sessionAlive(user){
  const res = await req(`${BASE}/xtgl/index_initMenu.html?jsdm=&_t=${Date.now()}`);
  if(res.status === 302) return false;
  const t = await res.text();
  return !/login_slogin/.test(t) && t.length > 1000;
}

/* ---------- 课表 ---------- */
async function fetchTimetable(user, year, term){
  const url = `${BASE}/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151&su=${encodeURIComponent(user)}`;
  const res = await req(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${BASE}/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default&su=${encodeURIComponent(user)}`
    },
    body: new URLSearchParams({ xnm: String(year), xqm: String(term) }).toString()
  });

  if(res.status === 302) throw new Error('会话已失效，需要重新登录');
  const text = await res.text();
  let data;
  try{ data = JSON.parse(text); }
  catch(e){ throw new Error('课表接口返回的不是 JSON，可能是权限或学期参数不对：' + text.slice(0,120)); }
  return data;
}

/* ---------- 转成 App 能直接导入的格式 ---------- */
function parseWeeks(zcd){
  if(!zcd) return [];
  let t = String(zcd).replace(/[（）]/g, m => m === '（' ? '(' : ')').replace(/\s/g, '');
  let parity = 0;
  if(/\(单\)|单周/.test(t)) parity = 1;
  if(/\(双\)|双周/.test(t)) parity = 2;
  t = t.replace(/[、，；;/]/g, ',').replace(/[^\d,\-~]/g, '');
  const out = [];
  t.split(',').forEach(p=>{
    const m = p.match(/^(\d+)[-~](\d+)$/);
    if(m){ for(let i = +m[1]; i <= +m[2]; i++) out.push(i); }
    else if(/^\d+$/.test(p)) out.push(+p);
  });
  let w = [...new Set(out)].sort((a,b)=>a-b);
  if(parity === 1) w = w.filter(x => x % 2 === 1);
  if(parity === 2) w = w.filter(x => x % 2 === 0);
  return w;
}

function toEntries(list){
  return list.map((k, i)=>{
    const jcs = String(k.jcs || '');
    let start = 1, end = 2;
    const range = jcs.match(/(\d{1,2})\s*[-~]\s*(\d{1,2})/);
    if(range){ start = +range[1]; end = +range[2]; }
    else if(/^\d{4}$/.test(jcs)){ start = +jcs.slice(0,2); end = +jcs.slice(2); }
    else { const one = jcs.match(/(\d{1,2})/); if(one) start = end = +one[1]; }

    return {
      id: 'jw' + Date.now().toString(36) + i,
      name: (k.kcmc || '').trim(),
      teacher: (k.xm || '').trim(),
      room: (k.cdmc || '').trim(),
      type: '必修',
      day: Math.min(7, Math.max(1, parseInt(k.xqj, 10) || 1)),
      start: Math.min(12, Math.max(1, start)),
      end: Math.min(12, Math.max(start, end)),
      weeks: parseWeeks(k.zcd),
      color: null
    };
  }).filter(e => e.name);
}

/* ---------- 主流程 ---------- */
async function main(){
  const args = parseArgs(process.argv.slice(2));
  if(args.help){
    console.log(`用法：node jwxt.mjs [--user 学号] [--year 2026] [--term 3]
  --year  学年起始年，如 2026 表示 2026-2027 学年
  --term  学期：3=第一学期  12=第二学期  16=短学期`);
    return;
  }

  const now = new Date();
  const defaultYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const defaultTerm = (now.getMonth() >= 7 && now.getMonth() <= 11) || now.getMonth() === 0 ? 3 : 12;

  const user = args.user || await ask('学号：');
  if(!user) { console.error('缺少学号'); process.exit(1); }
  const year = args.year || String(defaultYear);
  const term = args.term || String(defaultTerm);

  let pwd = process.env.JWC_PWD || '';
  const cached = loadSession();
  let alive = false;

  if(cached && !pwd){
    console.log('发现上次的会话，检查是否还有效…');
    alive = await sessionAlive(user);
    console.log(alive ? '会话仍有效，跳过登录' : '会话已过期，需要重新登录');
  }

  if(!alive){
    if(!pwd) pwd = await askPassword('密码（输入不显示）：');
    if(!pwd){ console.error('缺少密码'); process.exit(1); }
    console.log('正在登录教务系统…');
    const r = await login(user, pwd, console.log);
    pwd = ''; // 立刻丢弃
    if(!r.ok){
      console.error('登录失败：' + r.message);
      console.error('如果是密码错误，注意连续 5 次会锁定账号 2 分钟。');
      process.exit(2);
    }
    console.log('登录成功');
    saveSession();
  }

  console.log(`拉取课表：学年 ${year}-${+year+1}，学期代码 ${term}`);
  const data = await fetchTimetable(user, year, term);

  const list = data.kbList || data.kbList2 || [];
  console.log(`返回 ${list.length} 条课程记录`);
  if(list.length){
    const k = list[0];
    console.log('字段样例：', Object.keys(k).join(', '));
    console.log('第一条：', JSON.stringify(k).slice(0, 300));
  }else{
    console.log('课表为空。可能是学期代码不对，试试 --term 12（第二学期）或 --term 3（第一学期）。');
  }

  const outFile = path.join(DIR, 'raw-timetable.json');
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf8');
  console.log('\n原始数据已保存：' + outFile);

  if(list.length){
    const entries = toEntries(list);
    const importFile = path.join(DIR, 'timetable-import.json');
    fs.writeFileSync(importFile, JSON.stringify({ version: 2, entries }, null, 2), 'utf8');

    const names = new Set(entries.map(e => e.name));
    console.log('');
    console.log('== 转换结果 ==');
    console.log(`  ${names.size} 门课程，${entries.length} 个上课时段`);
    entries.slice(0, 3).forEach(e => {
      const dayName = ['周一','周二','周三','周四','周五','周六','周日'][e.day-1];
      console.log(`  · ${e.name} | ${dayName} 第${e.start}-${e.end}节 | ${e.room || '无地点'} | ${e.weeks.length}周`);
    });
    console.log('');
    console.log('可以直接导入 App 的文件已生成：');
    console.log('  ' + importFile);
    console.log('');
    console.log('下一步：把这个文件发到手机（微信文件传输助手），');
    console.log('手机上打开课表 App → 我的 → 备份/恢复 → 从文件导入。');
  }
}

main().catch(e => {
  console.error('出错了：' + e.message);
  process.exit(1);
});
