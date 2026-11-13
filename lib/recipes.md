# 视频配方库

`remotion` skill 讲工坊怎么运转（`meta` 契约、registry、渲染流程）；这一份讲**片子长什么样**。
下面每条配方给的都是能直接落进代码的数字，不是"感觉高级一点"。

## 开写之前先定三件事

没定这三件，写出来的东西一定返工：

1. **时长**。片头 ≤ 8 秒，竖屏短视频 15–30 秒，数据动画 40–60 秒，纯标题卡 3–6 秒。
   超过 60 秒的片子要分章，别一条直线拉到底。
2. **节奏**。一拍多少帧决定观众跟不跟得上：数据动画 13 帧/年、排名或柱状 18 帧/位、
   竖屏 8 帧/拍、字幕卡 45 帧/句。
3. **一屏几件事**。1080p 一屏最多 3 个信息块（标题区、主视觉、数值区）。
   第 4 块开始观众就不知道该看哪了。

30fps 下的换算，省得每次算：5 秒 = 150 帧，8 秒 = 240，15 秒 = 450，30 秒 = 900，
45 秒 = 1350，60 秒 = 1800。

## 通用骨架

```
0 ────── 入场 ────── 主体 ────── 收尾 ────── 结束
        24–45 帧      可变         45 帧
```

- 入场用 `interpolate(frame, [0, 24], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)})`，
  同时位移 18–24px。**不要**弹跳，弹跳在 30fps 下看起来像卡顿。
- 收尾 45 帧：结论字幕淡入 + 主数字停在终值（换成强调色，比如 `#22D3A6`）。
- 底部 5–6px 进度条，`linear-gradient(90deg, #FF5A5F, #4C8DFF, #22D3A6)`，不透明度 0.85。

## 串联：Series 还是 TransitionSeries

两条路只能选一条，混着用一定会错位。

- **`<Series>`（默认）**：一段播完再播下一段，零重叠。每段必须给
  `durationInFrames`，不给就一直播到片尾——「上一张字卡还没走、下一张已经出现」，
  十有八九是漏了这个字段。卡片内部的子段再嵌一层 `<Series>`。
- **`<TransitionSeries>`（要重叠才用）**：每次转场从时间轴上吃掉 D 帧，后面所有
  段整体提前 D 帧。有音乐当钟的时候这个偏移是听得出来的：10 次 12 帧的转场，
  最后一屏会比音乐早 120 帧（4 秒）。所以**卡拍点的片子用 Series 硬切**，重叠只
  留在同一张卡片内部。
- **`premountFor`**：卡片 30–45 帧，卡内子段 15–30 帧。它提前挂载，避免切进来的
  第一帧还在重新排版，观众看到的就是「晚半拍」。
- **把时长写成一张表**：数组里只写 `dur`，起始帧用 reduce 算出来，开发时 `throw`
  一次「总和 ≠ durationInFrames」。时间轴差几帧看不出来，差一张卡片就是成片事故。

## 配方 1：数据动画（折线 / 多序列对比）

**结构**（以 38 秒为例，`BirthRate` 就是这个）：片头 75 帧 → 每年 13 帧 × 73 年 → 片尾 120 帧。

| 元素 | 规格 |
| --- | --- |
| 年份大字 | 168px / 800 / `tabular-nums`，终值换强调色 |
| 序列数值 | 46px / 800 / `tabular-nums`，每行前 14px 圆点带 glow |
| 序列名 | 96px 宽，28px / 600 / `#A9B8D0` |
| 轴标签 | 22px / `#4C5F80` |
| 折线 | 5px，`strokeLinecap: round`，`feGaussianBlur stdDeviation=6` 做辉光 |
| 端点 | 外圈 13px 半透明 + 内圈 7px 白描边，随帧轻微脉动 |
| 图表区 | x 560–1800，y 300–900，左栏 110 起、宽 400 |

- 数据放 `public/<name>.json`，用 `valueAt` 在年与年之间插值，`buildPath` 画到当前年份为止的路径。
- 纵轴上限按数据的最大值定，别用默认值 —— 三条线全挤在底部是常见事故。
- **结尾必须给结论**，而且要具体："1950 年都在 28‰ 以上；2023 年全部跌破 6.3‰"，
  不是"由此可见出生率在下降"。

## 配方 2：标题卡 / 片头（3–8 秒）

| 元素 | 规格 |
| --- | --- |
| 主标题 | 88–96px / 800 / letter-spacing 1–2px |
| 副标题 | 30px / `#7D8FB0`，距主标题 22px |
| 眉标（可选） | 20px / 600 / letter-spacing 6px / `#5E7396` |
| 背景 | 深色渐变 + 一到两团柔和径向光，别用纯黑 |

- 入场 24 帧，同时 `translateY` 从 +24 到 0；整体再随全片缓慢上浮 16px（`drift`），
  静止的标题看起来像截图。
- 超过 8 秒的片头一定被跳过，宁可 4 秒。

## 配方 3：竖屏短视频（1080×1920）

`meta` 改 `width: 1080, height: 1920`，其余照旧。

| 项 | 数值 |
| --- | --- |
| 安全区 | 上下各留 250px（平台 UI 会盖住），左右各 80px |
| 可用内容区 | 1080×1420，居中 |
| 字号 | 横屏数值 × 1.6；正文不小于 42px |
| 行宽 | ≤ 900px，超过就换行 |
| 节奏 | 8 帧/拍，比横屏快 40% |
| 时长 | 15–30 秒，别到 60 |

- 竖屏一屏只能讲一件事。两栏布局在竖屏等于没布局。
- 字幕放底部安全区之上（y ≈ 1500），42–48px，最多两行。

## 配方 4：数字计数器（3–5 秒）

- 数字用 `interpolate` 从 0 到目标值，`tabular-nums` 必须开，否则每一位变化都会重排。
- 单位单独一行小字（28px / `#7D8FB0`），跟在数字右下，别塞进同一行。
- 结尾停 20 帧再切走，数字刚到位就结束观众看不清。

## 配方 5：字幕卡 / 引用卡（4–6 秒）

- 一句一行，每句 45 帧；同时最多显示 2 行，超过就换卡。
- 背景压暗到原亮度的 60%，文字才立得住。
- 字号 56–64px，行高 1.4，居中；引用卡加一对引号比加边框好看。

## 配方 6：左右对比（前后 / 两方）

- 左右各占 46% 宽，中间留 8% 空隙放分隔线（1.5px / `#1B2740`）。
- 右侧比左侧晚 6 帧入场 —— 同时出现会被看成一个整体。
- 两侧用不同强调色（`#4C8DFF` vs `#FF5A5F`），标题字号一致，数值区对齐同一基线。

## 音频（BGM / 配音 / 音效）

素材放 `public/`，取 URL 一律用 `staticFile('x.mp3')`——直接写相对路径在渲染时会 404。

```tsx
<Audio
  src={staticFile('bgm.mp3')}
  trimBefore={0}
  volume={(f) => interpolate(f, [0, 15, 120, 135], [0, 0.35, 0.35, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })}
/>
```

- `volume` 可以是一个 `(frame) => number` 函数，帧号是**相对所在 `<Sequence>`** 的局部帧，不是全片帧。
- 淡入淡出就用 `interpolate` 给 `volume` 做曲线，别去切素材。
- 口播压 BGM：把 BGM 的 `volume` 曲线在语音段压到 `0.15–0.25`，语音结束后回到 `0.35`。
- 起播点用 `<Sequence from={90}>` 包一层，别用 `trimBefore` 去"跳过"——`trimBefore` 是裁掉素材开头，不是延后起播。
- 音量上限：`0.35` 已经很响；多个音轨叠加时总和别过 `0.7`，否则渲染出来会削波。
- 素材带自己的声音时，`<OffthreadVideo muted>` 静音，音轨单独用 `<Audio>` 挂，两件事分开控。
- 渲染时音频混流由 ffmpeg 完成，`--concurrency` 不影响音轨，也不影响音画同步。

## 实拍剪辑（把用户发来的视频剪出关键部分）

这是本 kit 最重要的一条工作流：**先量，再剪，别猜**。

### 第 1 步：扫描

用 `remotion_scan_video`（或命令行 `node scripts/scan-video.mjs <文件> --pretty`）。它给四样东西：

| 输出 | 含义 | 用途 |
| --- | --- | --- |
| `scenes` | 画面突变的时刻 + 差异值 | 找镜头切换，切在镜头上 |
| `silences` | 静音区间 | 掐掉冷场、喘气、等待 |
| `speech` | 有声区间（静音的反面） | 口播类按句子切 |
| `clips` | 建议片段（按场景切点分段） | 直接拿来当剪辑清单 |

阈值怎么调：

- 切得太碎 → `scene_threshold` 调高（0.18 → 0.3）
- 该切的没切 → 调低（0.18 → 0.1）
- 长视频嫌慢 → `no_scene: true`，只做音频分析（快 10 倍以上）
- 口播类：以 `speech` 为准，不要用 `scenes`——说话人动一下就算一次"画面突变"。

**扫描只给时间点，不给语义**。哪些片段"好"必须问用户，或者自己看 still 判断。报告里要明确说"这些是切点，内容我还没看过"。

### 第 2 步：素材落地

把视频复制到 `remotion-kit/public/`，文件名用 ASCII（`interview-01.mp4`），中文名在 `staticFile` 里容易出岔子。

### 第 3 步：拼时间轴

```tsx
const FPS = 30;
const cut = (start: number, end: number) => ({
  trimBefore: Math.round(start * FPS),
  durationInFrames: Math.round((end - start) * FPS),
});

<Sequence from={0} durationInFrames={cut(12.4, 18.9).durationInFrames}>
  <OffthreadVideo
    src={staticFile('interview-01.mp4')}
    {...cut(12.4, 18.9)}
    style={{width: '100%', height: '100%', objectFit: 'cover'}}
  />
</Sequence>
```

- `trimBefore` = 源视频从第几帧开始，`durationInFrames` = 取多少帧。**不是** `startFrom`/`endAt`，那两个在 Remotion 4 已废弃。
- 每段都要包 `<Sequence from={累计帧数}>`，否则所有片段都从第 0 帧开始叠在一起。
- 片段之间的缝隙要么用转场填（见下一条），要么留黑——留黑会显得很业余，至少给 6 帧硬切。
- 素材分辨率低于输出时，`objectFit: 'cover'` 会裁切放大，糊是必然的；这种情况要提前告诉用户。

### 第 4 步：抽查

渲三张 still：第一段开头、一个切点、最后一段结尾。看四件事——画面有没有黑帧、裁切有没有切掉脸、字幕有没有被压住、转场中间是不是同时看到两段。

### 第 5 步：出片

`remotion_render` 出 mp4，然后核对 ffprobe 的时长是否等于所有片段之和。

## 转场（两段重叠，不是两段拼接）

三种够用了，都是"后一段提前 N 帧起播 + 前一段延后 N 帧结束"，重叠区就是转场区。

```tsx
const FADE = 15; // 0.5s，30fps

// 1) 交叉溶解：透明度 0→1
<AbsoluteFill style={{opacity: interpolate(frame, [start, start + FADE], [0, 1], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic),
})}}>

// 2) 推拉：后一段从右侧推入
transform: `translateX(${interpolate(frame, [start, start + FADE], [100, 0], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
})}%)`

// 3) 擦除：用 clipPath 从左边揭开
clipPath: `inset(0 ${interpolate(frame, [start, start + FADE], [100, 0], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
})}% 0 0)`
```

- 转场长度 12–18 帧（0.4–0.6s）。短于 8 帧看不出来，长于 24 帧显得拖沓。
- 三种转场在同一个片子里别混着用，选一种。
- 转场期间两段都在解码，长片里连续十几个转场会明显拖慢渲染——能硬切就硬切。
- `Easing` 一定要给，线性透明度变化看起来像闪一下。

## 配色与字体（全 kit 统一，别自创）

- 背景 `linear-gradient(160deg, #05070F, #0A1020 55%, #0C1730)` + 径向光
- 强调 `#FF5A5F` / `#4C8DFF` / `#22D3A6`，一个序列一个色，线、点、数字同色
- 文字 `#E9EEF8`，弱化 `#7D8FB0`，轴与网格 `#4C5F80` / `#1B2740`
- 字体 `"Microsoft YaHei", "Noto Sans SC", "PingFang SC", "Segoe UI", system-ui, sans-serif`

## 交付前检查清单

1. **先渲 still**：挑入场结束、主体中段、结尾各一帧（`format: "still"`，`frame:` 给具体帧号）。
   看四件事：文字有没有溢出画布、有没有互相遮挡、深色背景上字够不够亮、进度条有没有盖住内容。
2. **实拍再补三帧**：每段素材的第一帧、每个切点、最后一段的最后一帧。查：有没有黑帧、
   `objectFit: cover` 有没有把脸裁掉、转场中间是不是同时看到两段。
3. **音频单独听**：音量峰值别过 0.7；转场处有没有爆音；配音和画面对不对得上；
   BGM 有没有盖住人声。
4. **再出 mp4**，然后看 `remotion_renders` 报的 ffprobe 元数据：帧数对不对、时长对不对、
   尺寸是不是你以为的那个（竖屏最常见的事故就是忘了改 `meta`）。
5. **报数**：告诉用户文件路径、时长、体积，以及"这一版讲了什么"，不要只说"渲染完成"。
   剪辑类还要说明保留了哪几段、各多少秒、依据是什么（扫描结果还是用户指定）。

## 六个常见事故

- 数字不加 `tabular-nums` → 每帧抖动。
- 纵轴上限拍脑袋 → 折线全挤在底部。
- 片头超过 8 秒 → 观众已经划走。
- 竖屏忘了改 `meta.width/height` → 出来是横屏加黑边。
- 每帧 `Math.random()` → 每帧噪点都不一样。
- 只渲了 still 就说"视频做好了"。
