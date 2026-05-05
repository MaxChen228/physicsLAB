# Polarization Playground — 完整實作計劃

## 0. 決策（待確認）

| 項目         | 預設選擇                                       | 替代            |
| ------------ | ---------------------------------------------- | --------------- |
| 技術棧       | Vite + TypeScript + Three.js                   | 單檔 HTML + CDN |
| RCP/LCP 慣例 | 物理慣例：δ=+π/2 → LCP（從接收端看，E 逆時針） | 光學工程相反    |
| 路徑         | `~/Desktop/active/physicsLAB/EM-wave-polar/`（monorepo subdir） | 獨立 repo       |
| 部署         | GitHub Pages                                   | Vercel/Netlify  |
| 樣式         | 純 CSS + CSS variables；視覺方向見 §5.0        | Tailwind        |

下面所有設計**假設預設選擇**。

---

## 1. 檔案結構

```
polarization-playground/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .gitignore
├── README.md                        # 短，只寫怎麼跑
└── src/
    ├── main.ts                      # 進入點，組裝所有模組
    ├── state.ts                     # 全域 state + pub/sub
    ├── physics/
    │   ├── jones.ts                 # Jones vector / 衍生量
    │   ├── stokes.ts                # Stokes / Poincaré 座標
    │   └── presets.ts               # H, V, ±45, RCP, LCP
    ├── views/
    │   ├── wave3d.ts                # 3D 行波（Three.js scene A）
    │   ├── ellipse2d.ts             # 2D 橢圓（Canvas）
    │   ├── poincare.ts              # Poincaré 球（Three.js scene B）
    │   └── numeric.ts               # 數值面板（DOM）
    ├── ui/
    │   ├── controls.ts              # 3 sliders + preset buttons
    │   └── layout.css               # grid 排版
    └── styles.css                   # 全域樣式
```

---

## 2. 狀態管理

**單一 source of truth**，極簡 pub/sub，不引入框架。

```ts
// state.ts
type State = {
  Ex: number;        // 0..1
  Ey: number;        // 0..1
  delta: number;     // -π..π
  paused: boolean;
  timeScale: number; // 0..1，3D 動畫速度
};

const listeners = new Set<(s: State) => void>();
let state: State = { Ex: 1, Ey: 1, delta: Math.PI/2, paused: false, timeScale: 0.3 };

export const getState = () => state;
export const setState = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach(fn => fn(state));
};
export const subscribe = (fn: (s: State) => void) => {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
};
```

每個 view 在 `main.ts` 用 `subscribe` 註冊，slider 改值呼叫 `setState`。

---

## 3. 物理層

### 3.1 `jones.ts`

```ts
export type Jones = { Ex: number; Ey: number; delta: number };

// 歸一化後的方位角與橢圓率（弧度）
export function azimuth(j: Jones): number {
  const { Ex, Ey, delta } = j;
  return 0.5 * Math.atan2(2*Ex*Ey*Math.cos(delta), Ex*Ex - Ey*Ey);
}
export function ellipticity(j: Jones): number {
  const { Ex, Ey, delta } = j;
  const S0 = Ex*Ex + Ey*Ey;
  const S3 = 2*Ex*Ey*Math.sin(delta);
  return 0.5 * Math.asin(S3 / Math.max(S0, 1e-9));
}
// 橢圓半長軸/半短軸（給 2D 視圖用）
export function semiAxes(j: Jones): { a: number; b: number };
// E(t) 在 z=0 的瞬時值
export function fieldAt(j: Jones, t: number): { ex: number; ey: number };
```

### 3.2 `stokes.ts`

```ts
export type Stokes = { S0: number; S1: number; S2: number; S3: number };

export function jonesToStokes(j: Jones): Stokes;
export function poincareXYZ(s: Stokes): [number, number, number]; // (S1,S2,S3)/S0
export function dop(s: Stokes): number; // sqrt(S1²+S2²+S3²)/S0，純 Jones 永遠=1
```

### 3.3 `presets.ts`

```ts
export const presets = {
  H:    { Ex: 1, Ey: 0, delta: 0 },
  V:    { Ex: 0, Ey: 1, delta: 0 },
  D:    { Ex: 1/Math.SQRT2, Ey: 1/Math.SQRT2, delta: 0 },
  A:    { Ex: 1/Math.SQRT2, Ey: 1/Math.SQRT2, delta: Math.PI },
  RCP:  { Ex: 1/Math.SQRT2, Ey: 1/Math.SQRT2, delta: -Math.PI/2 },
  LCP:  { Ex: 1/Math.SQRT2, Ey: 1/Math.SQRT2, delta:  Math.PI/2 },
};
```

---

## 4. 視圖層

### 4.1 `wave3d.ts` — 3D 行波

- Three.js scene，PerspectiveCamera 預設斜角，OrbitControls 可旋轉
- z 軸：傳播方向；x、y 軸：場分量
- **三條線**：紅 = Ex(z,t)·x̂、綠 = Ey(z,t)·ŷ、白 = 合成 E
- 沿 z 採樣 N=200 點，每幀重算
- E 向量端點留下軌跡（在某幾個 z 切片畫小橢圓殘影，可選）
- 工具列：暫停、速度 slider、「迎面視角」按鈕（相機跳到 +z 看向原點）

### 4.2 `ellipse2d.ts` — 偏振橢圓（Canvas 2D）

- xy 平面正方形畫布
- 畫橢圓本體（解析式）+ 長短軸 + 方位角線 + 旋轉方向箭頭
- 動點：當前 E(t) 位置（讓人看到「畫橢圓的筆尖」）
- 標註：ψ、χ 的數值（小字）

### 4.3 `poincare.ts` — Poincaré 球

- Three.js scene B（獨立 canvas），SphereGeometry 半透明
- 三軸標籤：S1（H/V）、S2（D/A）、S3（RCP/LCP）
- 赤道圓 + 兩個子午圓（線偏軌跡參考）
- 狀態點：紅球，半徑 = DoP（純 Jones 一定在球面上）
- 軌跡：當 slider 連續變動時留下短淡尾巴（可選，加分項）

### 4.4 `numeric.ts` — 數值面板

純 DOM 表格，monospace 字型，每次 state 變更重新 render：

```
Jones        [ Ex                  ]   [ 1.000           ]
             [ Ey · exp(iδ)        ] = [ 1.000 ∠ 90.0°   ]

Stokes       S0 = 2.000   S1 =  0.000
             S2 = 0.000   S3 =  2.000

ψ (azimuth)     =  45.00°
χ (ellipticity) = +45.00°  →  圓偏（左旋）
DoP             = 1.000
分類            = LCP
```

「分類」用簡單規則判斷：|χ| < 1° → linear、|χ−45°| < 1° → circular、其餘 elliptical，並標 L/R。

---

## 5. UI / 排版

### 5.0 視覺方向：**Anaglyph Instrument Console**

概念：把畫面當儀器面板（spectrum analyzer / 邏輯分析儀 / CAD HUD 那一掛），紅綠雙通道直接綁定 Ex / Ey 兩個物理分量。冷硬、機械、無修飾 —— 沒有 serif、沒有 italic、沒有暖色。所有元素假裝自己是面板上的印刷標籤。

**色彩 token**（`styles.css` 的 `:root`）—— 淺色 cold-tech 配置，前景全黑、背景帶冷青灰底：

```css
--ink:        #ebedf0;          /* 冷白主背景，輕微帶藍 */
--ink-2:      #ffffff;          /* 卡片底（純白抬升） */
--steel:      #c2c7ce;          /* 分隔塊 / track，淺鋼 */
--paper:      #0a0e14;          /* 主前景，近黑 */
--paper-dim:  #5b6470;          /* 鋼灰次級文字 */
--hairline:   rgba(10,14,20,0.10);
--hairline-2: rgba(10,14,20,0.22);
--grid:       rgba(10,14,20,0.05);

--ch-x:       #d9002a;          /* deep cinnabar，淺底可讀 */
--ch-y:       #00875a;          /* deep phosphor，淺底可讀 */
--ch-sum:     var(--paper);     /* 合成 E = 黑 */
--signal:     #006d8f;          /* deep ice cyan，主互動色 */
--warn:       #b97a00;          /* deep amber，最後手段 */
```

通道色一律走「飽和度高 + 明度偏中下」路線，避開螢光綠 / 純紅，因為淺底上需要對比而非發光。

**字型**（Google Fonts，僅兩支）：

| 角色      | 字型                              | 用法                                          |
| --------- | --------------------------------- | --------------------------------------------- |
| Display   | *Anybody* var (wdth 75–125)       | 頁首、preset、view title、accent class label  |
| Mono / UI | *JetBrains Mono* (300/400/500/700)| 一切其他內容：body、numeric、controls、readout |

Anybody 永遠用 `font-variation-settings: "wdth" 80, "wght" 700` —— 窄體 + 粗，工業面板感。**全站禁用 italic**、禁用 serif、禁用 system-ui / Inter / Space Grotesk / Roboto。

**背景與紋理**：

- 全頁 `--ink` 底 + 24px 方格 + 中央 radial fade（暗角，凸顯儀器中央）
- watermark：每個 view 右下角大號 `01 / 02 / 03 / 04`（Anybody wdth 75 wght 700，opacity 0.035）
- 卡片邊框：四角 14px tick mark（用 8 個 linear-gradient 疊 outline 角，模擬儀器 bezel）
- masthead 底邊：紅 / 綠雙色短線標 channel
- meta 區帶 LED 脈衝點（`led-pulse` keyframes，1.6s）
- cursor 在 view 上 `crosshair`

**動效**：

- 載入：view 階梯進場（80ms/階）
- preset 切換：anaglyph 分離 0.28s，用 `steps(8, end)` 階躍時間函數（不是 ease，要機械感）
- slider thumb：4×16px 細長條（不是圓），active 時 `--signal` 並發 8px glow
- preset hover：上緣 0→100% 寬的 `--signal` 進度條由左向右刷出
- preset active：直接 `--signal` 反白為按下狀態
- meta LED：常駐脈衝，象徵儀器在線

**跨檔案配色協議**：

```
Ex(z,t)  → --ch-x      線寬 1.5
Ey(z,t)  → --ch-y      線寬 1.5
合成 E    → --ch-sum    線寬 2，opacity 1
橢圓本體 → --ch-sum    線寬 1
長/短軸  → --paper-dim 0.75，dashed
方位角線 → --signal    1，dashed
動點 / 狀態點 → --signal 帶 glow
Poincaré 球面 → --hairline-2 wireframe
S1/S2/S3 軸 → --ch-x / --ch-y / --signal
```

### 5.1 Layout（CSS Grid）

**桌面**（≥960px）：

```
┌────────────────────┬────────────────────┐
│  ⓐ 3D Wave         │  ⓑ Poincaré        │
├────────────────────┼────────────────────┤
│  ⓒ Ellipse         │  ⓓ Numeric         │
├────────────────────┴────────────────────┤
│  ⓔ Controls  (sliders + preset)         │
└─────────────────────────────────────────┘
```

`grid-template-columns: 1fr 1fr; grid-template-rows: minmax(320px, 42vh) minmax(320px, 42vh) auto;`，gap 用 hairline（`background: var(--hairline)`、實際 gap 1px，造視覺接縫）。

**平板**（600–960）：2 欄但 row 變高，Controls 跨 2 欄。
**手機**（<600）：1 欄堆疊，Controls 用 `position: sticky; bottom: 0` 帶 backdrop-filter 模糊。

每個 view 卡片頂部留 28px 條，左寫 Newsreader italic 標題（`a. wave / b. poincaré / c. ellipse / d. numeric`），右靠 mono 顯示該 view 當前最重要的單一數值（例如 ellipse 顯示 `χ = +44.97°`），就像 oscilloscope 角落的 readout。

### 5.2 Controls

```
[ Ex ]──────●─────────  1.000   ↺
[ Ey ]──────────●─────  1.000   ↺
[ δ  ]−π ────────●── π  +90.0°  ↺      [ ⏸ ] [ ▸ speed ──●──── ]

▸ presets:   H    V    +45°    −45°    RCP    LCP
```

- slider track 高 1px、thumb 12px 空心圓；數值用 JetBrains Mono 600，貼右
- δ 標尺刻度 −π / −π/2 / 0 / π/2 / π，刻度短 tick + Newsreader 小字
- preset 按鈕：Fraunces 600 opsz 48，無填充、雙 hairline 邊；hover 時 `--accent` 邊；active 時 `--paper` 反白
- ↺ 重置按鈕用 mono 字符 `↺`，hover 旋 −90°
- preset 觸發 §5.0 描述的 anaglyph 分離動效

---

## 6. 實作順序（建議 commit 切點）

1. **腳手架**：`npm create vite@latest -- --template vanilla-ts`，裝 three，建檔案結構，跑空白頁
2. **physics 層**：`jones.ts` + `stokes.ts` + presets，寫 3~5 個 console.assert 自我驗證（H 的 Stokes = (1,1,0,0)、LCP 的 Stokes = (1,0,0,1) 等）
3. **state + controls**：3 sliders + preset 按鈕，console 印出 state 確認流通
4. **numeric view**：先有數字才好驗證後面的視圖對不對
5. **ellipse 2D**：靜態橢圓 → 加動點 → 加箭頭與軸
6. **Poincaré 球**：球體 + 軸 + 點
7. **3D 行波**：三條線 + 動畫 + 迎面視角
8. **打磨**：暗色主題、字型、響應式排版、preset 切換時加 transition
9. **README + GitHub Pages 部署**

每階段完成可獨立看到效果，避免「全部寫完才知道哪裡錯」。

---

## 7. 驗證 checklist（給自己 demo 前跑一遍）

- [ ] H 預設：橢圓退化為水平線，Poincaré 點在 +S1，3D 看到紅線單獨振盪
- [ ] V 預設：橢圓退化為垂直線，Poincaré 點在 −S1
- [ ] +45°：橢圓 45° 斜線，Poincaré 點在 +S2
- [ ] LCP：橢圓變正圓，Poincaré 點在 +S3，3D 迎面視角看 E 端點逆時針旋轉
- [ ] RCP：圓 + 順時針 + Poincaré 在 −S3
- [ ] Ex=Ey、δ 從 0 連續轉到 π/2：橢圓從 +45° 線 → 漸開為橢圓 → 變圓
- [ ] Ex=1、Ey=0：δ 怎麼動橢圓都不變（單分量無相位意義）
- [ ] 三視圖數值與 numeric panel 完全一致

---

## 8. 範圍外（明確排除）

- 光學元件（偏振片、波片、Jones matrix 串接）
- 部分偏振光與 Mueller calculus
- 真實案例（3D 眼鏡、藍天等）動畫
- 量測模擬

這些留給第二階段，現在寫的程式碼結構（physics 層、state、view 訂閱模式）要能直接擴展，不要把元件邏輯硬編進現有 view。

---

## 9. 待你確認

1. 技術棧：**Vite + TS + Three.js**？確認就開腳手架。
2. RCP/LCP：用**物理慣例**（δ=+π/2 為 LCP）？
3. 還要加什麼必備項目？或上面有想砍的？

確認完我就從 step 1 開始建。