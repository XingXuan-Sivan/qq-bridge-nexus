// 主题引导（CSP 友好）：从 localStorage 读出明暗主题写到 <html data-theme>。
// 必须在样式表之前同步执行，否则首屏会闪一下另一套配色——所以 index.html 里用
// 普通 <script src>（非 module、非 defer）放在 <link rel="stylesheet"> 前面。
(function () {
  var theme;
  try {
    var saved = localStorage.getItem('qq-console-theme');
    theme = saved === 'dark' || saved === 'light'
      ? saved
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } catch (error) {
    theme = 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
