# DSH 使用计时 / Usage timer

<p align="center">
  <img src="icon.svg" width="96" height="96" alt="Usage timer icon" />
</p>

一个 DeepSeek Harness（DSH）插件：**打开 DSH 时自动开始计时，关闭时停止**，记录每一次使用时长，并在左侧栏页面汇总累计时长。

A DSH plugin that times how long the app stays open — every use and the running total — from a left-sidebar page.

## 功能

- **打开即计时**：插件在页面启动时自动开始本次记录；关闭窗口时结束。
- **每次使用记录**：每次打开的开始时间、结束时间与时长。
- **汇总**：累计使用时长、打开次数、平均每次。
- **历史列表**：按天分组，每天显示合计；当前这次实时显示“进行中”。
- **实时秒表**：本次使用卡片每秒刷新。
- **中英文界面**：跟随 DSH 语言，未翻译语言回退英文。
- **本地存储**：所有记录只保存在本机，不上传任何数据。

## 界面

安装启用后，左侧栏的「全局面板图标」区（Plugins、定时任务图标之后）会出现一个时钟图标，名称为「使用计时」。点开后中央页面显示：

1. **本次使用**：本次已用时长、开始时间、计时状态
2. **累计使用**：总时长、打开次数、平均每次
3. **使用记录**：按天分组的历史，每条为 `开始 → 结束` 与该次时长

## 安装

要求：DSH Web / Desktop（bundle 声明 `platform: web`），本机可用 `pnpm`；从 Git 地址安装时还需要 `git`。测试版本：DSH `0.2.2-rc.1`。

### 方式一：Git 仓库地址（推荐）

1. 打开 DSH 左侧栏的 **Plugins**。
2. 点 **Add plugin**（或箭头菜单里的 **Install a third-party plugin**）。
3. 在包名字段填入本仓库地址，例如：
   `https://github.com/CQin04/dsh-usage-timer`
4. 确认后等待安装完成，插件会自动启用。

### 方式二：本地目录

1. 克隆或下载本仓库到本机，例如 `C:\plugins\dsh-usage-timer`。
2. 在 **Add plugin** 中填入该目录的绝对路径（或以 `file:`/`link:` 开头的形式）。
3. 安装并启用。

> 以本地目录（`link:`）方式安装时，DSH 会引用该目录而不是复制文件，请不要在安装后移动或删除它。

### 验证安装

Plugins 列表中会出现 **Usage timer / 使用计时**，其详情页会显示本 README。左侧栏出现时钟图标即表示插件已运行。

## 数据与限制

- 记录保存在 DSH Web GUI 源（origin，例如 `http://127.0.0.1:54970`）的 `localStorage` 中，键名为 `dsh-usage-timer.v1`。
- 数据结构：`{ version: 1, sessions: [{ id, start, end, lastSeen }] }`，时间为毫秒时间戳，`end` 为 `null` 表示仍在计时。
- 计时精度：每 5 秒写入一次心跳；正常关闭时立即写入结束时间。崩溃或强制退出时，下次启动会按最后一次心跳时间补上结束点。
- 已知限制：
  - 每次页面加载（打开窗口或刷新页面）会记为一次使用。
  - 同时打开多个 DSH 窗口时，各窗口分别计时，累计时长可能重复。
  - 窗口没有关闭时（如系统休眠、锁屏），时长仍会继续累计。
  - 最多保留最近 2000 条记录。
  - 清除该站点的本地数据会清空全部记录。

## 项目结构

```
dsh-usage-timer/
├── package.json        # bundle 清单：dsh.bundle.patch、dsh.client、locale/icon 导出
├── cordis.patch.yml    # 向 profile 插入 usage-timer 行
├── index.js            # Host 半边（空实现，仅承载 bundle 与展示元数据）
├── client.js           # 浏览器半边：计时/心跳/记录、侧栏图标、主页面
├── locale/
│   ├── zh.json         # 插件页中文标题与描述（meta.title / meta.description）
│   └── en.json         # 英文标题与描述
├── icon.svg            # 插件图标
├── README.md
└── LICENSE
```

实现要点：

- 客户端模块通过 `window.__ModuleLoader__.load({ id, factory })` 注册，`id` 必须与 `package.json` 的 `name` 一致。
- `client.js` 在 `apply(ctx)` 中：
  - 用 `ctx.locale.register()` 注册界面文案，并 `ctx.locale.bind()` 取翻译函数；
  - 在 `ctx.effect()` 中开启本次使用记录与 5 秒心跳，窗口 `pagehide` / `beforeunload` 与插件清理时收尾；
  - 向 `sidebar.panellist` 注册左侧栏图标（`id: usage-timer`）；
  - 向 `main` 注册同名 `key` 的主页面，二者由 DSH 面板导航自动关联。

## 卸载

在 **Plugins** 中找到 **Usage timer / 使用计时**，关闭开关即可停用；卸载会移除代码，但 `localStorage` 中的历史记录仍在（需要时可在页面清除站点数据）。

## License

[MIT](LICENSE)
