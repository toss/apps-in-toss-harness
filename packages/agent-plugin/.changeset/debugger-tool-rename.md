---
'@apps-in-toss/agent-plugin': minor
---

debugger 0.4.0의 MCP 도구 이름 정리에 맞춰 `debug`·`setup-debugger`·`test-on-device`·`inject`·`launch`·`welcome` skill을 고쳤다. 옛 이름은 별칭이 없어서, 이 버전의 skill은 debugger 0.4.0 이상에서만 맞다. `get_debug_status`는 `get_status`, `start_debug`는 `switch_environment`, `list_pages`는 `get_page`, `get_dom_document`는 `get_dom`, `take_snapshot`은 `get_dom_snapshot`, `evaluate`는 `run_script`, `AIT.getSdkCallHistory`는 `list_sdk_calls`, `AIT.getMockState`는 `get_mock_state`, `AIT.getOperationalEnvironment`는 `get_sdk_environment`다. `call_sdk`는 `IAP.getPendingOrders`처럼 한 단계 네임스페이스 이름도 받고, 결제 네임스페이스는 호출마다 폰에서 확인한다.

권한 규칙을 쓰는 사용자는 직접 옮겨야 한다. 서버 키가 `ait-debugger`이므로 도구 이름은 `mcp__ait-debugger__*`이고, 규칙에 도구 이름을 적었다면 새 이름으로 바꾼다(예: `mcp__ait-debugger__evaluate`는 `mcp__ait-debugger__run_script`). 0.3.0 이하의 `mcp__ait-devtools__*` 규칙은 이 버전에서도 여전히 맞지 않는다.

`setup-debugger`는 `.mcp.json`의 `ait-devtools` 항목이 `@apps-in-toss/debugger`를 가리킬 때만 `ait-debugger`로 옮기고(다른 서버 항목은 그대로, 이미 새 키가 있으면 옛 키만 지우자고 제안), 이 패키지가 아닌 같은 이름의 항목은 건드리지 않고 알린다. 최소 debugger 버전을 0.4.0으로 올렸다.
