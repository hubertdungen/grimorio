[English](INSTALL.md) · [Português](INSTALL.pt.md) · [Español](INSTALL.es.md) · [Deutsch](INSTALL.de.md) · **简体中文**

# 安装 Grimório

Grimório 在你自己的电脑上运行。在 Windows 上，它会在自己的应用窗口中打开；在 Linux 上，由你的网页浏览器显示界面。
运行所需的一切（包括 Java 和 Forge 引擎）都已经包含在下载包里，而且它会自动保持最新。

## 系统要求

- **Windows 10 或 11**（64 位），或 **Linux**（64 位，x86-64：Ubuntu、Mint、Fedora、Debian、Arch……）。
- 至少 **4 GB 内存**（让机器人打很多局时，8 GB 会更从容）。
- 约 **600 MB** 可用磁盘空间。
- 第一次启动时需要**联网**（下载卡牌数据），之后显示卡图和导入套牌时也需要联网。卡图来自 Scryfall；在中国大陆，
  不使用代理时，卡图、部分导入网站以及 GitHub 下载可能会很慢，甚至无法访问。
- 仅 Linux：**Python 3.10 或更高版本**。几乎所有 Linux 都自带；可以用 `python3 --version` 查看。

## Windows

1. 打开 [Releases 页面](https://github.com/hubertdungen/grimorio/releases)，在最新版本的 **Assets** 下面
   下载 **`Grimorio-<version>-windows-x64.zip`**（约 110 MB）。
2. 在 *下载* 文件夹里找到这个文件，**右键单击 › 全部解压缩…**，选一个你记得住的位置，
   比如 `Documents\Grimorio`（即“文档”文件夹）。不要直接在压缩包里运行：它需要身边的所有文件。
3. 打开解压出来的 **Grimorio** 文件夹，双击 **`Grimorio.exe`**。
4. 如果 Windows 提示 *“Windows 已保护你的电脑”*：点击 **更多信息 › 仍要运行**。Grimório 是免费软件，没有使用付费证书签名，
   所以 Windows 暂时还不认识它（见[常见问题](#常见问题)）。
5. Grimório 会在自己的窗口中打开。第一次运行时，它会先下载卡牌数据，然后窗口才出现，通常不到一分钟
   （见[首次启动](#首次启动)）。

这个窗口使用 Microsoft Edge WebView2，Windows 10 和 11 都已自带。如果某台电脑没有它，Grimório 会改在浏览器中打开，
并显示一个小对话框 *“Grimório is running in your browser”*：玩的时候让它留在那里，想关闭 Grimório 时点击 **OK**。
如果你就是想用浏览器，可以用 `Grimorio.exe --browser` 启动（在该文件夹中打开命令提示符运行）。

## Linux

1. 打开 [Releases 页面](https://github.com/hubertdungen/grimorio/releases)，在最新版本的 **Assets** 下面
   下载 **`grimorio-<version>-linux-x64.tar.gz`**（约 100 MB）。
2. 解压。在终端中运行：

   ```bash
   cd ~/Downloads
   tar xzf grimorio-*-linux-x64.tar.gz
   ```

   （如果系统是中文的，下载文件夹可能叫 `~/下载`；也可以在文件管理器里右键单击文件 › *提取到此处*。）
   你会得到一个 `grimorio` 文件夹，可以把它移到任何地方，比如你的主文件夹。
3. 在终端中启动：

   ```bash
   cd grimorio
   ./grimorio
   ```

4. 浏览器会自动打开 Grimório。终端负责让它保持运行，使用期间请不要关闭终端。如果装了 Python 包 `pywebview`
   （`pip install pywebview`），Grimório 会在自己的窗口中打开，而不是在浏览器中。

## 首次启动

- Grimório 只需下载一次**卡牌数据**：约 **11 MB**（所有卡牌、组合技、赛事套牌），通常不到一分钟。
  在 Linux 上，终端里会显示进度；在 Windows 上，下载完成后窗口才会出现。之后再启动就不用下载任何东西了。
- Grimório 运行在 **http://127.0.0.1:8107**（如果这个端口被占用，就用下一个空闲端口：Linux 上终端里、Windows 上日志里会显示地址）。
- Grimório 会问你 **谁来玩？** 输入你的名字，创建你的档案。每个使用这台电脑的人都可以创建自己的档案，
  拥有自己的套牌、测试、赛事和评分，下次启动时选自己的档案即可。
- 在 **设置 › 语言** 中选择语言：English、Português、Español、Deutsch 或 简体中文。

## 再次打开

再次运行 `Grimorio.exe`（Windows）或 `./grimorio`（Linux）即可。如果 Grimório 已经在运行，它只会重新显示出来。
在 Windows 上，可以右键单击 `Grimorio.exe` › *显示更多选项 › 发送到 › 桌面快捷方式*，以后从桌面启动。

小贴士：

- Linux：把 **http://127.0.0.1:8107** 加入浏览器书签。在 Chrome 或 Edge 中，还可以把它安装成应用（地址栏里的*安装*图标），
  让它有自己的窗口和图标；不过 Grimório 本身仍然需要在运行。
- 想在同一 Wi-Fi 下的手机或平板上使用，用 `Grimorio.exe --host 0.0.0.0`（Windows，在该文件夹中打开命令提示符运行）
  或 `./grimorio --host 0.0.0.0`（Linux）启动，然后在手机上打开 `http://<你电脑的 IP>:8107`。
  这样你网络里的任何人都能打开它，所以只在家里这么做。

## 关闭 Grimório

**关闭 Grimório 窗口**（Windows；如果它是在浏览器中打开的，就在小对话框里点击 **OK**），或在终端中按 **Ctrl+C**
（Linux；直接关闭终端也会让它停止）。正在进行的 Forge 对局也会随之停止。你的套牌会随时自动保存：不会丢失任何东西。

## 数据存放位置

| 系统 | 文件夹 |
|---|---|
| Windows | `%LOCALAPPDATA%\Grimorio`（把它粘贴到文件资源管理器的地址栏） |
| Linux | `~/.local/share/grimorio` |

你的套牌、档案、测试、赛事和评分都保存在该文件夹中的 **`grimorio.db`** 里，你自己的套牌封面在 `covers` 里。
这个文件夹和程序文件夹是分开的，所以每个新版本都能原样找到你的数据。要备份的话，复制这两样即可（先关闭 Grimório）。

**备份与云端：** 在 **设置 › 数据与备份** 中可把全部内容导出为一个 `.grimorio` 文件，或连接 Google 云端硬盘、
OneDrive、Dropbox、Syncthing 的文件夹，让两台电脑保持一致（离线可用，联网后同步）。免费方案和 3 步指南：
[备份与云同步](../README.zh-CN.md#备份与云同步)。

## 更新

Grimório 会自动更新。每次启动时，它都会检查 GitHub 上的最新版本。有新版本时，它会在后台把新版本下载到数据文件夹
（`versions\<版本号>`），用 sha256 校验和检查文件，然后在你下次打开 Grimório 时启用。你的快捷方式和原来的
`Grimorio.exe` 照常可用：它们会转交给你手上最新的版本。新版本第一次启动时还会下载更新后的卡牌数据（约 11 MB）。

**设置 › 更新** 中会显示已安装的版本和最新版本。在那里取消勾选 **自动更新**，就会停止自动更新。

手动更新：按上面的方法从 [Releases](https://github.com/hubertdungen/grimorio/releases) 下载新版本，
关闭 Grimório，删除旧的程序文件夹，把新版本解压到原来的位置。

### 换到新版本时

你的数据一直在数据文件夹里（见[数据存放位置](#数据存放位置)），所以每个版本使用的都是同样的套牌、对局、赛事和评分。
新版本只会往数据库里添加内容（新的表或列），已有的一切都会保留。新版本第一次打开数据库之前，会先在数据文件夹里的
`backups` 文件夹中保存一份副本；最多保留最近 3 份。

## 常见问题

**出现“Windows 已保护你的电脑”，或者杀毒软件拦截了 `Grimorio.exe`。**
Grimório 是开源软件，没有使用付费证书签名，所以 SmartScreen 和部分杀毒软件会发出警告，新版本刚发布时尤其如此。
点击 **更多信息 › 仍要运行**。如果杀毒软件把某个文件移进了隔离区（通常是 `jre\bin\java.exe`），请把它恢复，
并把 Grimorio 文件夹加入白名单（排除项），或者重新解压一遍压缩包。源代码是公开的，安装包由 GitHub 根据源代码自动构建。

**窗口提示端口被占用 / Grimório 在另一个地址打开。**
Grimório 使用 8107 端口，被占用时依次尝试下一个空闲端口（最多到 8126），并显示它选中的地址。想自己指定端口：
`Grimorio.exe --port 9000`（Windows 命令提示符）或 `./grimorio --port 9000`（Linux）。

**竞技场里的测试报错，提示 Java 或 Forge 有问题。**
`jre` 和 `forge` 文件夹必须和程序放在一起。重新完整解压 zip/tar.gz（不要只复制 `.exe`），
并检查杀毒软件有没有把 `java.exe` 隔离。

**电脑变得很卡，或者 Forge 对局打到一半失败。**
每局 Forge 对局大约占用 1 GB 内存。进入 **设置**，把 **Forge 同时对局数** 设为 **1**，并关掉其他占资源的程序。
只有 4 GB 内存的话，就设为 1。

**用指挥官套牌时无法“亲自对战 Forge”。**
在 Grimório 牌桌上亲自对战 Forge 在桌面安装包中可以正常使用。指挥官赛制使用经典的 Forge 窗口，这需要用 Docker 的服务器部署
（见 [README](../README.zh-CN.md#部署在你自己的-linux-服务器上docker)）。

**卡牌数据下载失败。**
检查网络连接（以及代理或防火墙设置），然后重新启动 Grimório：它会自动重试。在中国大陆，访问 GitHub 可能较慢或不稳定，
必要时可以使用代理。你也可以从同一个 release 手动下载 `grimorio-data.zip`，再让 Grimório 使用它：Windows 上，
先运行 `set GRIMORIO_DATA_URL=C:\path\to\grimorio-data.zip`，然后在同一个命令提示符窗口里运行 `Grimorio.exe`；Linux 上运行
`GRIMORIO_DATA_URL=~/Downloads/grimorio-data.zip ./grimorio`。

**Linux：提示“Grimório needs Python 3.10 or newer”。**
安装 Python：`sudo apt install python3`（Ubuntu、Debian、Mint）、`sudo dnf install python3`（Fedora）、
`sudo pacman -S python`（Arch）。

**Linux：启动 `./grimorio` 时提示“Permission denied”。**
在该文件夹中运行 `chmod +x grimorio`（有些解压工具会丢失执行权限），然后再试一次。

**浏览器没有打开。**
自己手动打开终端中显示的地址（例如 http://127.0.0.1:8107）。

**Windows：Grimório 打不开，或者出了问题。**
Windows 应用会把它输出的所有信息写入 **`%LOCALAPPDATA%\Grimorio\logs\grimorio.log`**（把文件夹部分粘贴到文件资源管理器的
地址栏）；上一次运行的日志保存为 `grimorio.log.1`。开头几行会显示地址和版本号。求助或报告问题时，请附上这个文件。

## 卸载

1. 关闭 Grimório。
2. 删除程序文件夹（就是你解压出来的那个）。
3. 如果还想删除你的套牌和档案，删除数据文件夹（见[数据存放位置](#数据存放位置)）。
   此操作无法撤销：如果以后可能还想要这些数据，请先备份 `grimorio.db`。
