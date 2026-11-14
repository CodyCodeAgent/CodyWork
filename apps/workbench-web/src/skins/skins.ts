import type { SkinPack } from "./tokens"
import { qqSkin } from "./qqSkin"
export const BUILT_IN_SKINS: SkinPack[] = [...[
  {
    "id": "professional",
    "name": "清爽专业",
    "description": "冷白与墨蓝 · 清晰、高效的日常工作台",
    "manifest": {
      "schemaVersion": 2,
      "version": "1.0.0",
      "author": "CodyWork"
    },
    "defaultColorMode": "light",
    "variants": {
      "light": {
        "tokens": {
          "color": {
            "background": "#f3f6fa",
            "surface": "#edf2f7",
            "panel": "#ffffff",
            "elevated": "#ffffff",
            "text": "#182b43",
            "textMuted": "#52657b",
            "border": "#d8e2ed",
            "accent": "#245bb4",
            "danger": "#af3041",
            "warning": "#855313",
            "success": "#176345",
            "info": "#245bb4",
            "codeBackground": "#edf2f7",
            "terminalBackground": "#edf2f7"
          },
          "font": {
            "sans": "ui-sans-serif,-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif",
            "mono": "\"SFMono-Regular\",Consolas,\"Liberation Mono\",monospace"
          },
          "spacing": {
            "xs": "4px",
            "sm": "8px",
            "md": "12px",
            "lg": "16px"
          },
          "radius": {
            "sm": "8px",
            "md": "12px",
            "lg": "12px"
          },
          "shadow": {
            "panel": "0 2px 6px #1c385008",
            "floating": "0 16px 48px #1c385024",
            "focus": "0 0 0 3px #e8f0fd"
          },
          "motion": {
            "fast": "160ms",
            "normal": "180ms",
            "slow": "240ms"
          },
          "density": "comfortable"
        },
        "syntaxTheme": "light",
        "terminalTheme": {
          "background": "#edf2f7",
          "foreground": "#263e5a"
        },
        "chartPalette": [
          "#245bb4",
          "#176345",
          "#855313"
        ]
      }
    },
    "recipes": {
      "chrome": "native",
      "navigation": "native",
      "panel": "native",
      "control": "native",
      "message": "native",
      "identity": "none",
      "composer": "native",
      "backdrop": "solid"
    },
    "workbench": {
      "surface-canvas": "#f3f6fa",
      "surface-panel": "#ffffff",
      "surface-subtle": "#edf2f7",
      "surface-raised": "#ffffff",
      "ink-primary": "#182b43",
      "ink-secondary": "#52657b",
      "ink-tertiary": "#61748a",
      "border-default": "#d8e2ed",
      "border-strong": "#aebed0",
      "accent": "#245bb4",
      "accent-hover": "#194790",
      "accent-subtle": "#e8f0fd",
      "on-accent": "#ffffff",
      "nav-bg": "#eaf0f7",
      "nav-text": "#233b58",
      "nav-muted": "#536b85",
      "nav-hover": "#dde7f3",
      "success": "#176345",
      "success-bg": "#e5f4ec",
      "warning": "#855313",
      "warning-bg": "#fff2d9",
      "danger": "#af3041",
      "danger-bg": "#fff0f2",
      "code-bg": "#edf2f7",
      "code-text": "#263e5a",
      "overlay": "rgba(16,29,48,.42)",
      "shadow-panel": "0 2px 6px #1c385008",
      "shadow-popover": "0 16px 48px #1c385024",
      "radius-panel": "12px",
      "radius-control": "8px"
    }
  },
  {
    "id": "midnight",
    "name": "深色科技",
    "description": "深蓝与青色 · 专注于代码与执行进展",
    "manifest": {
      "schemaVersion": 2,
      "version": "1.0.0",
      "author": "CodyWork"
    },
    "defaultColorMode": "dark",
    "variants": {
      "dark": {
        "tokens": {
          "color": {
            "background": "#0c1422",
            "surface": "#1b2a40",
            "panel": "#141f31",
            "elevated": "#203149",
            "text": "#edf4ff",
            "textMuted": "#b7c7dd",
            "border": "#30415b",
            "accent": "#6cdbdc",
            "danger": "#ffabb5",
            "warning": "#f4cb80",
            "success": "#89dfb2",
            "info": "#6cdbdc",
            "codeBackground": "#0c1727",
            "terminalBackground": "#0c1727"
          },
          "font": {
            "sans": "ui-sans-serif,-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif",
            "mono": "\"SFMono-Regular\",Consolas,\"Liberation Mono\",monospace"
          },
          "spacing": {
            "xs": "4px",
            "sm": "8px",
            "md": "12px",
            "lg": "16px"
          },
          "radius": {
            "sm": "8px",
            "md": "12px",
            "lg": "12px"
          },
          "shadow": {
            "panel": "0 2px 8px #00000020",
            "floating": "0 20px 60px #00000060",
            "focus": "0 0 0 3px #173a43"
          },
          "motion": {
            "fast": "160ms",
            "normal": "180ms",
            "slow": "240ms"
          },
          "density": "comfortable"
        },
        "syntaxTheme": "dark",
        "terminalTheme": {
          "background": "#0c1727",
          "foreground": "#d4e4f9"
        },
        "chartPalette": [
          "#6cdbdc",
          "#89dfb2",
          "#f4cb80"
        ]
      }
    },
    "recipes": {
      "chrome": "native",
      "navigation": "native",
      "panel": "native",
      "control": "native",
      "message": "native",
      "identity": "none",
      "composer": "native",
      "backdrop": "solid"
    },
    "workbench": {
      "surface-canvas": "#0c1422",
      "surface-panel": "#141f31",
      "surface-subtle": "#1b2a40",
      "surface-raised": "#203149",
      "ink-primary": "#edf4ff",
      "ink-secondary": "#b7c7dd",
      "ink-tertiary": "#a2b4cd",
      "border-default": "#30415b",
      "border-strong": "#56708f",
      "accent": "#6cdbdc",
      "accent-hover": "#a0eded",
      "accent-subtle": "#173a43",
      "on-accent": "#08262d",
      "nav-bg": "#101a2b",
      "nav-text": "#e0ebfa",
      "nav-muted": "#a5b9d5",
      "nav-hover": "#21324b",
      "success": "#89dfb2",
      "success-bg": "#17382e",
      "warning": "#f4cb80",
      "warning-bg": "#3d3020",
      "danger": "#ffabb5",
      "danger-bg": "#422735",
      "code-bg": "#0c1727",
      "code-text": "#d4e4f9",
      "overlay": "rgba(0,5,16,.68)",
      "shadow-panel": "0 2px 8px #00000020",
      "shadow-popover": "0 20px 60px #00000060",
      "radius-panel": "12px",
      "radius-control": "8px"
    }
  },
  {
    "id": "forest",
    "name": "松林手记",
    "description": "暖纸与松绿 · 有温度的研发工作空间",
    "manifest": {
      "schemaVersion": 2,
      "version": "1.0.0",
      "author": "CodyWork"
    },
    "defaultColorMode": "light",
    "variants": {
      "light": {
        "tokens": {
          "color": {
            "background": "#f2f0e7",
            "surface": "#eeeee1",
            "panel": "#fffdf6",
            "elevated": "#fffefb",
            "text": "#293c32",
            "textMuted": "#586859",
            "border": "#d9ddcc",
            "accent": "#31654d",
            "danger": "#a33438",
            "warning": "#86531b",
            "success": "#28633f",
            "info": "#31654d",
            "codeBackground": "#eceede",
            "terminalBackground": "#eceede"
          },
          "font": {
            "sans": "ui-sans-serif,-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif",
            "mono": "\"SFMono-Regular\",Consolas,\"Liberation Mono\",monospace"
          },
          "spacing": {
            "xs": "4px",
            "sm": "8px",
            "md": "12px",
            "lg": "16px"
          },
          "radius": {
            "sm": "5px",
            "md": "5px",
            "lg": "5px"
          },
          "shadow": {
            "panel": "0 2px 0 #c6cdb540",
            "floating": "0 16px 40px #344b3628",
            "focus": "0 0 0 3px #e4edde"
          },
          "motion": {
            "fast": "160ms",
            "normal": "180ms",
            "slow": "240ms"
          },
          "density": "comfortable"
        },
        "syntaxTheme": "light",
        "terminalTheme": {
          "background": "#eceede",
          "foreground": "#344b36"
        },
        "chartPalette": [
          "#31654d",
          "#28633f",
          "#86531b"
        ]
      }
    },
    "recipes": {
      "chrome": "native",
      "navigation": "native",
      "panel": "native",
      "control": "native",
      "message": "native",
      "identity": "none",
      "composer": "native",
      "backdrop": "solid"
    },
    "workbench": {
      "surface-canvas": "#f2f0e7",
      "surface-panel": "#fffdf6",
      "surface-subtle": "#eeeee1",
      "surface-raised": "#fffefb",
      "ink-primary": "#293c32",
      "ink-secondary": "#586859",
      "ink-tertiary": "#66715c",
      "border-default": "#d9ddcc",
      "border-strong": "#a8b69a",
      "accent": "#31654d",
      "accent-hover": "#214e3a",
      "accent-subtle": "#e4edde",
      "on-accent": "#ffffff",
      "nav-bg": "#e6e9da",
      "nav-text": "#304c3b",
      "nav-muted": "#536955",
      "nav-hover": "#d8e0ce",
      "success": "#28633f",
      "success-bg": "#e4efdc",
      "warning": "#86531b",
      "warning-bg": "#f8ecd3",
      "danger": "#a33438",
      "danger-bg": "#fcebe7",
      "code-bg": "#eceede",
      "code-text": "#344b36",
      "overlay": "rgba(29,42,31,.44)",
      "shadow-panel": "0 2px 0 #c6cdb540",
      "shadow-popover": "0 16px 40px #344b3628",
      "radius-panel": "5px",
      "radius-control": "5px"
    }
  }
] as SkinPack[], qqSkin]
