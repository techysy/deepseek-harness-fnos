# 账号登录指南（dsh 界面左下角「登录」）

> 适用反馈：[#17](https://github.com/techysy/deepseek-harness-fnos/issues/17)「左下角的登录好像无法使用」——
> 在 `http://NAS_IP:28000`、fnOS 统一网关或 FN Connect 地址下点「登录」，弹窗
> **「登录失败 · 操作未完成，请重试。」**（带「添加 API Key」「重新登录」按钮），重试永远失败。

## 原因：上游仅支持 `localhost` 来源登录，不是部署缺陷

dsh 的账号登录是标准 OAuth 授权码流程（PKCE）。点击「登录」后：

1. 浏览器把**当前页面地址的 origin** 传给 dsh 服务端作为回调来源；
2. 服务端用它拼出 `redirect_uri`（`<origin>/oauth/callback`），向 DeepSeek 平台发起授权初始化；
3. 你在浏览器弹出的平台授权页完成登录后，平台把浏览器重定向回 `redirect_uri`，dsh 收到授权码换取凭据。

问题卡在两道**白名单**上，且都无法绕过：

| 环节 | 校验 | 结果 |
| --- | --- | --- |
| dsh 服务端 `loginOrigin()` | 回调 origin 必须是 `http://localhost:<端口>` / `http://127.0.0.1:<端口>` / `http://[::1]:<端口>`（上游注释明言 *remote domains and path-based proxies are unsupported*） | 用 `http://192.168.x.x:28000` 或网关地址打开页面时**直接抛协议错误**，弹「登录失败」 |
| DeepSeek 平台 `auth_init` | `redirect_uri` 只接受回环地址（实测非回环地址返回 `50005 PAYLOAD_SCHEMA_MISMATCH`；回环地址正常返回授权页） | 即使给 dsh 打补丁放开第一道校验，平台侧**照样拒绝**，补丁方案不可行 |

上游预期场景是「本机跑 dsh，浏览器开 `http://localhost:端口`」，或通过 **SSH 端口转发**让远端浏览器也以 `localhost` 身份访问。NAS 部署下浏览器与 dsh 必然不同机，所以只要不是从 `localhost` 打开，登录就一定失败——这与信任围栏、代理、账号本身都无关。

## 解决方法一：SSH 隧道登录一次（推荐，走账号订阅额度）

思路：让电脑浏览器以 `http://localhost:28000` 访问 NAS 上的 dsh，登录完成后凭据保存在 NAS 上，之后所有设备直接用。

1. fnOS 开启 SSH（系统设置 → 远程，记下端口，默认 `22`）；
2. 在**电脑**上建隧道（Windows 10/11 自带 `ssh`，PowerShell / CMD 直接执行；macOS / Linux 同理）：
   ```bash
   ssh -L 28000:127.0.0.1:28000 <fnOS用户名>@<NAS_IP>
   ```
   fnOS SSH 端口若改为其他值，加 `-p <端口>`；窗口保持开着即可。
3. 电脑浏览器打开 `http://localhost:28000`，点左下角「登录」——这次浏览器 origin 是 `localhost`，校验全部通过，会正常跳转平台授权页（约 10 分钟内完成）；
4. 授权完成、页面提示成功后即可关闭隧道窗口。

**登录状态是服务端的**：凭据写入 NAS 数据区 `dsh_home/.credentials.yaml`（权限 600）。之后任何设备经 `http://NAS_IP:28000`、统一网关或 FN Connect 打开 dsh，都是已登录状态，无需（也不能）在局域网地址下重复登录。

附带收益：`localhost` 是浏览器安全上下文，**语音输入的麦克风限制同样被解除**（见[语音输入插件兼容指南](dsh-voice-input.md)），录音可直接使用。

## 解决方法二：添加 API Key（无 SSH 条件时）

弹窗里的「添加 API Key」打开的是凭据引导页，直接把 [开放平台](https://platform.deepseek.com) 的 API Key 写入配置——**没有 OAuth 回调环节，局域网地址下可正常操作**。注意两种方式的额度体系不同：账号登录走 App 订阅额度，API Key 按开放平台用量计费。

## 相关

- 上游实现：`deepseek-ai/deepseek-harness` → `packages/credentials/deepseek-account-platform/src/`（`loginOrigin()` / `startSignIn()`）与 `packages/client/ui-settings-account/src/client/`
- 若平台侧未来放开 `redirect_uri` 白名单或提供设备码流程，可重新评估在本项目内做免隧道登录
