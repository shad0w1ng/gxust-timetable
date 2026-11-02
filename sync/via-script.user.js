// ==UserScript==
// @name         广科课表同步
// @namespace    gxust-timetable
// @version      1.0
// @description  在广西科技大学教务系统课表页注入一个按钮，点一下把课表抓到剪贴板，回到课表 App 粘贴导入
// @match        https://jwxt.gxust.edu.cn/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // 只在顶层页面注入，避免 iframe 里重复出现
  if (window.top !== window) return;
  if (window.__gxustSyncLoaded) return;
  window.__gxustSyncLoaded = true;

  /* ---------- 样式 ---------- */
  function injectStyle(){
  var style = document.createElement('style');
  style.textContent = [
    '#gxust-sync{position:fixed;right:16px;bottom:88px;z-index:2147483647;',
    'padding:11px 18px;border-radius:24px;border:0;cursor:pointer;',
    'font-size:15px;font-weight:600;font-family:-apple-system,sans-serif;',
    'color:#fff;background:linear-gradient(135deg,#2f8bf0,#1257ad);',
    'box-shadow:0 8px 24px -8px rgba(26,111,212,.95);',
    'transition:transform .12s ease,opacity .2s ease;opacity:.94;}',
    '#gxust-sync:active{transform:scale(.94);}',
    '#gxust-sync.ok{background:linear-gradient(135deg,#22c55e,#15803d);}',
    '#gxust-sync.err{background:linear-gradient(135deg,#ef4444,#b91c1c);}',
    '#gxust-sync.busy{opacity:.6;}',
    '#gxust-toast{position:fixed;right:16px;bottom:140px;z-index:2147483647;',
    'max-width:76vw;padding:10px 15px;border-radius:12px;',
    'background:rgba(20,24,30,.94);color:#fff;font-size:13px;line-height:1.5;',
    'font-family:-apple-system,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3);',
    'opacity:0;transition:opacity .22s ease;pointer-events:none;white-space:pre-wrap;}',
    '#gxust-toast.show{opacity:1;}'
  ].join('');
  var host = document.head || document.documentElement;
  if (host) host.appendChild(style);
  }

  /* ---------- 组件 ---------- */
  var btn = document.createElement('button');
  btn.id = 'gxust-sync';
  btn.textContent = '同步课表';

  var toast = document.createElement('div');
  toast.id = 'gxust-toast';

  var toastTimer = null;
  function tip(msg, sticky) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2600);
  }

  function setBtn(text, cls) {
    btn.textContent = text;
    btn.className = cls || '';
  }

  /* ---------- 学年学期 ---------- */
  function guessTerm() {
    var xnm = '', xqm = '';
    var e1 = document.querySelector('#xnm');
    var e2 = document.querySelector('#xqm');
    if (e1 && e1.value) xnm = e1.value;
    if (e2 && e2.value) xqm = e2.value;

    if (!xnm || !xqm) {
      var d = new Date();
      var m = d.getMonth() + 1;
      var y = d.getFullYear();
      if (m >= 8) { xnm = String(y); xqm = '3'; }
      else if (m === 1) { xnm = String(y - 1); xqm = '3'; }
      else { xnm = String(y); xqm = '12'; }
    }
    return { xnm: xnm, xqm: xqm };
  }

  function getStudentId() {
    var q = new URLSearchParams(location.search);
    var su = q.get('su');
    if (su) return su;
    var el = document.querySelector('#sessionUserKey');
    if (el && el.value) return el.value;
    var m = document.documentElement.innerHTML.match(/su=(\d{6,})/);
    return m ? m[1] : '';
  }

  /* ---------- 复制 ---------- */
  // 返回 'ok'（已写入剪贴板）或 'manual'（弹出面板让用户长按复制）
  function copyText(text) {
    return new Promise(function (resolve) {
      var done = false;

      function finish(ok) {
        if (done) return;
        done = true;
        if (ok) resolve('ok');
        else { showManual(text); resolve('manual'); }
      }

      function fallback() {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          if (ta.setSelectionRange) ta.setSelectionRange(0, ta.value.length);
          var ok = false;
          try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
          document.body.removeChild(ta);
          finish(ok);
        } catch (e) { finish(false); }
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(function () { finish(true); })
          .catch(fallback);
      } else {
        fallback();
      }

      // 兜底：2 秒还没结果就弹面板
      setTimeout(function () { if (!done) finish(false); }, 2000);
    });
  }

  /* 剪贴板不可用时，弹一个可长按复制的面板 */
  function showManual(text) {
    var mask = document.createElement('div');
    mask.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);'
      + 'display:flex;align-items:center;justify-content:center;padding:16px;';

    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:14px;padding:14px;width:100%;max-width:430px;box-sizing:border-box;';

    var title = document.createElement('div');
    title.textContent = '长按下面的文字，全选后复制';
    title.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:8px;color:#111;';

    var ta = document.createElement('textarea');
    ta.value = text;
    ta.readOnly = true;
    ta.style.cssText = 'width:100%;height:150px;font-size:11px;line-height:1.4;border:1px solid #ddd;'
      + 'border-radius:8px;padding:8px;box-sizing:border-box;color:#111;background:#f7f7f8;';

    var close = document.createElement('button');
    close.textContent = '关闭';
    close.style.cssText = 'margin-top:10px;width:100%;padding:11px;border:0;border-radius:8px;'
      + 'background:#1a6fd4;color:#fff;font-size:14px;font-weight:600;';
    close.onclick = function () {
      if (mask.parentNode) mask.parentNode.removeChild(mask);
    };

    box.appendChild(title);
    box.appendChild(ta);
    box.appendChild(close);
    mask.appendChild(box);
    document.body.appendChild(mask);

    setTimeout(function () { ta.focus(); ta.select(); }, 50);
  }

  /* ---------- 抓取 ---------- */
  function grab() {
    var t = guessTerm();
    var su = getStudentId();
    var url = '/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151' + (su ? '&su=' + encodeURIComponent(su) : '');

    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'xnm=' + t.xnm + '&xqm=' + t.xqm
    }).then(function (r) {
      if (r.status === 302 || r.redirected) throw new Error('登录已失效，请重新登录教务系统');
      return r.text();
    }).then(function (text) {
      var data;
      try { data = JSON.parse(text); }
      catch (e) { throw new Error('返回的不是课表数据，请确认停在课表页面'); }

      var list = data.kbList || [];
      if (!list.length) {
        throw new Error('课表为空。可能在' + t.xnm + '学年学期码' + t.xqm + '下没有课，可在教务系统里切换学期后重试');
      }

      var slim = list.map(function (k) {
        return {
          kcmc: k.kcmc, xm: k.xm, cdmc: k.cdmc,
          xqj: k.xqj, jcs: k.jcs, zcd: k.zcd
        };
      });

      var payload = 'GXUST-TT-1|' + JSON.stringify({ kbList: slim });
      return copyText(payload).then(function (how) { return { n: slim.length, how: how }; });
    });
  }

  /* ---------- 交互 ---------- */
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (btn.classList.contains('busy')) return;

    setBtn('抓取中…', 'busy');
    grab().then(function (r) {
      if (r.how === 'manual') {
        setBtn('待手动复制', 'ok');
        tip('剪贴板被系统拦截，已弹出面板，长按全选复制即可。');
      } else {
        setBtn('已复制 ' + r.n + ' 条', 'ok');
        tip('已复制 ' + r.n + ' 条课程到剪贴板。\n回到课表 App → 我的 → 粘贴导入');
      }
      setTimeout(function () { setBtn('同步课表', ''); }, 3200);
    }).catch(function (err) {
      setBtn('失败', 'err');
      tip('同步失败：' + (err && err.message ? err.message : err), true);
      setTimeout(function () { setBtn('同步课表', ''); }, 3600);
    });
  });

  /* ---------- 挂载 ---------- */
  var tries = 0;
  function mount() {
    if (!document.body) {
      if (++tries > 60) return;                 // 最多等 12 秒
      setTimeout(mount, 200);
      return;
    }
    if (document.getElementById('gxust-sync')) return;
    try { injectStyle(); } catch (e) {}
    document.body.appendChild(btn);
    document.body.appendChild(toast);
  }

  function fatal(e) {
    try {
      var box = document.createElement('div');
      box.textContent = '课表同步脚本出错：' + (e && e.message ? e.message : e);
      box.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;'
        + 'background:#c53030;color:#fff;font-size:13px;padding:10px;line-height:1.5;';
      (document.body || document.documentElement).appendChild(box);
    } catch (x) {}
  }

  function boot() {
    try { mount(); } catch (e) { fatal(e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
    // 兜底：万一 DOMContentLoaded 已经错过
    setTimeout(boot, 1500);
  } else {
    boot();
  }
})();
