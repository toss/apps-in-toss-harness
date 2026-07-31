---
name: design
description: |
  Bridge a Figma design into a mini-app — reads it via a Figma MCP if
  configured (else manual walkthrough), checks Apps in Toss UX constraints
  (safe-area, swipe-back, PageHeader), and produces registration image
  assets at the console MCP `miniapp_create` tool's exact specs (logo,
  thumbnail, screenshots). Never registers/uploads. Triggered by
  `/ait:design [figma-url]`.
argument-hint: '[figma-url]'
---

# design skill

## 목적

`/ait:design` 한 번으로 Figma 디자인을 앱인토스 미니앱으로 잇는다.
이 skill은 두 가지를 한다:

1. **디자인을 앱인토스 UX 제약으로 매핑** — safe-area inset, swipe-back 제스처,
   PageHeader 관례, 그리고 자체 design token의 일관성을 디자인에 대조해서, 토스
   앱 컨테이너 안에서 깨지지 않을 화면 구조인지 점검한다. 토스의 방대한 디자인
   시스템(TDS)을 모사·의존하도록 권하지 않는다 — 디자인 자유도를 묶고, 모델이
   실제 토큰 값을 알지 못한 채 "TDS 호환"을 추측하게 만들기 때문이다. 미니앱은
   자체 토큰으로 일관되게 디자인하면 충분하다.
2. **등록 이미지 자산을 정확한 규격으로 생성** — 콘솔 등록(console MCP
   `miniapp_create`)이 소비하는 `./assets/`의 PNG들(logo·thumbnail·세로
   스크린샷 등)을 등록이 검증하는 것과 **동일한 규격**으로 만든다.

이 skill은 harness의 디자인 station(station 8)이다. 콘솔 등록은 그동안 자산을
"사용자가 직접 `./assets/`에 배치"하는 수동 hand-off를 전제해 왔는데, design이
바로 그 산출을 맡는 앞 단계다 — design이 자산을 만들고, 등록이 그 자산을
소비한다.

이 skill이 완료되면:
- 프로젝트 루트 `./assets/`에 등록 규격에 맞는 PNG 자산이 준비된다.
- 화면별 UX 제약 점검 결과(safe-area / swipe-back / PageHeader / 토큰 일관성)가 정리된다.
- 곧바로 console MCP `miniapp_create`로 넘어가 같은 자산으로 등록을 진행할 수 있다.

생성·수정하는 모든 파일과 안내에 과장·홍보성 문구를 넣지 않는다. 토스의 디자인
시스템(TDS)을 모사·의존하도록 권하지 않으며, 부득이 언급할 때도 사실 참조에
그치고 TDS 사용이 곧 토스의 디자인 승인·인증을 뜻한다고 함의하지 않는다.

## 의존

- **Figma MCP server (선택)**: 사용자가 Figma MCP(예: Figma Dev Mode MCP,
  framelink 계열)를 자신의 에이전트에 설정해 두었으면 design이 그것을 **소비**해서
  프레임·레이어·토큰을 읽는다. 이 플러그인은 MCP server를 **제공하지 않는다** —
  Figma MCP는 "있으면 쓰고, 없으면 우아하게 대체"하는 선택적 입력일 뿐이다
  (아래 "실행 순서" 1단계의 detect-and-degrade 참조).
- **이미지 도구 (선택, 자산 리사이즈용)**: 정확한 규격으로 PNG를 만들려면
  ImageMagick(`magick`/`convert`)이나 `sips`(macOS), 또는 다른 로컬 이미지
  도구가 있으면 활용한다. 없으면 사용자에게 디자인 export 규격을 안내해 직접
  채우게 한다(절벽이 아니라 seam — register와 동일한 규격을 그대로 전달).

> 이 skill은 콘솔 인증을 **요구하지 않는다**. 디자인 매핑·자산 생성은 로컬 작업이고,
> 등록(console MCP `miniapp_create`)이 콘솔 세션을 쓴다(1회 인가는 `/mcp`에서
> `apps-in-toss-console` 브라우저 OAuth).

## 입력

- **Figma 입력** (선택): `/ait:design <figma-url>`로 파일/프레임 URL을 줄 수 있다.
  생략하면 1단계에서 Figma MCP를 탐지하거나 사용자에게 디자인 출처를 묻는다.
- **자산 의도**: 어떤 화면이 앱 아이콘·대표 썸네일·스크린샷이 될지. Figma 프레임이
  있으면 그 프레임을 후보로 제시한다.

이 skill은 콘솔 등록(console MCP `miniapp_create`)과 **동일한 자산 규격**을
산출 목표로 삼는다. 규격은 아래 "생성 자산 규격" 표에 있고, 등록이 요구하는
입력 규격과 정확히 일치한다.

## 실행 순서

### 1. Figma MCP 탐지 + 디자인 입력 수집 (detect-and-degrade)

먼저 사용 가능한 도구 목록에 Figma MCP server가 있는지 확인한다 — tool 이름에
`figma`가 들어가는 MCP tool(예: `get_code`, `get_image`, `get_variable_defs`,
`get_metadata` 류)이 노출돼 있으면 Figma MCP가 설정된 것이다.

- **Figma MCP가 있으면**: 사용자가 준 `<figma-url>`(또는 선택된 프레임)을 그
  MCP로 읽어 프레임 구조·레이어·디자인 토큰(색·타이포·spacing)·export 후보를
  가져온다. URL이 없으면 현재 선택/최근 파일을 물어본다.
- **Figma MCP가 없으면** (degrade): 에러로 취급하지 않는다. 정상 경로로 안내한다:

  ```
  Figma MCP server가 감지되지 않았습니다. 두 가지 방법으로 진행할 수 있습니다:

    1) Figma MCP를 설정하면 design이 프레임·토큰을 직접 읽습니다.
       (이 플러그인은 MCP server를 제공하지 않습니다 — 외부 Figma MCP를
        설정해 두면 그것을 소비합니다.)
    2) MCP 없이 진행 — 디자인을 직접 설명해주시면(또는 Figma에서 PNG를
       export해 ./assets/ 에 두시면) 그 입력으로 UX 매핑과 자산 규격
       정리를 도와드립니다.

  어느 쪽으로 진행할지 알려주세요.
  ```

  사용자가 (2)를 고르면, 화면별 핵심 정보(주요 화면 목록, 색/타이포 토큰, 아이콘
  소스, 스크린샷으로 쓸 화면)를 묻고 그 답을 입력으로 삼는다.

**MCP 설치를 강요하지 않는다.** Figma MCP는 편의 입력이고, 없어도 design은
수동 입력 경로로 끝까지 동작한다.

### 2. 앱인토스 UX 제약으로 매핑

수집한 디자인을 아래 제약에 대조한다. 각 항목을 화면별로 점검하고, 어긋나는
지점을 구체적으로 짚는다(추측으로 통과 처리하지 않는다).

미니앱은 토스 앱 WebView에서 도는 **웹(React DOM) 화면**이지 React Native
앱이 아니다 — 따라서 디자인을 웹 레이아웃(CSS·DOM)으로 매핑하고, RN 네이티브
컴포넌트(`<View>`·`<Text>` 등)를 전제하지 않는다.

| 제약 | 무엇을 점검하나 | 흔한 어긋남 |
|---|---|---|
| **Safe-area inset** | 상단 노치/상태바 영역을 피하는가. 최상단 콘텐츠가 `env(safe-area-inset-top)` / `--sat` 만큼 내려와 있는가 | 헤더·CTA가 노치 뒤로 잘림. `viewport-fit=cover` 없이 고정 padding만 사용 |
| **Swipe-back 제스처** | 좌측 가장자리 가로 스와이프가 뒤로가기로 동작하는가. 그 영역에 가로 드래그 UI(캐러셀·슬라이더)를 겹쳐 두지 않았는가 | 좌측 엣지 캐러셀이 swipe-back과 충돌. 뒤로가기 의도가 화면 전환과 어긋남 |
| **PageHeader 관례** | 화면 상단 타이틀/뒤로가기 패턴이 컨테이너의 헤더 관례와 정렬되는가. 커스텀 헤더가 시스템 헤더와 이중으로 쌓이지 않는가 | 자체 헤더 + 컨테이너 헤더 중복. 뒤로가기 affordance 부재 |
| **토큰 일관성** | 색·타이포·간격을 하드코딩된 값이 아니라 화면 전반에서 일관된 자체 design token으로 쓰는가. 같은 역할의 값이 화면마다 제각각이지 않은가 | 하드코딩된 hex/px가 화면마다 미세하게 달라 시각적으로 들쭉날쭉. 토큰 없이 매번 새 값 |

매핑 산출물은 화면별 "통과 / 조정 필요 + 구체적 사유" 목록이다. 코드 변경까지는
하지 않는다 — design은 진단·산출이고, 실제 화면 코드 수정은 사용자(또는
`/ait:debug`로 회귀 점검)의 몫이다. UX 패턴의 근거는 마지막 docs 링크(`navigation-flow`
등)로 잇는다.

### 3. 등록 이미지 자산 생성 (정확한 규격)

`./assets/`를 만든다(없을 때만):

```bash
mkdir -p assets
```

아래 규격으로 PNG를 산출한다. 이 표는 console MCP `miniapp_create`의 입력
규격과 **정확히 일치**해야 한다 — 등록이 로컬 + 서버 양쪽에서 같은 규격을
강제하므로, 여기서 어긋나면 등록이 거부된다.

| 파일 | 규격 | 개수 |
|---|---|---|
| `assets/logo.png` | 600×600 | 1 (필수) |
| `assets/thumbnail.png` | 1932×828 | 1 (필수) |
| `assets/screenshot-*.png` | 636×1048 | ≥ 3 (필수, 세로) |
| `assets/logo-dark.png` | 600×600 | 선택 |
| `assets/screenshot-h-*.png` | 1504×741 | 선택 (가로) |

산출 방법은 가용 도구에 따라 분기한다 — 이 skill은 이미지 렌더링 백엔드가
아니라, 에이전트가 가용 도구로 정확한 규격을 맞추도록 **지시**한다:

- **이미지 도구가 있고 소스가 준비된 경우**(Figma export 또는 사용자가 둔 원본):
  로컬 도구로 정확한 규격에 맞춰 리사이즈·크롭한다. 종횡비가 다르면 임의로 늘리지
  말고(왜곡 금지) 크롭/패딩 의도를 사용자에게 확인한다. 예시:

  ```bash
  # ImageMagick (정확히 600×600으로, 종횡비 깨지면 사용자 확인 후)
  magick source-logo.png -resize 600x600^ -gravity center -extent 600x600 assets/logo.png
  # macOS sips (정확한 픽셀로)
  sips -z 600 600 source-logo.png --out assets/logo.png
  ```

- **이미지 도구가 없고 소스도 없는 경우 (디자인 자산 전무)**: 에이전트가 직접
  단색 플레이스홀더 PNG를 생성해 `./assets/`에 배치한다. 생성 전에 앱 이름·
  주 색상(hex, 예: `#0064FF`)·카테고리를 묻는다. 플레이스홀더 생성 우선순위:

  1. **ImageMagick** (`magick` 명령이 있으면):

     ```bash
     mkdir -p assets
     magick -size 600x600 xc:#0064FF assets/logo.png
     magick -size 1932x828 xc:#0064FF assets/thumbnail.png
     magick -size 636x1048 xc:#0064FF assets/screenshot-1.png
     magick -size 636x1048 xc:#0064FF assets/screenshot-2.png
     magick -size 636x1048 xc:#0064FF assets/screenshot-3.png
     ```

  2. **Python Pillow** (`python3 -c "from PIL import Image"` 성공하면):

     ```python
     from PIL import Image
     import os
     os.makedirs("assets", exist_ok=True)
     color = (0, 100, 255)  # 사용자가 입력한 hex → RGB
     for spec in [("assets/logo.png", 600, 600),
                  ("assets/thumbnail.png", 1932, 828),
                  ("assets/screenshot-1.png", 636, 1048),
                  ("assets/screenshot-2.png", 636, 1048),
                  ("assets/screenshot-3.png", 636, 1048)]:
         Image.new("RGB", (spec[1], spec[2]), color).save(spec[0])
     ```

  3. **Node canvas** (`node -e "require('canvas')"` 성공하면):
     canvas API로 동일 규격 PNG를 생성.

  플레이스홀더 생성 후에도 4단계 규격 검증을 동일하게 통과해야 한다.
  완료 안내에 다음 한 줄을 반드시 추가한다:

  ```
  이 자산은 플레이스홀더입니다. 콘솔 등록 전에 실제 디자인으로 교체하세요.
  ```

  > 참고: `sips`는 기존 파일 리사이즈 전용이므로 소스 파일이 없는 합성에는
  > 사용하지 않는다.

- **이미지 도구는 없지만 Figma에서 직접 export하려는 경우**: 위 플레이스홀더
  자동 생성이 1차 경로이지만, 사용자가 Figma를 직접 활용하려는 경우 각 자산별
  export 설정을 구체적으로 안내한다 — Figma export는 "가능하면" 제안이 아니라
  **반드시** 다음 설정을 명시한다:

  | 자산 | Figma export 설정 |
  |---|---|
  | `logo.png` | 프레임을 600×600으로 지정, Export → PNG |
  | `thumbnail.png` | 프레임을 1932×828로 지정, Export → PNG |
  | `screenshot-*.png` | 프레임을 636×1048로 지정, Export → PNG (≥3장) |
  | `logo-dark.png` | 프레임을 600×600으로 지정, Export → PNG (선택) |
  | `screenshot-h-*.png` | 프레임을 1504×741로 지정, Export → PNG (선택) |

  `Export → Custom size → <W>×<H>px` 설정으로도 동일하게 맞출 수 있다.
  export 후 `./assets/`에 배치하면 4단계 규격 검증이 치수를 잡아준다.

세로 스크린샷은 **최소 3장**이 필수다. 2단계에서 "스크린샷으로 쓸 화면"으로 고른
프레임을 우선 후보로 삼는다.

### 4. 규격 검증

생성된 파일의 실제 픽셀 치수를 확인해서 규격과 맞는지 검증한다(서버 왕복 전에
잡는다):

```bash
# ImageMagick
magick identify -format "%f %wx%h\n" assets/*.png
# macOS (도구 없을 때)
sips -g pixelWidth -g pixelHeight assets/logo.png
```

각 파일을 규격표와 대조해서, 어긋나면 어느 파일이 어떤 치수로 틀렸는지 짚고
3단계로 돌아가 다시 만든다. 필수 자산(logo·thumbnail·세로 스크린샷 ≥3)이 모두
규격을 통과해야 완료로 본다.

### 5. 완료 안내

모든 단계 후 한 블록으로 마무리한다:

```
design 완료

UX 매핑:
  - safe-area / swipe-back / PageHeader / 토큰 일관성 점검 결과 (화면별 통과·조정 요약)

생성된 자산 (./assets/):
  - logo.png             600×600        (필수)
  - thumbnail.png        1932×828       (필수)
  - screenshot-1.png …   636×1048       (필수, 세로 ≥ 3장)
  - logo-dark.png        600×600        (선택, 생성했으면)
  - screenshot-h-1.png   1504×741       (선택, 가로, 생성했으면)
  규격은 생성 직후 검증했고, 등록 시(console MCP miniapp_create) 서버에서 다시 강제됩니다.

다음 단계:
  console MCP            # 이 자산으로 miniapp_create → bundle_upload →
                          # bundle_upload_complete 로 등록·업로드
                          # (최초 1회 /mcp 에서 apps-in-toss-console 인가 필요)

실기기에서 화면 회귀를 점검하려면:
  /ait:debug
```

## Out of scope (이 skill이 하지 않는 것)

- ❌ MCP server 추가·제공 — 이 플러그인은 순수 skills 패키지(idle context 비용 0).
  Figma MCP는 **소비만** 한다(있으면 쓰고 없으면 수동 경로). 설치를 강요하지 않는다.
- ❌ 등록·업로드 — design은 그 **앞** 단계(자산 생산자). 등록·업로드는 console
  MCP 도구(`miniapp_create`/`bundle_upload`/`bundle_upload_complete`)의 역할.
- ❌ 이미지 렌더링 백엔드 노릇 — 임의 디자인을 픽셀부터 창작하지 않는다. 가용
  로컬 도구로 규격에 맞춰 리사이즈/검증하거나, 소스가 없으면 단색 플레이스홀더를
  자동 생성한다(사용자가 이후 실제 디자인으로 교체). Figma export를 직접 실행하지
  않는다.
- ❌ 화면 코드 수정 — UX 제약 매핑은 진단·산출이지 자동 리팩터가 아니다. 실제
  화면 회귀 점검은 `/ait:debug`.
- ❌ 종횡비 왜곡 — 규격에 안 맞는 소스를 임의로 늘려 채우지 않는다. 크롭/패딩
  의도를 사용자에게 확인한다.

## 하지 말아야 할 것

- ❌ Figma MCP가 없다고 에러로 중단 — 정상 상태로 보고 수동 입력 경로로 우아하게 대체.
- ❌ register와 다른 자산 규격을 산출 — 규격표는 register와 정확히 일치해야 한다.
  어긋나면 등록 시점에 거부된다.
- ❌ 규격 검증 없이 "자산 생성 완료"만 전달 — 반드시 실제 픽셀 치수를 확인.
- ❌ UX 제약을 추측으로 통과 처리 — 점검 결과는 화면별로 구체적 사유와 함께.
- ❌ TDS를 토스의 디자인 인증·제휴로 함의하기. 생성·수정하는 안내에 과장·홍보성 문구 삽입 금지.

## 참고

- 짝 skill: `new-miniapp` (greenfield 프로젝트 생성 — 디자인을 입힐 대상이 없을 때 먼저).
- 짝 skill: `debug` (자산 반영 후 실기기 화면 회귀 점검).
- 생성한 자산은 콘솔 등록(console MCP `miniapp_create`)이 바로 소비한다.
- 진입·종료·화면 컨텍스트(swipe-back/PageHeader), 상단 네비게이션 바
  악세서리 버튼(`partner.addAccessoryButton`) 등 주제별 가이드는 docs MCP
  (`searchDocumentation`/`getPage`)로 조회한다.
