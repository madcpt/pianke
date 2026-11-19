# 片刻

一个只保留搜索、选集和播放的界面。无首页推荐、弹窗广告、广告 SDK、账号或追踪脚本。纯静态文件，可直接部署到 GitHub Pages。支持两个片源：

- **非凡**（默认）：1080P 高清，搜索/详情经内置 Cloudflare Worker 代理；部分播放域名有地域封锁，会自动回退到 360 源同名影片。
- **欧乐**（备选）：720P，速度快，接口开跨域，开箱即用无需配置。

两个源都支持 iPhone/iPad Safari 的 AirPlay 投屏。

## 使用

搜索片名 → 选择结果 → 播放。在 iPhone/iPad 的 **Safari** 中，播放后点击 **AirPlay 投屏**，并在系统选择器中选择同一 Wi-Fi 下的电视。电视需要支持并启用 Apple AirPlay。网页不会自动连接设备。

Safari 使用原生 HLS，保留真实 HTTPS 视频地址以支持 AirPlay；其他支持 MSE 的浏览器使用本地打包的 hls.js。支持 Remote Playback API 的浏览器会尝试系统的远程播放选择器。不支持通过纯网页发现或控制任意 DLNA 电视；没有实现 Google Cast 接收端。

## 部署 GitHub Pages

将此目录的内容提交到仓库根目录，在 Settings → Pages 中选择 **Deploy from a branch**，`main` / `(root)`，保存。无需构建步骤或后台服务。

本地预览：

```sh
python3 -m http.server 8080
```

打开 `http://localhost:8080`。页面必须通过 HTTP(S) 访问，不能双击以 `file://` 打开。GitHub Pages 使用 HTTPS。

## 启用非凡 1080P 片源（可选）

非凡的采集接口不允许浏览器直接跨域访问，需要一个代理转发；视频 m3u8 地址本身开放 CORS，由浏览器直连，不经过代理。代理只转发搜索和详情的 JSON 请求。

1. 用免费账号登录 [Cloudflare](https://dash.cloudflare.com/)，进入 **Workers & Pages → Create Worker**。
2. 删除默认代码，把本仓库 `worker.js` 的全部内容粘贴进去，点 **Deploy**。
3. 复制部署地址（形如 `https://pianke-proxy.xxx.workers.dev`）。
4. 在网页点击搜索框下方的 **代理设置**，粘贴地址并保存；非凡源即启用。地址只存在浏览器 localStorage，不上传。

如需限制代理只允许自己的站点使用，编辑 `worker.js` 顶部的 `ALLOWED_ORIGIN`。URL 加 `?src=feifan` 可默认进入非凡源，`?src=olevod` 回到欧乐源。

## 访问码（私人分享）

页面带一层访问码门禁，方便把站点当作私人入口分享给朋友：

- **分享链接**：在网址后加 `?k=你的访问码`（例如 `https://madcpt.github.io/pianke/?k=pianke-2026-N8K4`）。朋友点开即自动验证并解锁，验证通过后地址栏里的 `k` 会被移除，避免访问码留在链接里；之后从同一浏览器打开会自动解锁，无需重复输入。
- **手动输入**：没有带码链接时，页面显示解锁框，输入访问码即可进入。
- 如果作为部署者想自己搭一套：在 Cloudflare Worker 的 **Settings → Variables and secrets** 里新增一个 Secret 变量 `INVITE_CODE`，值为你的访问码；`worker.js` 会读取它校验每个请求。真码只存在 Worker 的 Secret 里，**不要写进公开仓库的代码**。留空 `INVITE_CODE` 则门禁关闭（便于本地调试）。

这是轻量级的分享控制，能挡住只有网站地址的普通访客；它不能防止拿到专属链接的人再转发。视频流直连源站，门禁只作用于数据请求（搜索/详情），不影响播放速度。

## 数据和兼容性

- 欧乐：搜索与详情直接请求其公开接口 `https://api.olelive.com`，未发送用户身份或 Cookie。
- 非凡：搜索与详情经自建 Cloudflare Worker 转发苹果 CMS V10 公开接口 `https://cj.ffzyapi.com`；播放地址与海报由浏览器直连源站。多集/多线路自动解析，优先选择 m3u8 线路。
- 欧乐接口返回的公开视频地址由浏览器/电视直接拉取；不经开发电脑转发。
- 接口每日数据编码与请求时间戳在 `api.js` 中处理。不请求首页推荐、广告接口，不嵌入原站页面或执行原站脚本。
- 不提供登录或 VIP 解锁；会员片源显示为不可选。网站界面无广告；无法保证源视频本身不含嵌入广告。
- 欧乐并未提供稳定性承诺；接口、跨域策略、源站连接和电视格式支持可能变化。“重新加载”会重新获取片源并尝试保留进度。
- 仅搜索结果显示时请求片源海报。查询保存在当前 URL 的 `q` 参数，未写入本地历史。

## 第三方组件

`vendor/crypto-js.js`：CryptoJS 4.2.0，MIT；`vendor/hls.min.js`：版本见文件头，Apache-2.0。许可证随文件提供，第三方组件全部本地加载，无外部脚本 CDN。

## 验证

`npm run check` 检查语法；`npm test` 测试请求编码、日期边界、数据解码、URL 约束和非凡线路解析（优先 m3u8、多集、非 HTTPS 过滤）。真实搜索和播放需网络连接；非凡需先配置代理。AirPlay 端到端测试需要用户在真实 iPhone 的系统选择器中选择电视。
