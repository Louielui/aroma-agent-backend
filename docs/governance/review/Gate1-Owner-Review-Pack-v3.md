---
Version: 3.0
Status: ACCEPTED (Gate 1 D-phase complete) — merge/push pending Owner GO
Classification: Governance Data — Owner-only
Accepted-by: Louie
Acceptance date: 2026-07-14
Last-Updated: 2026-07-14
---

# Aroma Phase 2 — Gate 1 Owner Review Pack v3

**範圍:** 讀取型 MCP connector(香香/ChatGPT 取「已完成執行」)之**實體隔離**建置與證明。
**狀態:** ACCEPTED（D 段五步完成、pack 定稿）。**未 merge、未 push、所有 flag 預設 OFF、tag `aisl-v1.0 @ e3c673a` 未動。** merge/push 待 Owner 另下明確 GO。
**執行模型:** Route B（Owner 於提權 PowerShell 逐步執行、貼回 redact 輸出；build agent 設計/驗收，工具主機無法提權）。

## §1 Gate 1 交付了什麼
一條**只讀、無寫入路徑、不持任何 secret（Model 2）**的 connector 通道:MCP 端持零密鑰,經**命名管線 broker**(backend 持 `BACKEND_READ_IDENTITY`)取得**投影後**的完成結果(僅 `{connectorResultId,summary}`);所有稽核**唯一由 `aroma_audit_svc` 落檔**、**來源身分不可偽造**。結構性隔離,不依賴模型行為。

## §2 D1–D5 實體隔離證據（redacted）
帳號（machine-SID 前綴略,只列 RID）:`aroma_mcp_svc …-1006`、`aroma_audit_svc …-1007`、`aroma_auditor …-1008`、backend=`louis …-1002`。

| 步 | 建置 | 實測證據(通過) |
|---|---|---|
| **D1** | 建低權帳號 audit_svc/auditor(mcp_svc 前步) | 三帳號 Enabled、**皆非 Administrators** |
| **D2** | audit dir `C:\aroma-audit` 保護 DACL,斬繼承後**僅三 ACE**(audit_svc=Modify、auditor=Read、Administrators=Full) | 反向六情境:audit_svc 寫 OK、auditor 讀 OK/寫 DENIED、mcp_svc 讀寫皆 DENIED、**louis(非提權)直寫 DENIED**;`icacls /save` 備份於 `aclbak\` |
| **D3** | audit service **以 audit_svc 跑=唯一 writer**;append pipe ACL 只綁 mcp_svc(…-1006)+louis;service 依**連入 SID** 蓋 sourceIdentity | 正向 mcp/louis append 落 `C:\aroma-audit\audit.log`;**反偽造**:client 送 `S-1-5-18` 假身分→記為連入 SID `…-1006`;auditor `CONNECT_DENIED`;**sink 不可用→`SINK_UNAVAILABLE` 不謊報、無落檔**;`audit.log` owner=`aroma_audit_svc` |
| **D4** | broker **以 louis(backend)跑**,broker pipe ACL 只綁 mcp_svc;presentedReadIdentity 一律取自 broker 持有的 `BACKEND_READ_IDENTITY` | `PIPE_SDDL` = 僅 `SYSTEM(F)` + `mcp_svc …-1006(RW)`;mcp_svc 得投影 `{connectorResultId,summary}`(**無** sourceTaskId/原欄);**反偽造** `payloadIdentityWasPresent=true` 仍 `ok=true`(`used BROKER_HELD, ignored payload`);auditor/louis `CONNECT_DENIED` |
| **D5/T-01** | 最小 `createApp` harness(synthetic、stub workerDeps、`LLM_PROVIDER=mock`、`CONNECTOR_PROJECTION` off、不改 .env),`CONNECTOR_GENERIC_AUTH=on` | `return-ready` NO-token=**401**/WITH=**200**;`proposals/results` NO-token=**401**/WITH=**200**;`proposals`(ungated)=**200**、`health`=**200** → mcp 觸不到 generic 資料 |

## §3 完整 T-matrix 逐項狀態
> **編號說明:** 本 T-matrix 為**選擇性編號**(非連續 1–23);**T-05 / T-07 / T-14 無定義屬正常、非漏編**(Owner 已確認)。

| T | 描述 | 狀態 |
|---|---|---|
| **T-01** | mcp→generic 端點無 token 被擋 | **實體已證(D5,甲)** + synthetic |
| T-02 | mcp→backend repo 檔案 DENY | **實體已證**(sub-step 4) |
| T-03 | 無 read-identity→fail-closed | synthetic + **實體**(D4 `READ_IDENTITY_DENIED`) |
| **T-04** | 成功只回投影欄 | **實體已證**(D3/D4) |
| **T-06** | 跨帳號 process/資源存取被拒 | **實體已證**(D2/D3/D4 + sub-step4) |
| T-08~T-12 | 分類/抑制/禁字 fail-closed | synthetic(backend projection) |
| T-13 | handle 重用 | unit-tested(Tool 2 out-of-scope) |
| T-15 | 寫入嘗試→`WRITE_ATTEMPT_DENIED` | synthetic(dispatcher+#3) |
| T-16/17 | 枚舉/超量→deny | synthetic(`OVERSIZED_RESPONSE`) |
| **T-18** | 稽核先於回傳失敗→不出資料 | synthetic + **實體**(D3 durable-or-deny) |
| **T-19** | 稽核不可用→deny+health | synthetic + **實體**(D3 `SINK_UNAVAILABLE`) |
| **T-20/21** | source-identity 蓋章 + correlation | **實體已證**(D3 反偽造) |
| T-22/23 | 固定碼;log 無 secret | synthetic + **實體**(D4 不印 secret) |
| — | audit **唯一-writer** 正反 | **實體已證**(D2/D3) |
| — | IR-01 broker 讀身分不可偽造 | **實體已證**(D4) |
| T-05/07/14 | — | **選擇性編號、無定義(非漏編)** |

## §4 Residuals
| # | Residual | 狀態 |
|---|---|---|
| R1 | loopback 無法用防火牆隔離 | **已由 T-01(甲)實體關閉**(改以 IR-01 端點 auth) |
| R2 | backend(louis)未對 audit dir 做**帳號級**寫入隔離(louis=admin 保 owner custody) | **仍為 residual**;完整隔離需專屬 backend 帳號 |
| R3 | Owner 妥協在結構性 containment 之外(設計如此) | 憑證衛生/secret 保管/OOB 核准為緩解(AISL-006 §6) |
| R4 | 真實 secrets 保管(CONTROL_PLANE_API_KEY 等) | → **Gate 2**;Gate 1 全程佔位值、不外印 |
| R5 | Tool 2 / 任何寫入路徑 | out-of-Gate-1-scope;connector 結構性無寫入能力 |

## §5 程式碼變更
**Backend**(branch `phase-2/gate-1-mcp-connector` @ `0235c8d`,領先 `main @ 4c84867` 共 7 commits):
```
19 files changed, 1539 insertions(+), 4 deletions(-)
```
- **只動兩既有檔**:`src/app.js`(+68/−4:接線 connector,`connectorDeps`/`genericAuthEnabled`,兩旗標控制)、`src/index.js`(+13:`assertConnectorConfig` fail-fast——**僅當 `CONNECTOR_PROJECTION=on` 且 `BACKEND_READ_IDENTITY` 未設才擋**,flag off 時 no-op)。
- 其餘 **17 個全新檔** in `src/connector/`(classificationPolicy / connectorSafeSummary / connectorResultId / auditSink / durableAuditWriter / resultIdStore / projectionEndpoint / connectorConfig / backendReadIdentity / broker + 7 個 `*.test.js`)。
- Commits:slice1 pure fns → slice2 audit 合約 → slice3 projection core → slice4 durable writer → slice5 wiring(flag OFF)→ slice6A IR-01 auth(flag OFF)→ slice6B Model 2 broker。
- **旗標預設 OFF** → 全新程式碼路徑不啟用 → 對既有行為**零 blast radius**(additive-only)。

**MCP connector**(獨立 repo @ `8d1b483`,2 commits):
- root `46063c6`(G1-D):Tool 1 `list_return_ready_results`(唯讀、單工具、`WRITE_ATTEMPT_DENIED`、持零密鑰)。
- `8d1b483`(slice 6C):`src/pipeProjectionClient.js` + `test/pipeClient.test.js`(`+127`,Model 2、MCP 不送任何 secret)。

**測試:** backend 全套(flag OFF)通過、connector 測試綠;D 段為**真機實體**證據(非 mock)。

## §6 Rollback / 安全姿態
- **未 merge、未 push**;backend recovery ref = **`main @ 4c84867`**;MCP 為獨立 repo(未 push)。
- **旗標全 OFF**:`CONNECTOR_PROJECTION` off、`CONNECTOR_GENERIC_AUTH` off、`BACKEND_READ_IDENTITY` 未設 → connector 完全惰性。
- **additive-only**:無 DROP/ALTER 既有表/檔;回復 = 不合併即可;若已合併,`git reset --hard <pre-tag>` + 保持旗標 OFF。
- tag `aisl-v1.0 @ e3c673a` 未動。

## §7 收尾清單(`C:\aroma-gate1` 測試 .ps1)
Gate 1 收貨後清除(全為 Route B 測試腳本,無正式碼)——**已於 2026-07-14 執行**:
`audit_append_client.ps1`、`audit_service.ps1`、`audit_service_diag.ps1`、`broker_client.ps1`、`broker_service.ps1`、`grp_probe.ps1`、`pipe_client.ps1`、`pipe_server.ps1`、`read_probe.ps1`、`synthetic_child.ps1` 皆已移除。
- `C:\aroma-gate1\aclbak\`(D2 的 `icacls /save` 備份):**保留至 Gate 1 正式簽核後**再刪(audit dir ACL 的外科式回復點)。
- **保留(非測試、正式隔離資產):** `C:\aroma-audit`(audit dir + 三-ACE DACL)、三個服務帳號。

## §8 尚未做 / 待決定
- **Merge/Push:** 保留待 Owner 明確 GO(backend ff-only 併 main;MCP repo push)。Owner 決定:待清醒時重讀本 pack 再另下 GO。
- **Gate 2:** 真實 secrets 保管(R4)、Tool 2/寫入路徑(R5)、專屬 backend 帳號關閉 R2、Phase 3 Cowork 自動掃描。

## Changelog
- **v3.0 — 2026-07-14.** Gate 1 D 段(D1–D5)實體隔離全數完成並經 Owner 收貨;真實 git diff --stat、D1–D5 實測證據、選擇性 T-matrix、residuals R1–R5、rollback recovery ref `main @ 4c84867`。merge/push 待 Owner GO。
