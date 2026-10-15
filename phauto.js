// ═══ 内置示例规则（完整参数版）═══
// 匹配域名的页面加载完成后自动执行本脚本，返回播放地址即直接起播。
// 返回值支持的全部写法（详见规则页右上角「帮助」）：
//   return 'https://a.m3u8';                                  // 单个地址
//   return ['https://a.m3u8', { url: 'https://b.m3u8', name: '720P' }]; // 数组
//   return { urls: [...], labels: {...}, headers: {...} };    // 对象
//   return { sources: [{ url: 'https://a.m3u8', name: '1080P' }] };     // 线路列表
//   return null;                                              // 未命中，交给下一条规则
// 播放请求头完全按这里返回的 headers 原样发送（未返回则不带头）；
// 本例末尾给出了完整的请求头调用示例。

// ⓪ 页面判定：仅视频播放页（链接含 view_video.php）执行，首页/
//    列表页等其他页面直接退出，避免无意义的取页与预检请求。
if (location.href.indexOf('view_video.php') < 0) return null;

// ① 宿主端请求拿服务器原始 HTML：等价 okhttp 的裸请求，不带 WebView
//    引擎的移动端 Client Hints 指纹（sec-ch-ua-mobile=?1 / Android，

var html = await R.http(location.href);

// ② 解析原始 HTML 里的 mediaDefinitions（R.jsonAt 直接抠出数组）。
var defs = (html ? R.jsonAt(html, 'mediaDefinitions') : null) || [];

// ③ 兜底一：正则扫原始 HTML 里的 videoUrl（R.matchAll 全部匹配、
//    R.unescape 还原 JSON 转义；注意正则里的 \s 在 JS 字符串中要写 \\s）。
if (!defs.length && html) {
  var found = R.matchAll(html, '"videoUrl"\\s*:\\s*"([^"]+)"');
  if (found.length) {
    defs = [];
    for (var i = 0; i < found.length; i++) {
      defs.push({ format: 'hls', videoUrl: R.unescape(found[i]) });
    }
  }
}

// ④ 兜底二：宿主端请求失败时退回页内内联脚本（WebView 请求可能被
//    站点按移动端下发 m 系，播放稳定性不如①，仅作保底）。
if (!defs.length) {
  defs = R.jsonAt(R.scripts(), 'mediaDefinitions') || [];
}

// ⑤ 归一化为线路列表：每项 { url, name }，name 显示为清晰度标题。
var sources = [];
for (var i = 0; i < defs.length; i++) {
  var d = defs[i];
  if (!d  d.format !== 'hls'  !d.videoUrl) continue;
  var name = d.height ? (d.height + 'P')
           : (d.quality ? (d.quality + 'P') : '清晰度');
  sources.push({ url: d.videoUrl, name: name, height: d.height || 0 });
}
if (!sources.length) return null;   // 未命中：返回 null 或 [] 均可
sources.sort(function (a, b) { return b.height - a.height; });

// ⑥ 起播前预检首选地址：站点会随机下发失效的签名地址（实测这类
//    地址对任何客户端都直接 410，重试无意义），重新请求页面即可
//    拿到新的签名（主机/签名样式可能变化）。探测到 4xx/5xx 就重新
//    取页面重解析，最多重试 10 次；探测失败(-1，网络问题)不阻塞播放。
//    10 次预检仍未通过则放弃本次取址（失效签名强行播放必定失败），
//    提示用户重新加载网页换新签名。进度经 R.progress 显示为页面
//    中央的自消失提示框。
var playHeaders = { 'Referer': R.page };
R.progress('获取成功，预检中');
var MAX_PRECHECK = 10;
for (var attempt = 0; attempt < MAX_PRECHECK && sources.length; attempt++) {
  var status = await R.status(sources[0].url, playHeaders);
  if (status < 0) { R.progress('预检不可用，直接播放'); break; }
  if (status >= 200 && status < 400) { R.progress('预检正常，开始播放'); break; }
  if (attempt === MAX_PRECHECK - 1) {
    R.progress('预检' + MAX_PRECHECK + '次仍未通过，请重新加载网页重试');
    return null;   // 不强行播放：交给用户重载页面取新签名
  }
  R.progress('链接' + status + '错误，重试第' + (attempt + 1) + '次');
  var fresh = await R.http(location.href);
  var defs2 = (fresh ? R.jsonAt(fresh, 'mediaDefinitions') : null) || [];
  var next = [];
  for (var j = 0; j < defs2.length; j++) {
    var d2 = defs2[j];
    if (!d2  d2.format !== 'hls'  !d2.videoUrl) continue;
    var n2 = d2.height ? (d2.height + 'P')
           : (d2.quality ? (d2.quality + 'P') : '清晰度');
    next.push({ url: d2.videoUrl, name: n2, height: d2.height || 0 });
  }
  if (!next.length) break;   // 拿不到新地址：按现有结果返回
  next.sort(function (a, b) { return b.height - a.height; });
  sources = next;
}

// ⑦ 完整返回：sources 线路列表 + labels 标题映射 + headers 播放请求头。
return {
  sources: sources,                 // 按清晰度从高到低
  labels: {
    // 可选：再按"原始 url"指定标题（sources 已带 name 时可省略）。
    // [sources[0].url]: '优先线路',
  },
  headers: {
    // 请求头调用示例：规则返回什么就发什么（此行给出 Referer，
    // 防盗链站点建议显式写；UA / Origin / Cookie 同理按需添加）。
    'Referer': R.page,
    // 'Origin': location.origin,        // 站点校验来源（防盗链）时追加
    // 'Cookie': document.cookie,        // 需要登录态的地址可携带 Cookie
    // 'User-Agent': navigator.userAgent,// 需要时自行给出 UA
  },
};
