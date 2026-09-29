# 官方语音输入插件兼容指南（@deepseek-ai/dsh-experimental-voice-input-bundle）

> 回应一个常见质疑：「封装成飞牛走 FN Connect，基本等于放弃插件的语音能力」。
> **结论相反**：模型准备、插件管理在 fnOS 封装下完整可用；麦克风的关键恰是
> **HTTPS** —— FN Connect 域名（`https://dsh.<FN_ID>.fnos.net`）正是本封装
> 唯一开箱即用的 HTTPS 入口，是语音能力的**最佳入口**而不是牺牲品。
> 局域网 IP 的 HTTP 明文访问受浏览器安全上下文限制禁用麦克风，这是所有
> 自托管 Web 语音方案的共同约束，并非本封装引入（文末给出局域网解法）。

---

## 1. 插件是什么

`@deepseek-ai/dsh-experimental-voice-input-bundle` 是 DeepSeek 官方的**实验性**
语音输入插件（dsh 设置 → 插件 → 官方列表可见），包含 4 个组件：

| 组件 | 作用 |
| --- | --- |
| `dsh-experimental-speech-to-text` | 语音识别框架，可选识别服务提供方 |
| `dsh-experimental-speech-to-text-sensevoice` | 本地 SenseVoice ONNX 转写（托管 sherpa-onnx 子进程，无需 Python / 编译） |
| `dsh-experimental-api-speech-to-text` | 浏览器客户端的鉴权转写 API |
| `dsh-experimental-client-ui-voice-input` | 输入框录音 UI，录音转文字填入会话草稿 |

识别模型为 **SenseVoiceSmall（INT8，约 239 MB；FP32 约 938 MB）** + Silero VAD，
固定修订、SHA-256 校验，首次启用时由 dsh 服务端（NAS 本机）下载。

## 2. 安装

两种方式任选：

1. **dsh 设置页（推荐）**：设置 → 插件 → 官方 → 语音输入 → 启用。版本由 dsh 自动匹配。
2. **28001 管理面板**：`http://NAS_IP:28001/` → 插件管理 → 安装插件，输入
   `@deepseek-ai/dsh-experimental-voice-input-bundle`。面板会**自动钉到已装 dsh
   的相同版本**（该官方作用域的 npm `latest` 标签可能指向 alpha，与运行中的 rc
   不匹配，手动安装时建议显式 `@版本`），默认源失败自动回退 npmmirror。

安装后 dsh 需重启生效；面板的插件表格中官方实验性插件与第三方插件一样可
禁用 / 启用 / 删除（插件导致 dsh 启动崩溃循环时的救急通道）。

> ⚠️ 版本匹配：插件版本应与 dsh 版本一致（如 dsh 0.1.7-rc.1 配插件 0.1.7-rc.1）。

## 3. 模型下载与代理（NAS 侧网络）

下载在**运行 dsh 的机器（NAS）**上进行，浏览器不参与。默认源为
`https://huggingface.co` 与 `https://hf-mirror.com`（并发探测，先响应者优先，
失败自动尝试其他源）。NAS 直连两者都可能 `ECONNRESET`，解决办法按优先级：

1. **配置代理**（推荐）：应用设置 / 安装向导填代理 IP + 端口（写入
   `dsh_home/proxy.conf`），**重启应用**后生效 —— dsh 启动时导出
   `HTTP(S)_PROXY / ALL_PROXY` 并安装为全局 fetch 代理，插件模型下载同样走该
   代理（app.log 出现 `network proxy from proxy.conf: ...` 即已生效）。
2. **手动选择下载源**：插件设置 → 模型下载源 → `HF-Mirror（国内镜像）`，重试准备。
3. **彻底离线**：见第 6 节，PC 下载模型后放入 NAS，配置离线路径，全程不联网。

> 注意：配置代理后必须**重启 dsh 应用**（fnOS 应用设置保存不会自动重启），
> 环境变量才会注入 dsh 进程。

## 4. 麦克风与安全上下文（关键）

浏览器只在**安全上下文**（HTTPS 或 localhost）开放麦克风 API
（`navigator.mediaDevices.getUserMedia`）。实测（Chrome，fnOS 局域网）：

| 入口 | 协议 | `isSecureContext` | 麦克风 | 说明 |
| --- | --- | --- | --- | --- |
| FN Connect（外网） | HTTPS | ✅ true | ✅ 可用 | 开箱即用，推荐 |
| FN Connect（局域网内） | 跳转 `http://NAS_IP:28000` | ❌ false | ❌ | fnOS 局域网直连优化，落回 HTTP |
| 局域网 IP 直连 | HTTP | ❌ false | ❌ | 点击录音提示「当前浏览器不支持录音」 |

局域网内要用麦克风，三选一：

1. **Chrome / Edge 标志位**（最快）：地址栏打开
   `chrome://flags/#unsafely-treat-insecure-origin-as-secure`，填入
   `http://<NAS_IP>:28000`（如 `http://192.168.31.101:28000`），设为 Enabled，
   重启浏览器。之后局域网 HTTP 下录音可用。
2. **走 FN Connect 外网入口**：手机流量 / 外网环境打开
   `https://dsh.<FN_ID>.fnos.net`，HTTPS 下直接可用。需先在 fnOS
   **应用设置 → 访问权限** 里授予 dsh 远程访问权限（FN Connect 子域
   `dsh.<FN_ID>.fnos.net` 已由本封装自动写入信任域）。
3. **外网 HTTPS 反代**：自定义域名 + 有效证书反代 `NAS_IP:28000`（域名加入
   `trusted_hosts.conf` 或安装向导自定义域名）。

> 该限制是浏览器侧的安全策略，服务端无法绕过；上游 dsh 对不支持的浏览器
> 统一提示「当前浏览器不支持录音」，容易误导为浏览器版本问题。

## 5. 资源需求

| 项 | 要求 | 说明 |
| --- | --- | --- |
| 磁盘 | ≥ 1 GB（数据区卷） | 模型 + 运行时 + 下载缓存 |
| 内存 | 加载后约 1 GB（INT8）/ 2 GB（FP32） | 转写时更高，默认闲置 5 分钟释放 |
| CPU | x86 / ARM64 均可 | sherpa-onnx 提供 Linux glibc x64 / arm64 原生包，CPU 推理，默认 2 线程 |
| 首次准备 | 1–10 分钟 | 取决于网络；已校验文件复用，重启 / 禁用后无需重下 |

## 6. 离线部署（免下载源）

模型缓存位于数据区 `dsh_home/speech-to-text/sensevoice/`：
`models/sensevoice-onnx/`（`model.int8.onnx` + `tokens.txt`）与
`models/silero/silero_vad.onnx`。两种免网络方式：

- **预填缓存**：在 PC 下载下方文件并放入上述目录（插件会校验大小与 SHA-256，
  通过即离线就绪）：

  | 文件 | 大小 | SHA-256 |
  | --- | --- | --- |
  | [model.int8.onnx](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx) | 239,233,841 | `c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51` |
  | [tokens.txt](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/tokens.txt) | 315,894 | `f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc` |
  | [silero_vad.onnx](https://huggingface.co/csukuangfj/vad/resolve/fba88cd2e921609e7675c3aaf51e0b9b295da4bc/silero_vad.onnx) | 1,807,522 | `a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28` |

  （FP32 参考权重 `model.onnx` 937,617,178 字节，SHA-256
  `977016bd9c79f9eb343430b5cc305e07ab64d5212dff41b0dcfa1694bee9a8cb`。）

- **任意路径部署**：把模型放到自定义目录，在插件配置里设
  `modelDirectory`（含 ONNX 与 `tokens.txt` 的绝对路径）与 `vadModelPath`
  （Silero ONNX 绝对路径）；显式路径只检查可访问性，文件内容由部署者负责。

## 7. 故障排查

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| 无法下载 tokens.txt / model…：`ECONNRESET` | NAS 直连 HF / hf-mirror 被重置 | 配 `proxy.conf` 并**重启应用**；或手动选 HF-Mirror 重试 |
| 下载慢 / 卡在某文件 | 默认源探测到了慢源 | 手动切换模型下载源后重试；已完成的文件会复用 |
| 点录音提示「当前浏览器不支持录音」 | HTTP 明文页无麦克风权限（非浏览器版本问题） | 见第 4 节：Chrome 标志位 / FN Connect HTTPS |
| FN Connect 打不开（无权限页） | fnOS 侧未授予远程访问 | fnOS 应用设置 → 访问权限 开启 dsh 的 FN Connect 访问 |
| dsh 启动崩溃循环（装了不兼容插件版本） | 插件版本与 dsh 不匹配 | 面板 `:28001` → 插件管理 → 禁用或删除该插件后重装匹配版本 |
| 转写慢 | CPU 推理，默认 2 线程 | 插件配置调 `threads`；或换 INT8 精度 |
