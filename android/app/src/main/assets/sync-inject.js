(function () {
  if (window.__gxustAppSyncLoaded) return;
  window.__gxustAppSyncLoaded = true;

  var style = document.createElement('style');
  style.textContent = [
    '#gxust-app-sync{position:fixed;right:16px;bottom:88px;z-index:2147483647;',
    'padding:12px 20px;border-radius:26px;border:0;cursor:pointer;',
    'font-size:16px;font-weight:600;font-family:-apple-system,sans-serif;',
    'color:#fff;background:linear-gradient(135deg,#2f8bf0,#1257ad);',
    'box-shadow:0 8px 26px -8px rgba(26,111,212,.95);opacity:.96;}',
    '#gxust-app-sync:active{transform:scale(.94);}',
    '#gxust-app-sync.ok{background:linear-gradient(135deg,#22c55e,#15803d);}',
    '#gxust-app-sync.err{background:linear-gradient(135deg,#ef4444,#b91c1c);}',
    '#gxust-app-toast{position:fixed;right:16px;bottom:142px;z-index:2147483647;',
    'max-width:78vw;padding:10px 15px;border-radius:12px;',
    'background:rgba(20,24,30,.94);color:#fff;font-size:13px;line-height:1.5;',
    'font-family:-apple-system,sans-serif;opacity:0;transition:opacity .22s ease;',
    'pointer-events:none;white-space:pre-wrap;}',
    '#gxust-app-toast.show{opacity:1;}'
  ].join('');
  (document.head || document.documentElement).appendChild(style);

  var btn = document.createElement('button');
  btn.id = 'gxust-app-sync';
  btn.textContent = '同步课表';

  var toast = document.createElement('div');
  toast.id = 'gxust-app-toast';

  var timer = null;
  function tip(msg, sticky) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(timer);
    if (!sticky) timer = setTimeout(function () { toast.classList.remove('show'); }, 3000);
  }

  function setBtn(text, cls) {
    btn.textContent = text;
    btn.className = cls || '';
  }

  function term() {
    var xnm = '', xqm = '';
    var e1 = document.querySelector('#xnm');
    var e2 = document.querySelector('#xqm');
    if (e1 && e1.value) xnm = e1.value;
    if (e2 && e2.value) xqm = e2.value;

    // 页面选择器没就绪时，从地址栏参数读（正方课表页 URL 常带 xnm/xqm）
    if (!xnm || !xqm) {
      try {
        var q = new URLSearchParams(location.search);
        if (!xnm && q.get('xnm')) xnm = q.get('xnm');
        if (!xqm && q.get('xqm')) xqm = q.get('xqm');
      } catch (e) {}
    }

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

  /* 候选学期：主选在前，只在主选返回空时才往后试 */
  function termCandidates() {
    var base = term();
    var out = [{ xnm: base.xnm, xqm: base.xqm }];
    function push(xnm, xqm) {
      if (!xnm || !xqm) return;
      for (var i = 0; i < out.length; i++) {
        if (out[i].xnm === xnm && out[i].xqm === xqm) return;
      }
      out.push({ xnm: xnm, xqm: xqm });
    }
    var y = String(+base.xnm || new Date().getFullYear());
    push(y, '3'); push(y, '12'); push(y, '16');
    push(String(+y - 1), '12'); push(String(+y - 1), '3');
    return out;
  }

  function studentId() {
    var q = new URLSearchParams(location.search);
    var su = q.get('su');
    if (su) return su;
    var el = document.querySelector('#sessionUserKey');
    if (el && el.value) return el.value;
    var m = document.documentElement.innerHTML.match(/su=(\d{6,})/);
    return m ? m[1] : '';
  }

  function requestOnce(t, su) {
    var url = '/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151' + (su ? '&su=' + encodeURIComponent(su) : '');
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'xnm=' + t.xnm + '&xqm=' + t.xqm
    }).then(function (r) {
      if (r.status === 302 || r.redirected) throw new Error('登录已失效，请重新登录');
      return r.text();
    }).then(function (text) {
      var data;
      try { data = JSON.parse(text); }
      catch (e) { throw new Error('返回的不是课表数据，请确认停在课表页面'); }
      return data;
    });
  }

  function grab() {
    var su = studentId();
    var cands = termCandidates();
    var idx = 0;
    var used = null;

    function step() {
      if (idx >= cands.length) return Promise.resolve(null);
      var t = cands[idx++];
      return requestOnce(t, su).then(function (data) {
        var list = data.kbList || [];
        if (list.length) { used = { t: t, data: data }; return used; }
        return step();          // 这个学期没课，换下一个候选
      });
    }

    return step().then(function (hit) {
      if (!hit) {
        throw new Error('教务系统返回的课表为空（试过 ' + cands.length + ' 个学期），请确认已登录且学期选择正确');
      }

      var data = hit.data;
      var kb = data.kbList || [];
      var sjk = (data.sjkList || []).filter(function (x) { return x && x.xqj && x.jcs; });

      var slim = function (k) {
        return { kcmc: k.kcmc, xm: k.xm, cdmc: k.cdmc, xqj: k.xqj, jcs: k.jcs, zcd: k.zcd };
      };

      var payload = 'GXUST-TT-1|' + JSON.stringify({
        kbList: kb.map(slim),
        sjkList: sjk.map(slim),
        xnm: hit.t.xnm,
        xqm: hit.t.xqm
      });

      if (window.GxustNative && window.GxustNative.onResult) {
        window.GxustNative.onResult(payload);
        return kb.length + sjk.length;
      }
      throw new Error('没有连接到 App，请从 App 内打开同步');
    });
  }

  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (btn.className === 'busy') return;

    setBtn('抓取中…', 'busy');
    grab().then(function (n) {
      setBtn('成功 ' + n + ' 条', 'ok');
      tip('已抓到 ' + n + ' 条课程，正在返回课表…');
    }).catch(function (err) {
      setBtn('失败', 'err');
      var msg = err && err.message ? err.message : String(err);
      tip('同步失败：' + msg, true);
      if (window.GxustNative && window.GxustNative.onError) {
        window.GxustNative.onError(msg);
      }
      setTimeout(function () { setBtn('同步课表', ''); }, 3600);
    });
  });

  /* ---------- 自动同步 ---------- */
  function isLoginPage() {
    return /login_slogin|login_sso|\/login/i.test(location.href);
  }

  // 登录成功后的页面会自动抓一次，用户不用点按钮
  function autoGrab() {
    if (isLoginPage()) return;
    if (window.__gxustAutoDone) return;
    window.__gxustAutoDone = true;

    setBtn('自动同步中…', 'busy');
    setTimeout(function () {
      grab().then(function (n) {
        setBtn('成功 ' + n + ' 条', 'ok');
        tip('已抓到 ' + n + ' 条课程，正在返回课表…');
      }).catch(function (err) {
        // 自动失败不打扰，留按钮让用户手动重试
        setBtn('同步课表', '');
        window.__gxustAutoDone = false;
        var msg = err && err.message ? err.message : String(err);
        if (!isLoginPage()) tip('自动同步没成功：' + msg, true);
      });
    }, 1000);
  }

  var tries = 0;
  function mount() {
    if (!document.body) {
      if (++tries > 60) return;
      setTimeout(mount, 200);
      return;
    }
    if (document.getElementById('gxust-app-sync')) return;
    document.body.appendChild(btn);
    document.body.appendChild(toast);
    autoGrab();
  }
  mount();
})();
