/* 401 门页脚本：这是整页文档而不是控制台片段，所以用普通脚本而非 ES 模块。
   放在 <head> 里先于正文执行——带本地令牌的刷新能抢在首次绘制前跳转（方案 A），
   拿不到令牌时再等 DOM 就绪接上表单（方案 B：登录成功后服务端种 HttpOnly cookie，
   之后刷新由服务端直接 200，不再回门页）。 */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var hash = location.hash || '';
  var manual = params.has('manual');
  var rejected = Boolean(params.get('token'));
  // 控制台里 API 401 会跳到 /?reauth=1：页面 cookie 可能还有效，但页面手里的令牌已经不能用了。
  // 门页据此清掉旧令牌、直接要新的；reauth 留在 URL 里，刷新仍回门页，登录成功后才随 ?token= 一起消失。
  var reauth = params.get('reauth') === '1';
  var notice = rejected && !reauth ? '令牌无效或已更换，请重新输入。'
    : reauth ? '登录状态已失效，请重新输入令牌。' : '';
  var saved = null;
  try { saved = localStorage.getItem('consoleToken'); } catch (e) { /* 隐私模式下不可用 */ }

  if (rejected || reauth) {
    // 旧令牌不能再用：别留着它反复重试。
    try { localStorage.removeItem('consoleToken'); } catch (e) { /* 同上 */ }
    // 失效令牌不留在地址栏与历史记录里；hash 保留，提交时再拼回去。
    // reauth 不抹——抹掉后刷新会被有效 cookie 直接送回控制台，又变成 401 循环。
    if (!reauth) {
      try { history.replaceState({}, '', location.pathname + hash); } catch (e) { /* 忽略 */ }
    }
  } else if (!manual && saved) {
    location.replace('/?token=' + encodeURIComponent(saved) + hash);
    return;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('gateForm');
    var input = document.getElementById('gateToken');
    var error = document.getElementById('gateError');
    if (!form || !input) return;

    if (notice) showError(notice);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = input.value.trim();
      if (!value) { showError('请先填入控制台令牌。'); input.focus(); return; }
      location.replace('/?token=' + encodeURIComponent(value) + hash);
    });
    input.focus();

    function showError(text) {
      if (!error) return;
      error.textContent = text;
      error.hidden = false;
    }
  });
})();
