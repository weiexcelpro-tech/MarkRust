---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: 'd670741b-d4f9-4752-8afc-7dda392235df'
  PropagateID: 'd670741b-d4f9-4752-8afc-7dda392235df'
  ReservedCode1: 'a22429f5-a38e-4a4b-a9bf-c60dd29385f4'
  ReservedCode2: 'a22429f5-a38e-4a4b-a9bf-c60dd29385f4'
---

# ESP32-C3 SuperMini 刷机教程与示例程序

> 面向零基础小白，从开箱到跑通第一个程序，每一步都有详细说明。
> 假设你从来没有接触过单片机、Arduino、Python，也能跟着做。

---

## 目录

- [第一章 认识你的开发板](#第一章-认识你的开发板)
- [第二章 开箱与硬件检查](#第二章-开箱与硬件检查)
- [第三章 查看COM口与驱动安装](#第三章-查看com口与驱动安装)
- [第四章 检查板子基本功能是否正常](#第四章-检查板子基本功能是否正常)
- [第五章 方案一：Arduino IDE 开发（C/C++）](#第五章-方案一arduino-ide-开发cc)
- [第六章 方案二：MicroPython 开发（Python）](#第六章-方案二micropython-开发python)
- [第七章 示例程序集](#第七章-示例程序集)
- [第八章 常见问题与排错大全](#第八章-常见问题与排错大全)
- [第九章 进阶资源](#第九章-进阶资源)

---

## 第一章 认识你的开发板

### 1.1 什么是 ESP32-C3 SuperMini？

ESP32-C3 SuperMini 是一款基于**乐鑫（Espressif）ESP32-C3** 芯片的超小型物联网开发板。你可以把它理解为一个「能连 WiFi 和蓝牙的微型电脑」，虽然体积只有拇指大小（22.52 x 18mm），但却能运行你写的程序，控制外部硬件，连接互联网。

**它适合做什么？**

- 智能家居设备（智能开关、温湿度监控）
- WiFi/蓝牙遥测（远程采集传感器数据）
- 可穿戴设备
- 学习物联网和嵌入式开发

**价格**：通常 10-20 元人民币（裸板），加上一根 Type-C 数据线就能开始玩。

### 1.2 核心参数（你不需要全看懂，仅供参考）

| 项目     | 参数                        | 通俗解释                 |
| ------ | ------------------------- | -------------------- |
| 处理器    | 32 位 RISC-V 单核，最高 160 MHz | 比 Arduino Uno 快几十倍   |
| 内存     | 400 KB SRAM + 384 KB ROM  | 可运行较复杂程序             |
| 闪存     | 4 MB（内置）                  | 存放程序和数据的"硬盘"         |
| WiFi   | 802.11 b/g/n，2.4 GHz      | 能连你家路由器（**不支持5GHz**） |
| 蓝牙     | Bluetooth 5 (LE)          | 能和手机蓝牙通信             |
| GPIO   | 11 个可编程数字 I/O（均支持 PWM）    | 能控制/读取 11 个外部设备      |
| ADC    | 4 个模拟输入通道（12 位精度）         | 能读取模拟传感器（温度、光照等）     |
| 串行接口   | 1x I2C、1x SPI、2x UART     | 和各种模块通信              |
| 板载 LED | 蓝色 LED，连接 GPIO8           | 用来做第一个"点灯"实验         |
| 板载按键   | BOOT 键（GPIO9）、RESET 键     | 刷机和重启用               |
| USB 接口 | Type-C                    | 供电 + 通信一体            |
| 深度睡眠功耗 | 约 43 μA                   | 电池能用很久               |

### 1.3 板子上的东西长什么样？

拿到板子后，你会看到：

```
    ┌─────────────────────────────────────────┐
    │                                         │
    │   [天线]     ESP32-C3 芯片              │
    │             ┌──────────┐                │
    │             │  金属罩  │    [RESET按键] │
    │             │ (主芯片) │                │
    │             └──────────┘    [BOOT按键]  │
    │                                [蓝LED]  │
    │  [Type-C USB接口]                       │
    │                                         │
    └─────────────────────────────────────────┘

    两侧是排针引脚，共 16 个（每边 8 个）
```

你应该能找到以下关键部件：

- **USB Type-C 接口**：板子底边，用于连接电脑
- **金属罩芯片**：ESP32-C3 主芯片 + 4MB Flash
- **天线**：板子顶部，可能是PCB天线或外接天线座
- **RESET 按键**：标注 RST 或 RESET，按下重启板子
- **BOOT 按键**：标注 BOOT 或 B，刷机时用
- **蓝色 LED**：连在 GPIO8 上，程序控制它闪烁

### 1.4 引脚定义

ESP32-C3 SuperMini 有 16 个引脚（每边 8 个），挨着排列如下：

```
          ┌──────────────────┐
          │  ESP32-C3 Super  │
          │      Mini        │
      5V ─┤                  ├─ GND
     3V3 ─┤                  ├─ GPIO0 (ADC0)
   GPIO1 ─┤  (ADC1)          ├─ GPIO2 (ADC2)
   GPIO3 ─┤  (ADC3)          ├─ GPIO4 (RX)
   GPIO5 ─┤  (TX)            ├─ GPIO6
   GPIO7 ─┤                  ├─ GPIO8 (LED / SDA)
   GPIO9 ─┤  (SCL / BOOT)    ├─ GPIO10
          │                  │
          └──────────────────┘
```

**引脚功能速查表：**

| GPIO   | ADC  | 默认功能              | 特殊说明              | 慎用原因                  |
| ------ | ---- | ----------------- | ----------------- | --------------------- |
| GPIO0  | ADC0 | 数字 I/O            |                   |                       |
| GPIO1  | ADC1 | 数字 I/O            |                   |                       |
| GPIO2  | ADC2 | 数字 I/O            | **Strapping Pin** | 启动时如果被外部电路拉低，可能进入错误模式 |
| GPIO3  | ADC3 | 数字 I/O            |                   |                       |
| GPIO4  |      | UART1 RX          | 可做普通 GPIO         |                       |
| GPIO5  |      | UART1 TX          | 可做普通 GPIO         |                       |
| GPIO6  |      | 数字 I/O            |                   |                       |
| GPIO7  |      | 数字 I/O            |                   |                       |
| GPIO8  |      | I2C SDA / 板载 LED  | **Strapping Pin** | 连接LED和使用I2C时需注意启动电平   |
| GPIO9  |      | I2C SCL / BOOT 按键 | **Strapping Pin** | 外接设备可能导致无法启动          |
| GPIO10 |      | 数字 I/O            |                   |                       |

> **什么是 Strapping Pin？** 简单说，ESP32-C3 每次上电（或者按 RESET 后），会"看一眼"这几个引脚的电平状态，来决定自己该进入什么模式（正常运行？还是下载模式？）。如果你在这些引脚上接了东西，上电时恰好把它拉到了低电平，板子可能就不正常了。
> 
> 经验法则：**除非必要，避免在 GPIO8 和 GPIO9 上接外部设备；如果必须接，加上 10K 上拉电阻到 3V3。**

### 1.4 GPIO 避坑指南（必读！）

ESP32-C3 SuperMini 标称"11 个可编程 GPIO"，但实际上**很多引脚有隐形限制**，如果不了解就接线，会踩到各种奇怪的坑——灯不亮、板子无法启动、串口没法用……以下是从新手到老手都会踩的完整避坑表：

#### 完全不能用的引脚

| GPIO | 被谁占用                  | 后果                         |
| ---- | --------------------- | -------------------------- |
| 0    | USB-Serial/JTAG (RxD) | `pinMode()` 无效，电平被 JTAG 驱动 |
| 1    | USB-Serial/JTAG (TxD) | 同上                         |
| 2    | USB-Serial/JTAG (RTS) | 同上                         |
| 3    | USB-Serial/JTAG (CTS) | 同上                         |
| 11   | VDD_SPI（给 Flash 供电）   | 操作可能让 Flash 掉电，板子直接变砖      |
| 12   | SPI Flash (SPIHD)     | QIO 模式下连接 Flash，不能碰        |
| 13   | SPI Flash (SPIWP)     | QIO 模式下连接 Flash，不能碰        |
| 18   | USB D-                | USB 通信专用，接线会断 USB          |
| 19   | USB D+                | USB 通信专用，接线会断 USB          |
| 20   | 未引出                   | 芯片内部使用                     |
| 21   | 未引出                   | 芯片内部使用                     |

> **关于 GPIO0-3**：这 4 个引脚被 USB-Serial/JTAG 外设永久占用，无论 Arduino 还是 MicroPython，`pinMode(3, OUTPUT)` 或 `Pin(3, Pin.OUT)` 都**不会报错**，但 `digitalWrite()` / `value(1)` 完全无效，引脚电平被 JTAG 控制器驱动，你的代码根本抢不过来。这是新手踩得最多的坑。

> **关于 GPIO11**：默认功能是 VDD_SPI（给 Flash 供电），SuperMini 板子已将 Flash 供电改为外部 3.3V，理论上可以通过烧录 eFuse 把 GPIO11 释放出来用，但这是**一次性不可逆操作**，不建议新手尝试。

#### 需要格外小心的引脚（Strapping Pin）

| GPIO | 上电时需要的电平 | 接了外部设备的后果                | 安全做法           |
| ---- | -------- | ------------------------ | -------------- |
| 2    | 高电平      | 上电时被拉低 → 下载模式，板子起不来      | 避免使用，或加 10K 上拉 |
| 8    | 高电平      | 上电时被拉低 → 下载模式；它还是板载蓝灯    | 避免使用，或加 10K 上拉 |
| 9    | 高电平      | 上电时被拉低 → 下载模式；它还是 BOOT 键 | 避免使用，或加 10K 上拉 |

> **实际经验**：GPIO2 虽然是 Strapping Pin，但在 USB-JTAG 模式下和 GPIO0/1/3 一样被占用，基本不可用。GPIO8/9 如果你确实需要用（比如要读 BOOT 键状态），必须确保外接设备不会在上电瞬间把引脚拉低。

#### 可以放心使用的引脚

| GPIO   | 功能说明          | 特殊备注                |
| ------ | ------------- | ------------------- |
| **4**  | 普通数字 I/O，ADC2 | UART1 默认 RX，不用串口就可用 |
| **5**  | 普通数字 I/O，ADC1 | UART1 默认 TX，不用串口就可用 |
| **6**  | 普通数字 I/O      | 无任何复用冲突，最安全         |
| **7**  | 普通数字 I/O      | 无任何复用冲突，最安全         |
| **10** | 普通数字 I/O      | 安全，但部分开发板可能未引出      |

> **推荐**：外接 LED、传感器、按键等设备，优先使用 **GPIO4/5/6/7**，这四个引脚最省心。

#### 一句话总结

```
GPIO 0-3：JTAG 占了，你的代码管不了
GPIO 8/9：Strapping Pin，接错东西板子起不来
GPIO 11-13：Flash 专用，碰了可能变砖
GPIO 18/19：USB 专用，碰了断 USB 连接
GPIO 4/5/6/7：放心用！
```

---

## 第二章 开箱与硬件检查

### 2.1 你需要准备的东西

| 物品                     | 说明                         | 备注               |
| ---------------------- | -------------------------- | ---------------- |
| ESP32-C3 SuperMini 开发板 | 1 块                        | 淘宝/京东搜索即可        |
| USB Type-C 数据线         | **必须能传数据！**                | 这是最容易出问题的一环，详见下文 |
| 电脑                     | Windows / macOS / Linux 均可 | 本文以 Windows 为主   |

### 2.2 关于 USB 数据线——这个坑踩的人最多

**很多 Type-C 线只能充电，不能传数据！**

区分方法：

- 如果线是从充电宝、充电器附带的，大概率**只能充电**
- 如果线是买手机/硬盘/U盘时附带的，通常**能传数据**
- 不确定的话，买线时确认商品描述有「数据传输」或「USB 2.0/3.0」

**如何验证你的线能不能传数据**（后面第三章有更详细的验证步骤）：

1. 用这根线连接开发板和电脑
2. 如果电脑发出「叮咚」的 USB 设备接入提示音，说明能传数据
3. 如果什么反应都没有，换一根线

### 2.3 观察板子外观

在连接电脑之前，先肉眼检查：

1. **芯片有没有歪斜、缺角？** 正常情况下金属罩应该端正地焊在板子上
2. **排针有没有弯折？** 16 个引脚应该整齐排列
3. **有没有明显的烧焦痕迹？** 如果有，联系卖家换货
4. **USB 接口内有没有异物？** 确保没有灰尘或金属碎屑

### 2.4 首次上电观察

用 Type-C 线把板子接到电脑 USB 口，观察：

| 观察项   | 正常表现                    | 异常表现           |
| ----- | ----------------------- | -------------- |
| 电脑提示音 | 发出「叮咚」USB 接入音           | 无反应            |
| 板子指示灯 | 可能看到蓝色 LED 闪一下（取决于出厂固件） | 完全没有灯光         |
| 板子温度  | 常温或微微温热                 | 烫手（可能短路，立即拔掉！） |
| 电脑识别  | 设备管理器出现新设备              | 无任何变化          |

> 如果上电后板子烫手，**立即拔掉 USB 线**，这通常意味着板子短路或损坏，联系卖家换货。

---

## 第三章 查看COM口与驱动安装

### 3.1 什么是 COM 口？

COM 口（串口）是电脑和开发板之间通信的通道。烧录程序、查看输出信息，都要通过 COM 口。你需要知道你的板子用的是哪个 COM 口编号。

### 3.2 Windows 系统查看 COM 口（详细步骤）

**方法一：通过设备管理器（推荐）**

1. **先不要插开发板**，先看一下当前有哪些 COM 口

2. 右键点击桌面上的「此电脑」（或「我的电脑」）图标 → 选择「管理」

3. 在弹出的窗口左侧，点击「设备管理器」
   
   > **⚠️ Windows 11 常见问题：看不到「端口 (COM 和 LPT)」这一项？**
   > 
   > 这是正常的！Windows 11 在**没有任何串口设备**时，会自动隐藏「端口 (COM 和 LPT)」这个分类。
   > 你不需要做任何处理，继续往下操作即可——插上开发板后，这个分类会自动出现。
   > 
   > 如果插上开发板后仍然看不到「端口 (COM 和 LPT)」，请尝试：
   > 
   > - 点击设备管理器菜单栏的「查看」→ 勾选「显示隐藏的设备」，看看是否出现了灰色图标
   > - 检查设备管理器中是否在其他位置出现了新设备（比如「其他设备」或「通用串行总线设备」下有带黄色感叹号的项目）
   > - 参考[第 3.6 节：驱动安装](#36-驱动安装)处理

4. 如果你能看到「端口 (COM 和 LPT)」，展开它，记下现有的 COM 口（可能没有，也可能有 COM1 等）

5. **现在把开发板插上 USB 口**

6. 你应该会听到电脑发出「叮咚」提示音

7. 再次查看——此时「端口 (COM 和 LPT)」分类**应该已经出现**，展开它，**新增的那个就是你的开发板**

8. 可能显示为以下任一名称：
   
   - `USB 串行设备 (COM3)` -- Windows 10/11 自带驱动
   - `USB Serial Device (COM3)`
   - `Silicon Labs CP210x USB to UART Bridge (COM5)` -- CP2102 芯片
   - `WCH CH343 UART Controller (COM4)` -- CH343 芯片

**记下这个 COM 口编号**（如 COM3），后面选择端口时要用。

**方法二：有没有更快捷地打开设备管理器？**

有的：

- 按 `Win + X` 键 → 选择「设备管理器」
- 或者按 `Win + R` → 输入 `devmgmt.msc` → 回车

**方法三：插拔对比法（最笨但最靠谱）**

如果你搞不清哪个 COM 口是开发板：

1. 记下当前所有 COM 口编号
2. 拔掉开发板
3. 看哪个 COM 口消失了
4. 再插上，那个 COM 口又出现了——就是它

### 3.3 macOS 系统查看端口

1. 打开「终端」应用（在「应用程序」→「实用工具」中）

2. 插上开发板前执行：
   
   ```bash
   ls /dev/cu.usb*
   ```

3. 插上开发板后再次执行同样的命令

4. 新出现的设备就是你的开发板，名称类似：
   
   - `/dev/cu.usbmodem1101`（内置 USB）
   - `/dev/cu.usbserial-110`（CP2102）

### 3.4 Linux 系统查看端口

1. 打开终端

2. 插上开发板前执行：
   
   ```bash
   ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
   ```

3. 插上开发板后再次执行

4. 新出现的设备（如 `/dev/ttyUSB0` 或 `/dev/ttyACM0`）就是你的开发板

5. 如果提示权限不足，需要将当前用户加入 dialout 组：
   
   ```bash
   sudo usermod -aG dialout $USER
   ```
   
   然后重新登录

### 3.5 识别不到 COM 口怎么办？

如果你插上开发板，设备管理器**完全没有变化**，按以下顺序排查：

| 排查步骤 | 操作              | 原因                     |
| ---- | --------------- | ---------------------- |
| 1    | 换一根 USB 数据线     | 90%的问题是线只能充电           |
| 2    | 换一个 USB 口       | 前面板 USB 口可能供电不足，用机箱背面的 |
| 3    | 不要用 USB Hub     | Hub 可能供电不够，直连电脑        |
| 4    | 试试另一台电脑         | 排除你电脑 USB 口的问题         |
| 5    | 按一下板子上的 RESET 键 | 有时板子卡在异常状态             |

### 3.6 驱动安装

ESP32-C3 SuperMini 使用**ESP32-C3 芯片内置 USB 接口**，在 Windows 10/11 上通常**自动识别**，无需安装驱动。

但以下情况需要手动处理：

**情况一：设备管理器中显示「JTAG/serial debug unit」而不是 COM 口**

这说明 Windows 把它识别成了调试设备而不是串口。解决方法：

1. 右键「此电脑」→「管理」→「设备管理器」
2. 找到「JTAG/serial debug unit」，一般会在「其他设备」或「通用串行总线设备」下
3. 右键点击它 → 选择「更新驱动程序」
4. 选择「浏览我的电脑以查找驱动程序」
5. 选择「让我从计算机上的可用驱动程序列表中选取」
6. 在列表中选择「USB 串行设备」→ 点击「下一步」
7. 安装完成后，在「端口 (COM 和 LPT)」下应该能看到 COM 口了

**情况二：设备旁有黄色感叹号**

说明驱动有问题。根据开发板使用的 USB 芯片安装对应驱动：

- **CH343 芯片**（查看板子背面是否印有 CH343）：
  
  - 从南京沁恒官网搜索「CH343SER」下载安装
  - 安装后重启电脑

- **CP2102 芯片**（查看板子背面是否印有 CP2102）：
  
  - 从 Silicon Labs 官网搜索「CP210x Universal Windows Driver」下载安装

**情况三：内置 USB 但系统就是不识别**

1. 下载 [Zadig](https://zadig.akeo.ie/) 工具
2. 打开 Zadig → 选项 → 列出所有设备
3. 找到 ESP32 相关设备
4. 将驱动替换为「CDC」或「WinUSB」
5. 重新插拔

---

## 第四章 检查板子基本功能是否正常

> 在开始刷机写代码之前，我们先确认板子的基本功能都是好的。

### 4.1 检查清单总览

| 检查项     | 方法               | 正常结果              |
| ------- | ---------------- | ----------------- |
| USB 通信  | 插电脑看是否识别 COM 口   | 出现 COM 口          |
| 供电      | USB 供电后板子不烫      | 常温或微温             |
| 芯片通信    | 用 esptool 读取芯片信息 | 能读到芯片型号和 Flash 大小 |
| LED     | 上传闪烁程序           | 蓝灯闪烁              |
| 串口输出    | 串口监视器看输出         | 能看到打印信息           |
| BOOT 模式 | 手动进入下载模式         | 能进入下载模式           |

### 4.2 用 esptool 检测芯片——确认板子没坏

这是最可靠的检测方法。esptool 是乐鑫官方的通信工具，能直接和 ESP32-C3 芯片对话。

**第一步：安装 Python**

1. 访问 [Python 官网](https://www.python.org/downloads/) 下载最新版

2. 安装时**务必勾选「Add Python to PATH」**（这个非常重要！）

3. 安装完成后，打开命令提示符（Win+R → 输入 `cmd` → 回车），输入：
   
   ```
   python --version
   ```
   
   应该能看到版本号输出

**第二步：安装 esptool**

在命令提示符中输入：

```
pip install esptool
```

等待安装完成。

**第三步：检测芯片**

1. 把开发板接上 USB 线，确认 COM 口编号（如 COM3）

2. 在命令提示符中输入（**把 COM3 换成你实际的 COM 口**）：
   
   ```
   esptool --chip esp32c3 --port COM3 chip_id
   ```

3. 如果一切正常，你会看到类似输出：
   
   ```
   esptool.py v4.x
   Serial port COM3
   Connecting....
   Chip is ESP32-C3 (revision v0.4)
   Features: WiFi, BLE
   Crystal is 40MHz
   MAC: xx:xx:xx:xx:xx:xx
   Chip ID: 0x00000000
   ```

4. 如果看到上面的信息，**恭喜！板子芯片通信正常！**

**如果卡在 `Connecting....` 不动：**

这说明开发板没有自动进入通信模式。在命令执行的时候：

1. 按住板子上的 **BOOT** 键不要松手
2. 看到 `Connecting....` 变成 `Chip is ESP32-C3` 后松开 BOOT 键
3. 或者：按住 BOOT → 按一下 RESET → 松开 BOOT

### 4.3 检查 Flash 信息

同样用 esptool，输入：

```
esptool --chip esp32c3 --port COM3 flash_id
```

正常输出应包含：

```
Chip is ESP32-C3 (revision v0.4)
...
Flash: 4MB (乐鑫)
```

确认 Flash 显示为 **4MB**。如果不是 4MB，可能是山寨板或型号不对。

### 4.4 手动进入下载模式（刷机模式）

无论用什么软件刷机，都需要板子进入下载模式。ESP32-C3 SuperMini 通常能**自动进入**，但有时需要手动操作。

**手动进入下载模式的步骤：**

1. 确保板子通过 USB 连接着电脑
2. **按住 BOOT 键不要松手**
3. **按一下 RESET 键再松开**（此时仍然按住 BOOT）
4. **松开 BOOT 键**
5. 现在板子就进入了下载模式

**如何确认是否成功进入了下载模式？**

你可以在设备管理器中观察：进入下载模式后，COM 口可能会短暂消失再出现。更直观的判断：在下载模式下，蓝灯通常不闪烁，板子"安静"着等你操作。

> **每次重新上电后，都要重新进入下载模式吗？**
> 不一定。Arduino IDE 上传程序时通常会自动让板子进入下载模式（通过 DTR/RTS 信号）。但有时候自动方式不灵，就需要手动。MicroPython 烧固件时通常需要手动进入。

### 4.5 上传第一个测试程序——LED 闪烁

如果你已经迫不及待想看板子动起来，可以先跳到第五章安装 Arduino IDE，上传 LED 闪烁程序来验证板子是好的。

如果你只想确认板子能工作还不想装 Arduino，可以用 esptool 直接烧一个别人编译好的 `.bin` 固件文件。不过对新手来说，直接走 Arduino IDE 路线更简单。

---

## 第五章 方案一：Arduino IDE 开发（C/C++）

> Arduino IDE 是最经典、社区资源最丰富的 ESP32 开发方式。即使你不会 C/C++，照着示例代码改改也能用。

### 5.1 下载安装 Arduino IDE

**第一步：下载**

- **国外网速快**：访问 [Arduino 官网](https://www.arduino.cc/en/software)，下载 Windows Installer 版本
- **国内网速慢**：访问 [Arduino 中文社区](https://arduino.me/download)，速度更快

**第二步：安装**

1. 双击下载的安装程序（如 `arduino-ide_2.3.2_Windows_64bit.exe`）
2. 如果 Windows 弹出「Windows 已保护你的电脑」，点击「更多信息」→「仍要运行」
3. 接受许可协议
4. 选择安装选项（默认全勾选即可，特别是「Install USB driver」一定要勾选）
5. 选择安装路径（默认即可，记住安装在哪里）
6. 等待安装完成
7. 桌面出现 Arduino IDE 图标

**第三步：启动**

双击桌面 Arduino IDE 图标，第一次启动可能需要十几秒。

### 5.2 添加 ESP32 开发板支持——让 Arduino IDE 认识你的板子

Arduino IDE 默认只支持 Arduino 官方开发板，我们需要告诉它「我要用 ESP32-C3」。

**第一步：添加开发板管理器地址**

1. 打开 Arduino IDE

2. 点击菜单栏的 **「文件」→「首选项」**（英文版是 `File` → `Preferences`）
   
   - 快捷键：`Ctrl + 逗号`（Ctrl+,）

3. 找到 **「附加开发板管理器网址」** 那一栏

4. 在文本框中填入以下地址（如果已有其他地址，用换行或逗号分隔）：
   
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```

5. 点击「确定」

> **国内用户访问慢怎么办？**
> 
> 上面的地址指向 GitHub，国内可能无法访问或很慢。可以换成：
> 
> ```
> https://espressif.github.io/arduino-esp32/package_esp32_index.json
> ```
> 
> 如果还是慢，可以搜「esp32 arduino 离线安装包」下载后手动解压到 Arduino 的 hardware 目录。

**第二步：安装 ESP32 开发板包**

1. 点击菜单 **「工具」→「开发板」→「开发板管理器...」**
   - 快捷方式：左侧边栏的「开发板管理器」图标（像个放大镜下面一排芯片）
2. 在搜索框输入 **`esp32`**
3. 你会看到一个条目：**`esp32 by Espressif Systems`**
4. 点击「安装」按钮
5. **耐心等待**！这个包大约 200-300MB，下载和安装可能需要 5-20 分钟，取决于网速
6. 安装完成后，你会看到「INSTALLED」字样
7. 关闭开发板管理器窗口

> **安装非常慢或失败？**
> 
> - 检查网络，确保能访问 GitHub
> - 尝试使用手机热点
> - 或在网上搜索「esp32 arduino 离线安装」，下载别人打包好的离线包

### 5.3 选择正确的开发板类型

1. 用 USB 线连接开发板和电脑
2. 点击菜单 **「工具」→「开发板」→向下滚动找到「esp32」分组→选择「ESP32C3 Dev Module」**

> **注意**：不是选「ESP32 Dev Module」，也不是选「ESP32C3 SuperMini」（列表里没有这个名字），一定要选 **「ESP32C3 Dev Module」**。
> 
> 列表很长，你可以直接在搜索框输入 `C3` 来快速定位。

### 5.4 选择正确的 COM 口

1. 点击菜单 **「工具」→「端口」**
2. 你会看到类似 `COM3`、`COM4` 的选项
3. 选择你在第三章中确认的 COM 口

> **不确定选哪个？** 参考第三章的「插拔对比法」：拔掉板子看哪个 COM 口消失，再插上看哪个出现。

### 5.5 配置开发板参数——非常重要！

选择好开发板和端口后，还需要确认以下参数。点击 **「工具」** 菜单，逐项设置：

| 菜单项                  | 应该设置的值                  | 为什么这么设                        |
| -------------------- | ----------------------- | ----------------------------- |
| **开发板**              | ESP32C3 Dev Module      | 板子的芯片型号                       |
| **Upload Mode**      | UART0 / Hard-Reset      | 默认即可，烧录方式                     |
| **USB CDC On Boot**  | **Enabled**             | **最关键的设置！** 不开的话串口没有输出        |
| **Flash Mode**       | **DIO**                 | 4MB Flash 只能用 DIO，用 QIO 会无限重启 |
| **Flash Size**       | 4MB                     | SuperMini 的 Flash 容量          |
| **Partition Scheme** | Default 4MB with spiffs | 默认分区方案                        |
| **Upload Speed**     | 921600                  | 上传速度，默认即可                     |
| **CPU Frequency**    | 160 MHz                 | 默认最高频率                        |
| **Port**             | COM3（你的实际端口）            | 必须选对                          |

> **USB CDC On Boot 是什么意思？**
> 
> ESP32-C3 有两种方式通过 USB 输出调试信息：
> 
> - `Disabled`：通过硬件串口（UART）输出，需要接额外的串口模块才能看到
> - `Enabled`：通过 USB 口直接输出，插上 USB 线就能在电脑上看到
> 
> 绝大多数情况下你需要设为 **Enabled**，否则你在 Arduino 串口监视器里什么都看不到。

### 5.6 上传第一个程序——LED 闪烁

**第一步：输入代码**

1. 在 Arduino IDE 的代码编辑区（中间大白框）中，删除默认内容
2. 复制粘贴以下代码：

```cpp
// ESP32-C3 SuperMini 板载 LED 在 GPIO8
// 这个程序让蓝灯每秒闪烁一次，并在串口输出信息

#define LED_PIN 8    // 板载蓝色 LED 连接的引脚编号

void setup() {
  // setup() 函数只在开机时运行一次

  pinMode(LED_PIN, OUTPUT);    // 设置 LED 引脚为输出模式
  Serial.begin(115200);        // 启动串口通信，波特率 115200

  Serial.println("================================");
  Serial.println("  ESP32-C3 SuperMini 已启动!");
  Serial.println("  LED 闪烁程序运行中...");
  Serial.println("================================");
}

void loop() {
  // loop() 函数会不断循环执行

  digitalWrite(LED_PIN, HIGH);   // 点亮 LED（蓝灯亮起）
  Serial.println("LED ON - 蓝灯亮");
  delay(1000);                   // 等待 1000 毫秒 = 1 秒

  digitalWrite(LED_PIN, LOW);    // 熄灭 LED（蓝灯灭掉）
  Serial.println("LED OFF - 蓝灯灭");
  delay(1000);                   // 等待 1 秒
}
```

**第二步：验证代码（编译）**

1. 点击工具栏的 **「验证」按钮**（✓ 对勾图标），或按 `Ctrl+R`

2. IDE 底部的控制台会显示编译进度

3. 如果一切正常，最后会显示类似：
   
   ```
   Sketch uses 198456 bytes (15%) of program storage space.
   Global variables use 39536 bytes (12%) of dynamic memory.
   ```

4. 如果有错误，检查代码是否完整复制、有没有多余的中文标点

**第三步：上传程序**

1. 确认开发板已经通过 USB 连接，COM 口已选择

2. 点击工具栏的 **「上传」按钮**（→ 右箭头图标），或按 `Ctrl+U`

3. IDE 会先编译代码，然后开始上传

4. 上传过程中底部的控制台会显示：
   
   ```
   Compiling sketch...
   ...
   Connecting........_____.....    ← 如果一直卡在这里，看下面
   Writing at 0x00010000... (15%)  ← 出现这个说明正在写入
   ...
   Hash of data verified.
   Leaving...
   Hard resetting via RTS pin...
   ```

5. 看到「Hard resetting」说明上传成功！

> **卡在 `Connecting......` 不动？**
> 
> 这是最常见的问题。解决方法：
> 
> 1. 点击上传按钮后，**立刻按住 BOOT 键**
> 2. 等看到 `Writing at......` 开始写入后，**松开 BOOT 键**
> 3. 如果还是不行：**按住 BOOT → 按一下 RESET → 松开 BOOT**，然后再次点击上传

**第四步：查看运行结果**

1. 上传成功后，板子会自动重启
2. 你应该能看到板子上的蓝色 LED 每秒闪烁一次
3. 打开串口监视器看文字输出：
   - 点击菜单 **「工具」→「串口监视器」**，或按 `Ctrl+Shift+M`
   - 在串口监视器窗口右下角，确认波特率为 **115200**（和代码中 `Serial.begin(115200)` 一致）
   - 你应该看到交替输出 `LED ON - 蓝灯亮` 和 `LED OFF - 蓝灯灭`

> **串口监视器空白？**
> 
> 1. 确认 `USB CDC On Boot` 设为了 `Enabled`（5.5 节）
> 2. 确认波特率是 `115200`
> 3. 试试按一下板子上的 RESET 键
> 4. 如果还是空白，看第八章的详细排错

**恭喜！如果你的 LED 在闪烁、串口有输出，说明你的开发板一切正常，可以继续后面的内容了。**

---

## 第六章 方案二：MicroPython 开发（Python）

> 如果你会 Python 或者想用更简单的方式玩，MicroPython 是最佳选择。不需要编译，写完代码直接运行。

### 6.1 什么是 MicroPython？

MicroPython 是 Python 3 的精简版，专门为微控制器设计。烧入 MicroPython 固件后，你就可以用 Python 语法控制 ESP32-C3，而且代码**即改即跑**，无需编译上传的等待。

### 6.2 安装 Thonny IDE

1. 访问 [Thonny 官网](https://thonny.org/)
2. 下载 Windows 安装包（类似 `thonny-4.1.4.exe`）
3. 双击安装，一路默认即可
4. 启动 Thonny

> **国内下载慢**：可以在清华镜像等平台搜索 Thonny 下载

### 6.3 下载 MicroPython 固件

1. 访问 MicroPython 官方下载页面：
   **https://micropython.org/download/ESP32_GENERIC_C3/**
2. 你会看到一列固件文件，找到最新的稳定版（标记为 `Standard` 或没有 nightly 标记的）
3. 下载 `.bin` 文件，文件名类似 `ESP32_GENERIC_C3-20260101-v1.xx.bin`
4. 记住这个文件保存在哪里（比如「下载」文件夹）

> **注意**：一定要选 **ESP32_GENERIC_C3**，不要选成 ESP32 或 ESP32_S3 的固件，不同芯片的固件不通用！

### 6.4 刷入 MicroPython 固件

**方法一：使用 Thonny 烧录（推荐新手，最简单）**

1. 用 USB 线连接开发板
2. 打开 Thonny
3. 点击菜单 **「运行」→「配置解释器...」**（英文版 `Run` → `Configure interpreter...`）
4. 在「解释器」选项卡中，下拉选择 **「MicroPython (ESP32)」**
5. 点击右下角的 **「安装或更新 MicroPython」** 链接
6. 在弹出的窗口中：
   - **目标端口**：选择你的 COM 口（如 COM3）
   - **Firmware**：点击「浏览...」，选择你下载的 `.bin` 固件文件
   - 勾选 **「Erase flash before installing」**（烧录前擦除Flash）
7. 点击 **「安装」** 按钮
8. 等待进度条走完，显示「Done」
9. 关闭安装窗口

> **Thonny 烧录失败？**
> 
> 如果提示连接失败：
> 
> 1. 先手动进入下载模式（按住 BOOT → 按 RESET → 松开 BOOT）
> 2. 然后再点「安装」
> 3. 如果还是不行，使用方法二（esptool 命令行）

**方法二：使用 esptool 命令行烧录（更可靠）**

1. 确认已安装 Python 和 esptool（第四章 4.2 节有详细步骤）

2. 确认 COM 口编号（如 COM3）

3. 打开命令提示符

4. **先擦除 Flash**（清除出厂固件）：
   
   ```
   esptool --chip esp32c3 --port COM3 erase_flash
   ```
   
   如果卡在 Connecting，按住 BOOT 键直到开始执行

5. 擦除完成后，**烧录 MicroPython 固件**：
   
   ```
   esptool --chip esp32c3 --port COM3 --baud 460800 write_flash -z 0x0 ESP32_GENERIC_C3-xxxxxxxx.bin
   ```
   
   注意：
   
   - 把 `COM3` 换成你的实际 COM 口
   - 把 `ESP32_GENERIC_C3-xxxxxxxx.bin` 换成你实际下载的文件名（如果固件文件不在当前目录，需要写完整路径）

6. 等待烧录完成，显示 `Hash of data verified.`

7. 按一下板子上的 RESET 键

**方法三：使用乐鑫 Flash Download Tool（图形界面，适合不想用命令行的人）**

1. 访问 [乐鑫官网下载页](https://www.espressif.com/zh-hans/support/download/other-tools)
2. 下载「Flash Download Tool」
3. 解压并运行 `flash_download_tool.exe`
4. 第一个界面选择：
   - ChipType: **ESP32-C3**
   - WorkMode: **Develop**
   - LoadMode: **UART**
5. 点击 OK
6. 在第二个界面：
   - 勾选第一行，点击「...」浏览选择固件 `.bin` 文件
   - 地址栏填写 **`0x0`**（不要写其他地址！）
   - 在右侧 SPICOM 下选择你的 COM 口
   - BAUD 选择 460800 或 115200
7. 点击 **「START」** 按钮
8. 等待进度条变绿，显示「FINISH」

### 6.5 在 Thonny 中运行 MicroPython 程序

1. 打开 Thonny

2. 确认右下角状态栏显示 **`MicroPython (ESP32)`** 或类似字样
   
   - 如果显示 `Python 3.x`，说明还没连上开发板
   - 点击右下角的下拉，选择 `MicroPython (ESP32)` 

3. 如果连接成功，Thonny 下方的 Shell 区域会显示：
   
   ```
   MicroPython v1.xx.x on 2026-xx-xx; ESP32C3 module with ESP32C3
   Type "help()" for more information.
   >>>
   ```

4. 你可以直接在 `>>>` 后面输入 Python 代码测试：

```python
>>> print("Hello, ESP32-C3!")
Hello, ESP32-C3!
```

### 6.6 第一个 MicroPython 程序——LED 闪烁

1. 在 Thonny 上方的编辑区输入以下代码：

```python
# ESP32-C3 SuperMini 板载 LED 在 GPIO8
from machine import Pin
import time

# 创建 LED 对象，GPIO8，输出模式
led = Pin(8, Pin.OUT)

print("ESP32-C3 SuperMini LED 闪烁程序启动!")

while True:
    led.value(1)      # 点亮 LED
    print("LED ON")
    time.sleep(1)     # 等 1 秒
    led.value(0)      # 熄灭 LED
    print("LED OFF")
    time.sleep(1)     # 等 1 秒
```

2. 按 **F5** 或点击绿色三角形「运行」按钮
3. 你应该看到蓝灯开始闪烁，Shell 区域交替输出 `LED ON` 和 `LED OFF`

### 6.7 保存程序到开发板——断电不丢失

上面的运行方式是临时性的，断电后程序就没了。要让它上电自动运行：

1. 点击菜单 **「文件」→「另存为...」**
2. 选择 **「MicroPython 设备」**
3. 文件名输入 **`main.py`**（必须是这个名字，上电后会自动运行 main.py）
4. 点击「确定」
5. 断开 USB 线，重新接上，程序会在几秒后自动运行

> **为什么必须是 `main.py`？** 
> MicroPython 启动时会按顺序执行 `boot.py`（如果存在）→ `main.py`（如果存在）。所以把你的主程序命名为 `main.py` 就能实现上电自运行。

### 6.8 Repl 交互测试——逐行执行代码

MicroPython 的一个强大特性是 **REPL（交互式命令行）**，你可以一行一行地执行代码，即时看到结果。

在 Thonny 的 Shell 区域（`>>>` 提示符处），试试这些：

```python
>>> from machine import Pin
>>> led = Pin(8, Pin.OUT)
>>> led.value(1)     # LED 亮了！
>>> led.value(0)     # LED 灭了！
>>> import machine
>>> machine.reset()  # 重启开发板
```

这种「敲一行代码、立刻看到效果」的方式，非常适合学习和调试。

---

## 第七章 示例程序集

> 以下示例同时提供 Arduino（C++）和 MicroPython（Python）两个版本，选择你习惯的即可。

### 7.1 LED 呼吸灯（PWM 调光）

LED 不只是亮和灭，还可以渐亮渐灭，像呼吸一样。这需要用到 PWM（脉冲宽度调制）。

**Arduino 版：**

```cpp
#define LED_PIN 8

void setup() {
  Serial.begin(115200);
  // ESP32-C3 的 LEDC 通道配置
  // 参数：引脚编号, 频率(Hz), 分辨率(位数)
  ledcAttach(LED_PIN, 5000, 8);  // 8位分辨率 → 0~255
  Serial.println("LED 呼吸灯启动!");
}

void loop() {
  // 渐亮：从 0 到 255
  for (int brightness = 0; brightness <= 255; brightness++) {
    ledcWrite(LED_PIN, brightness);
    delay(5);
  }
  // 渐灭：从 255 到 0
  for (int brightness = 255; brightness >= 0; brightness--) {
    ledcWrite(LED_PIN, brightness);
    delay(5);
  }
}
```

**MicroPython 版：**

```python
from machine import Pin, PWM
import time

led = PWM(Pin(8))      # 在 GPIO8 上创建 PWM 对象
led.freq(1000)          # 设置 PWM 频率为 1kHz

while True:
    # 渐亮
    for duty in range(0, 1024, 4):    # 0-1023，步进4
        led.duty(duty)
        time.sleep(0.01)
    # 渐灭
    for duty in range(1023, -1, -4):
        led.duty(duty)
        time.sleep(0.01)
```

---

### 7.2 WiFi 连接（交互式扫描选择）

> 之前的示例需要你手动改代码填写 WiFi 名称和密码，经常因为拼写错误连不上。
> 下面这个版本会**先扫描附近的 WiFi 列表，你在串口监视器里选编号、输密码**，再也不怕打错字了。

**Arduino 版：**

```cpp
#include <WiFi.h>
#include "esp_wifi.h"

// ============ 配置区 ============
#define SERIAL_BAUD   115200
#define SCAN_TIMEOUT  15000      // 等待用户选择WiFi的超时（毫秒）
#define CONNECT_WAIT  20         // 连接等待次数（每次500ms，共10秒）
// ================================

String chosenSSID   = "";
String chosenPass   = "";

// ---------- 工具函数：从串口读取一行 ----------
String readSerialLine(unsigned long timeoutMs = 0) {
  String line = "";
  unsigned long start = millis();
  while (true) {
    if (Serial.available()) {
      char c = Serial.read();
      if (c == '\n' || c == '\r') {
        if (line.length() > 0) break;   // 忽略空行
        continue;
      }
      line += c;
    }
    if (timeoutMs > 0 && (millis() - start) > timeoutMs) {
      Serial.println("\n[超时]");
      return "";
    }
    yield();   // 让出CPU，避免看门狗复位
  }
  line.trim();
  return line;
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(1000);

  Serial.println("================================");
  Serial.println("  ESP32-C3 WiFi 扫描 & 连接");
  Serial.println("================================");

  // ---- 降功率（SuperMini 必备）----
  // SuperMini 板载 PCB 天线在高功率下信号失真，导致握手失败或频繁断连
  // 降到 8.5dBm 后信号更"干净"，反而更稳定
  esp_wifi_set_max_tx_power(WIFI_POWER_8_5dBm);
  Serial.println("WiFi 发射功率: 8.5dBm (SuperMini 降功率模式)");

  // ---- 第1步：扫描 WiFi ----
  Serial.println("\n正在扫描附近 WiFi...");
  WiFi.mode(WIFI_STA);
  int n = WiFi.scanNetworks();

  if (n <= 0) {
    Serial.println("未找到任何 WiFi！请检查天线或重试。");
    return;
  }

  // ---- 第2步：列出 WiFi 列表 ----
  Serial.printf("\n找到 %d 个 WiFi：\n", n);
  Serial.println("────┬────────────────────┬──────┬────────");
  Serial.println("编号│ WiFi 名称          │ 信号 │ 加密");
  Serial.println("────┼────────────────────┼──────┼────────");
  for (int i = 0; i < n; i++) {
    Serial.printf(" %2d │ %-18s │ %4d │ %s\n",
      i + 1,
      WiFi.SSID(i).c_str(),
      WiFi.RSSI(i),
      WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "开放" : "加密"
    );
  }
  Serial.println("────┴────────────────────┴──────┴────────");
  Serial.println("\n⚠️  只能连接 2.4GHz 的 WiFi，5GHz 不支持！");

  // ---- 第3步：等待用户选择 ----
  Serial.printf("\n请输入编号（1-%d），%d 秒内无输入将自动重扫：", n, SCAN_TIMEOUT / 1000);

  String input = readSerialLine(SCAN_TIMEOUT);
  if (input.length() == 0) {
    Serial.println("操作超时，即将重新扫描...");
    WiFi.scanDelete();        // 释放扫描结果内存
    ESP.restart();            // 重启再来
    return;
  }

  int choice = input.toInt();
  if (choice < 1 || choice > n) {
    Serial.printf("无效编号：%s\n", input.c_str());
    return;
  }

  chosenSSID = WiFi.SSID(choice - 1);
  Serial.printf("\n你选择了：[%s]\n", chosenSSID.c_str());

  // 开放网络无需密码
  if (WiFi.encryptionType(choice - 1) == WIFI_AUTH_OPEN) {
    Serial.println("这是开放网络，无需密码。");
    chosenPass = "";
  } else {
    Serial.print("请输入 WiFi 密码：");
    chosenPass = readSerialLine(30000);   // 30秒内输入密码
    if (chosenPass.length() == 0) {
      Serial.println("未输入密码，退出。");
      return;
    }
  }

  // 释放扫描结果（节省约 1KB 内存）
  WiFi.scanDelete();

  // ---- 第4步：连接 WiFi ----
  Serial.printf("\n正在连接 [%s] ", chosenSSID.c_str());
  WiFi.begin(chosenSSID.c_str(), chosenPass.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    attempts++;
    if (attempts > CONNECT_WAIT) {
      Serial.println("\n连接失败！常见原因：");
      Serial.println("  1. 密码输错了");
      Serial.println("  2. 这是 5GHz WiFi（只支持 2.4GHz）");
      Serial.println("  3. 企业/校园网需网页认证（不支持）");
      Serial.println("\n按复位键或重新烧录再试。");
      return;
    }
  }

  Serial.println("\n✓ WiFi 连接成功!");
  Serial.print("  IP 地址: "); Serial.println(WiFi.localIP());
  Serial.print("  信号强度: "); Serial.print(WiFi.RSSI()); Serial.println(" dBm");
}

void loop() {
  // 断线自动重连
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi 断开，正在重连...");
    WiFi.begin(chosenSSID.c_str(), chosenPass.c_str());
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      delay(500);
      Serial.print(".");
      attempts++;
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\n重连成功!");
    }
  }
  delay(10000);
}
```

> **串口操作步骤**：打开串口监视器 → 波特率 115200 → 在输出框看到 WiFi 列表 → 在输入框输入编号回车 → 输入密码回车。
> 如果用 Arduino IDE 的串口监视器，确保右下角换行符选 **"NL 和 CR"**。

**MicroPython 版：**

```python
import network
import time
import ubinascii

# 加密类型对照表
# 0=开放 1=WEP 2=WPA 3=WPA2 4=WPA/WPA2 5=WPA2/WPA3 6=WPA3
SEC_NAMES = {
    0: "开放",
    1: "WEP(不支持)",
    2: "WPA",
    3: "WPA2",
    4: "WPA/WPA2",
    5: "WPA2/WPA3!!",
    6: "WPA3(不支持)",
}

def wifi_scan_and_connect():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)

    # ---- 第1步：扫描 WiFi ----
    print("\n正在扫描附近 WiFi...")
    networks = wlan.scan()

    if not networks:
        print("未找到任何 WiFi！")
        return None

    # 按信号强度排序（最强的排前面）
    networks.sort(key=lambda x: x[3], reverse=True)

    # ---- 第2步：列出 WiFi 列表 ----
    print("\n找到 %d 个 WiFi：" % len(networks))
    print("-" * 72)
    print(" 编号  WiFi 名称                信号  加密类型         BSSID")
    print("-" * 72)
    for i, net in enumerate(networks):
        ssid = str(net[0], 'utf-8')
        rssi = net[3]
        sec_type = net[4]
        sec_name = SEC_NAMES.get(sec_type, "未知(%d)" % sec_type)
        bssid = ubinascii.hexlify(net[1], ':').decode()
        print("  %2d   %-24s %4d  %-16s %s" % (i + 1, ssid, rssi, sec_name, bssid))
    print("-" * 72)
    print("\n!! 只能连接 2.4GHz 的 WiFi，5GHz 不支持！")
    print("!! ESP32-C3 不支持 WPA3，只支持 WPA2-PSK 及以下！")

    # ---- 第3步：等待用户选择 ----
    try:
        choice = input("\n请输入编号（1-%d）：" % len(networks))
        choice = int(choice.strip())
    except (ValueError, EOFError):
        print("输入无效！")
        return None

    if choice < 1 or choice > len(networks):
        print("编号超出范围！")
        return None

    chosen_net = networks[choice - 1]
    chosen_ssid = str(chosen_net[0], 'utf-8')
    chosen_bssid = chosen_net[1]       # bytes, 6字节MAC地址
    chosen_sec = chosen_net[4]
    bssid_str = ubinascii.hexlify(chosen_bssid, ':').decode()

    print("\n你选择了：[%s]" % chosen_ssid)
    print("  BSSID: %s" % bssid_str)
    print("  加密:  %s" % SEC_NAMES.get(chosen_sec, "未知"))

    # 检查是否支持
    if chosen_sec in (1, 6):
        print("\n!! 该加密类型 ESP32-C3 不支持，无法连接！")
        return None
    if chosen_sec == 5:
        print("\n!! 警告：该网络同时支持 WPA3，部分路由器可能强制使用 WPA3。")
        print("   如果连接失败，请在路由器设置中关闭 WPA3，只保留 WPA2-PSK。")

    # 开放网络无需密码
    if chosen_sec == 0:
        print("这是开放网络，无需密码。")
        password = ""
    else:
        password = input("请输入 WiFi 密码：")

    # ---- 第4步：连接 WiFi ----
    # 【关键1】SuperMini 板载 PCB 天线在高功率下信号失真
    # 必须降发射功率到 8dBm，否则握手失败或频繁断连
    try:
        wlan.config(txpower=8)
        print("WiFi 发射功率: 8dBm (SuperMini 降功率模式)")
    except:
        print("注意: 当前固件不支持 txpower 配置，如连接不稳请更新固件")

    # 【关键2】scan() 会占用 WiFi 内部状态机，必须先 disconnect + 等待清理
    # 否则直接 connect 会触发 RuntimeError: Wifi Unknown Error 0x0102
    print("准备连接...")
    wlan.disconnect()
    time.sleep(1)          # 等待 WiFi 内部状态机清理完毕

    # 用 BSSID 精确连接（避免双频同名路由器连错频段）
    print("正在连接 [%s] (BSSID: %s) " % (chosen_ssid, bssid_str), end="")
    wlan.connect(chosen_ssid, password, bssid=chosen_bssid)

    attempts = 0
    while not wlan.isconnected():
        print(".", end="")
        time.sleep(0.5)
        attempts += 1
        if attempts > 40:
            print("\n\n连接失败！请逐一排查：")
            print("  1. 密码是否正确（注意大小写和特殊字符）")
            print("  2. 路由器是否开了 WPA3？如果开了，请在路由器设置中关闭，")
            print("     只保留 WPA2-PSK（也叫 WPA2-Personal）")
            print("  3. 路由器是否开启了 MAC 地址过滤？")
            print("  4. 是否是企业/校园网需要网页认证？")
            print("  5. 试试重启路由器，或用手机开热点测试（设为仅 WPA2）")
            return None

    print("\n\nWiFi 连接成功!")
    cfg = wlan.ifconfig()
    print("  IP 地址:   %s" % cfg[0])
    print("  子网掩码:  %s" % cfg[1])
    print("  网关:      %s" % cfg[2])
    print("  DNS:       %s" % cfg[3])
    return wlan

# 运行
wifi_scan_and_connect()
```

> **MicroPython 注意**：`input()` 需要在 Thonny 的 Shell 窗口中运行，直接在板子上运行会阻塞。
> 如果你在 Thonny 中运行，程序会弹出输入框让你选 WiFi 和输密码，非常方便。
>
> **关键改进点**：
> - 显示**加密类型**（WPA2/WPA3），ESP32-C3 **不支持 WPA3**
> - 显示 **BSSID**（路由器 MAC 地址），可用于区分同名双频路由器的 2.4GHz 和 5GHz
> - 连接时指定 **BSSID** 而非仅靠 SSID，避免双频同名时连错频段
> - **scan 后先 disconnect + sleep(1) 再 connect** — 这是避免 `0x0102` 错误的核心修复
> - 移除了 `wlan.config(pm=...)`（部分固件版本不支持此参数）

---

### 7.3 Web 服务器——手机浏览器控制 LED

> 这是 ESP32 最经典的应用：用手机访问开发板上的网页来控制硬件。
>
> **连不上 WiFi？** 先用 7.2 节的交互式扫描程序确认 WiFi 名称和密码正确，再回来改这里。

**Arduino 版：**

```cpp
#include <WiFi.h>
#include <WebServer.h>

const char* ssid     = "你的WiFi名称";
const char* password = "你的WiFi密码";

WebServer server(80);   // 在 80 端口创建 Web 服务器
#define LED_PIN 8
bool ledState = false;

// 这个 HTML 会被发送到手机浏览器显示
const char htmlPage[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ESP32-C3 LED 控制</title>
  <style>
    body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; background: #f0f0f0; }
    h1 { color: #333; }
    .btn {
      padding: 15px 40px; font-size: 20px; margin: 10px;
      border: none; border-radius: 8px; cursor: pointer;
      text-decoration: none; display: inline-block; color: white;
    }
    .btn-on  { background: #4CAF50; }
    .btn-off { background: #f44336; }
    .status  { font-size: 24px; margin: 20px; color: #333; }
  </style>
</head>
<body>
  <h1>ESP32-C3 SuperMini</h1>
  <h2>手机控制 LED</h2>
  <div class="status">LED 状态: <b>%STATE%</b></div>
  <a href="/on"  class="btn btn-on">开灯</a>
  <a href="/off" class="btn btn-off">关灯</a>
</body>
</html>
)rawliteral";

// 替换 HTML 中的占位符
String getHTML() {
  String html = htmlPage;
  html.replace("%STATE%", ledState ? "开 (ON)" : "关 (OFF)");
  return html;
}

// 处理不同网址的请求
void handleRoot() {          // 访问 / 时
  server.send(200, "text/html", getHTML());
}

void handleOn() {            // 访问 /on 时
  ledState = true;
  digitalWrite(LED_PIN, HIGH);
  server.send(200, "text/html", getHTML());
}

void handleOff() {           // 访问 /off 时
  ledState = false;
  digitalWrite(LED_PIN, LOW);
  server.send(200, "text/html", getHTML());
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // 连接 WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("正在连接 WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi 连接成功!");
  Serial.print("在手机浏览器中打开: http://");
  Serial.println(WiFi.localIP());

  // 注册路由（告诉服务器：什么网址对应什么处理函数）
  server.on("/", handleRoot);     // 首页
  server.on("/on", handleOn);     // 开灯
  server.on("/off", handleOff);   // 关灯
  server.begin();                  // 启动服务器
  Serial.println("Web 服务器已启动!");
}

void loop() {
  server.handleClient();   // 持续监听客户端请求
}
```

**使用方法：**

1. 把代码中的 WiFi 名称和密码改成你自己的
2. 上传程序
3. 打开串口监视器，记下显示的 IP 地址（如 `192.168.1.100`）
4. 确保手机和 ESP32 连的是**同一个 WiFi**
5. 在手机浏览器地址栏输入 `http://192.168.1.100`
6. 你会看到一个网页，点击「开灯」「关灯」按钮就能控制 LED！

---

### 7.4 温湿度传感器（DHT11/DHT22）

**硬件连接：**

```
DHT11/DHT22 模块        ESP32-C3 SuperMini
  VCC  ────────────────  3V3
  GND  ────────────────  GND
  DATA ────────────────  GPIO4（可自选其他 GPIO，但避开 GPIO0-3）
```

**Arduino 版：**

1. 先安装库：`工具` → `管理库` → 搜索 **`DHT sensor library`**（作者 Adafruit）→ 安装（会提示安装依赖，全部选是）

```cpp
#include <DHT.h>

#define DHTPIN 4
#define DHTTYPE DHT11      // 如果你的传感器是 DHT22，改为 DHT22

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);
  dht.begin();
  Serial.println("DHT 温湿度传感器启动...");
  delay(2000);  // 传感器启动需要一点时间
}

void loop() {
  float humidity = dht.readHumidity();       // 读取湿度（%）
  float temperature = dht.readTemperature(); // 读取温度（摄氏度）

  // 检查是否读取失败
  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("读取失败！请检查接线！");
    delay(2000);
    return;
  }

  // 计算体感温度
  float heatIndex = dht.computeHeatIndex(temperature, humidity, false);

  Serial.printf("温度: %.1f°C | 湿度: %.1f%% | 体感: %.1f°C\n",
                temperature, humidity, heatIndex);
  delay(2000);  // 每 2 秒读一次（不要读太快）
}
```

**MicroPython 版：**

```python
import dht
from machine import Pin
import time

sensor = dht.DHT11(Pin(4))   # GPIO4，如果是DHT22改为 dht.DHT22(Pin(4))

while True:
    try:
        sensor.measure()               # 触发测量
        temp = sensor.temperature()     # 读取温度
        hum = sensor.humidity()         # 读取湿度
        print(f"温度: {temp}°C | 湿度: {hum}%")
    except OSError as e:
        print(f"读取失败: {e}")
    time.sleep(2)
```

---

### 7.5 ADC 读取模拟传感器

ESP32-C3 有 4 个 ADC 通道（GPIO0-3），12 位分辨率（0-4095）。

**Arduino 版：**

```cpp
#define ADC_PIN 0  // GPIO0 = ADC0，也可以选 GPIO1/2/3

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);  // 12 位分辨率，读值范围 0-4095
  Serial.println("ADC 模拟传感器读取启动!");
}

void loop() {
  int rawValue = analogRead(ADC_PIN);
  float voltage = rawValue * 3.3 / 4095.0;  // 转换为电压值

  Serial.printf("原始值: %4d  |  电压: %.2fV  |  百分比: %.1f%%\n",
                rawValue, voltage, rawValue / 40.95);
  delay(500);
}
```

**MicroPython 版：**

```python
from machine import ADC, Pin
import time

adc = ADC(Pin(0))         # GPIO0
adc.atten(ADC.ATTN_11DB)  # 允许测量 0-3.3V 全量程

while True:
    raw = adc.read()                # 0-4095
    voltage = raw * 3.3 / 4095     # 转换为电压
    print(f"原始值: {raw:4d} | 电压: {voltage:.2f}V")
    time.sleep(0.5)
```

---

### 7.6 I2C OLED 屏幕显示

**硬件连接：**

```
OLED SSD1306 (128x64)   ESP32-C3 SuperMini
  VCC  ────────────────  3V3
  GND  ────────────────  GND
  SDA  ────────────────  GPIO8
  SCL  ────────────────  GPIO9
```

> 注意：GPIO8 同时是板载 LED，使用 OLED 时 LED 无法正常工作，这是正常现象。

**Arduino 版：**

安装库：`工具` → `管理库` → 搜索安装 **`Adafruit SSD1306`** 和 **`Adafruit GFX Library`**

```cpp
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define I2C_SDA 8
#define I2C_SCL 9

// 创建显示对象（-1 表示没有 RESET 引脚）
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

void setup() {
  Serial.begin(115200);

  // 初始化 I2C 总线
  Wire.begin(I2C_SDA, I2C_SCL);

  // 初始化 OLED，地址 0x3C（最常见）
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED 初始化失败! 请检查接线。");
    while (true);  // 死循环，停止程序
  }

  // 清屏
  display.clearDisplay();

  // 显示文字
  display.setTextSize(2);              // 字号 2（较大）
  display.setTextColor(SSD1306_WHITE); // 白色文字
  display.setCursor(0, 0);            // 光标移到左上角
  display.println("Hello!");
  display.setTextSize(1);              // 字号 1（较小）
  display.println("ESP32-C3");
  display.println("SuperMini");
  display.println("OLED OK!");

  display.display();  // 把缓存的内容实际显示到屏幕上
  Serial.println("OLED 显示成功!");
}

void loop() {
  // 无操作
}
```

**MicroPython 版：**

```python
from machine import I2C, Pin
import ssd1306
import time

# 初始化 I2C
i2c = I2C(0, sda=Pin(8), scl=Pin(9), freq=400000)

# 初始化 OLED
display = ssd1306.SSD1306_I2C(128, 64, i2c)

# 显示文字
display.fill(0)           # 清屏
display.text("Hello!", 0, 0)
display.text("ESP32-C3", 0, 16)
display.text("SuperMini", 0, 26)
display.text("OLED OK!", 0, 36)
display.show()            # 刷新到屏幕

print("OLED 显示成功!")
```

> MicroPython 的 ssd1306 模块需要额外安装，可以在 Thonny 中 `工具` → `管理包` → 搜索 `ssd1306` 安装。

---

### 7.7 蓝牙 BLE 广播

**Arduino 版：**

```cpp
#include <BLEDevice.h>
#include <BLEServer.h>

// UUID 是蓝牙服务的唯一标识，这里用示例值
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

void setup() {
  Serial.begin(115200);

  // 初始化 BLE，设置广播名称
  BLEDevice::init("ESP32-C3-BLE");

  // 创建 BLE 服务器
  BLEServer *pServer = BLEDevice::createServer();

  // 创建 BLE 服务
  BLEService *pService = pServer->createService(SERVICE_UUID);

  // 创建特征值（可读可写）
  BLECharacteristic *pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE
  );

  // 设置特征值的内容
  pCharacteristic->setValue("Hello BLE from ESP32-C3!");

  // 启动服务
  pService->start();

  // 开始广播
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  BLEDevice::startAdvertising();

  Serial.println("BLE 已启动!");
  Serial.println("用手机 BLE 扫描 App 搜索 'ESP32-C3-BLE'");
}

void loop() {
  delay(2000);
}
```

**手机测试**：下载 **nRF Connect**（iOS/Android 均有免费版），打开后扫描即可找到 `ESP32-C3-BLE`。

---

### 7.8 深度睡眠（低功耗）

```cpp
void setup() {
  Serial.begin(115200);
  delay(1000);  // 等串口准备好

  Serial.println("================================");
  Serial.println("  ESP32-C3 深度睡眠示例");
  Serial.println("================================");
  Serial.println("程序运行中...");
  Serial.println("5 秒后进入深度睡眠");

  // 做一些事情
  delay(5000);

  Serial.println("正在进入深度睡眠...");
  Serial.println("10 秒后会自动醒来");
  Serial.flush();  // 确保串口输出完毕

  // 设置唤醒源：10 秒后定时唤醒
  esp_sleep_enable_timer_wakeup(10 * 1000000);  // 微秒

  // 也可以用外部 GPIO 唤醒（取消下面的注释）：
  // esp_sleep_enable_ext0_wakeup(GPIO_NUM_0, 0);  // GPIO0 低电平时唤醒

  // 进入深度睡眠
  esp_deep_sleep_start();
}

void loop() {
  // 深度睡眠后不会执行到这里
  // 唤醒后相当于重新启动，会从 setup() 开始执行
}
```

> 深度睡眠时功耗约 43μA，用 500mAh 的锂电池理论上能工作超过一年。

---

### 7.9 红黄绿交通灯模块——电脑串口远程控制

> 这是一个实战项目：用一个红黄绿三色交通灯模块，通过电脑发送串口指令来控制哪个颜色的灯亮起。

#### 7.9.1 模块介绍

市面上常见的红黄绿交通灯模块通常有 4 个引脚：

| 引脚  | 含义  | 说明            |
| --- | --- | ------------- |
| GND | 接地  | 连 ESP32 的 GND |
| R   | 红灯  | 高电平点亮红灯       |
| Y   | 黄灯  | 高电平点亮黄灯       |
| G   | 绿灯  | 高电平点亮绿灯       |

这个模块内部已经包含了限流电阻和 LED，**不需要额外加电阻**，直接用杜邦线连接即可。

> **共阴 vs 共阳**：绝大多数这种 4 引脚模块是**共阴型**（GND 是公共阴极），给 R/Y/G 引脚输出高电平（3.3V）就能点亮对应的灯。如果你的模块是共阳型（VCC 公共端），需要输出低电平才能点亮，代码中 HIGH/LOW 要反过来。判断方法：如果模块标注的是 VCC 而非 GND，就是共阳型。

#### 7.9.2 硬件连接

用 4 根杜邦线（母对母或母对公，取决于你的模块排针）连接：

```
红黄绿交通灯模块          ESP32-C3 SuperMini
   GND  ────────────────  GND        （随便哪个 GND 都行）
   R    ────────────────  GPIO5      （红灯 → GPIO5）
   Y    ────────────────  GPIO6      （黄灯 → GPIO6）
   G    ────────────────  GPIO7      （绿灯 → GPIO7）
```

**为什么选 GPIO5/6/7？**

- 这三个引脚相邻，接线整齐方便
- 都是普通数字 I/O，没有任何硬件复用冲突，也没有 Strapping Pin 限制
- **绝对不能用的引脚**：GPIO0-3 被 USB-Serial/JTAG 外设占用，`pinMode()` 或 `Pin.OUT` 无法抢回控制权；GPIO8 是板载 LED + Strapping Pin；GPIO9 是 BOOT 键 + Strapping Pin；GPIO11-13 连接内部 Flash；GPIO18/19 是 USB D-/D+

**接线实物描述：**

1. 找到交通灯模块上标注 GND 的引脚，用杜邦线连到 ESP32-C3 SuperMini 上标注 GND 的引脚
2. 找到模块上标注 R 的引脚，用杜邦线连到 ESP32 上标注 5 的引脚（GPIO5）
3. 找到模块上标注 Y 的引脚，用杜邦线连到 ESP32 上标注 6 的引脚（GPIO6）
4. 找到模块上标注 G 的引脚，用杜邦线连到 ESP32 上标注 7 的引脚（GPIO7）

> **接线前注意**：先拔掉 USB 线（断电状态下接线），接好后再通电。带电插拔杜邦线可能导致短路。

#### 7.9.3 控制方式设计

我们设计一套简单的串口指令协议：

| 电脑发送的指令   | ESP32 执行的动作               |
| --------- | ------------------------- |
| `R` 或 `r` | 只亮红灯，灭黄绿                  |
| `Y` 或 `y` | 只亮黄灯，灭红绿                  |
| `G` 或 `g` | 只亮绿灯，灭红黄                  |
| `A` 或 `a` | 全亮（红+黄+绿）                 |
| `O` 或 `o` | 全灭（Off）                   |
| `1`       | 交通灯自动循环模式（红5秒→绿5秒→黄2秒→循环） |
| `?`       | 查询当前状态                    |

> 指令不区分大小写。每条指令以回车换行结束（串口监视器中按回车发送即可）。

#### 7.9.4 Arduino 版完整代码

```cpp
// ============================================
// ESP32-C3 SuperMini 红黄绿交通灯 - 串口远程控制
// ============================================
// 
// 接线：
//   交通灯 GND → ESP32 GND
//   交通灯 R   → ESP32 GPIO5
//   交通灯 Y   → ESP32 GPIO6
//   交通灯 G   → ESP32 GPIO7
//
// 串口指令（波特率 115200）：
//   R/r - 亮红灯    Y/y - 亮黄灯    G/g - 亮绿灯
//   A/a - 全亮      O/o - 全灭
//   1   - 自动循环  ?   - 查询状态

#define PIN_RED    5    // 红灯引脚
#define PIN_YELLOW 6    // 黄灯引脚
#define PIN_GREEN  7    // 绿灯引脚

// 灯的状态
bool redOn   = false;
bool yellowOn = false;
bool greenOn = false;

// 自动循环模式标志
bool autoMode = false;
unsigned long lastSwitchTime = 0;
int autoPhase = 0;  // 0=红, 1=绿, 2=黄

// 设置所有灯的状态
void setLights(bool red, bool yellow, bool green) {
  digitalWrite(PIN_RED,    red   ? HIGH : LOW);
  digitalWrite(PIN_YELLOW, yellow ? HIGH : LOW);
  digitalWrite(PIN_GREEN,  green  ? HIGH : LOW);
  redOn    = red;
  yellowOn = yellow;
  greenOn  = green;
}

// 打印当前状态
void printStatus() {
  Serial.println("-------- 当前状态 --------");
  Serial.printf("  红灯: %s\n", redOn    ? "ON  ●" : "OFF ○");
  Serial.printf("  黄灯: %s\n", yellowOn ? "ON  ●" : "OFF ○");
  Serial.printf("  绿灯: %s\n", greenOn  ? "ON  ●" : "OFF ○");
  Serial.printf("  模式: %s\n", autoMode ? "自动循环" : "手动控制");
  Serial.println("--------------------------");
}

void setup() {
  Serial.begin(115200);

  // 初始化引脚
  pinMode(PIN_RED,    OUTPUT);
  pinMode(PIN_YELLOW, OUTPUT);
  pinMode(PIN_GREEN,  OUTPUT);

  // 上电全灭
  setLights(false, false, false);

  delay(1000);
  Serial.println("================================");
  Serial.println("  红黄绿交通灯控制器 v1.0");
  Serial.println("  ESP32-C3 SuperMini");
  Serial.println("================================");
  Serial.println("串口指令：");
  Serial.println("  R - 亮红灯    Y - 亮黄灯");
  Serial.println("  G - 亮绿灯    A - 全亮");
  Serial.println("  O - 全灭      1 - 自动循环");
  Serial.println("  ? - 查询状态");
  Serial.println("================================");
  Serial.println("等待指令...");
}

void loop() {
  // 1. 检查串口是否有数据
  if (Serial.available() > 0) {
    char cmd = Serial.read();
    autoMode = false;  // 收到任何手动指令都退出自动模式

    switch (cmd) {
      case 'R': case 'r':
        setLights(true, false, false);
        Serial.println(">> 红灯亮");
        break;

      case 'Y': case 'y':
        setLights(false, true, false);
        Serial.println(">> 黄灯亮");
        break;

      case 'G': case 'g':
        setLights(false, false, true);
        Serial.println(">> 绿灯亮");
        break;

      case 'A': case 'a':
        setLights(true, true, true);
        Serial.println(">> 全亮");
        break;

      case 'O': case 'o':
        setLights(false, false, false);
        Serial.println(">> 全灭");
        break;

      case '1':
        autoMode = true;
        autoPhase = 0;
        lastSwitchTime = millis();
        setLights(true, false, false);
        Serial.println(">> 进入自动循环模式");
        break;

      case '?':
        printStatus();
        break;

      case '\n': case '\r':
        // 忽略回车换行
        break;

      default:
        Serial.printf(">> 未知指令: '%c' (0x%02X)\n", cmd, cmd);
        Serial.println(">> 可用指令: R Y G A O 1 ?");
        break;
    }
  }

  // 2. 自动循环模式
  if (autoMode) {
    unsigned long now = millis();

    switch (autoPhase) {
      case 0:  // 红灯阶段，持续 5 秒
        if (now - lastSwitchTime >= 5000) {
          setLights(false, false, true);
          autoPhase = 1;
          lastSwitchTime = now;
          Serial.println(">> [自动] 红灯→绿灯");
        }
        break;

      case 1:  // 绿灯阶段，持续 5 秒
        if (now - lastSwitchTime >= 5000) {
          setLights(false, true, false);
          autoPhase = 2;
          lastSwitchTime = now;
          Serial.println(">> [自动] 绿灯→黄灯");
        }
        break;

      case 2:  // 黄灯阶段，持续 2 秒
        if (now - lastSwitchTime >= 2000) {
          setLights(true, false, false);
          autoPhase = 0;
          lastSwitchTime = now;
          Serial.println(">> [自动] 黄灯→红灯");
        }
        break;
    }
  }
}
```

#### 7.9.5 MicroPython 版完整代码

```python
# ============================================
# ESP32-C3 SuperMini 红黄绿交通灯 - 串口远程控制
# ============================================
# 接线：
#   交通灯 GND → ESP32 GND
#   交通灯 R   → ESP32 GPIO5
#   交通灯 Y   → ESP32 GPIO6
#   交通灯 G   → ESP32 GPIO7

from machine import Pin
import time

# 初始化三个灯的引脚
red_led    = Pin(5, Pin.OUT)
yellow_led = Pin(6, Pin.OUT)
green_led  = Pin(7, Pin.OUT)

auto_mode = False
auto_phase = 0       # 0=红, 1=绿, 2=黄
last_switch = 0

def set_lights(red=False, yellow=False, green=False):
    """设置三个灯的开关状态"""
    red_led.value(1 if red else 0)
    yellow_led.value(1 if yellow else 0)
    green_led.value(1 if green else 0)

def print_status():
    """打印当前状态"""
    print("-------- 当前状态 --------")
    print(f"  红灯: {'ON  ●' if red_led.value() else 'OFF ○'}")
    print(f"  黄灯: {'ON  ●' if yellow_led.value() else 'OFF ○'}")
    print(f"  绿灯: {'ON  ●' if green_led.value() else 'OFF ○'}")
    print(f"  模式: {'自动循环' if auto_mode else '手动控制'}")
    print("--------------------------")

# 上电全灭
set_lights(False, False, False)

print("================================")
print("  红黄绿交通灯控制器 v1.0")
print("  ESP32-C3 SuperMini")
print("================================")
print("串口指令：")
print("  R - 亮红灯    Y - 亮黄灯")
print("  G - 亮绿灯    A - 全亮")
print("  O - 全灭      1 - 自动循环")
print("  ? - 查询状态")
print("================================")
print("等待指令...")

while True:
    # 1. 检查串口输入
    if hasattr(time, 'ticks_ms'):
        # MicroPython 标准
        pass

    try:
        if hasattr(__import__('sys').stdin, 'in_waiting'):
            # Windows USB CDC
            data = __import__('sys').stdin.read(1)
        else:
            # 标准 MicroPython USB
            import sys
            data = sys.stdin.readline() if sys.stdin in dir() else None
            # 更通用的方法
            data = None
    except:
        data = None

    # 使用更可靠的串口读取方式
    try:
        from machine import UART
        # ESP32-C3 通过 USB CDC 串口（UART0）通信
        # 在 Thonny 中可以直接在 Shell 输入
        pass
    except:
        pass

    # 2. 自动循环模式
    if auto_mode:
        now = time.ticks_ms()
        if auto_phase == 0 and time.ticks_diff(now, last_switch) >= 5000:
            set_lights(green=True)
            auto_phase = 1
            last_switch = now
            print(">> [自动] 红灯→绿灯")
        elif auto_phase == 1 and time.ticks_diff(now, last_switch) >= 5000:
            set_lights(yellow=True)
            auto_phase = 2
            last_switch = now
            print(">> [自动] 绿灯→黄灯")
        elif auto_phase == 2 and time.ticks_diff(now, last_switch) >= 2000:
            set_lights(red=True)
            auto_phase = 0
            last_switch = now
            print(">> [自动] 黄灯→红灯")

    time.sleep(0.05)  # 50ms 轮询间隔
```

> **MicroPython 串口输入注意**：在 Thonny 的 Shell 中直接输入字母即可（如输入 `r` 回车），MicroPython 的 REPL 本身就是交互式的。上面的 MicroPython 版本推荐在 Thonny Shell 中用函数调用的方式操作更直观，见下面的简化版。

**MicroPython 交互版（在 Thonny Shell 中直接调用）：**

```python
# 交通灯 - MicroPython 交互版
# 在 Thonny Shell 中直接调用函数即可控制

from machine import Pin

red    = Pin(5, Pin.OUT)
yellow = Pin(6, Pin.OUT)
green  = Pin(7, Pin.OUT)

def off():
    """全灭"""
    red.value(0); yellow.value(0); green.value(0)
    print("全灭")

def red_on():
    """只亮红灯"""
    red.value(1); yellow.value(0); green.value(0)
    print("红灯亮 ●")

def yellow_on():
    """只亮黄灯"""
    red.value(0); yellow.value(1); green.value(0)
    print("黄灯亮 ●")

def green_on():
    """只亮绿灯"""
    red.value(0); yellow.value(0); green.value(1)
    print("绿灯亮 ●")

def all_on():
    """全亮"""
    red.value(1); yellow.value(1); green.value(1)
    print("全亮 ●●●")

# 启动时全灭
off()
print("交通灯已就绪！试试输入: red_on() / yellow_on() / green_on() / off() / all_on()")
```

在 Thonny 的 Shell 中，你只需要输入函数名：

```
>>> red_on()       # 红灯亮
>>> green_on()     # 绿灯亮
>>> off()          # 全灭
```

#### 7.9.6 电脑端 Python 控制脚本

如果你想从电脑端编程发送串口指令（而不是手动在串口监视器里打字），可以用 Python 的 pyserial 库：

**第一步：安装 pyserial**

```bash
pip install pyserial
```

**第二步：创建控制脚本 `traffic_light.py`**

```python
"""
电脑端 ESP32 红黄绿交通灯控制脚本

使用方法：
  python traffic_light.py              # 交互模式
  python traffic_light.py red          # 亮红灯
  python traffic_light.py green        # 亮绿灯
  python traffic_light.py auto         # 自动循环
"""

import serial
import sys
import time

# ---- 修改这里的 COM 口 ----
COM_PORT = "COM3"       # 改成你的 ESP32 的 COM 口
BAUD_RATE = 115200

def send_command(ser, cmd):
    """发送一条指令并等待回复"""
    ser.write((cmd + "\n").encode("utf-8"))
    time.sleep(0.1)
    # 读取回复
    while ser.in_waiting > 0:
        response = ser.readline().decode("utf-8", errors="ignore").strip()
        if response:
            print(f"  ↳ {response}")

def interactive_mode(ser):
    """交互模式：手动输入指令"""
    print("\n=== 交互模式 ===")
    print("可用指令: R(红) Y(黄) G(绿) A(全亮) O(全灭) 1(自动) ?(状态) Q(退出)")
    print()

    while True:
        try:
            cmd = input("请输入指令 > ").strip()
            if cmd.upper() == "Q":
                print("退出控制程序")
                break
            if cmd:
                send_command(ser, cmd)
        except KeyboardInterrupt:
            print("\n退出控制程序")
            break
        except EOFError:
            break

def main():
    if len(sys.argv) > 1:
        # 命令行参数模式
        cmd = sys.argv[1].lower()

        try:
            ser = serial.Serial(COM_PORT, BAUD_RATE, timeout=1)
            time.sleep(2)  # 等待 ESP32 重启完成
            print(f"已连接到 {COM_PORT}")

            # 清空启动信息
            while ser.in_waiting > 0:
                ser.readline()

            if cmd == "red":
                send_command(ser, "R")
            elif cmd == "yellow":
                send_command(ser, "Y")
            elif cmd == "green":
                send_command(ser, "G")
            elif cmd == "all":
                send_command(ser, "A")
            elif cmd == "off":
                send_command(ser, "O")
            elif cmd == "auto":
                send_command(ser, "1")
            elif cmd == "status":
                send_command(ser, "?")
            else:
                print(f"未知指令: {cmd}")

            ser.close()
        except serial.SerialException as e:
            print(f"串口打开失败: {e}")
            print(f"请检查 COM_PORT 是否正确（当前设置为 {COM_PORT}）")
    else:
        # 交互模式
        try:
            ser = serial.Serial(COM_PORT, BAUD_RATE, timeout=1)
            time.sleep(2)
            print(f"已连接到 {COM_PORT}")

            # 打印启动信息
            while ser.in_waiting > 0:
                line = ser.readline().decode("utf-8", errors="ignore").strip()
                if line:
                    print(f"  ↳ {line}")

            interactive_mode(ser)
            ser.close()
        except serial.SerialException as e:
            print(f"串口打开失败: {e}")
            print(f"请检查 COM_PORT 是否正确（当前设置为 {COM_PORT}）")

if __name__ == "__main__":
    main()
```

**使用方式：**

```bash
# 交互模式（手动输入指令）
python traffic_light.py

# 快捷命令
python traffic_light.py red       # 亮红灯
python traffic_light.py yellow    # 亮黄灯
python traffic_light.py green     # 亮绿灯
python traffic_light.py off       # 全灭
python traffic_light.py auto      # 自动循环
python traffic_light.py status    # 查询状态
```

> **注意**：使用 Python 控制脚本时，需要关闭 Arduino 串口监视器或 Thonny，因为一个 COM 口只能被一个程序占用。

#### 7.9.7 不用写代码——串口监视器直接控制

如果你不想写 Python 脚本，最简单的方式就是用 Arduino IDE 的串口监视器：

1. 把 Arduino 版代码上传到 ESP32
2. 打开串口监视器（`工具` → `串口监视器`，或 `Ctrl+Shift+M`）
3. 确认波特率为 **115200**
4. 在串口监视器顶部的输入框中：
   - 输入 `R` 然后按回车 → 红灯亮
   - 输入 `G` 然后按回车 → 绿灯亮
   - 输入 `1` 然后按回车 → 自动循环开始
   - 输入 `O` 然后按回车 → 全灭
5. 确认串口监视器右下角设置为「换行符」或「NL 和 CR」（这样发送时才会带上回车）

#### 7.9.8 WiFi 版交通灯——手机远程控制

如果你想让手机通过 WiFi 控制交通灯（而不是用 USB 线），结合 7.3 节的 Web 服务器和本节的灯光控制。**WiFi 连不上？先用 7.2 节的交互式扫描程序排查。**

```cpp
#include <WiFi.h>
#include <WebServer.h>

const char* ssid     = "你的WiFi名称";
const char* password = "你的WiFi密码";

WebServer server(80);

#define PIN_RED    3
#define PIN_YELLOW 4
#define PIN_GREEN  5

// 设置灯光状态
void setLights(bool red, bool yellow, bool green) {
  digitalWrite(PIN_RED,    red    ? HIGH : LOW);
  digitalWrite(PIN_YELLOW, yellow ? HIGH : LOW);
  digitalWrite(PIN_GREEN,  green  ? HIGH : LOW);
}

// 网页
const char htmlPage[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>交通灯控制</title>
  <style>
    body { font-family: Arial; text-align: center; margin-top: 30px; background: #222; color: #fff; }
    h1 { color: #fff; }
    .light-container {
      display: inline-block; background: #333; border-radius: 20px;
      padding: 20px; margin: 20px;
    }
    .btn {
      display: inline-block; padding: 15px 30px; font-size: 18px;
      margin: 8px; border: none; border-radius: 50px;
      cursor: pointer; text-decoration: none; color: white;
    }
    .btn-red    { background: #e74c3c; }
    .btn-yellow { background: #f39c12; }
    .btn-green  { background: #27ae60; }
    .btn-off    { background: #666; }
  </style>
</head>
<body>
  <h1>交通灯远程控制</h1>
  <div class="light-container">
    <a href="/red"    class="btn btn-red">红灯</a>
    <a href="/yellow" class="btn btn-yellow">黄灯</a>
    <a href="/green"  class="btn btn-green">绿灯</a>
    <a href="/off"    class="btn btn-off">关闭</a>
  </div>
</body>
</html>
)rawliteral";

void handleRoot() {
  server.send(200, "text/html", htmlPage);
}
void handleRed() {
  setLights(true, false, false);
  server.send(200, "text/html", htmlPage);
  Serial.println("WiFi 控制: 红灯");
}
void handleYellow() {
  setLights(false, true, false);
  server.send(200, "text/html", htmlPage);
  Serial.println("WiFi 控制: 黄灯");
}
void handleGreen() {
  setLights(false, false, true);
  server.send(200, "text/html", htmlPage);
  Serial.println("WiFi 控制: 绿灯");
}
void handleOff() {
  setLights(false, false, false);
  server.send(200, "text/html", htmlPage);
  Serial.println("WiFi 控制: 全灭");
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RED,    OUTPUT);
  pinMode(PIN_YELLOW, OUTPUT);
  pinMode(PIN_GREEN,  OUTPUT);
  setLights(false, false, false);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("连接 WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.print("\nWiFi 连接成功! 访问: http://");
  Serial.println(WiFi.localIP());

  server.on("/",       handleRoot);
  server.on("/red",    handleRed);
  server.on("/yellow", handleYellow);
  server.on("/green",  handleGreen);
  server.on("/off",    handleOff);
  server.begin();
}

void loop() {
  server.handleClient();
}
```

#### 7.9.9 常见问题

| 问题            | 原因                   | 解决                            |
| ------------- | -------------------- | ----------------------------- |
| 灯不亮但代码已在运行    | 接线错误或杜邦线接触不良         | 检查 GND 是否接好，杜邦线是否插紧           |
| 灯的颜色对不上       | R/Y/G 引脚接错了          | 对调一下杜邦线，或者修改代码中的引脚号           |
| 灯很暗           | 3.3V 驱动某些模块不够亮       | 部分模块设计为 5V 驱动，3.3V 也能亮但偏暗，属正常 |
| 串口发送指令没反应     | 串口监视器没有设对换行符         | 确认设为「NL 和 CR」或「换行符」           |
| Python 脚本连接失败 | COM 口被其他程序占用         | 先关闭 Arduino 串口监视器和 Thonny     |
| 自动模式不切换       | `millis()` 溢出（约50天后） | 正常使用不受影响，重启即可                 |

---

### 7.10 CPU 温度监控——红黄绿灯实时报警

**场景**：电脑 CPU 太热了？让 ESP32 + 红黄绿灯模块做你的桌面温度报警器！PC 端 Python 脚本定时读取 CPU 温度，通过串口发给 ESP32，ESP32 根据温度点亮不同颜色的灯：

| 温度范围        | 灯状态 | 含义  |
| ----------- | --- | --- |
| > 90°C      | 红灯  | 危险！ |
| 70°C ~ 90°C | 黄灯  | 警告  |
| 50°C ~ 70°C | 绿灯  | 正常  |
| < 50°C      | 全灭  | 凉快  |

**硬件接线**：与 7.9 相同

| 灯模块引脚 | ESP32 引脚 | 说明  |
| ----- | -------- | --- |
| GND   | GND      | 公共地 |
| R     | GPIO5    | 红灯  |
| Y     | GPIO6    | 黄灯  |
| G     | GPIO7    | 绿灯  |

#### 7.10.1 ESP32 Arduino 代码

```cpp
/*
 * 7.10 CPU 温度监控 - 红黄绿灯实时报警
 * 
 * 接收 PC 通过串口发送的温度值，格式：T:75.5
 * 根据温度阈值控制红黄绿灯
 * 
 * 接线：GND-GND, R-GPIO5, Y-GPIO6, G-GPIO7
 */

#define PIN_RED     5   // GPIO5 - 红灯
#define PIN_YELLOW  6   // GPIO6 - 黄灯
#define PIN_GREEN   7   // GPIO7 - 绿灯

// 温度阈值
#define TEMP_CRITICAL  90   // >90°C: 红灯
#define TEMP_WARNING   70   // 70-90°C: 黄灯
#define TEMP_NORMAL    50   // 50-70°C: 绿灯
                            // <50°C: 全灭

float currentTemp = -999;   // 当前温度
unsigned long lastRecvTime = 0;  // 上次收到温度的时间
const unsigned long TIMEOUT = 15000;  // 15秒无数据视为断连

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RED, OUTPUT);
  pinMode(PIN_YELLOW, OUTPUT);
  pinMode(PIN_GREEN, OUTPUT);

  allOff();
  delay(1000);

  Serial.println("=== CPU Temperature Monitor ===");
  Serial.println("Format: T:75.5");
  Serial.println(">90 RED | 70-90 YELLOW | 50-70 GREEN | <50 OFF");
  Serial.println("Ready.");
}

void loop() {
  // 读取串口温度数据
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();

    if (line.startsWith("T:")) {
      float temp = line.substring(2).toFloat();
      if (temp > 0 && temp < 150) {  // 合理温度范围校验
        currentTemp = temp;
        lastRecvTime = millis();
        updateLEDs();
        sendStatus();
      }
    }
  }

  // 超时检测：15秒没收到数据，闪烁黄灯报警
  if (currentTemp > -999 && (millis() - lastRecvTime > TIMEOUT)) {
    blinkAlert();
  }
}

void updateLEDs() {
  digitalWrite(PIN_RED,    currentTemp > TEMP_CRITICAL ? HIGH : LOW);
  digitalWrite(PIN_YELLOW, (currentTemp >= TEMP_WARNING && currentTemp <= TEMP_CRITICAL) ? HIGH : LOW);
  digitalWrite(PIN_GREEN,  (currentTemp >= TEMP_NORMAL && currentTemp < TEMP_WARNING) ? HIGH : LOW);
}

void allOff() {
  digitalWrite(PIN_RED, LOW);
  digitalWrite(PIN_YELLOW, LOW);
  digitalWrite(PIN_GREEN, LOW);
}

void sendStatus() {
  Serial.print("CPU: ");
  Serial.print(currentTemp, 1);
  Serial.print("C [");
  if (currentTemp > TEMP_CRITICAL) {
    Serial.print("!!!CRITICAL");
  } else if (currentTemp >= TEMP_WARNING) {
    Serial.print("!WARNING");
  } else if (currentTemp >= TEMP_NORMAL) {
    Serial.print("OK");
  } else {
    Serial.print("COOL");
  }
  Serial.println("]");
}

void blinkAlert() {
  // 黄灯快闪，提示串口断连
  static unsigned long lastBlink = 0;
  static bool blinkState = false;
  if (millis() - lastBlink > 300) {
    blinkState = !blinkState;
    digitalWrite(PIN_RED, LOW);
    digitalWrite(PIN_GREEN, LOW);
    digitalWrite(PIN_YELLOW, blinkState ? HIGH : LOW);
    lastBlink = millis();
  }
}
```

#### 7.10.2 ESP32 MicroPython 代码

```python
# 7.10 CPU 温度监控 - MicroPython 版
# 接线：GND-GND, R-GPIO5, Y-GPIO6, G-GPIO7

from machine import Pin
import time

# 温度阈值
TEMP_CRITICAL = 90
TEMP_WARNING = 70
TEMP_NORMAL = 50

# LED 引脚
red    = Pin(5, Pin.OUT)
yellow = Pin(6, Pin.OUT)
green  = Pin(7, Pin.OUT)

def all_off():
    red.value(0)
    yellow.value(0)
    green.value(0)

def update_leds(temp):
    red.value(1 if temp > TEMP_CRITICAL else 0)
    yellow.value(1 if TEMP_WARNING <= temp <= TEMP_CRITICAL else 0)
    green.value(1 if TEMP_NORMAL <= temp < TEMP_WARNING else 0)

def get_status(temp):
    if temp > TEMP_CRITICAL: return "!!!CRITICAL"
    if temp >= TEMP_WARNING: return "!WARNING"
    if temp >= TEMP_NORMAL: return "OK"
    return "COOL"

all_off()
print("=== CPU Temperature Monitor (MicroPython) ===")
print(">90 RED | 70-90 YELLOW | 50-70 GREEN | <50 OFF")
print("Ready.")

last_recv = time.time()

while True:
    if True:  # 在 REPL 交互模式中可用 input()
        try:
            line = input()
            line = line.strip()
            if line.startswith("T:"):
                temp = float(line[2:])
                if 0 < temp < 150:
                    update_leds(temp)
                    print(f"CPU: {temp:.1f}C [{get_status(temp)}]")
                    last_recv = time.time()
        except:
            pass

    # 超时闪烁警告
    if time.time() - last_recv > 15:
        yellow.value(not yellow.value())
        red.value(0)
        green.value(0)

    time.sleep(0.1)
```

#### 7.10.3 PC 端：读取 CPU 温度并控制 ESP32

**核心问题：Windows 读取 CPU 温度需要管理员权限**

CPU 温度传感器是内核级硬件，Windows 不允许普通用户直接读取。以下是两种方案，**推荐方案 B**：

---

**方案 A：Python + WMI（简单，但可能读不到）**

**优点**：只需装一个 Python 包，代码最简洁
**缺点**：很多主板/ CPU 不向 WMI 暴露温度数据，可能读到空值

1. 安装依赖：
   
   ```powershell
   pip install wmi pyserial
   ```

2. **以管理员身份运行** PowerShell 或终端，执行脚本：
   
   ```python
   # cpu_monitor_wmi.py
   # 方案A：通过 WMI 读取 CPU 温度（需管理员权限）
   
   import wmi
   import serial
   import time
   
   COM_PORT = "COM3"   # 改成你的 COM 口
   INTERVAL = 2        # 采样间隔（秒）
   
   ser = serial.Serial(COM_PORT, 115200, timeout=1)
   time.sleep(2)
   
   # 读取 ESP32 的启动信息
   while ser.in_waiting:
       print(ser.readline().decode(errors='replace'), end='')
   
   w = wmi.WMI(namespace="root\\wmi")
   
   print("=== CPU Temp Monitor (WMI) ===")
   print(f"Serial: {COM_PORT} | Interval: {INTERVAL}s")
   print("Press Ctrl+C to stop\n")
   
   try:
       while True:
           try:
               temps = w.MSAcpi_ThermalZoneTemperature()
               if temps:
                   raw = temps[0].CurrentTemperature
                   temp = (raw - 2732) / 10.0
                   cmd = f"T:{temp:.1f}\n"
                   ser.write(cmd.encode())
   
                   # 读取 ESP32 回复
                   time.sleep(0.1)
                   while ser.in_waiting:
                       print(ser.readline().decode(errors='replace'), end='')
               else:
                   print("[WMI] No temperature data available")
           except Exception as e:
               print(f"[WMI Error] {e}")
               print(">>> 你的主板可能不支持 WMI 温度接口，请换用方案B")
               break
   
           time.sleep(INTERVAL)
   except KeyboardInterrupt:
       print("\nStopped.")
   finally:
       ser.write(b"T:25.0\n")  # 关闭前设低温，熄灭所有灯
       ser.close()
   ```

3. 如果看到 `No temperature data` 或 `Not supported` 错误 → 你主板的 WMI 不提供温度，请换方案 B

---

**方案 B：Python + LibreHardwareMonitor（推荐，最可靠）**

LibreHardwareMonitor 是开源硬件监控库，支持 Intel / AMD 全系列 CPU 的温度读取。

**优点**：兼容性最好，几乎所有 CPU 都能读到核心温度
**缺点**：需要下载一个 DLL 文件，仍需管理员权限

1. 安装 Python 依赖：
   
   ```powershell
   pip install pythonnet pyserial
   ```

2. 下载 LibreHardwareMonitor 的 DLL 文件：
   
   - 去 GitHub releases 页面：`https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases`
   - 下载最新版 ZIP，解压后找到 `LibreHardwareMonitorLib.dll`
   - 把 DLL 文件复制到你的 Python 脚本**同一个目录**下

3. **以管理员身份运行**脚本：
   
   ```python
   # cpu_monitor_lhm.py
   # 方案B：通过 LibreHardwareMonitor 读取 CPU 温度（需管理员权限）
   # 需要将 LibreHardwareMonitorLib.dll 放在脚本同目录下
   
   import sys
   import os
   import time
   import serial
   import clr  # pythonnet
   
   COM_PORT = "COM3"   # 改成你的 COM 口
   INTERVAL = 2        # 采样间隔（秒）
   
   # ---- 初始化 LibreHardwareMonitor ----
   script_dir = os.path.dirname(os.path.abspath(__file__))
   dll_path = os.path.join(script_dir, "LibreHardwareMonitorLib.dll")
   
   if not os.path.exists(dll_path):
       print(f"[ERROR] 找不到 {dll_path}")
       print("请从 https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases")
       print("下载 ZIP，解压后将 LibreHardwareMonitorLib.dll 放到脚本同目录")
       sys.exit(1)
   
   sys.path.append(script_dir)
   clr.AddReference("LibreHardwareMonitorLib")
   
   from LibreHardwareMonitor.Hardware import Computer, HardwareType, SensorType
   
   computer = Computer()
   computer.IsCpuEnabled = True
   computer.Open()
   
   # ---- 初始化串口 ----
   ser = serial.Serial(COM_PORT, 115200, timeout=1)
   time.sleep(2)
   while ser.in_waiting:
       print(ser.readline().decode(errors='replace'), end='')
   
   # ---- 获取 CPU 平均温度 ----
   def get_cpu_temp():
       computer.AcceptUpdate()
       for hw in computer.Hardware:
           if hw.HardwareType == HardwareType.Cpu:
               hw.Update()
               temps = []
               for sensor in hw.Sensors:
                   if sensor.SensorType == SensorType.Temperature:
                       if sensor.Value is not None:
                           # 优先取 Core Average / Package 温度
                           name = sensor.Name.lower()
                           if "average" in name or "package" in name or "total" in name:
                               return float(sensor.Value)
                           temps.append(float(sensor.Value))
               # 没有平均值就取所有核心的平均
               if temps:
                   return sum(temps) / len(temps)
       return None
   
   # ---- 主循环 ----
   print("=== CPU Temp Monitor (LibreHardwareMonitor) ===")
   print(f"Serial: {COM_PORT} | Interval: {INTERVAL}s")
   print("Press Ctrl+C to stop\n")
   
   try:
       while True:
           temp = get_cpu_temp()
           if temp is not None:
               cmd = f"T:{temp:.1f}\n"
               ser.write(cmd.encode())
   
               time.sleep(0.1)
               while ser.in_waiting:
                   print(ser.readline().decode(errors='replace'), end='')
           else:
               print("[WARN] Cannot read CPU temperature")
               print("  - 确认以管理员身份运行此脚本")
               print("  - 确认 LibreHardwareMonitorLib.dll 版本正确")
   
           time.sleep(INTERVAL)
   except KeyboardInterrupt:
       print("\nStopped.")
   finally:
       ser.write(b"T:25.0\n")  # 关闭前设低温，熄灭所有灯
       ser.close()
       computer.Close()
   ```

---

**如何「以管理员身份运行」Python 脚本：**

| 方法               | 操作                                                      |
| ---------------- | ------------------------------------------------------- |
| PowerShell       | 右键 PowerShell → 「以管理员身份运行」→ `python cpu_monitor_lhm.py` |
| Windows Terminal | 右键 → 「以管理员身份运行」→ 切到脚本目录执行                               |
| 命令提示符            | 右键 → 「以管理员身份运行」→ `python cpu_monitor_lhm.py`            |
| 快捷方式             | 右键脚本快捷方式 → 属性 → 高级 → 勾选「以管理员身份运行」                       |

> **为什么必须管理员？** CPU 温度传感器在芯片内部，读取需要操作内核驱动（Ring 0），这是 Windows 的安全机制，所有方案都无法绕过。

#### 7.10.4 效果演示

```
=== CPU Temp Monitor (LibreHardwareMonitor) ===
Serial: COM3 | Interval: 2s
Press Ctrl+C to stop

CPU: 45.2C [COOL]          ← 全灭
CPU: 52.8C [OK]            ← 绿灯亮
CPU: 73.1C [!WARNING]      ← 黄灯亮
CPU: 92.6C [!!!CRITICAL]   ← 红灯亮！赶紧关程序！
```

如果 15 秒没收到数据（比如 Python 脚本关了），ESP32 会黄灯快闪提示断连。

#### 7.10.5 扩展玩法

- **加蜂鸣器**：温度 > 90°C 时同时驱动蜂鸣器报警（接 GPIO6 + 三极管）
- **加 OLED 屏**：把温度数字显示在 0.96 寸 OLED 上（参考 7.6 节）
- **加 WiFi 上报**：同时把温度通过 WiFi 发到手机网页（参考 7.3 节）
- **调阈值**：修改代码中 `TEMP_CRITICAL` / `TEMP_WARNING` / `TEMP_NORMAL` 三个常量即可

#### 7.10.6 常见问题

| 问题                   | 原因                      | 解决                                      |
| -------------------- | ----------------------- | --------------------------------------- |
| WMI 方案读不到温度          | 主板固件不向 WMI 暴露温度         | 换方案 B（LibreHardwareMonitor）             |
| LHM 报错找不到 DLL        | DLL 文件不在脚本同目录           | 把 `LibreHardwareMonitorLib.dll` 复制到脚本旁边 |
| LHM 读到 None          | 没有以管理员身份运行              | 右键 → 以管理员身份运行                           |
| 串口报错 PermissionError | COM 口被 Arduino 串口监视器占用  | 先关闭 Arduino IDE 的串口监视器                  |
| ESP32 黄灯快闪不灭         | Python 脚本已停止，ESP32 判断超时 | 重新运行 Python 脚本即可                        |
| 温度值跳变很大              | 某些 CPU 核心间温差大，取了平均      | 修改脚本优先取 Package 温度                      |

---

## 第八章 常见问题与排错大全

### 8.1 完全无法识别开发板

**症状**：插上 USB 线，电脑没有任何反应

**排查流程**（按顺序检查）：

```
1. 换一根 USB 数据线 ←── 90% 的问题都是这个
   ↓ 还不行
2. 换一个 USB 口（用机箱背面的，不用前面板的）
   ↓ 还不行
3. 不用 USB Hub，直连电脑
   ↓ 还不行
4. 换一台电脑试试
   ↓ 还不行
5. 检查 USB 口里有没有杂物
   ↓ 还不行
6. 很可能是板子坏了，联系卖家换货
```

### 8.2 上传时卡在 `Connecting......`

**原因**：开发板没有进入下载模式

**解决方法（按推荐顺序尝试）**：

1. **方法一**：点击上传按钮后，立刻**按住 BOOT 键**，看到开始写入后松开
2. **方法二**：按住 BOOT → 按一下 RESET → 松开 BOOT → 再点击上传
3. **方法三**：先拔掉 USB 线 → 按住 BOOT → 插上 USB 线 → 松开 BOOT → 点击上传
4. **方法四**：降低上传速度：`工具` → `Upload Speed` → 选择 `115200`

### 8.3 上传成功但程序不运行

**解决方法**：上传完成后按一下 **RESET** 键

### 8.4 串口监视器一片空白

**这是新手遇到最多的问题，按顺序排查**：

| 步骤  | 操作                   | 说明                       |
| --- | -------------------- | ------------------------ |
| 1   | 检查 `USB CDC On Boot` | 设为 **Enabled**（90%是这个问题） |
| 2   | 检查波特率                | 串口监视器右下角设为 **115200**    |
| 3   | 检查 COM 口             | 确认选对了端口                  |
| 4   | 按 RESET              | 重启开发板看看有没有启动信息           |
| 5   | 关闭再打开串口监视器           | 有时候串口监视器连接状态异常           |

> **如果以上都不行**：试试把 `USB CDC On Boot` 设为 `Enabled` 后重新上传一次程序（不是只改设置，要重新上传）。

### 8.5 串口监视器能看到输出，但输入指令没有反应

**程序刷入成功、串口监视器能打印启动信息，但手动输入指令（如 `R`、`Y`、`G`）板子没反应**——这是串口通信方向的问题，按可能性排序排查：

**1. 检查「USB CDC On Boot」设置（最高概率）**

ESP32-C3 用内置 USB 输出串口，必须开启这个选项，否则串口通信不走 USB：

- Arduino IDE 菜单：`工具` → `USB CDC On Boot` → 选 **Enabled**
- 改完后**重新上传程序**（不能只改设置不上传）
- 判断方法：上传后按 RESET，如果串口监视器能看到启动信息，说明 USB CDC 已开启；如果看不到，就是这个问题

**2. 检查串口监视器的「行结束符」（第二高概率）**

程序用 `Serial.readStringUntil('\n')` 读取指令，需要发送换行符才能触发：

- 串口监视器窗口**顶部**有个行结束符下拉框
- 选 **Newline**（换行）或 **Both NL & CR**（回车换行）
- 如果选的是「No line ending」，你输入什么都不会被程序接收到——这是**最容易被忽略的设置**

**3. 确认波特率 115200**

串口监视器右下角波特率必须和程序里的 `Serial.begin(115200)` 一致。

**4. 上传后按一下 RESET 键**

让板子重新启动，观察串口监视器有没有打印启动信息（类似 "Traffic Light Controller ready"）。有启动信息说明串口通了，只是命令输入的问题；没有则回到第 1 条。

### 8.6 设备管理器中根本看不到「端口 (COM 和 LPT)」分类

**这是 Windows 11 的正常行为**——没有串口设备时，这个分类会被自动隐藏。

**按以下步骤排查：**

1. **先插上开发板**，等 5-10 秒让系统识别
2. 如果「端口 (COM 和 LPT)」**出现了**——一切正常，继续操作即可
3. 如果仍然没有，点击设备管理器菜单栏 → **「查看」→ 勾选「显示隐藏的设备」**
4. 看看是否出现了**灰色的**「端口 (COM 和 LPT)」分类，如果有，说明驱动有问题（灰色 = 被禁用或驱动异常），参考[3.6 节驱动安装](#36-驱动安装)
5. 如果连灰色都没有，去**其他位置**找找：
   - **「其他设备」** 下有没有带黄色感叹号的「未知设备」？
   - **「通用串行总线设备」** 下有没有「JTAG/serial debug unit」或「ESP32」相关项？
   - 如果发现了 → 参考[3.6 节驱动安装](#36-驱动安装)的「情况一」处理
6. 如果设备管理器**完全没有任何变化** → 参考[3.5 节](#35-识别不到-com-口怎么办)排查 USB 线和接口

**终极方法：用命令行直接查看**

如果设备管理器让你头疼，可以直接在 PowerShell 中查看：

```powershell
# 插上开发板后，执行：
Get-PnpDevice | Where-Object { $_.FriendlyName -match "COM|Serial|USB Serial|CH34|CP21|ESP" }
```

这个命令会列出所有包含 COM/Serial/USB 等关键词的设备，不管设备管理器怎么分类，都能帮你找到。

### 8.7 设备管理器显示「JTAG/serial debug unit」而不是 COM 口

1. 右键此设备 → 更新驱动程序
2. 浏览我的电脑 → 让我从列表选取
3. 选择「USB 串行设备」
4. 安装后重新插拔 USB

### 8.8 Flash Mode 选了 QIO 导致无限重启

4MB Flash 的 ESP32-C3 **只支持 DIO 模式**！

解决方法：`工具` → `Flash Mode` → 改为 **DIO** → 重新上传程序

### 8.9 WiFi 总是连不上

逐项检查：

1. WiFi 名称和密码是否正确（**区分大小写，不要有多余的空格**）
2. WiFi 是否为 **2.4 GHz**（ESP32-C3 **完全不支持 5 GHz**）
3. WiFi 是否隐藏了 SSID
4. 路由器是否开启了「AP 隔离」或「客户端隔离」
5. 开发板离路由器够不够近
6. 有些企业/校园 WiFi 需要网页认证，ESP32 无法使用
7. 路由器是否开了 **WPA3**？ESP32-C3 只支持 WPA2-PSK，请进路由器后台关闭 WPA3

### 8.9.1 报错 `RuntimeError: Wifi Unknown Error 0x0102`

**原因**：0x0102 是 ESP-IDF 的 `ESP_ERR_WIFI_CONN`，表示 WiFi 内部连接状态机冲突。最常见的触发场景是 **scan() 之后直接 connect()**，扫描操作会占用 WiFi 内部状态，如果不先清理就直接连接，就会报这个错。

**解决方案**（在 MicroPython 中）：

```python
# scan 之后不要直接 connect！
networks = wlan.scan()
# ... 用户选择 ...
wlan.disconnect()     # 先断开（清理扫描留下的内部状态）
time.sleep(1)          # 等待 WiFi 状态机重置
wlan.connect(ssid, password)   # 再连接
```

如果仍然不行，按复位键重启板子后再试。

### 8.9.2 WiFi 能扫描到但连接失败/频繁断连（状态码 6）

**症状**：能扫描到 WiFi 列表，密码正确，2.4GHz，WPA2 纯净，但：
- `connect()` 返回状态码 6 或直接报错
- 偶尔能连上但几秒后自动断开
- 换路由器、换手机热点统统无效

**根本原因**：SuperMini 的板载 PCB 天线在高发射功率下信号失真或反射过大，导致与路由器握手失败。**降功率后信号更"干净"，反而更稳定。**

**解决方案** — 在连接 WiFi 之前降低发射功率到 8~8.5dBm：

**Arduino 版：**
```cpp
#include "esp_wifi.h"

// 在 WiFi.begin() 之前调用
esp_wifi_set_max_tx_power(WIFI_POWER_8_5dBm);
```

**MicroPython 版：**
```python
# 在 wlan.connect() 之前调用
wlan.config(txpower=8)    # 8dBm
```

> 如果你的 MicroPython 固件不支持 `txpower` 参数，请升级到较新版本（v1.24+），或使用 Arduino 版本。

> **实测结论**：这不是个别现象，而是 SuperMini 这类超小板子的通病。如果你遇到"密码没错但就是连不上"，别盲目排查了，先降功率！

### 8.10 GPIO8/GPIO9 外接设备后开发板无法启动

**原因**：这两个引脚是 Strapping Pin，上电电平决定了启动模式。外接设备在上电瞬间把引脚拉低，板子就进入下载模式而不是正常运行模式。

**解决方案**：

- 给引脚加 10K 上拉电阻到 3V3，确保启动时为高电平
- 或改用其他 GPIO（推荐，优先用 GPIO4/5/6/7）

> 更完整的 GPIO 避坑说明见[1.4 节 GPIO 避坑指南](#14-gpio-避坑指南必读)

### 8.11 GPIO0-3 接了设备但代码控制不了（灯不亮/没反应）

**原因**：GPIO0-3 被 USB-Serial/JTAG 外设永久占用，代码 `pinMode()` 或 `Pin.OUT` 不会报错，但实际无法改变引脚电平。

**解决方案**：**不要使用 GPIO0-3 接外部设备**，改用 GPIO4/5/6/7。详见[1.4 节 GPIO 避坑指南](#14-gpio-避坑指南必读)

### 8.12 Thonny 无法识别 ESP32-C3

1. 确认 COM 口正确
2. Thonny 版本 ≥ 4.0
3. 手动进入下载模式后再烧录固件
4. 先用 esptool 命令行烧好固件，再用 Thonny 连接

### 8.13 MicroPython 固件烧录后无法连接 Thonny

1. 按 RESET 重启板子
2. 等待 3-5 秒再连接
3. 在 Thonny 的「配置解释器」中手动选择端口
4. 检查固件版本是否正确（必须是 ESP32_GENERIC_C3，不是 ESP32_GENERIC）

### 8.14 编译报错各种函数未定义

| 错误信息              | 原因                            | 解决                                              |
| ----------------- | ----------------------------- | ----------------------------------------------- |
| `ledcAttach` 未定义  | ESP32 Arduino 核心 3.x 版本改了 API | 用 `ledcAttachPin()` + `ledcSetup()`，或降级到 2.x 版本 |
| `WiFi.h` 找不到      | 没选对开发板                        | 确认选了 `ESP32C3 Dev Module`                       |
| `BLEDevice.h` 找不到 | 开发板包版本太旧                      | 更新 ESP32 开发板包                                   |

### 8.15 开发板发烫

- **微温**（30-40°C）：正常，WiFi 工作时会有一定发热
- **烫手**（60°C+）：异常！可能是短路或供电电压过高，立即断电检查
- 确认供电电压在 3.3-6V 之间（5V 引脚外部供电时）
- 确认没有接线错误导致短路

### 8.16 D9 和 GND 短接——最后的救砖方法

如果所有方法都无法烧录，可以试试这个方法：

1. 在板子**上电前**，用杜邦线或镊子短接 GPIO9（D9）和 GND
2. 插上 USB 线
3. 烧录程序
4. 烧录成功后，断开 D9 和 GND 的短接
5. 按 RESET 重启

> **注意**：这个方法只在其他方法都不行时使用，平时不需要这样做。

### 8.17 电脑端读取 CPU 温度失败（权限或兼容问题）

**根本原因**：CPU 温度传感器位于芯片内部，Windows 只允许内核级（Ring 0）程序访问，所以**所有方案都必须以管理员身份运行**。

**排查步骤**：

1. **确认以管理员身份运行**：右键 PowerShell → 「以管理员身份运行」→ 再执行 `python cpu_monitor_lhm.py`
2. **WMI 方案读到空值或报错**：你的主板固件不向 Windows WMI 暴露温度数据，换方案 B（LibreHardwareMonitor），兼容性好得多
3. **LHM 报错 `FileNotFoundException`**：`LibreHardwareMonitorLib.dll` 没放在脚本同目录，复制过去即可
4. **LHM 读到 `None`**：DLL 版本和 CPU 不匹配，去 GitHub 下载最新版
5. **不想每次都右键管理员？**：右键脚本快捷方式 → 属性 → 高级 → 勾选「以管理员身份运行」

> **没有不需要管理员的方案**——这是 Windows 安全机制的限制，不是工具的问题。

---

## 第九章 进阶资源

### 9.1 官方资源

| 资源                        | 链接                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| ESP32-C3 SuperMini 官方仓库   | https://github.com/NologoTech/ESP32C3-Supermini                                                        |
| ESP32 Arduino 官方文档        | https://docs.espressif.com/projects/arduino-esp32/                                                     |
| MicroPython 官方文档          | https://docs.micropython.org/                                                                          |
| MicroPython ESP32-C3 固件下载 | https://micropython.org/download/ESP32_GENERIC_C3/                                                     |
| ESP-IDF 官方框架（专业级）         | https://docs.espressif.com/projects/esp-idf/                                                           |
| ESP32-C3 数据手册             | https://www.espressif.com/sites/default/files/documentation/esp32-c3_datasheet_en.pdf                  |
| ESP32-C3 技术参考手册           | https://www.espressif.com/sites/default/files/documentation/esp32-c3_technical_reference_manual_en.pdf |
| 乐鑫 Flash Download Tool    | https://www.espressif.com/zh-hans/support/download/other-tools                                         |

### 9.2 教程与社区

| 资源                       | 说明                                                 |
| ------------------------ | -------------------------------------------------- |
| ESP32 Arduino 教程（开源）     | https://github.com/NologoTech/ESP32-C3-Arduino     |
| ESP32 MicroPython 教程（开源） | https://github.com/NologoTech/ESP32-C3-MicroPython |
| QQ 技术交流群                 | 522420541                                          |
| Arduino 中文社区             | https://arduino.me/                                |
| ESP32 中文社区               | https://www.esp32.com/viewforum.php?f=24           |

### 9.3 开发工具推荐

| 工具                   | 用途             | 适合人群        |
| -------------------- | -------------- | ----------- |
| Arduino IDE          | C/C++ 开发       | 初学者         |
| Thonny               | MicroPython 开发 | 会 Python 的人 |
| VS Code + PlatformIO | 专业 C/C++ 开发    | 有经验的开发者     |
| ESP-IDF              | 官方专业开发框架       | 专业嵌入式工程师    |
| Flash Download Tool  | 图形界面烧录         | 不想用命令行的人    |

### 9.4 常用传感器/模块购买建议

| 模块                   | 价格     | 用途       | 连接方式          |
| -------------------- | ------ | -------- | ------------- |
| DHT11 温湿度            | 3-5元   | 温湿度测量    | 1个GPIO        |
| DHT22 温湿度            | 8-15元  | 精度更高的温湿度 | 1个GPIO        |
| SSD1306 OLED (0.96寸) | 5-10元  | 小屏幕显示    | I2C (GPIO8/9) |
| 光敏电阻模块               | 1-3元   | 光照检测     | ADC           |
| 舵机 SG90              | 3-8元   | 角度控制     | 1个GPIO (PWM)  |
| 继电器模块                | 3-5元   | 控制大功率设备  | 1个GPIO        |
| WS2812 RGB LED       | 2-5元/个 | 彩色灯效     | 1个GPIO        |

---

> 本文档最后更新：2026-06-15

> AI生成