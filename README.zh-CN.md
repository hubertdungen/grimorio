[English](README.md) · [Português](README.pt.md) · [Español](README.es.md) · [Deutsch](README.de.md) · **简体中文**

# Grimório

**构筑、测试你的万智牌（Magic: The Gathering）套牌，再让它们上场一较高下——建议都附带理由，还有真正的 AI 对 AI 对局。**

Grimório 是一款免费的套牌构筑工具，支持所有赛制（指挥官 Commander、摩登 Modern、纯铁 Pauper、标准 Standard、薪传 Legacy……），直接在你自己的电脑上运行。
它综合牌张文字、真实赛事套牌、EDHREC 数据和 Commander Spellbook 的组合技来推荐卡牌，*并告诉你为什么推荐*；
它还会用开源的 [Forge](https://github.com/Card-Forge/forge) 规则引擎让你的套牌和其他套牌对战，
你可以观看对局、阅读报告，然后把套牌调得更好。

界面支持 **English**（默认）、**Português**、**Español**、**Deutsch** 和 **简体中文**（设置 › 语言）。

## 安装

**Windows 和 Linux，无需 Docker，也不用架设服务器：** 从
[Releases](https://github.com/hubertdungen/grimorio/releases) 下载安装包，解压后运行 `Grimorio.exe`（Windows）或
`./grimorio`（Linux），浏览器就会自动打开 Grimório。面向所有人的分步指南：**[docs/INSTALL.zh-CN.md](docs/INSTALL.zh-CN.md)**。

第一次启动时，Grimório 会问你“谁来玩？”：每个人用自己的名字创建一个档案，各自的套牌、测试、赛事和评分互不干扰。
一台电脑上的同一份安装可以多人共用。

想把它部署在家用服务器上供多台设备使用，或者参与开发：请看[开发者部署](#开发者部署)。

## 功能

- **全赛制套牌构筑**——合法性检查、各赛制专属目标、法术力基础建议、法术力曲线、预算、分级（bracket）。
- **聪明且有理由的建议**——文本向量（embedding）+ EDHREC + 真实套牌 + 组合技 + 你自己的偏好；边构筑边实时给出。
- **想怎么开始都行**——选 3–10 张牌（或一个指挥官）让它补完整副套牌，也可以手动构筑、导入，或者描述一个思路。
- **导入**：支持 TappedOut、Moxfield、Archidekt、MTGGoldfish、Deckstats、MTGTop8 和 Scryfall——可导入整个用户主页的套牌、
  自定义卡图和封面、备牌和候选区。还能带筛选条件搜索 Archidekt 上的公开套牌。
- **3D 卡牌宇宙**、组合技与协同组件、套牌对比和重复检测。
- **竞技场（Forge AI）**——按真实规则进行 AI 对 AI 对局（Bo1/Bo3、局间智能换备牌、会学习），3–4 人混战和指挥官牌桌，
  可以实时观看的动画牌桌，对局报告和改进建议；还可以在浏览器里亲自对战 Forge（需要用 Docker 的服务器部署）。
- **赛事**——单淘汰、双败淘汰、瑞士轮、联赛和牌桌，实时对阵图、领奖台和历史记录。
- **评分**——每副套牌 0–6 星（每个赛制单独计算 Elo，另有独立的休闲评分），数据来自测试、赛事和可选的自动 Arena。
- **档案**——一份安装，多名玩家，每人有自己的套牌。
- **可安装**为手机和平板上的 PWA；触屏友好。

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
| `sim.py`、`build/forge/` | Forge 运行器（Docker 或本地 Java）和 `GrimorioSim` 启动器（精确的对局事件、AI 调整、卡牌 AI 提示） |
| `tournament.py`、`ratings.py` | 赛事和评分 / Arena |
| `deck_import.py`、`ia.py`、`play.py` | 各网站导入器、可选的 AI 服务商、对战 Forge（noVNC，仅限 Docker） |
| `build/` | 数据流水线（Scryfall、向量、UMAP、组合技、衍生物、环境） |
| `web/` | React + Vite 前端 |
| `packaging/` | Windows/Linux 桌面安装包：启动器、打包和数据构建工具 |

## 路线图

- Android 应用——见 [docs/ROADMAP.md](docs/ROADMAP.md)（英文）。
- 不用 Docker 也能亲自对战 Forge（桌面安装包）。

## 致谢与法律声明

卡牌数据和图片：[Scryfall](https://scryfall.com) · 组合技：[Commander Spellbook](https://commanderspellbook.com)
· 环境数据：[EDHREC](https://edhrec.com) 和 [MTGTop8](https://www.mtgtop8.com) · 规则引擎：[Forge](https://github.com/Card-Forge/forge)（GPL-3.0）。

Grimório is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not approved/endorsed
by Wizards. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC.

*Grimório 是依据威世智（Wizards of the Coast）粉丝内容政策（Fan Content Policy）许可的非官方粉丝内容，未经威世智批准或认可。所用素材的部分内容归威世智所有。© Wizards of the Coast LLC。*

## 许可证

[GPL-3.0](LICENSE)——可以自由使用、研究、修改和分享；你发布的修改版本必须以同一许可证继续开源。
