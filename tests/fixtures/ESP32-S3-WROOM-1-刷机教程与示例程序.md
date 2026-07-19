# ESP32-S3-WROOM-1 刷机教程与示例程序

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

### 1.1 什么是 ESP32-S3-WROOM-1？

ESP32-S3-WROOM-1 是乐鑫（Espressif）推出的一款**高性能 Wi-Fi + 蓝牙双模 MCU 模组**，核心搭载 **ESP32-S3** 芯片。与便宜的 ESP32-C3 相比，S3 是真正的「性能小钢炮」——双核处理器、更多 GPIO、内置 USB OTG、支持摄像头接口和 AI 加速指令。

你可以把它理解为一个「能连 WiFi 和蓝牙的微型双核电脑」，虽然模组本身只有 18 x 25.5mm，但它能：

- 同时运行两个任务（真正的双核并行）
- 直接通过 USB 与电脑通信（无需额外的 USB 转串口芯片）
- 驱动摄像头、彩色屏幕等复杂外设
- 运行轻量级 AI 推理（语音唤醒、人脸检测等）

**它适合做什么？**

- 智能家居中控面板（带屏幕的那种）
- AI 语音助手（本地语音唤醒 + 云端大模型对话）
- 摄像头应用（人脸识别、监控、视频上传）
- 复杂物联网网关（同时管好几个传感器和执行器）
- 小型机器人控制板
- 学习嵌入式和物联网开发

**价格**：带 ESP32-S3-WROOM-1 模组的开发板通常 15-40 元人民币（取决于 Flash/PSRAM 配置），加上一根 Type-C 数据线就能开始。

### 1.2 核心参数（你不需要全看懂，仅供参考）

| 项目     | 参数                                 | 通俗解释                          |
| ------ | ---------------------------------- | ----------------------------- |
| 处理器    | 32 位 Xtensa LX7 **双核**，最高 240 MHz  | 比 ESP32-C3 单核快 3 倍，双核可并行跑两个任务 |
| 内存     | 512 KB SRAM + 384 KB ROM           | 比 C3 多 100KB+，能跑更复杂程序         |
| 闪存     | 视模组型号，4/8/16 MB（外挂 SPI Flash）      | 存放程序和数据的"硬盘"，16MB 超宽裕         |
| PSRAM  | 视模组型号，0/2/8 MB（外挂 PSRAM）           | 额外的"内存条"，8MB 跑图像处理、大数组很从容     |
| WiFi   | 802.11 b/g/n，2.4 GHz               | 能连你家路由器（**不支持5GHz**）          |
| 蓝牙     | Bluetooth 5.0 (LE)                 | 能和手机蓝牙通信，支持 BLE Mesh          |
| GPIO   | 45 个可编程引脚（模组可用约 26-35 个）           | 比 C3 多很多，能接一堆外设               |
| ADC    | 2 个 12 位 SAR ADC，共 20 个通道          | 能读取模拟传感器                      |
| USB    | 内置全速 USB OTG（GPIO19=DM, GPIO20=DP） | 原生 USB！可直连电脑，不用转串口芯片          |
| 摄像头接口  | DVP 8/16 位接口                       | 能直接接摄像头模组                     |
| AI 加速  | 硬件向量指令                             | 跑神经网络推理比纯软件快几倍                |
| LCD 接口 | SPI/QSPI/RGB 接口                    | 能驱动彩色 LCD 屏幕                  |
| 触摸传感器  | 14 个电容触摸通道                         | 能做触摸按键                        |
| 深度睡眠功耗 | 约 10 μA                            | 电池能用很久                        |

### 1.3 型号编码怎么看？

ESP32-S3-WROOM-1 有很多子型号，关键看后缀：

```
ESP32-S3-WROOM-1-N16R8
                  ││  ││
                  ││  └─── R8 = 8MB Octal PSRAM
                  │└────── N16 = 16MB Nor Flash
                  └─────── WROOM-1 = 标准模组（板载天线）
```

**常见配置一览：**

| 型号后缀      | Flash    | PSRAM   | 适合场景                  |
| --------- | -------- | ------- | --------------------- |
| N4        | 4MB      | 无       | 简单控制、传感器采集            |
| N8        | 8MB      | 无       | 中等复杂固件、双分区 OTA        |
| N16       | 16MB     | 无       | 大固件、OTA、字库            |
| N4R2      | 4MB      | 2MB     | 带屏幕的简单项目              |
| N8R2      | 8MB      | 2MB     | 带屏幕 + WiFi 通信         |
| **N16R8** | **16MB** | **8MB** | **摄像头、AI推理、复杂应用（顶配）** |
| N8R8      | 8MB      | 8MB     | AI 推理但固件不大            |

**U 后缀**（如 WROOM-1U）：外接 IPEX 天线接口，适合装在金属外壳里的设备。

> **新手建议**：如果你还没买板子，推荐 **N16R8** 或 **N8R2** 版本。N16R8 是顶配，一步到位；N8R2 性价比高。开发板背面或包装上通常会印完整型号。

### 1.4 GPIO 避坑指南（重要！必读！）

ESP32-S3 有 45 个 GPIO（GPIO0 ~ GPIO21 + GPIO26 ~ GPIO48），但很多引脚有特殊用途，**不能随便用**。这是新手最常踩的坑！

#### 完全不能用的引脚（模组内部已占用）

| 引脚              | 占用原因           | 说明              |
| --------------- | -------------- | --------------- |
| GPIO26 ~ GPIO32 | Flash（SPI）     | 外挂 Flash 芯片的通信线 |
| GPIO33 ~ GPIO37 | PSRAM（SPI/OPI） | 外挂 PSRAM 芯片的通信线 |
| GPIO19          | USB DM（D-）     | 内置 USB 数据负      |
| GPIO20          | USB DP（D+）     | 内置 USB 数据正      |

> 如果你的模组没有 PSRAM（如 N4、N8、N16 无 R 后缀的），GPIO33~37 可能被释放，但很多开发板仍然物理连接了 PSRAM 焊盘，**实际使用时仍建议避开**，除非你确认板子确实没焊 PSRAM 芯片。

#### 上电时有特殊使命的引脚（Strapping Pins）——可以谨慎使用

这些引脚在**芯片上电/复位的瞬间**会被采样，决定芯片的启动行为。启动完成后可以用作普通 GPIO，但你必须确保你的外设电路不会在上电时把这些脚拉到错误的电平。

| 引脚     | 上电功能            | 推荐状态      | 使用建议                       |
| ------ | --------------- | --------- | -------------------------- |
| GPIO0  | 与 GPIO46 决定启动模式 | 拉高 = 正常运行 | **低电平进入下载模式**，接设备时要确保不拉低   |
| GPIO3  | 控制 JTAG 使能      | 默认使能 JTAG | 如果不用 JTAG 调试，可用作普通 IO      |
| GPIO45 | 配置 VDD_SPI 电压   | 拉高 = 3.3V | 接设备时要确保不拉低，否则 Flash 可能无法工作 |
| GPIO46 | 决定启动模式 + ROM 日志 | 拉高 = 正常启动 | 不要做输出用，可做输入                |
| GPIO47 | 保留（Strapping）   | —         | 尽量不用                       |

#### 仅输入的引脚（不能做输出）

| 引脚     | 说明          |
| ------ | ----------- |
| GPIO46 | 只能做输入，无内部上拉 |

#### 可以放心使用的引脚（推荐新手首选）

| 引脚              | 备注                       |
| --------------- | ------------------------ |
| GPIO1 ~ GPIO2   | 普通双功能 IO，任意使用            |
| GPIO4 ~ GPIO6   | 普通双功能 IO，任意使用            |
| GPIO7 ~ GPIO18  | 普通双功能 IO，任意使用            |
| GPIO21          | 普通双功能 IO，任意使用            |
| GPIO38 ~ GPIO42 | 普通双功能 IO，任意使用            |
| GPIO43          | 通常做 UART0 TX（串口发送），也可以复用 |
| GPIO44          | 通常做 UART0 RX（串口接收），也可以复用 |

> **新手黄金法则**：如果不确定用哪个脚，就选 **GPIO1, GPIO2, GPIO4, GPIO5, GPIO6, GPIO7** 这些，最安全。

### 1.5 ESP32-S3 与 ESP32-C3 的核心差异

| 维度   | ESP32-C3              | ESP32-S3                 |
| ---- | --------------------- | ------------------------ |
| 处理器  | RISC-V 单核 160MHz      | Xtensa LX7 **双核** 240MHz |
| 内存   | 400KB SRAM            | **512KB** SRAM           |
| GPIO | 11 个可用                | **26-35 个**可用            |
| USB  | 无原生 USB（需要 USB 转串口芯片） | **内置 USB OTG**（直连电脑）     |
| 摄像头  | 不支持                   | **支持 DVP 摄像头**           |
| LCD  | 不支持                   | **支持 SPI/RGB LCD**       |
| ADC  | 12位                   | 12位（2个ADC，通道更多）          |
| 触摸   | 无                     | **14路电容触摸**              |
| AI加速 | 无                     | **向量指令加速**               |
| 适合场景 | 简单控制、传感器              | **屏幕驱动、AI推理、摄像头**        |

> 简单说：C3 便宜够用做简单项目，S3 是性能版，双核+大内存+USB+摄像头，能做更酷的东西。

### 1.6 板子上的东西长什么样？

ESP32-S3-WROOM-1 开发板（以最常见的 DevKitC 为例）：

```
    ┌──────────────────────────────────────────────────┐
    │                                                  │
    │  [天线区]         ESP32-S3-WROOM-1 模组         │
    │                  ┌────────────────┐              │
    │                  │  金属屏蔽罩    │              │
    │                  │ (芯片+Flash    │   [BOOT按键] │
    │                  │  +PSRAM)       │              │
    │                  └────────────────┘   [RST按键]  │
    │                                       [RGB LED] │
    │                                                  │
    │  [Type-C USB接口]                               │
    │                                                  │
    │  [排针引脚]                           [排针引脚] │
    │  3V3  GND  ...                       ... TX RX  │
    └──────────────────────────────────────────────────┘
```

**板上关键部件：**

1. **ESP32-S3-WROOM-1 模组**：那个方形金属屏蔽罩就是核心模组
2. **Type-C USB 口**：供电 + 数据通信（烧录 + 串口）
3. **BOOT 按键**：按住再按 RESET 进入刷机模式
4. **RESET 按键**：重启芯片
5. **LED**：可能是单色或 RGB（WS2812），位置因板子而异
6. **排针**：左右两侧各一排，是 GPIO 引出脚

> **注意**：不同厂家的开发板布局可能不同，但核心元素（模组、USB 口、BOOT/RST 键）一定有。拿到板子后先看清丝印标注。

---

## 第二章 开箱与硬件检查

### 2.1 你需要准备什么

**必备：**

1. ESP32-S3-WROOM-1 开发板一块
2. 一根 **Type-C 数据线**（必须是数据线，不是只能充电的线！）
3. 一台 Windows 电脑（Win10/11 均可）

**可选：**

4. 面包板 + 杜邦线若干（接外部设备时用）
5. USB 扩展 hub（如果电脑 USB 口不够）

### 2.2 检查数据线能否传输数据

这是**最常被忽略的问题**！很多线只能充电不能传数据。

**测试方法：**

1. 用这根线把开发板插到电脑
2. 打开「设备管理器」（Win+X → 设备管理器）
3. 看「端口(COM 和 LPT)」是否出现新的 COM 口
4. 如果出现了 → 线没问题
5. 如果什么都没出现 → 换一根线试试

> **经验法则**：那种特别细、特别软的线通常是纯充电线；稍微粗一点、硬一点的一般是数据线。买线时认准「支持数据传输」。

### 2.3 确认模组具体型号

开发板背面或模组金属屏蔽罩的标签上，会印着类似这样的文字：

```
ESP32-S3-WROOM-1-N16R8
```

记住最后的 **NxxRxx** 部分，后续配置需要用到。如果你的是 N8R2、N4 等其他型号，很多步骤一样，但 Flash/PSRAM 配置会有差异。

### 2.4 首次上电检查

1. 用 Type-C 线连接开发板和电脑
2. 观察板子：
   - 有一个 LED 应该亮起（电源指示）或闪烁（出厂测试程序）
   - 电脑发出「叮」的 USB 接入声
3. 打开设备管理器，确认出现了新的 COM 端口

如果以上都正常，说明板子基本没问题，可以继续往下做。

---

## 第三章 查看COM口与驱动安装

### 3.1 查看 COM 口

1. **按 Win+X**，选择「设备管理器」
2. 展开「端口(COM 和 LPT)」
3. 你应该看到类似这样的条目：

```
端口 (COM 和 LPT)
  ├─ 通信端口 (COM1)
  └─ USB 串行设备 (COM3)    ← 这就是你的 ESP32-S3
```

记住这个 COM 号（如 COM3），后面会反复用到。

> **Windows 11 特殊提示**：如果设备管理器里看不到「端口(COM 和 LPT)」这一项，点击菜单栏「查看」→「显示隐藏的设备」，或者先插上板子再打开设备管理器。

### 3.2 ESP32-S3 的两种 USB 连接方式

ESP32-S3 有**两种 USB 通信路径**，这一点与 ESP32-C3 不同，必须搞清楚：

#### 方式一：通过板载 USB 转串口芯片（UART 方式）

很多开发板上有一个额外的芯片（如 CH340、CP2102、CH343），它把 USB 信号转换为 UART 串口信号。这种方式的 COM 口用于**烧录和串口监视**。

- 设备管理器里显示为：「USB-SERIAL CH340 (COMx)」或类似名称
- 需要安装对应驱动
- 烧录时需要手动按 BOOT 键进入下载模式

#### 方式二：通过 ESP32-S3 内置 USB OTG（USB 直连方式）

ESP32-S3 芯片本身就有 USB 功能，GPIO19(D-) 和 GPIO20(D+) 可以直接连到 USB 口。这种方式：

- 设备管理器里可能显示为：「USB 串行设备 (COMx)」
- **Win10/11 免驱**，即插即用
- 支持更高烧录速度
- 可以做 USB 键盘/鼠标/游戏手柄等花样

> **关键区别**：有些开发板**两个 USB 口都有**（一个走 UART 芯片，一个走内置 USB），有些**只有一个口**（走内置 USB 或 UART 芯片其中之一）。请看你的板子丝印标注。

**判断你的板子是哪种方式：**

- 如果设备管理器显示 **CH340 / CP2102 / CH343** → UART 方式
- 如果显示 **USB 串行设备** 或 **ESP32-S3** → 内置 USB 方式

### 3.3 安装驱动（按需）

#### 如果你用的是 UART 方式（CH340/CP2102）

需要安装对应驱动：

- **CH340**：搜索「CH340 驱动下载」，安装后重启电脑
- **CP2102**：搜索「CP2102 驱动下载」，安装后重启电脑
- **CH343**：搜索「CH343 驱动下载」安装

安装后重新插拔 USB，确认 COM 口出现。

#### 如果你用的是内置 USB 方式

Win10/11 通常免驱，插上就能识别。如果没有识别：

1. 尝试换一个 USB 口
2. 尝试换一根数据线
3. 按住 BOOT 键再插 USB（强制进入下载模式）

### 3.4 确认 COM 口能正常通信

1. 记住你的 COM 口号
2. 打开任意串口工具（如 Arduino IDE 串口监视器、PuTTY、Thonny）
3. 连接该 COM 口，波特率设为 115200
4. 按一下板子上的 RESET 键
5. 如果看到一堆启动信息滚动出现，说明通信正常

---

## 第四章 检查板子基本功能是否正常

### 4.1 用 esptool 检测芯片

先安装 esptool（乐鑫官方烧录工具）：

```bash
pip install esptool
```

> 如果 pip 找不到，说明 Python 没装或没加 PATH。去 python.org 下载安装 Python，安装时**务必勾选「Add Python to PATH」**。

然后执行（COM 口号换成你自己的）：

```bash
esptool.py -p COM3 chip_id
```

正常的话你会看到：

```
Detecting chip type... ESP32-S3
Chip is ESP32-S3 (revision v0.1)
Features: Wi-Fi, BLE, co-processor, Universal MAC (no CRC)
Crystal is 40MHz
MAC: xx:xx:xx:xx:xx:xx
```

如果报错 `Timed out waiting for packet header`：

- 确认 COM 口号正确
- 尝试先按住 BOOT 键，再执行命令，然后松开 BOOT 键
- 换一根数据线

### 4.2 读取 Flash 信息

```bash
esptool.py -p COM3 flash_id
```

你会看到 Flash 大小、厂商等信息。确认和你的模组标注一致（如 N16 = 16MB Flash）。

### 4.3 读取 PSRAM 信息

```bash
esptool.py -p COM3 --chip esp32s3 read_mac
```

或者，用更详细的方式（需要先烧入固件后查看启动日志），PSRAM 信息会在启动时打印出来。

---

## 第五章 方案一：Arduino IDE 开发（C/C++）

### 5.1 安装 Arduino IDE

1. 前往 https://www.arduino.cc/en/software 下载 Arduino IDE 2.x（推荐）
2. 安装时一路下一步即可
3. 首次打开可能较慢，耐心等

### 5.2 添加 ESP32 开发板支持

1. 打开 Arduino IDE
2. 点击菜单「文件」→「首选项」(File → Preferences)
3. 在「附加开发板管理器网址」中填入：

```
https://espressif.github.io/arduino-esp32/package_esp32_index.json
```

如果已有其他网址，用换行或逗号分隔，不要覆盖之前的。

4. 点击「确定」
5. 点击菜单「工具」→「开发板」→「开发板管理器」
6. 搜索 **esp32**
7. 找到 **esp32 by Espressif Systems**，点击「安装」
8. 等待下载安装完成（文件较大，可能需要几分钟到十几分钟）

> **下载慢？** 这是 GitHub 托管的文件，可能需要科学上网。如果实在下不了，搜索「Arduino ESP32 离线安装包」找国内镜像。

### 5.3 选择正确的开发板

1. 点击菜单「工具」→「开发板」→ 找到 **esp32** 分组
2. 选择 **ESP32S3 Dev Module**

> 不要选 "ESP32 Dev Module"，那是老款 ESP32 的。也不要选 "ESP32C3 Dev Module"。必须选 **ESP32S3**。

### 5.4 关键配置项（新手必看！）

选择了 ESP32S3 Dev Module 后，还需要配置几个关键参数：

点击「工具」菜单，依次设置：

| 配置项              | 推荐设置                                                     | 解释                                       |
| ---------------- | -------------------------------------------------------- | ---------------------------------------- |
| Upload Speed     | 921600                                                   | 上传速度，越快越好                                |
| USB CDC On Boot  | **Enabled**                                              | 开启后 Serial 走 USB，不用 UART 芯片也能看串口输出       |
| CPU Frequency    | 240MHz                                                   | 最大性能                                     |
| Flash Mode       | QIO 或 QOUT                                               | QIO 更快，QOUT 兼容性更好，不确定就选 QOUT             |
| Flash Size       | 根据你的模组（N8=8MB, N16=16MB）                                 | 选错可能空间不够或浪费                              |
| Partition Scheme | **Default 4MB with spiffs** 或 **Huge APP**               | 选 Huge APP 给程序更多空间；带了 PSRAM 就不用太担心分区     |
| PSRAM            | **OPI PSRAM**（N16R8/R8型号） 或 **OPI PSRAM** / **Disabled** | 有 R8/R2 后缀的选 OPI；无 PSRAM 的选 Disabled     |
| Upload Mode      | **UART0 / Hardware CDC**                                 | 有内置 USB 选 Hardware CDC；通过 UART 芯片选 UART0 |
| Upload Reset     | No dtr / dtr 失败再换                                        | 一般默认即可                                   |

**最关键的配置——USB CDC On Boot：**

- 设置为 **Enabled**：程序中的 `Serial.println()` 直接通过内置 USB 输出，不依赖 UART 芯片。这就是 ESP32-S3 最大的优势！
- 设置为 Disabled：Serial 走传统 UART0（GPIO43 TX / GPIO44 RX）

> **强烈建议新手开启 USB CDC On Boot**！这样可以一根 USB 线搞定烧录+调试+供电，省去很多麻烦。

### 5.5 连接开发板

1. 用 Type-C 线连接开发板和电脑
2. 在「工具」→「端口」中选择你的 COM 口
3. 如果找不到 COM 口，检查驱动和数据线

### 5.6 第一个程序：Hello World

```cpp
// 第一个程序：串口输出 Hello World
void setup() {
  // 注意：开启了 USB CDC On Boot 后，用 Serial 即可
  // 如果没开启 USB CDC On Boot，需要指定波特率
  Serial.begin(115200);
  delay(1000);  // 等待串口就绪

  Serial.println("Hello, ESP32-S3!");
  Serial.println("我是一块 ESP32-S3-WROOM-1 开发板");
}

void loop() {
  Serial.println("运行中...");
  delay(2000);  // 每2秒打印一次
}
```

**步骤：**

1. 新建一个 Sketch（文件 → 新建）
2. 把上面的代码粘贴进去
3. 点击「上传」按钮（右箭头图标）
4. 等待编译和上传完成
5. 打开「串口监视器」（工具 → 串口监视器），波特率设为 115200
6. 你应该看到 "Hello, ESP32-S3!" 和 "运行中..." 的输出

> **上传失败了？** 看提示信息：
> 
> - 如果提示 `Timed out waiting for packet header`：按住 BOOT 键再点上传，出现 Connecting... 后松开 BOOT 键
> - 如果提示 `Failed to connect`：检查 COM 口是否正确，换根线试试

### 5.7 第二个程序：LED 闪烁

ESP32-S3 开发板上的 LED 引脚因板子而异，常见的有 GPIO2、GPIO38、GPIO48 等。**请看你的板子丝印标注**。以下以 GPIO2 为例：

```cpp
// LED 闪烁
#define LED_PIN 2  // 改成你板子上的 LED 引脚号

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);  // 点亮
  Serial.println("LED ON");
  delay(500);

  digitalWrite(LED_PIN, LOW);   // 熄灭
  Serial.println("LED OFF");
  delay(500);
}
```

如果板子上是 RGB LED（WS2812），代码会不同，见示例程序集。

---

## 第六章 方案二：MicroPython 开发（Python）

### 6.1 为什么选 MicroPython？

- **语法超简单**：Python 语法，几行代码就能控制硬件
- **交互式开发**：在 REPL 里直接输入命令，立刻看到结果
- **不需要编译**：改完代码直接运行，比 Arduino 快
- **适合快速原型**：想法变现实的速度最快

> 但 MicroPython 性能不如 C/C++，不适合对时序要求极高的场景。

### 6.2 下载 MicroPython 固件

1. 前往 MicroPython 官方下载页：
   
   ```
   https://micropython.org/download/ESP32_GENERIC_S3/
   ```

2. 下载最新的 `.bin` 文件，文件名类似：
   
   ```
   ESP32_GENERIC_S3-20260115-v1.25.0.bin
   ```

3. 把下载的 `.bin` 文件放到一个你找得到的目录（如桌面）

> **如果有 PSRAM**（N16R8 / N8R2 等），下载带 **SPIRAM** 字样的版本会更好，能使用更多内存。如果你不确定，普通版也能跑。

### 6.3 方法一：用 Thonny 烧录（推荐新手）

Thonny 是一个超简单的 Python IDE，内置了 MicroPython 烧录工具。

#### 安装 Thonny

1. 前往 https://thonny.org/ 下载安装 Thonny
2. 安装完成后打开

#### 烧录 MicroPython

1. 用 USB 线连接开发板
2. 打开 Thonny
3. 点击菜单「运行」→「配置解释器」
4. 解释器选择 **MicroPython (ESP32)**
5. 点击右下角的「安装或更新 MicroPython」
6. 在弹出的窗口中：
   - **端口**：选择你的 ESP32-S3 的 COM 口
   - **Firmware**：浏览选择你下载的 `.bin` 文件
   - 勾选「擦除 Flash 后安装」
7. 点击「安装」
8. 等待进度条完成（约 1-2 分钟）
9. 看到 "Done" 提示即成功

> **烧录失败？** 按住 BOOT 键再点安装，出现连接后松开。

### 6.4 方法二：用 esptool 命令行烧录

#### 第一步：擦除 Flash

```bash
esptool.py --chip esp32s3 -p COM3 erase_flash
```

#### 第二步：写入固件

```bash
esptool.py --chip esp32s3 -p COM3 write_flash -z 0x0 ESP32_GENERIC_S3-20260115-v1.25.0.bin
```

> `-z` 表示压缩传输，速度更快。`0x0` 是写入起始地址，必须是 0。

#### 如果连不上（UART 方式）

先按住 BOOT 键，再执行命令，看到 `Connecting...` 后松开 BOOT 键。

### 6.5 验证 MicroPython 是否成功

1. 打开 Thonny

2. 底部 Shell 窗口应该显示：
   
   ```
   MicroPython v1.25.0 on 2026-01-15; ESP32S3 module with ESP32S3
   >>>
   ```

3. 输入：
   
   ```python
   print("Hello, ESP32-S3!")
   ```

4. 如果输出 `Hello, ESP32-S3!`，恭喜你，成功了！

### 6.6 第一个程序：LED 闪烁

在 Thonny 中新建文件，输入以下代码：

```python
from machine import Pin
import time

# 修改为你板子上的 LED 引脚号
led = Pin(2, Pin.OUT)

while True:
    led.value(1)    # 点亮
    print("LED ON")
    time.sleep(0.5)
    led.value(0)    # 熄灭
    print("LED OFF")
    time.sleep(0.5)
```

点击「运行」按钮（绿色三角），LED 应该开始闪烁。

### 6.7 保存程序到开发板

上面只是临时运行，断电就没了。要把程序永久保存：

1. 在 Thonny 中点击「文件」→「另存为」
2. 选择 **MicroPython 设备**
3. 文件名必须为 **`main.py`**（这是 MicroPython 开机自运行的文件名）
4. 保存后按 RESET 键，程序会自动运行

---

## 第七章 示例程序集

以下每个示例提供 **Arduino (C/C++)** 和 **MicroPython** 两个版本。
引脚号用注释标注，请根据你的实际接线修改。

### 7.1 LED 呼吸灯（PWM）

**Arduino 版：**

```cpp
// 7.1 LED 呼吸灯
#define LED_PIN 2  // 改成你的 LED 引脚

void setup() {
  // ESP32-S3 的 LEDC PWM 使用方式
  ledcAttach(LED_PIN, 5000, 8);  // 引脚, 频率5kHz, 8位分辨率(0-255)
}

void loop() {
  // 渐亮
  for (int brightness = 0; brightness <= 255; brightness++) {
    ledcWrite(LED_PIN, brightness);
    delay(5);
  }
  // 渐暗
  for (int brightness = 255; brightness >= 0; brightness--) {
    ledcWrite(LED_PIN, brightness);
    delay(5);
  }
}
```

**MicroPython 版：**

```python
# 7.1 LED 呼吸灯
from machine import Pin, PWM
import time

led = PWM(Pin(2))  # 改成你的 LED 引脚
led.freq(5000)      # 5kHz PWM 频率

while True:
    # 渐亮
    for brightness in range(0, 1024, 4):  # MicroPython PWM 精度 0-1023
        led.duty(brightness)
        time.sleep_ms(5)
    # 渐暗
    for brightness in range(1023, -1, -4):
        led.duty(brightness)
        time.sleep_ms(5)
```

### 7.2 按键输入检测

**Arduino 版：**

```cpp
// 7.2 按键输入检测
#define BUTTON_PIN 4   // 按键接 GPIO4
#define LED_PIN 2      // LED 接 GPIO2

bool ledState = false;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // 启用内部上拉电阻
}

void loop() {
  if (digitalRead(BUTTON_PIN) == LOW) {  // 按键按下为低电平
    delay(50);  // 消抖
    if (digitalRead(BUTTON_PIN) == LOW) {
      ledState = !ledState;  // 切换 LED 状态
      digitalWrite(LED_PIN, ledState);
      Serial.printf("按键按下！LED = %s\n", ledState ? "ON" : "OFF");
      while (digitalRead(BUTTON_PIN) == LOW) {
        delay(10);  // 等待按键释放
      }
    }
  }
}
```

**MicroPython 版：**

```python
# 7.2 按键输入检测
from machine import Pin
import time

button = Pin(4, Pin.IN, Pin.PULL_UP)  # 按键接 GPIO4
led = Pin(2, Pin.OUT)                  # LED 接 GPIO2
led_state = False

while True:
    if button.value() == 0:  # 按下
        time.sleep_ms(50)    # 消抖
        if button.value() == 0:
            led_state = not led_state
            led.value(led_state)
            print(f"按键按下！LED = {'ON' if led_state else 'OFF'}")
            while button.value() == 0:
                time.sleep_ms(10)
```

### 7.3 WiFi 连接

**Arduino 版：**

```cpp
// 7.3 WiFi 连接
#include <WiFi.h>

const char* ssid = "你的WiFi名";
const char* password = "你的WiFi密码";

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.printf("正在连接 WiFi: %s\n", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n连接成功！");
    Serial.printf("IP 地址: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("信号强度: %d dBm\n", WiFi.RSSI());
  } else {
    Serial.println("\n连接失败！请检查 WiFi 名称和密码");
  }
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("信号: %d dBm | IP: %s\n",
                  WiFi.RSSI(), WiFi.localIP().toString().c_str());
  } else {
    Serial.println("WiFi 断开，尝试重连...");
    WiFi.reconnect();
  }
  delay(5000);
}
```

**MicroPython 版：**

```python
# 7.3 WiFi 连接
import network
import time

ssid = "你的WiFi名"
password = "你的WiFi密码"

wlan = network.WLAN(network.STA_IF)
wlan.active(True)

print(f"正在连接 WiFi: {ssid}")
wlan.connect(ssid, password)

attempts = 0
while not wlan.isconnected() and attempts < 20:
    print(".", end="")
    time.sleep(1)
    attempts += 1

if wlan.isconnected():
    print(f"\n连接成功！")
    print(f"IP 地址: {wlan.ifconfig()[0]}")
else:
    print("\n连接失败！请检查 WiFi 名称和密码")

# 持续监控
while True:
    if wlan.isconnected():
        print(f"信号正常 | IP: {wlan.ifconfig()[0]}")
    else:
        print("WiFi 断开，尝试重连...")
        wlan.connect(ssid, password)
    time.sleep(5)
```

### 7.4 HTTP 请求（获取网络数据）

**Arduino 版：**

```cpp
// 7.4 HTTP GET 请求
#include <WiFi.h>
#include <HTTPClient.h>

const char* ssid = "你的WiFi名";
const char* password = "你的WiFi密码";

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi 已连接");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    // 示例：获取一个简单 API
    http.begin("http://httpbin.org/get");
    int httpCode = http.GET();

    if (httpCode > 0) {
      Serial.printf("HTTP 状态码: %d\n", httpCode);
      String payload = http.getString();
      Serial.println("响应内容：");
      Serial.println(payload);
    } else {
      Serial.printf("请求失败: %s\n", http.errorToString(httpCode).c_str());
    }
    http.end();
  }
  delay(10000);  // 每10秒请求一次
}
```

**MicroPython 版：**

```python
# 7.4 HTTP GET 请求
import network
import urequests
import time

ssid = "你的WiFi名"
password = "你的WiFi密码"

wlan = network.WLAN(network.STA_IF)
wlan.active(True)
wlan.connect(ssid, password)

while not wlan.isconnected():
    time.sleep(1)
print(f"WiFi 已连接，IP: {wlan.ifconfig()[0]}")

while True:
    try:
        response = urequests.get("http://httpbin.org/get")
        print(f"状态码: {response.status_code}")
        print(f"内容: {response.text[:200]}")  # 只打印前200字
        response.close()
    except Exception as e:
        print(f"请求失败: {e}")
    time.sleep(10)
```

### 7.5 读取模拟传感器（ADC）

**Arduino 版：**

```cpp
// 7.5 读取模拟传感器
// 假设一个光敏电阻接在 GPIO1 上

#define SENSOR_PIN 1  // ADC1_CH0 = GPIO1

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);   // 12 位精度 (0-4095)
  analogSetAttenuation(ADC_11db);  // 量程 0-3.3V
}

void loop() {
  int raw = analogRead(SENSOR_PIN);
  float voltage = raw * 3.3 / 4095.0;

  Serial.printf("原始值: %4d | 电压: %.2fV\n", raw, voltage);

  // 简单判断光照强度
  if (raw > 3000) {
    Serial.println("  → 很亮（强光）");
  } else if (raw > 1500) {
    Serial.println("  → 正常（室内光）");
  } else {
    Serial.println("  → 暗淡");
  }

  delay(1000);
}
```

**MicroPython 版：**

```python
# 7.5 读取模拟传感器
from machine import ADC, Pin
import time

# ESP32-S3 的 ADC1 通道映射：GPIO1=ADC1_CH0, GPIO2=ADC1_CH1, 等
sensor = ADC(Pin(1))  # 光敏电阻接 GPIO1
sensor.atten(ADC.ATTN_11DB)  # 量程 0-3.3V
sensor.width(ADC.WIDTH_12BIT)  # 12位精度

while True:
    raw = sensor.read()
    voltage = raw * 3.3 / 4095

    print(f"原始值: {raw:4d} | 电压: {voltage:.2f}V")

    if raw > 3000:
        print("  → 很亮（强光）")
    elif raw > 1500:
        print("  → 正常（室内光）")
    else:
        print("  → 暗淡")

    time.sleep(1)
```

### 7.6 I2C 温湿度传感器（BME280）

**接线：**

| BME280  | ESP32-S3 |
| ------- | -------- |
| VIN/VCC | 3V3      |
| GND     | GND      |
| SDA     | GPIO7    |
| SCL     | GPIO6    |

> GPIO6/7 是安全引脚，不用担心冲突。

**Arduino 版：**

```cpp
// 7.6 I2C 温湿度传感器 BME280
// 需要安装库：Adafruit BME280 Library
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>

#define SDA_PIN 7
#define SCL_PIN 6

Adafruit_BME280 bme;

void setup() {
  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);

  if (!bme.begin(0x76)) {  // 常见 I2C 地址：0x76 或 0x77
    Serial.println("找不到 BME280 传感器！请检查接线");
    while (1);
  }
  Serial.println("BME280 初始化成功！");
}

void loop() {
  float temp = bme.readTemperature();
  float hum = bme.readHumidity();
  float pres = bme.readPressure() / 100.0F;  // Pa → hPa

  Serial.printf("温度: %.1f°C | 湿度: %.1f%% | 气压: %.1fhPa\n",
                temp, hum, pres);
  delay(2000);
}
```

**MicroPython 版：**

```python
# 7.6 I2C 温湿度传感器 BME280
# 需要先上传 bme280.py 库文件到开发板
from machine import I2C, Pin
import time

# 导入 BME280 库（需要先安装）
try:
    import bme280
except ImportError:
    print("缺少 bme280 库！请从以下地址下载 bme280.py 并保存到开发板：")
    print("https://github.com/robert-hh/BME280")
    raise

i2c = I2C(0, scl=Pin(6), sda=Pin(7), freq=400000)
bme = bme280.BME280(i2c=i2c, addr=0x76)

while True:
    temp, pres, hum = bme.values
    print(f"温度: {temp} | 湿度: {hum} | 气压: {pres}")
    time.sleep(2)
```

### 7.7 SSD1306 OLED 显示屏

**接线：**

| SSD1306 | ESP32-S3 |
| ------- | -------- |
| VCC     | 3V3      |
| GND     | GND      |
| SDA     | GPIO7    |
| SCL     | GPIO6    |

**Arduino 版：**

```cpp
// 7.7 SSD1306 OLED 显示
// 需要安装：Adafruit SSD1306 + Adafruit GFX Library
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SDA_PIN 7
#define SCL_PIN 6
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

void setup() {
  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 初始化失败！");
    while (1);
  }

  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Hello");
  display.println("ESP32-S3!");
  display.display();

  Serial.println("OLED 显示成功！");
}

void loop() {
  // 显示计数器
  static int count = 0;
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.printf("Counter: %d\n", count);
  display.printf("Heap: %d bytes\n", ESP.getFreeHeap());
  display.display();
  count++;
  delay(1000);
}
```

**MicroPython 版：**

```python
# 7.7 SSD1306 OLED 显示
from machine import I2C, Pin
import ssd1306
import time
import gc

i2c = I2C(0, scl=Pin(6), sda=Pin(7), freq=400000)
display = ssd1306.SSD1306_I2C(128, 64, i2c, addr=0x3C)

display.fill(0)
display.text("Hello", 0, 0, 1)
display.text("ESP32-S3!", 0, 16, 1)
display.show()

print("OLED 显示成功！")

count = 0
while True:
    display.fill(0)
    display.text(f"Counter: {count}", 0, 0, 1)
    display.text(f"Free: {gc.mem_free()}B", 0, 16, 1)
    display.show()
    count += 1
    time.sleep(1)
```

### 7.8 WS2812 RGB LED 灯带

ESP32-S3 开发板上的 RGB LED 通常是 WS2812（也叫 NeoPixel），接在某个 GPIO 上。

**Arduino 版：**

```cpp
// 7.8 WS2812 RGB LED
// 需要安装库：Adafruit NeoPixel
#include <Adafruit_NeoPixel.h>

#define RGB_PIN 48   // 改成你板子的 RGB LED 引脚（常见：38 或 48）
#define NUM_PIXELS 1 // 板上通常只有1颗 RGB LED

Adafruit_NeoPixel pixels(NUM_PIXELS, RGB_PIN, NEO_GRB + NEO_KHZ800);

void setup() {
  Serial.begin(115200);
  pixels.begin();
  pixels.setBrightness(30);  // 亮度 0-255，别太亮刺眼
  Serial.println("RGB LED 初始化完成");
}

void loop() {
  // 红色
  pixels.setPixelColor(0, pixels.Color(255, 0, 0));
  pixels.show();
  Serial.println("红色");
  delay(1000);

  // 绿色
  pixels.setPixelColor(0, pixels.Color(0, 255, 0));
  pixels.show();
  Serial.println("绿色");
  delay(1000);

  // 蓝色
  pixels.setPixelColor(0, pixels.Color(0, 0, 255));
  pixels.show();
  Serial.println("蓝色");
  delay(1000);

  // 彩虹渐变
  for (int hue = 0; hue < 360; hue += 5) {
    int r = 128 + 127 * sin(hue * 3.14159 / 180);
    int g = 128 + 127 * sin((hue + 120) * 3.14159 / 180);
    int b = 128 + 127 * sin((hue + 240) * 3.14159 / 180);
    pixels.setPixelColor(0, pixels.Color(r, g, b));
    pixels.show();
    delay(30);
  }
}
```

**MicroPython 版：**

```python
# 7.8 WS2812 RGB LED
from machine import Pin
import neopixel
import time
import math

RGB_PIN = 48    # 改成你板子的 RGB LED 引脚
NUM_PIXELS = 1  # 板上1颗

np = neopixel.NeoPixel(Pin(RGB_PIN), NUM_PIXELS)

def rainbow(hue):
    """将色相值转换为 RGB"""
    r = int(128 + 127 * math.sin(math.radians(hue)))
    g = int(128 + 127 * math.sin(math.radians(hue + 120)))
    b = int(128 + 127 * math.sin(math.radians(hue + 240)))
    return (r, g, b)

# 红、绿、蓝
for color, name in [((255,0,0), "红"), ((0,255,0), "绿"), ((0,0,255), "蓝")]:
    np[0] = color
    np.write()
    print(f"{name}色")
    time.sleep(1)

# 彩虹渐变
while True:
    for hue in range(0, 360, 5):
        np[0] = rainbow(hue)
        np.write()
        time.sleep_ms(30)
```

### 7.9 红黄绿信号灯控制

使用一个红黄绿三色 LED 模块（4个引脚：GND、R、Y、G）。

**接线：**

| LED 模块 | ESP32-S3 |
| ------ | -------- |
| GND    | GND      |
| R      | GPIO5    |
| Y      | GPIO6    |
| G      | GPIO7    |

> GPIO5/6/7 是安全引脚，放心用。

**Arduino 版：**

```cpp
// 7.9 红黄绿信号灯控制
#define RED_PIN 5
#define YELLOW_PIN 6
#define GREEN_PIN 7

void setup() {
  Serial.begin(115200);
  pinMode(RED_PIN, OUTPUT);
  pinMode(YELLOW_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);

  // 初始化全部熄灭
  digitalWrite(RED_PIN, LOW);
  digitalWrite(YELLOW_PIN, LOW);
  digitalWrite(GREEN_PIN, LOW);

  Serial.println("信号灯系统启动");
}

void loop() {
  // 绿灯 5 秒
  digitalWrite(GREEN_PIN, HIGH);
  Serial.println("🟢 绿灯 - 通行");
  delay(5000);
  digitalWrite(GREEN_PIN, LOW);

  // 黄灯 2 秒
  digitalWrite(YELLOW_PIN, HIGH);
  Serial.println("🟡 黄灯 - 注意");
  delay(2000);
  digitalWrite(YELLOW_PIN, LOW);

  // 红灯 5 秒
  digitalWrite(RED_PIN, HIGH);
  Serial.println("🔴 红灯 - 停止");
  delay(5000);
  digitalWrite(RED_PIN, LOW);
}
```

**MicroPython 版：**

```python
# 7.9 红黄绿信号灯控制
from machine import Pin
import time

red = Pin(5, Pin.OUT)
yellow = Pin(6, Pin.OUT)
green = Pin(7, Pin.OUT)

# 初始化全部熄灭
red.value(0)
yellow.value(0)
green.value(0)

print("信号灯系统启动")

while True:
    # 绿灯 5 秒
    green.value(1)
    print("绿灯 - 通行")
    time.sleep(5)
    green.value(0)

    # 黄灯 2 秒
    yellow.value(1)
    print("黄灯 - 注意")
    time.sleep(2)
    yellow.value(0)

    # 红灯 5 秒
    red.value(1)
    print("红灯 - 停止")
    time.sleep(5)
    red.value(0)
```

### 7.10 双核任务演示（ESP32-S3 独有特色）

ESP32-S3 最大的亮点之一就是**双核**。这个示例展示如何让两个核心同时做不同的事。

**Arduino 版：**

```cpp
// 7.10 双核任务演示
TaskHandle_t Task1, Task2;

// 核心0的任务：快速闪烁 LED
void task1_function(void *parameter) {
  int count = 0;
  while (true) {
    digitalWrite(2, !digitalRead(2));  // LED 翻转
    count++;
    Serial.printf("[核心0] LED 翻转 #%d\n", count);
    vTaskDelay(200 / portTICK_PERIOD_MS);  // 200ms
  }
}

// 核心1的任务：每隔 3 秒打印系统信息
void task2_function(void *parameter) {
  int count = 0;
  while (true) {
    count++;
    Serial.printf("[核心1] 系统信息 #%d | 空闲内存: %d bytes | 运行时间: %lus\n",
                  count, ESP.getFreeHeap(), millis() / 1000);
    vTaskDelay(3000 / portTICK_PERIOD_MS);  // 3s
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  delay(1000);

  Serial.println("双核任务演示启动！");
  Serial.printf("当前运行在核心: %d\n", xPortGetCoreID());

  // 在核心0上创建任务1
  xTaskCreatePinnedToCore(
    task1_function,   // 任务函数
    "Task1",          // 任务名
    4096,             // 栈大小
    NULL,             // 参数
    1,                // 优先级
    &Task1,           // 任务句柄
    0                 // 核心0
  );

  // 在核心1上创建任务2
  xTaskCreatePinnedToCore(
    task2_function,
    "Task2",
    4096,
    NULL,
    1,
    &Task2,
    1                 // 核心1
  );
}

void loop() {
  // 主循环运行在核心1，这里啥也不做
  vTaskDelay(1000 / portTICK_PERIOD_MS);
}
```

> **MicroPython 注意**：MicroPython 目前对 ESP32-S3 双核支持有限，通常只在一个核心上运行。如需充分利用双核，建议使用 Arduino/ESP-IDF。

### 7.11 触摸按键（ESP32-S3 独有特色）

ESP32-S3 内置 14 路电容触摸传感器，不需要额外硬件就能做触摸按键！

**Arduino 版：**

```cpp
// 7.11 电容触摸按键
#define TOUCH_PIN 4   // GPIO4 = Touch0
#define LED_PIN 2
#define TOUCH_THRESHOLD 40  // 触摸阈值（低于此值视为触摸）

bool ledState = false;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("触摸按键演示 - 用手指触摸 GPIO4 引脚");
}

void loop() {
  uint16_t touchValue = touchRead(TOUCH_PIN);
  Serial.printf("触摸值: %d ", touchValue);

  if (touchValue < TOUCH_THRESHOLD) {
    Serial.println("← 检测到触摸！");
    ledState = !ledState;
    digitalWrite(LED_PIN, ledState);
    delay(300);  // 防止连续触发
  } else {
    Serial.println("");
  }

  delay(100);
}
```

**MicroPython 版：**

```python
# 7.11 电容触摸按键
from machine import Pin, TouchPad
import time

touch = TouchPad(Pin(4))  # GPIO4 = Touch0
led = Pin(2, Pin.OUT)

THRESHOLD = 400  # 触摸阈值
print("触摸按键演示 - 用手指触摸 GPIO4 引脚")

while True:
    value = touch.read()
    if value < THRESHOLD:
        print(f"触摸值: {value} ← 检测到触摸！")
        led.value(not led.value())
        time.sleep_ms(300)
    else:
        print(f"触摸值: {value}")
    time.sleep_ms(100)
```

### 7.12 MQTT 消息收发（物联网通信）

**Arduino 版：**

```cpp
// 7.12 MQTT 消息收发
// 需要安装库：PubSubClient
#include <WiFi.h>
#include <PubSubClient.h>

const char* ssid = "你的WiFi名";
const char* password = "你的WiFi密码";
const char* mqtt_server = "broker.emqx.io";  // 公共 MQTT 服务器
const int mqtt_port = 1883;
const char* topic_sub = "esp32s3/test/in";
const char* topic_pub = "esp32s3/test/out";

WiFiClient espClient;
PubSubClient client(espClient);

void callback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.printf("收到消息 [%s]: %s\n", topic, message.c_str());
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("连接 MQTT...");
    String clientId = "ESP32S3-" + String(random(0xffff), HEX);
    if (client.connect(clientId.c_str())) {
      Serial.println("成功！");
      client.subscribe(topic_sub);
    } else {
      Serial.printf("失败，rc=%d，5秒后重试\n", client.state());
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi 已连接");

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  static unsigned long lastMsg = 0;
  if (millis() - lastMsg > 5000) {
    lastMsg = millis();
    String msg = "Hello from ESP32-S3! Uptime: " + String(millis() / 1000) + "s";
    client.publish(topic_pub, msg.c_str());
    Serial.printf("发送: %s\n", msg.c_str());
  }
}
```

### 7.13 红外遥控发射（NEC 协议）

**Arduino 版：**

```cpp
// 7.13 红外遥控发射
// 需要安装库：IRremoteESP8266
#include <IRsend.h>

#define IR_LED_PIN 5  // 红外 LED 接 GPIO5

IRsend irsend(IR_LED_PIN);

void setup() {
  Serial.begin(115200);
  irsend.begin();
  Serial.println("红外遥控发射演示");
  Serial.println("将发送 NEC 协议的电源按键码");
}

void loop() {
  // 发送 NEC 格式的电源码（地址 0x00FF, 命令 0x02FD）
  Serial.println("发送: NEC 0x00FF02FD (电源键)");
  irsend.sendNEC(0x00FF02FD, 32);
  delay(3000);
}
```

### 7.14 USB 键盘模拟（ESP32-S3 独有特色）

ESP32-S3 内置 USB，可以模拟键盘/鼠标！这是 C3 做不到的。

**Arduino 版：**

```cpp
// 7.14 USB 键盘模拟
// 需要 ESP32 Arduino Core 2.0+ 版本
// 配置: USB CDC On Boot = Enabled, Upload Mode = Hardware CDC

#include "USB.h"
#include "USBHIDKeyboard.h"

USBHIDKeyboard Keyboard;

void setup() {
  Serial.begin(115200);
  Keyboard.begin();
  USB.begin();
  delay(2000);

  Serial.println("USB 键盘模拟启动");
  Serial.println("每 5 秒自动输入文字");
}

void loop() {
  // 模拟打字
  Keyboard.print("Hello from ESP32-S3!");
  Keyboard.write(KEY_RETURN);
  Serial.println("已发送按键");
  delay(5000);
}
```

> **注意**：USB 键盘模拟程序烧录后，开发板会变成一个键盘设备。如果它不断打字导致你无法操作 IDE，按住 BOOT 键再按 RESET 进入下载模式，然后刷入其他程序即可。

### 7.15 简单 Web 服务器

**Arduino 版：**

```cpp
// 7.15 简单 Web 服务器
#include <WiFi.h>
#include <WebServer.h>

const char* ssid = "你的WiFi名";
const char* password = "你的WiFi密码";

WebServer server(80);
#define LED_PIN 2

void handleRoot() {
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>ESP32-S3 控制台</title></head>
<body style="font-family:Arial;text-align:center;margin-top:50px">
<h1>ESP32-S3 控制台</h1>
<p>LED 状态: <span id="status">未知</span></p>
<p>
<a href="/on"><button style="padding:15px 30px;font-size:18px">开灯</button></a>
<a href="/off"><button style="padding:15px 30px;font-size:18px">关灯</button></a>
</p>
</body>
</html>)rawliteral";
  server.send(200, "text/html", html);
}

void handleOn() {
  digitalWrite(LED_PIN, HIGH);
  server.sendHeader("Location", "/");
  server.send(303);
}

void handleOff() {
  digitalWrite(LED_PIN, LOW);
  server.sendHeader("Location", "/");
  server.send(303);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nWiFi 已连接，IP: %s\n", WiFi.localIP().toString().c_str());

  server.on("/", handleRoot);
  server.on("/on", handleOn);
  server.on("/off", handleOff);
  server.begin();
  Serial.println("Web 服务器已启动！");
  Serial.printf("浏览器访问: http://%s\n", WiFi.localIP().toString().c_str());
}

void loop() {
  server.handleClient();
}
```

---

## 第八章 常见问题与排错大全

### 8.1 设备管理器看不到 COM 口

**可能原因和解决方案：**

1. **数据线只能充电**：换一根数据线（最常见的坑！）
2. **驱动未安装**：
   - UART 方式（CH340）：安装 CH340 驱动
   - UART 方式（CP2102）：安装 CP2102 驱动
   - 内置 USB 方式：Win10/11 免驱
3. **插在了 USB Hub 上**：换到电脑直连 USB 口
4. **板子坏了**：插别的电脑试试，如果别的电脑也不行，可能板子有问题

**Windows 11 找不到「端口(COM 和 LPT)」：**

- 点击设备管理器菜单「查看」→「显示隐藏的设备」
- 或者先插上板子再打开设备管理器

### 8.2 esptool 连接超时

```
ERROR: Timed out waiting for packet header
```

**解决方案：**

1. **手动进入下载模式**：
   
   - 按住 BOOT 键不放
   - 点击一下 RESET 键
   - 松开 BOOT 键
   - 再执行 esptool 命令

2. **检查 COM 口**：确认用的是正确的 COM 号

3. **降低波特率**：加 `-b 115200` 参数

4. **换 USB 口**：有时候前置 USB 口供电不足

### 8.3 烧录成功但程序不运行

**可能原因：**

1. **USB CDC On Boot 配置不对**：如果程序用了 `Serial` 但没开启 USB CDC，日志走 UART0，看不到输出
2. **GPIO0 被拉低**：某个外设把 GPIO0 拉到低电平，芯片一直停在下载模式
3. **程序崩溃**：看串口输出是否有 `Guru Meditation Error` 或 `Backtrace`
4. **Flash 大小配置错误**：选了 4MB 但板子是 16MB，可能导致分区表错误

**解决步骤：**

1. 开启 USB CDC On Boot，重新烧录
2. 拔掉所有外部接线，只留 USB 线
3. 按一下 RESET 键
4. 查看串口（115200 波特率）是否有输出

### 8.4 反复重启（Watchdog / Guru Meditation Error）

**看串口输出的错误信息：**

1. **`Task watchdog got triggered`**：某个任务卡住了，没有及时喂看门狗
   
   - 检查是否有死循环没有 `delay()` 或 `vTaskDelay()`
   - 检查是否在 `setup()` 里卡住（比如 WiFi 连不上一直等）

2. **`Guru Meditation Error`**：程序崩溃
   
   - 可能是空指针访问
   - 可能是内存溢出
   - 检查代码中是否有未初始化的指针

3. **`panic` 后不断重启**：
   
   - 按住 BOOT + RESET 进入下载模式
   - 刷入一个简单的 Blink 程序确认板子正常
   - 然后逐步排查你的代码

### 8.5 串口监视器能看到输出，但输入指令没有反应

**可能原因：**

1. **行结束符设置不对**：
   
   - Arduino 串口监视器：右下角选择「NL 和 CR」
   - 串口工具需设置换行符为 `\r\n`

2. **USB CDC On Boot 导致**：
   
   - 如果程序用 USB CDC 做 Serial，上传后在某些工具里输入可能不走 USB 通道
   - 用 Arduino IDE 自带的串口监视器通常没问题

3. **程序没有读取串口输入的代码**：
   
   - 需要在代码中用 `Serial.readString()` 等函数读取输入

### 8.6 WiFi 连不上

1. **确认 2.4GHz**：ESP32-S3 **只支持 2.4GHz**，不支持 5GHz！很多路由器双频合一后，需要手动分离
2. **密码对不对**：注意大小写、特殊字符
3. **信号太弱**：离路由器近一点
4. **企业级 WiFi**：不支持 WPA2-Enterprise，需要 WPA2-PSK（个人版）

### 8.7 GPIO 接了设备但代码控制不了

1. **引脚号对不对**：ESP32-S3 的引脚编号可能和丝印上的数字不一致。看板子的引脚映射图
2. **用了不能用的引脚**：参考 1.4 节 GPIO 避坑指南
3. **GPIO19/20 被 USB 占了**：如果用内置 USB，这两个脚不能接别的东西
4. **GPIO26-37 被 Flash/PSRAM 占了**：这些脚绝对不能碰
5. **Strapping Pin 被拉低了**：GPIO0 被拉低会导致芯片进入下载模式而不是正常运行

### 8.8 上传报错 "Failed to connect"

1. 按住 BOOT 键 → 点击上传 → 看到 `Connecting...` 后松开 BOOT
2. 确认 COM 口正确
3. 确认选择了 ESP32S3 Dev Module（不是 ESP32 或 ESP32C3）
4. 换一根数据线
5. 换一个 USB 口

### 8.9 Arduino IDE 编译特别慢

1. **第一次编译慢是正常的**：ESP32 的框架代码很多，首次编译需要编译所有库
2. **后续编译会快很多**：只编译你修改的部分（增量编译）
3. **关闭杀毒软件实时扫描**：编译会产生大量临时文件，杀毒软件逐个扫描会拖慢速度
4. **换用 PlatformIO**：VSCode + PlatformIO 编译速度通常更快
5. **用 MicroPython**：不需要编译，改完直接跑（但性能不如 C/C++）

### 8.10 只能烧录一次，第二次就烧不进了

**原因**：程序运行时占用了串口/USB 通道，烧录工具无法连接。

**解决方案**：

1. 按住 BOOT → 按 RESET → 松开 BOOT，强制进入下载模式
2. 如果 BOOT 键不灵，先断开 USB，按住 BOOT 再插 USB
3. 用 esptool 先擦除 Flash：`esptool.py -p COM3 erase_flash`，然后重新烧录

### 8.11 RGB LED 不亮或颜色不对

1. **引脚号不对**：不同版本开发板的 RGB LED 引脚不同（GPIO2、GPIO38、GPIO48 都有），看板子丝印
2. **需要单独的库**：WS2812/NeoPixel 需要专用库（Adafruit NeoPixel 或 neopixel）
3. **不是 RGB LED**：有些板子是普通单色 LED，不是 WS2812
4. **亮度太低**：检查代码中是否设置了亮度

### 8.12 PSRAM 相关问题

1. **编译报 PSRAM 错误**：在 Arduino IDE 工具菜单中，PSRAM 设置选 **OPI PSRAM**
2. **MicroPython 内存没变大**：需要使用带 SPIRAM 标签的固件版本
3. **使用 PSRAM 内存的代码**：
   - Arduino：`ps_malloc()` 代替 `malloc()`，或者用 `ESP.getFreePsram()` 查看
   - 配置 Partition Scheme 时选 **Default 4MB with spiffs** 或 **Huge APP**

### 8.13 USB CDC 无输出

1. 确认 Arduino IDE 中 **USB CDC On Boot = Enabled**
2. 烧录后需要重新插拔 USB（新的 COM 口会出现）
3. 串口监视器连接**新的 COM 口**（不是之前那个）
4. 如果还是不行，检查是否用 `Serial.begin()` 初始化了串口

### 8.14 摄像头相关问题

1. **引脚冲突**：摄像头 DVP 接口占用的引脚和 Flash/PSRAM 可能冲突，需要仔细规划
2. **PSRAM 必须有**：跑摄像头至少需要 2MB PSRAM（推荐 8MB）
3. **帧率低**：调低分辨率，减少 JPEG 质量
4. **使用官方示例**：ESP-IDF 的 esp_camera 驱动最稳定

### 8.15 开发板型号不确定选哪个配置

| 你的板子是...              | Arduino Flash Size | PSRAM 设置  | Partition Scheme         |
| --------------------- | ------------------ | --------- | ------------------------ |
| N4（4MB 无PSRAM）        | 4MB                | Disabled  | Default 4MB              |
| N8（8MB 无PSRAM）        | 8MB                | Disabled  | Default 8MB              |
| N4R2（4MB+2MB PSRAM）   | 4MB                | OPI PSRAM | Default 4MB with spiffs  |
| N8R2（8MB+2MB PSRAM）   | 8MB                | OPI PSRAM | Default 8MB with spiffs  |
| N16R8（16MB+8MB PSRAM） | 16MB               | OPI PSRAM | Huge APP (3MB) 或 Default |

---

## 第九章 进阶资源

### 9.1 官方资源

| 资源                      | 地址                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| 乐鑫官网                    | https://www.espressif.com/                                                                             |
| ESP32-S3 技术规格书          | https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf                  |
| ESP32-S3-WROOM-1 模组数据手册 | https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf |
| ESP-IDF 编程指南            | https://docs.espressif.com/projects/esp-idf/zh_CN/latest/esp32s3/                                      |
| Arduino ESP32 GitHub    | https://github.com/espressif/arduino-esp32                                                             |
| MicroPython 官网          | https://micropython.org/                                                                               |
| MicroPython ESP32-S3 固件 | https://micropython.org/download/ESP32_GENERIC_S3/                                                     |

### 9.2 开发工具

| 工具                  | 用途               | 推荐度   |
| ------------------- | ---------------- | ----- |
| Arduino IDE 2.x     | 初学者首选，界面友好       | ★★★★★ |
| Thonny              | MicroPython 开发首选 | ★★★★★ |
| VSCode + PlatformIO | 进阶开发，编译更快，代码补全更好 | ★★★★☆ |
| VSCode + ESP-IDF    | 专业开发，功能最全，学习曲线最陡 | ★★★☆☆ |
| esptool.py          | 命令行烧录工具，最灵活      | ★★★★☆ |

### 9.3 推荐学习路线

```
入门阶段：
  1. LED 闪烁（7.1） → 掌握基本烧录运行
  2. 按键输入（7.2） → 掌握数字输入
  3. 串口输出 → 学会调试
  4. WiFi 连接（7.3） → 入门联网

进阶阶段：
  5. ADC 温度/光照（7.5） → 模拟传感器
  6. I2C 传感器（7.6） → 数字传感器
  7. OLED 显示（7.7） → 显示输出
  8. Web 服务器（7.15） → 手机控制
  9. 双核任务（7.10） → 并行处理

高级阶段：
  10. MQTT（7.12）→ 物联网通信
  11. USB 键盘（7.14）→ USB 外设
  12. 摄像头 → 图像采集
  13. ESP-IDF → 专业开发
```

### 9.4 常用库汇总

| 功能             | Arduino 库         | MicroPython     |
| -------------- | ----------------- | --------------- |
| LED PWM        | 内置 (ledc)         | machine.PWM     |
| OLED 显示        | Adafruit SSD1306  | ssd1306 (内置)    |
| 温湿度 (BME280)   | Adafruit BME280   | bme280.py (需下载) |
| 温湿度 (DHT11/22) | DHTesp            | dht (内置)        |
| RGB LED        | Adafruit NeoPixel | neopixel (内置)   |
| 红外遥控           | IRremoteESP8266   | —               |
| MQTT           | PubSubClient      | umqtt.simple    |
| HTTP           | HTTPClient        | urequests       |
| 摄像头            | esp_camera        | —               |
| USB HID        | USBHID (内置)       | —               |

---

> 