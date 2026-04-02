# 状态成就生图 Prompt

这组成就用于“进阶模式 > 状态”选项卡，对应：

- 发呆
- 元气满满
- 忧郁
- 愉悦

目标要求：

- 必须延续 `D:\成就素材` 中现有成就图的小猫原型与笔触风格。
- 必须保持“黑色粗蜡笔/粉笔手绘线条 + 少量主题色点缀 + 留白背景友好”的视觉语言。
- 必须看起来像同一只小猫的不同状态，而不是四只不同猫。
- 构图必须区别于现有“春夏秋冬”系列的大脸特写构图。
- 四个状态之间应使用同一套基础构图，只在表情、局部姿态、陪衬元素和配色上变化。
- 输出优先为透明背景 PNG，主体完整，边缘干净，适合后续叠在米白背景卡面上。

## 统一母版 Prompt

```text
Use case: illustration-story
Asset type: achievement badge transparent PNG
Primary request: a hand-drawn achievement illustration of the same small cat from the existing achievement series, using the exact same cat prototype and rough crayon-brush line quality
Input images: existing achievement cat images as style and character reference
Scene/backdrop: transparent background, no card, no text, no border
Subject: the same round-eyed little cat peeking out from a soft emotion cloud / fluffy cushion shape, with two small front paws resting on the front edge; same face proportions, same whiskers, same naive and cute hand-drawn look as the existing series
Style/medium: childlike crayon and dry-brush ink illustration, black rough strokes with powdery edges, sparse accent colors only
Composition/framing: centered composition, new layout different from the four seasonal close-up badges; head and upper body visible, emotion cloud wrapping the lower half, generous transparent padding around subject
Lighting/mood: flat illustrated mood, no realistic lighting, expressive through gesture and accent marks
Color palette: mostly black and off-white with one to two mood accent colors
Constraints: keep the same cat identity and rough hand-drawn texture; no polished vector look; no realistic fur; no extra scene background; no text; no watermark
Avoid: photorealism, clean geometric icon style, anime rendering, glossy gradients, heavy shadows, cluttered props
```

## 发呆

```text
Based on the master prompt, show the cat in a dazed absent-minded mood.
Expression: round open eyes looking slightly upward, tiny "o" mouth, relaxed ears, loose cheeks.
Mood props: one small floating thought bubble, one drifting tiny star or dot, slightly slouched paws.
Accent colors: pale lavender, misty gray-blue.
Overall feeling: blank, slow, airy, quietly zoning out.
```

## 元气满满

```text
Based on the master prompt, show the cat in a lively energetic mood.
Expression: bright eyes, uplifted brows, tiny smiling mouth, ears perked up.
Mood props: bouncing lines, one tiny sun spark, one leaf or small motion mark, paws pressing forward as if ready to spring.
Accent colors: fresh yellow, warm orange, lively green.
Overall feeling: energetic, charged up, playful and ready to move.
```

## 忧郁

```text
Based on the master prompt, show the cat in a moody melancholic state.
Expression: drooping eyelids, slightly downward brows, tiny curved mouth, lowered head.
Mood props: one small rain cloud or droplet above the head, soft ripples or sagging emotion cloud below.
Accent colors: desaturated blue, muted indigo.
Overall feeling: quiet, inward, a little rainy, but still cute and gentle.
```

## 愉悦

```text
Based on the master prompt, show the cat in a delighted cheerful mood.
Expression: smiling crescent eyes or happy round eyes, lifted cheeks, curved smiling mouth.
Mood props: small floating hearts or confetti-like dots, slightly raised paws, relaxed buoyant posture.
Accent colors: peach pink, warm yellow.
Overall feeling: light, pleased, sweet, softly celebratory.
```
