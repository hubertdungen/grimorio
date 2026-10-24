[English](INSTALL.md) · [Português](INSTALL.pt.md) · [Español](INSTALL.es.md) · [Deutsch](INSTALL.de.md) · **简体中文**

# 安装 Grimório

Grimório 在你自己的电脑上运行：一个小程序负责启动它，你的网页浏览器负责显示界面。你不需要安装 Docker、Java
或其他任何东西，也不需要服务器。运行所需的一切都已经包含在下载包里。

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
5. 会打开一个黑色窗口。第一次运行时它会下载卡牌数据（见[首次启动](#首次启动)），然后浏览器会自动打开 Grimório。

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

4. 浏览器会自动打开 Grimório。使用期间请保持终端开着。

## 首次启动

- Grimório 只需下载一次**卡牌数据**：约 **11 MB**（所有卡牌、组合技、赛事套牌），通常不到一分钟。
  窗口里会显示进度。之后再启动就不用下载任何东西了。
- 浏览器会打开 **http://127.0.0.1:8107**（如果这个端口被占用，就用下一个空闲端口，窗口里会显示地址）。
- Grimório 会问你 **谁来玩？** 输入你的名字，创建你的档案。每个使用这台电脑的人都可以创建自己的档案，
  拥有自己的套牌、测试、赛事和评分，下次启动时选自己的档案即可。
- 在 **设置 › 语言** 中选择语言：English、Português、Español、Deutsch 或 简体中文。

## 再次打开

再次运行 `Grimorio.exe`（Windows）或 `./grimorio`（Linux）即可。如果 Grimório 已经在运行，它只会重新在浏览器中打开。

小贴士：

- 把 **http://127.0.0.1:8107** 加入浏览器书签。
- 在 Chrome 或 Edge 中，可以把它安装成应用（地址栏里的*安装*图标）：它会有自己的窗口和图标。
  不过 Grimório 本身仍然需要在运行（见上一步）。
- 想在同一 Wi-Fi 下的手机或平板上使用，用 `Grimorio.exe --host 0.0.0.0`（Windows，在该文件夹中打开命令提示符运行）
  或 `./grimorio --host 0.0.0.0`（Linux）启动，然后在手机上打开 `http://<你电脑的 IP>:8107`。
  这样你网络里的任何人都能打开它，所以只在家里这么做。

## 关闭 Grimório

**关闭那个黑色窗口**（Windows），或在终端中按 **Ctrl+C**（Linux；直接关闭终端也会让它停止）。
正在进行的对局也会随之停止。你的套牌会随时自动保存：不会丢失任何东西。

## 数据存放位置

| 系统 | 文件夹 |
|---|---|
| Windows | `%LOCALAPPDATA%\Grimorio`（把它粘贴到文件资源管理器的地址栏） |
| Linux | `~/.local/share/grimorio` |

你的套牌、档案、测试、赛事和评分都保存在该文件夹中的 **`grimorio.db`** 里，你自己的套牌封面在 `covers` 里。
要备份的话，复制这两样即可（先关闭 Grimório）。

**备份与云端：** 在 **设置 › 数据与备份** 中可把全部内容导出为一个 `.grimorio` 文件，或连接 Google 云端硬盘、
OneDrive、Dropbox、Syncthing 的文件夹，让两台电脑保持一致（离线可用，联网后同步）。免费方案和 3 步指南：
[备份与云同步](../README.zh-CN.md#备份与云同步)。

## 更新

1. 按上面的方法从 [Releases](https://github.com/hubertdungen/grimorio/releases) 下载新版本。
2. 关闭 Grimório，删除旧的程序文件夹，把新版本解压到原来的位置。
3. 启动它。你的数据会保留（数据在数据文件夹里，不在程序文件夹里）；新版本第一次启动时会下载更新后的卡牌数据（约 11 MB）。

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

**无法使用“出牌”（亲自上桌对战 Forge）。**
这个模式需要用 Docker 的服务器部署（见 [README](../README.zh-CN.md#开发者部署)）。竞技场里的其他功能——测试、赛事、
自动 Arena——在桌面安装包中都能正常使用。

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
自己手动打开窗口中显示的地址（例如 http://127.0.0.1:8107）。

## 卸载

1. 关闭 Grimório。
2. 删除程序文件夹（就是你解压出来的那个）。
3. 如果还想删除你的套牌和档案，删除数据文件夹（见[数据存放位置](#数据存放位置)）。
   此操作无法撤销：如果以后可能还想要这些数据，请先备份 `grimorio.db`。
