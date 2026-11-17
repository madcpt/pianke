# 片刻

一个只保留搜索、选集和播放的欧乐片源界面。无首页推荐、弹窗广告、广告 SDK、账号或追踪脚本。纯静态文件，可直接部署到 GitHub Pages。

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

## 数据和兼容性

- 搜索与详情直接请求欧乐网站使用的公开接口 `https://api.olelive.com`，未发送用户身份或 Cookie。
- 欧乐接口返回的公开视频地址由浏览器/电视直接拉取；不经开发电脑转发。
- 接口每日数据编码与请求时间戳在 `api.js` 中处理。不请求首页推荐、广告接口，不嵌入原站页面或执行原站脚本。
- 不提供登录或 VIP 解锁；会员片源显示为不可选。网站界面无广告；无法保证源视频本身不含嵌入广告。
- 欧乐并未提供稳定性承诺；接口、跨域策略、源站连接和电视格式支持可能变化。“重新加载”会重新获取片源并尝试保留进度。
- 仅搜索结果显示时请求片源海报。查询保存在当前 URL 的 `q` 参数，未写入本地历史。

## 第三方组件

`vendor/crypto-js.js`：CryptoJS 4.2.0，MIT；`vendor/hls.min.js`：版本见文件头，Apache-2.0。许可证随文件提供，第三方组件全部本地加载，无外部脚本 CDN。

## 验证

`npm run check` 检查语法；`npm test` 测试请求编码、日期边界、数据解码和 URL 约束。真实欧乐搜索和播放需网络连接。AirPlay 端到端测试需要用户在真实 iPhone 的系统选择器中选择电视。
