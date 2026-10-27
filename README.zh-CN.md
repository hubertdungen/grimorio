[English](README.md) · [Português](README.pt.md) · [Español](README.es.md) · [Deutsch](README.de.md) · **简体中文**

<p align="center"><img src="web/public/logo.svg" width="112" alt="Grimório"></p>

<h1 align="center">Grimório</h1>

**构筑、测试你的万智牌（Magic: The Gathering）套牌，再让它们上场一较高下——建议都附带理由，有真正的 AI 对 AI 对局，你也可以亲自和 Forge 对战。**

Grimório 是一款免费的套牌构筑工具，支持所有赛制（指挥官 Commander、摩登 Modern、纯铁 Pauper、标准 Standard、薪传 Legacy……），直接在你自己的电脑上运行。
它综合牌张文字、真实赛事套牌、EDHREC 数据和 Commander Spellbook 的组合技来推荐卡牌，*并告诉你为什么推荐*；
它还会用开源的 [Forge](https://github.com/Card-Forge/forge) 规则引擎让你的套牌和其他套牌对战，
你可以观看对局、阅读报告，然后把套牌调得更好。

你也可以亲自上桌：在 Grimório 自己的牌桌上和 Forge 对战，举办带排名的赛事、联赛和锦标赛，还能为好友开设在线房间。

界面支持 **English**（默认）、**Português**、**Español**、**Deutsch** 和 **简体中文**（设置 › 语言）。

## 截图

<table>
<tr><td width="50%"><a href="docs/img/home.jpg"><img src="docs/img/home.jpg" alt="首页"></a><br><sub>首页</sub></td><td width="50%"><a href="docs/img/build.jpg"><img src="docs/img/build.jpg" alt="构筑：任意语言的自然搜索、牌表与建议"></a><br><sub>构筑：任意语言的自然搜索、牌表与建议</sub></td></tr>
<tr><td width="50%"><a href="docs/img/suggestions.jpg"><img src="docs/img/suggestions.jpg" alt="按作用分类的建议、组合技与真实套牌"></a><br><sub>按作用分类的建议、组合技与真实套牌</sub></td><td width="50%"><a href="docs/img/analysis.jpg"><img src="docs/img/analysis.jpg" alt="分析：法术力曲线、颜色、起手概率与套牌如何获胜"></a><br><sub>分析：法术力曲线、颜色、起手概率与套牌如何获胜</sub></td></tr>
<tr><td width="50%"><a href="docs/img/universe.jpg"><img src="docs/img/universe.jpg" alt="宇宙：所有卡牌的 3D 地图"></a><br><sub>宇宙：所有卡牌的 3D 地图</sub></td><td width="50%"><a href="docs/img/library.jpg"><img src="docs/img/library.jpg" alt="牌库：封面、星级、奖杯与对比"></a><br><sub>牌库：封面、星级、奖杯与对比</sub></td></tr>
<tr><td width="50%"><a href="docs/img/game.jpg"><img src="docs/img/game.jpg" alt="竞技场：观看 Forge 用你的套牌对战，堆叠实时显示"></a><br><sub>竞技场：观看 Forge 用你的套牌对战，堆叠实时显示</sub></td><td width="50%"><a href="docs/img/forgeplay.jpg"><img src="docs/img/forgeplay.jpg" alt="在 Grimório 的牌桌上亲自对战 Forge"></a><br><sub>在 Grimório 的牌桌上亲自对战 Forge</sub></td></tr>
<tr><td width="50%"><a href="docs/img/tournament.jpg"><img src="docs/img/tournament.jpg" alt="赛事：实时领奖台、排名与套牌来源标签"></a><br><sub>赛事：实时领奖台、排名与套牌来源标签</sub></td><td width="50%"><a href="docs/img/online.jpg"><img src="docs/img/online.jpg" alt="在线房间：通过公开链接进行单局或赛事"></a><br><sub>在线房间：通过公开链接进行单局或赛事</sub></td></tr>
<tr><td width="50%"><a href="docs/img/ratings.jpg"><img src="docs/img/ratings.jpg" alt="评分：每副套牌的星级与自动 Arena"></a><br><sub>评分：每副套牌的星级与自动 Arena</sub></td><td width="50%"><a href="docs/img/table.jpg"><img src="docs/img/table.jpg" alt="牌桌工具：生命计数器、3D 骰子与识卡扫描"></a><br><sub>牌桌工具：生命计数器、3D 骰子与识卡扫描</sub></td></tr>
<tr><td width="50%"><a href="docs/img/draft.jpg"><img src="docs/img/draft.jpg" alt="轮抽与现开：真实补充包、Forge 机器人，最后打一场锦标赛"></a><br><sub>轮抽与现开：真实补充包、Forge 机器人，最后打一场锦标赛</sub></td><td width="50%"><a href="docs/img/sideboard.jpg"><img src="docs/img/sideboard.jpg" alt="备牌：针对测试中输给的对象的应对牌"></a><br><sub>备牌：针对测试中输给的对象的应对牌</sub></td></tr>
</table>

## 安装

**Windows 和 Linux：** 从 [Releases](https://github.com/hubertdungen/grimorio/releases) 下载安装包，
解压后运行 `Grimorio.exe`（Windows）或 `./grimorio`（Linux）。在 Windows 上，Grimório 会在自己的应用窗口中打开；
在 Linux 上则在浏览器中打开。面向所有人的分步指南：**[docs/INSTALL.zh-CN.md](docs/INSTALL.zh-CN.md)**。

**更新：** 安装包会自动更新。新版本在后台下载（并用 sha256 校验），下次打开 Grimório 时启用；在设置 › 更新中可以关闭。
你的套牌、对局、赛事和评分保存在应用文件夹之外，每个新版本都会沿用；新版本打开数据库之前，会先把一份副本存到 `backups/`。

第一次启动时，Grimório 会问你“谁来玩？”：每个人用自己的名字创建一个档案，各自的套牌、测试、赛事和评分互不干扰。
一台电脑上的同一份安装可以多人共用。

想把它部署在家用服务器上供多台设备使用，或者参与开发：请看[开发者部署](#开发者部署)。

## 部署在你自己的 Linux 服务器上（Docker）

把 Grimório 装在家里的服务器上（迷你主机、旧笔记本、装 Linux 的 NAS），家里所有手机、平板和电脑都能打开。
竞技场在 **Docker** 中运行 Forge，*与 Forge 对战* 可直接在浏览器中进行。在 Ubuntu 24.04 上开发（其他较新的 Debian/Ubuntu 应该也可以）；
对局需要约 4 GB 可用内存和约 3 GB 磁盘。

```bash
# 1. Git, Python, Node.js 22 and Docker
sudo apt update && sudo apt install -y git python3 bzip2 curl unzip
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER   # 然后注销并重新登录

# 2. Grimório
git clone https://github.com/hubertdungen/grimorio.git && cd grimorio
D=~/.local/share/grimorio && mkdir -p $D/forge

# 3. Forge 2.0.15 (规则引擎)
curl -L https://github.com/Card-Forge/forge/releases/download/forge-2.0.15/forge-installer-2.0.15.tar.bz2 | tar -xj -C $D/forge

# 4. 卡牌数据：直接使用最新版本中做好的（或用 build/build.sh 自己构建，约 45 分钟）
curl -L -o /tmp/grimorio-data.zip https://github.com/hubertdungen/grimorio/releases/latest/download/grimorio-data.zip
unzip -o /tmp/grimorio-data.zip -d $D

# 5. 构建网页应用并安装到 ~/.local/share/grimorio/app
(cd web && npm ci) && ./deploy.sh

# 6. 启动后，在家里任意设备上打开 http://服务器IP:8107
python3 $D/app/server.py --host 0.0.0.0 --port 8107
```

**随服务器启动**（systemd 用户服务）：

```ini
# ~/.config/systemd/user/grimorio.service
[Unit]
Description=Grimório
After=network-online.target

[Service]
ExecStart=/usr/bin/python3 %h/.local/share/grimorio/app/server.py --host 0.0.0.0 --port 8107
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload && systemctl --user enable --now grimorio
sudo loginctl enable-linger $USER   # 注销后仍保持运行
```

- **谁在玩：** 默认每个人选择或创建一个档案（“谁在玩？”）。只有一个用户时，加上 `--owner 你的名字`。
- **在外面访问：** 不要直接把 8107 端口开放到互联网。请放在登录之后（如 Caddy + Authelia 反向代理、带 Access 的
  Cloudflare Tunnel 或 Tailscale）；登录用户通过 `Remote-User` 头传入，每个人都有自己的套牌。
- **更新：** `cd grimorio && git pull && ./deploy.sh`，然后 `systemctl --user restart grimorio`。
- **备份：** 见下一节。

## 备份与云同步

你创建的一切都保存在自己的安装中（数据文件夹里的 `grimorio.db`）。有两种可选、免费的保存方式，都在
**设置 › 数据与备份**：

- **全部导出**：下载一个 `.grimorio` 文件（套牌、档案、测试、赛事、投注、评分以及你的套牌封面）。**导入**可以恢复：
  默认*合并*（不会丢失任何内容，每副套牌保留最新版本），也可以*全部替换*；导入前总会先把当前数据另存一份
  （`grimorio.db.before-import-…`）。
- **与云端文件夹同步**：借助任何能同步文件夹的免费应用，让多台电脑保持一致。Grimório 始终使用本地副本，因此离线也能
  用（比如在飞机上）：联网后由同步应用上传和下载更改。每台电脑只在该文件夹里写自己的文件，并合并其他电脑的文件。

| 免费应用 | 免费空间 | 账号 | Windows / macOS / Linux / Android |
|---|---|---|---|
| Google 云端硬盘电脑版 | 15 GB（与 Gmail 共用） | Google | ✓ / ✓ / —（请用 Syncthing 或 Nextcloud） / 应用 |
| OneDrive | 5 GB | Microsoft | ✓（系统自带） / ✓ / 非官方客户端 / 应用 |
| Dropbox | 2 GB | Dropbox | ✓ / ✓ / ✓ / 应用 |
| Syncthing | 不限（无云端：设备之间直接同步） | 无需 | ✓ / ✓ / ✓ / Syncthing-Fork |
| Nextcloud | 取决于服务商，或使用你自己的服务器 | Nextcloud | ✓ / ✓ / ✓ / 应用 |
| iCloud 云盘 | 5 GB | Apple | Windows 版 iCloud / ✓ / — / — |

**Google 云端硬盘 3 步。** 1）安装 *Google 云端硬盘电脑版* 并登录（Windows 上会出现 `G:` 盘和 *My Drive*）。
2）在 Grimório 中：设置 › 数据与备份 › 勾选 *与云端文件夹同步*，选择建议的 *Google Drive*（`G:\My Drive\Grimorio`），
点击 *使用此文件夹*。3）在另一台电脑上使用同一个 Google 账号和同一个文件夹。完成。

**Syncthing 3 步**（无需账号，数据不经过任何云）。1）在两台设备上安装 Syncthing（[syncthing.net](https://syncthing.net)；
Android：*Syncthing-Fork*）。2）互相添加设备并共享一个文件夹，例如 `~/Sync/Grimorio`。3）在两边的 Grimório 中选择这个
文件夹。两台设备同时开机时就会同步。

如果同一副套牌在两次同步之间被两台电脑修改，保留最新的版本，另一个会另存为 *「名称 (conflito)」*，任何版本都不会
丢失。进行中的赛事到达另一台电脑时会处于暂停状态（同一时间只由一台电脑进行）。在需要登录的服务器上，每个人只导出和
导入自己的数据；云端文件夹同步适用于个人电脑和单一所有者的服务器。

## 功能

- **全赛制套牌构筑**——合法性检查、各赛制专属目标、法术力基础建议、法术力曲线、预算、分级（bracket）。
- **聪明且有理由的建议**——文本向量（embedding）+ EDHREC + 真实套牌 + 组合技 + 你自己的偏好；边构筑边实时给出。
- **想怎么开始都行**——选 3–10 张牌（或一个指挥官）让它补完整副套牌，也可以手动构筑、导入，或者描述一个思路。
- **导入**：支持 TappedOut、Moxfield、Archidekt、MTGGoldfish、Deckstats、MTGTop8 和 Scryfall——可导入整个用户主页的套牌
  （作为你的套牌、社区套牌或好友套牌）、自定义卡图和封面、备牌和候选区。还能带筛选条件搜索 Archidekt 上的公开套牌。
- **用任意语言自然搜索**——“带 +1/+1 指示物的传奇人类生物”“抽牌的地”“lands that draw cards”“terrenos que compram cartas”，
  或 Scryfall 语法（`t:`、`o:`、`mv<=`）；重音符号可有可无；35 种以上卡牌作用（移除、抽牌、磨牌、直伤、闪烁、stax…）可供筛选。
- **分析面板**——关键数字、按生物与其他牌拆分的法术力曲线、颜色饼图（费用需要 vs. 地产出）、起手概率、套牌如何获胜与如何
  落败、备牌能否应对击败你的牌、实战中带来胜利或卡手的牌，每个数字都有 ⓘ 说明。
- **3D 卡牌宇宙**——按作用划分的区域显示你的套牌缺什么，每张牌在实战中的表现及替换建议，环境原型星座，
  以及用套索圈出任意区域找出其中最好的牌。
- **组合技与协同组件**、套牌对比和重复检测。
- **AI 助手（可选）**——支持多家服务商的密钥，自动识别最新模型；一键直接修改你的套牌（换牌、调整数量、任意卡牌的替代品）。
- **竞技场（Forge AI）**——按真实规则进行 AI 对 AI 对局（Bo1/Bo3、局间智能换备牌、会学习），3–4 人混战和指挥官牌桌，
  实时显示堆叠的动画牌桌，对局报告和改进建议。
- **亲自对战 Forge**——Grimório 自己的牌桌：单击拿起一张牌，拖到牌桌上即可使用（或双击；只有付得起的牌会亮起），
  鼠标划过手牌时其他牌会让出位置，T 横置（tap）鼠标下的牌，F 将其翻面；Bo3/Bo5 系列赛，局间可换备牌，还有由你亲自打
  自己套牌对局的赛事；拖动生物来攻击和阻挡，自由摆放你这一侧，堆叠、选择、占卜和牌库搜寻都直接在页面中完成，Enter 让过、Shift+Enter 结束回合。
  可在服务器和桌面安装包中使用（无需 Docker）；指挥官使用经典的 Forge 窗口（需要用 Docker 的服务器）。
- **赛事、联赛和锦标赛**——单淘汰、双败淘汰、瑞士轮、联赛、牌桌、挑战赛（gauntlet）、擂台赛（king of the hill）、
  小组赛 + 淘汰赛以及团队赛；休闲赛可混合或不混合赛制；赛事生成器、实时对阵图、领奖台和历史记录，冠军联赛和领奖台联赛，获胜套牌可得金/银/铜和白金奖杯，
  可选排名或休闲；用游戏金币投注（无需购买，不涉及真钱）。
- **评分与排名**——每副套牌 0–6 星（每个赛制单独计算 Elo，另有独立的休闲评分），白星和奖杯数量，我的 / 好友 / 社区 / 环境 筛选，名人堂和奖杯陈列馆，数据来自测试、赛事和
  可选的自动 Arena。
- **在线与好友**——“在线”标签页可通过公开链接进行单局或赛事（一键免费 Cloudflare 隧道，或使用你自己的域名）：
  打开链接的人带上自己的套牌即可加入，无需账号。好友邀请，好友套牌可作为赛事和 Arena 的来源，并用标签标明每副套牌的来源
  （环境、我的、好友、社区）。
- **📖 规则库**——任意语言的关键词、规则或卡名（也可用相机）：完整规则、官方裁定和可选的 AI 解释。
  在任何界面中，加粗的机制名称在鼠标悬停时显示规则，并可在窗口中打开规则库；法术力符号显示为符号，而不是 {T}。
- **代理卡**——带版本的列表（用于代理卡网站）、图片 ZIP，或按印刷厂要求的可打印 PDF：纸张、边距、卡牌尺寸、间距、出血
  （黑色、指定颜色或延伸卡牌边框）、逐张裁切线、水印和双面。也可以加入套牌会产生的衍生物（自动识别，可设数量）以及 Grimório 推荐的测试牌。
- **牌桌工具**——生命计数器（最多 6 人）、3D 骰子，以及带瞄准框的识卡扫描（相机；在手机和平板上以全屏打开相机）。
- **默认机器人**——为你的套牌和对手分别选择实验室、赛事和 Arena 中的 Forge AI 配置；顶部栏显示正在进行的内容并可跳转到直播。
- **轮抽与现开**——拆开 160 个系列中任意一个的真实补充包（Forge 自带的补充包）：与 Forge 机器人坐满 8 人一桌轮抽，
  或观看 8 个机器人轮抽，或拆 6 包打现开。机器人各自组好 40 张套牌，你的卡池会变成「构筑」中的限制赛套牌，随后进行
  瑞士轮锦标赛——由 Forge 替你打，或你在 Forge Play 中亲自打。
- **你输给什么**——备牌建议会读取你的测试对局：你总是输给的牌类（生物、坟场、神器……），以及你颜色中 AI 会施放的
  应对牌，环境备牌中常见的排在前面。Forge AI 从不施放的牌会被标出。
- **分析中的套牌评分**——常规、全部对局、目标和休闲星级，附 Elo 和对局数，以及奖杯星级和获得的每个奖杯（点击打开对应赛事）。
- **更聪明的 Forge AI**——Grimório 修正了 Forge 在真实套牌上的失误：按手牌所需颜色出地（包括 fetch 地）、Urza's Saga、
  Heliod + Spike Feeder 组合技、在合适时机使用食物、Maze's End 取胜、风暴套牌（Wish、Manamorphose）、Wrath of the
  Skies、Path to Exile 的目标以及叠加灵气。自动换备牌不会放入 AI 不会施放的牌，也不会换掉 4 张的核心牌。
- **锦标赛直播**——跳到同一对决的下一局（或等待它），你下注的套牌会坐在你这一侧，其他正在进行的赛事显示在投注旁边，一键即达。
- **档案**——一份安装，多名玩家，每人有自己的套牌。
- **可安装**为手机和平板上的 PWA；触屏友好。手机上的直播牌桌可缩放（− / + / 适配），打开 Grimório 时屏幕常亮
  （设置 › 屏幕），全屏保持竖屏。如果网络屏蔽 scryfall.io（单位、学校），卡图会改经你自己的服务器获取（自动，或 设置 › 卡牌图片）；导入套牌（TappedOut, Archidekt）自带的图片也同样如此。

### Grimório 如何学习

你越多地让机器人在竞技场里用你的套牌打牌（测试、赛事和自动 Arena），建议就越准。
每一局都会记录：哪些牌被抓到、被施放，哪些一直卡在手里；每张牌对这副套牌实际致胜手段（伤害、磨牌、中毒、组合技、控制……）
贡献了多少；是什么击败了这副套牌；以及这副套牌的排名（星级）。有了这些，Grimório 会：

- 针对打败你的那些套牌和牌，推荐能应对它们的牌；
- 给出聪明的替换方案——*「把 X 换成 Y」*并附上理由，依据是致胜贡献、使用情况、法术力效率、组合技/协同作用和价格；
- 在局与局之间调整换备牌计划；
- 更新每副套牌的评分。

> **小贴士：** 在相信这些建议之前，先和环境（meta）套牌打几轮 Bo3（或者让自动 Arena 挂一整晚）——
> 每副套牌打 10 局以上是个不错的起点。

## 开发者部署

Linux（已在 Ubuntu 24.04 上测试）、**Python 3.10+**、**Node.js 20+**，对局需要约 4 GB 空闲内存，约 2 GB 磁盘空间。
已安装 **Docker** 时，Forge 在 Docker 中运行（Linux 服务器上的默认方式）；也可以用本地的 **Java 17**
（`GRIMORIO_RUNTIME=local`、`GRIMORIO_JAVA=/path/to/java`）。数据构建在 Docker 中进行。

```bash
git clone https://github.com/hubertdungen/grimorio.git && cd grimorio

# 1. Forge 2.0.15（规则引擎）：从 https://github.com/Card-Forge/forge/releases/tag/forge-2.0.15
#    下载 "forge-installer-2.0.15.tar.bz2"，解压到 ~/.local/share/grimorio/forge
mkdir -p ~/.local/share/grimorio/forge && tar -xjf forge-installer-2.0.15.tar.bz2 -C ~/.local/share/grimorio/forge

# 2. 卡牌数据（Scryfall + Commander Spellbook、向量、3D 地图）。第一次大约需要 45 分钟。
build/build.sh
python3 build/meta_mtgtop8.py --max-decks 400      # 可选：获取近期赛事套牌作为环境数据

# 3. 构建网页应用、编译 Forge 启动器，并安装到 ~/.local/share/grimorio/app
(cd web && npm ci) && ./deploy.sh

# 4. 运行，然后打开 http://localhost:8107
python3 ~/.local/share/grimorio/app/server.py --port 8107
```

选项：`--host`、`--port`、`--data-dir`（或 `GRIMORIO_DATA_DIR`）、`--owner`（或 `GRIMORIO_OWNER`：固定的单一用户）。
不加 `--owner` 时，服务器以档案模式运行；放在登录代理后面时，用户名取自 `Remote-User` 请求头。

Forge 运行方式：`GRIMORIO_RUNTIME=docker|local`（默认：只要有 `docker` 命令就用 docker，Windows 除外）、
`GRIMORIO_JAVA`（java 可执行文件）、`GRIMORIO_FORGE_DIR`（默认 `<data>/forge`）。本地运行方式要求把 Grimório 的
AI 配置和卡牌脚本（`forge-ext/ai`、`forge-ext/cardsfolder`）复制到 Forge 文件夹里；安装包会自动完成这一步。
桌面安装包：`packaging/build.py` 和 `.github/workflows/release.yml`。

## 项目结构

| 路径 | 内容 |
|---|---|
| `server.py` | 基于标准库的 HTTP 服务器：API、套牌（SQLite）、档案、导入、代理 |
| `backup.py` | 导出/导入 `.grimorio` 备份，以及可选的云端文件夹同步（合并规则、评分重算） |
| `sim.py`、`build/forge/` | Forge 运行器（Docker 或本地 Java）和 `GrimorioSim` 启动器（精确的对局事件、AI 调整、卡牌 AI 提示） |
| `tournament.py`、`ratings.py` | 赛事和评分 / Arena |
| `guests.py`、`rooms.py`、`share.py` | 好友与在线：邀请链接与访客模式、在线房间（对局和赛事）、一键公共隧道 |
| `playnet.py`、`build/forge/GrimorioNet.java` | Forge Play：在 Grimório 牌桌上进行你自己的对局所用的 Forge 桥接（状态、提示和选择以 JSON 传递） |
| `rules.py`、`artfolder.py` | 完整规则搜索；来自文件夹（Drive、GitHub）的自定义卡图 |
| `deck_import.py`、`ia.py`、`play.py` | 各网站导入器、可选的 AI 服务商、对战 Forge（noVNC，仅限 Docker） |
| `build/` | 数据流水线（Scryfall、向量、UMAP、组合技、衍生物、环境） |
| `web/` | React + Vite 前端 |
| `packaging/` | Windows/Linux 桌面安装包：启动器（应用窗口、自动更新、数据库备份）、打包和数据构建工具 |

## 路线图

- Android 应用（APK）——见 [docs/ROADMAP.md](docs/ROADMAP.md)（英文）。
- 两个版本：**Grimório Full**（含 Forge Play 和在线对战）和 **Grimório Lite**（其余全部功能，下载更小）。
- 在 Grimório 的牌桌上进行玩家之间的在线对局，并为你和好友举办赛事（与机器人同场或对战机器人）。
- 服务器、桌面应用和手机之间的跨平台互通，桌面应用中的“向家庭网络开放”开关，以及“加入好友的 Grimório”。

## 致谢与法律声明

卡牌数据和图片：[Scryfall](https://scryfall.com) · 组合技：[Commander Spellbook](https://commanderspellbook.com)
· 环境数据：[EDHREC](https://edhrec.com) 和 [MTGTop8](https://www.mtgtop8.com) · 规则引擎：[Forge](https://github.com/Card-Forge/forge)（GPL-3.0）。

Grimório is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not approved/endorsed
by Wizards. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC.

*Grimório 是依据威世智（Wizards of the Coast）粉丝内容政策（Fan Content Policy）许可的非官方粉丝内容，未经威世智批准或认可。所用素材的部分内容归威世智所有。© Wizards of the Coast LLC。*

## 许可证

[GPL-3.0](LICENSE)——可以自由使用、研究、修改和分享；你发布的修改版本必须以同一许可证继续开源。
