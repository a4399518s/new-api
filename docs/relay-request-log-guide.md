# New-API Relay 请求日志添加指南

> 适用于 v1.0.0-rc.36 及以上版本

## 目标

给 new-api 添加请求日志功能，记录发送到 LLM 的请求参数和 LLM 返回的响应内容，支持流式和非流式响应，数据保存到数据库 `logs` 表。

## 前置条件

- 数据库支持：SQLite、MySQL >= 5.7.8、PostgreSQL >= 9.6（三者必须同时兼容）
- 使用 GORM 进行数据库操作
- 日志系统使用 `logger/logger.go`

---

## 第一步：数据库迁移 — `logs` 表添加字段

在 `model/log.go` 的 `Log` 结构体中添加两个字段：

```go
// 文件: model/log.go
// 在 Other 字段后面添加（注意：v1.0.0-rc.36 已有 UpstreamRequestId 字段）

type Log struct {
    // ... 其他字段
    UpstreamRequestId string `json:"upstream_request_id,omitempty" gorm:"type:varchar(128);index:idx_logs_upstream_request_id;default:''"`
    Other             string `json:"other"`
    RequestBody       string `json:"request_body" gorm:"type:text"`    // 新增
    ResponseBody      string `json:"response_body" gorm:"type:text"`   // 新增
}
```

### SQL 迁移

根据使用的数据库执行对应 SQL：

```sql
-- SQLite
ALTER TABLE logs ADD COLUMN request_body TEXT;
ALTER TABLE logs ADD COLUMN response_body TEXT;

-- MySQL
ALTER TABLE logs ADD COLUMN request_body TEXT;
ALTER TABLE logs ADD COLUMN response_body TEXT;

-- PostgreSQL
ALTER TABLE logs ADD COLUMN request_body TEXT;
ALTER TABLE logs ADD COLUMN response_body TEXT;
```

> **注意**：如果开启了 `LogConsumeEnabled`，GORM 会自动为新字段创建列。但建议手动执行以确保安全。

---

## 第二步：记录参数结构体添加字段

在 `model/log.go` 的 `RecordConsumeLogParams` 中添加字段，并在 `RecordConsumeLog` 函数中传递：

```go
// 文件: model/log.go

type RecordConsumeLogParams struct {
    // ... 其他字段
    Group            string    `json:"group"`
    Other            *LogOther `json:"other"`
    RequestBody      string    `json:"request_body"`    // 新增
    ResponseBody     string    `json:"response_body"`   // 新增
}
```

在 `RecordConsumeLog` 函数中，将参数写入 Log：

```go
// 文件: model/log.go - RecordConsumeLog 函数内
// 在创建 log 对象时添加（注意：v1.0.0-rc.36 还有 UpstreamRequestId）

log := &Log{
    // ... 其他字段赋值
    RequestId:         requestId,
    UpstreamRequestId: upstreamRequestId,
    Other:             otherStr,
    RequestBody:       params.RequestBody,    // 新增
    ResponseBody:      params.ResponseBody,   // 新增
}
```

---

## 第三步：RelayInfo 添加请求/响应体字段

在 `relay/common/relay_info.go` 的 `RelayInfo` 结构体中添加字段，用于在整个请求生命周期中传递数据：

```go
// 文件: relay/common/relay_info.go

type RelayInfo struct {
    // ... 其他字段
    StreamStatus *StreamStatus

    // convOptions caches the converter settings snapshot (see ConvOptions).
    convOptions *convmeta.Options

    conversionDiagnostics          []types.ConversionDiagnostic
    conversionDiagnosticKeys       map[conversionDiagnosticKey]struct{}
    conversionDiagnosticsTruncated bool

    // RequestBody 是发送到上游的请求体（字符串形式）
    RequestBody string
    // ResponseBody 是从上游接收的响应体（字符串形式，非流式为完整内容，流式为所有 chunk 拼接）
    ResponseBody string

    // ... 其他字段
}
```

---

## 第四步：配置项 — GeneralSetting

在 `setting/operation_setting/general_setting.go` 中添加日志配置：

```go
// 文件: setting/operation_setting/general_setting.go

type GeneralSetting struct {
    // ... 其他字段
    CustomCurrencyExchangeRate float64 `json:"custom_currency_exchange_rate"`

    // Relay 日志配置
    RelayLogEnabled      bool `json:"relay_log_enabled"`        // 总开关，默认 false
    RelayLogRequestBody  bool `json:"relay_log_request_body"`   // 记录请求体（含敏感信息），默认 false
    RelayLogResponseBody bool `json:"relay_log_response_body"`  // 记录响应体，默认 true
    RelayLogMaxLength    int  `json:"relay_log_max_length"`     // 最大记录字符数，默认 4096
}

// 默认配置
var generalSetting = GeneralSetting{
    // ... 其他默认值
    RelayLogEnabled:            false,
    RelayLogRequestBody:        false,
    RelayLogResponseBody:       true,
    RelayLogMaxLength:          4096,
}
```

---

## 第五步：日志函数 — logger/logger.go

在 `logger/logger.go` 末尾添加三个函数：

```go
// 文件: logger/logger.go
// 需要 import "github.com/QuantumNous/new-api/setting/operation_setting"

func LogRelayRequest(ctx context.Context, requestBody []byte) {
    settings := operation_setting.GetGeneralSetting()
    if !settings.RelayLogEnabled {
        return
    }
    if !settings.RelayLogRequestBody {
        logHelper(ctx, loggerINFO, "[Relay Request]")
        return
    }
    maxLen := settings.RelayLogMaxLength
    if maxLen <= 0 {
        maxLen = 4096
    }
    body := string(requestBody)
    if len(body) > maxLen {
        body = body[:maxLen] + "...[truncated]"
    }
    logHelper(ctx, loggerINFO, fmt.Sprintf("[Relay Request] %s", body))
}

func LogRelayResponse(ctx context.Context, responseBody []byte) {
    settings := operation_setting.GetGeneralSetting()
    if !settings.RelayLogEnabled {
        return
    }
    if !settings.RelayLogResponseBody {
        logHelper(ctx, loggerINFO, "[Relay Response]")
        return
    }
    maxLen := settings.RelayLogMaxLength
    if maxLen <= 0 {
        maxLen = 4096
    }
    body := string(responseBody)
    if len(body) > maxLen {
        body = body[:maxLen] + "...[truncated]"
    }
    logHelper(ctx, loggerINFO, fmt.Sprintf("[Relay Response] %s", body))
}

func LogRelayStreamResponse(ctx context.Context, streamData string) {
    settings := operation_setting.GetGeneralSetting()
    if !settings.RelayLogEnabled {
        return
    }
    if !settings.RelayLogResponseBody {
        return
    }
    maxLen := settings.RelayLogMaxLength
    if maxLen <= 0 {
        maxLen = 4096
    }
    data := streamData
    if len(data) > maxLen {
        data = data[:maxLen] + "...[truncated]"
    }
    logHelper(ctx, loggerINFO, fmt.Sprintf("[Relay Stream] %s", data))
}
```

---

## 第六步：流式响应收集 — StreamScannerHandler

在 `relay/helper/stream_scanner.go` 的 `StreamScannerHandler` 函数中添加流式数据收集。v1.0.0-rc.36 使用 `context.WithCancel` + `cleanup` 模式：

```go
// 文件: relay/helper/stream_scanner.go - StreamScannerHandler 函数

func StreamScannerHandler(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo, dataHandler func(data string, sr *StreamResult)) {
    // ... 前置检查

    // 在 info.StreamStatus = ... 之后添加：
    // 用于收集所有流式数据
    var streamBuilder strings.Builder

    ctx, cancel := context.WithCancel(context.Background())

    // ... 现有代码 ...

    // 在 cleanup 函数中（cleanupOnce.Do 内），resp.Body.Close() 之后添加：
    // 保存所有流式数据到 info.ResponseBody
    if streamBuilder.Len() > 0 {
        info.ResponseBody = streamBuilder.String()
    }

    // 在 scanner 读取到数据的处理分支中（dataHandler 调用前），添加：
    logger.LogRelayStreamResponse(c, data)

    // 收集流式数据
    streamBuilder.WriteString(data)
    streamBuilder.WriteString("\n")
}
```

---

## 第七步：请求体记录 — 各 Handler 入口

在以下 handler 文件中，找到 `requestBody` 赋值的位置，在其前后添加请求体记录。

> **注意**：v1.0.0-rc.36 使用 `relaycommon.NewOutboundJSONBody(jsonData)` 返回 `(io.Reader, io.Closer, error)`，PassThrough 分支使用 `common.NewReplayableBodyReader(storage)`。

### 7.1 TextHelper（OpenAI 兼容格式）

```go
// 文件: relay/compatible_handler.go - TextHelper 函数
// 需要 import "github.com/QuantumNous/new-api/logger"

// PassThrough 分支：
if debugBytes, bErr := storage.Bytes(); bErr == nil {
    logger.LogRelayRequest(c, debugBytes)
    info.RequestBody = string(debugBytes)
}
requestBody = common.NewReplayableBodyReader(storage)

// 正常转换分支（jsonData 序列化后）：
logger.LogDebug(c, "text request body: %s", jsonData)
logger.LogRelayRequest(c, jsonData)
info.RequestBody = string(jsonData)

body, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
if err != nil {
    return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
}
defer closer.Close()
jsonData = nil
requestBody = body
```

### 7.2 ClaudeHelper

```go
// 文件: relay/claude_handler.go - ClaudeHelper 函数
// 需要 import "github.com/QuantumNous/new-api/logger"

// PassThrough 分支：
if debugBytes, bErr := storage.Bytes(); bErr == nil {
    logger.LogRelayRequest(c, debugBytes)
    info.RequestBody = string(debugBytes)
}
requestBody = common.NewReplayableBodyReader(storage)

// 正常转换分支：
logger.LogDebug(c, "requestBody: %s", jsonData)
logger.LogRelayRequest(c, jsonData)
info.RequestBody = string(jsonData)

body, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
if err != nil {
    return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
}
defer closer.Close()
jsonData = nil
requestBody = body
```

### 7.3 ResponsesHelper

```go
// 文件: relay/responses_handler.go - ResponsesHelper 函数
// 需要 import "github.com/QuantumNous/new-api/logger"

// PassThrough 分支：
if debugBytes, bErr := storage.Bytes(); bErr == nil {
    logger.LogRelayRequest(c, debugBytes)
    info.RequestBody = string(debugBytes)
}
requestBody = common.NewReplayableBodyReader(storage)

// 正常转换分支：
logger.LogDebug(c, "requestBody: %s", jsonData)
logger.LogRelayRequest(c, jsonData)
info.RequestBody = string(jsonData)

body, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
if err != nil {
    return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
}
defer closer.Close()
jsonData = nil
requestBody = body
```

### 7.4 EmbeddingHelper

```go
// 文件: relay/embedding_handler.go - EmbeddingHelper 函数
// 需要 import "github.com/QuantumNous/new-api/logger"

logger.LogDebug(c, "converted embedding request body: %s", jsonData)
logger.LogRelayRequest(c, jsonData)
info.RequestBody = string(jsonData)

body, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
if err != nil {
    return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
}
defer closer.Close()
jsonData = nil
var requestBody io.Reader = body
```

### 7.5 GeminiEmbeddingHandler

```go
// 文件: relay/gemini_handler.go - GeminiEmbeddingHandler 函数
// 需要 import "github.com/QuantumNous/new-api/logger"

logger.LogDebug(c, "Gemini embedding request body: %s", jsonData)
logger.LogRelayRequest(c, jsonData)
info.RequestBody = string(jsonData)

body, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
if err != nil {
    return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
}
defer closer.Close()
jsonData = nil
requestBody = body
```

### 7.6 RerankHelper

```go
// 文件: relay/rerank_handler.go - RerankHelper 函数
// 需要 import "github.com/QuantumNous/new-api/logger"

logger.LogDebug(c, "Rerank request body: %s", jsonData)
logger.LogRelayRequest(c, jsonData)
info.RequestBody = string(jsonData)

body, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
if err != nil {
    return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
}
defer closer.Close()
jsonData = nil
requestBody = body
```

### 7.7 ImageHelper

```go
// 文件: relay/image_handler.go - ImageHelper 函数
// 需要 import "github.com/QuantumNous/new-api/logger"

// PassThrough 分支：
if debugBytes, bErr := storage.Bytes(); bErr == nil {
    logger.LogRelayRequest(c, debugBytes)
    info.RequestBody = string(debugBytes)
}
requestBody = common.NewReplayableBodyReader(storage)

// 正常转换分支：
logger.LogDebug(c, "image request body: %s", jsonData)
logger.LogRelayRequest(c, jsonData)
info.RequestBody = string(jsonData)

body, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
if err != nil {
    return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
}
defer closer.Close()
jsonData = nil
requestBody = body
```

---

## 第八步：响应体记录 — 各 Channel Handler

在以下 channel handler 中，读取响应体后添加 `info.ResponseBody = ...` 赋值。

### 8.1 OpenAI 渠道

```go
// 文件: relay/channel/openai/relay-openai.go

// OpenaiHandler 函数（读取 responseBody 后）：
logger.LogDebug(c, "upstream response body: %s", responseBody)
logger.LogRelayResponse(c, responseBody)
info.ResponseBody = string(responseBody)

// OpenaiHandlerWithUsage 函数：
info.ResponseBody = string(responseBody)
```

```go
// 文件: relay/channel/openai/audio.go

// OpenaiTTSHandler 函数（非流式分支）：
info.ResponseBody = string(bodyBytes)

// OpenaiSTTHandler 函数：
info.ResponseBody = string(responseBody)
```

```go
// 文件: relay/channel/openai/relay_responses.go

// OaiResponsesHandler 函数：
logger.LogRelayResponse(c, responseBody)
info.ResponseBody = string(responseBody)
```

```go
// 文件: relay/channel/openai/relay_responses_compact.go

// OaiResponsesCompactionHandler 函数（需修改函数签名添加 info 参数）：
func OaiResponsesCompactionHandler(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (*dto.Usage, *types.NewAPIError) {
    // ...
    info.ResponseBody = string(responseBody)
}

// 同时修改调用方：
// relay/channel/openai/adaptor.go
usage, err = OaiResponsesCompactionHandler(c, resp, info)
// relay/channel/codex/adaptor.go
return openai.OaiResponsesCompactionHandler(c, resp, info)
```

### 8.2 Claude 渠道

```go
// 文件: relay/channel/claude/relay-claude.go
// 需要 import "github.com/QuantumNous/new-api/logger"

// ClaudeHandler 函数：
logger.LogDebug(c, "responseBody: %s", responseBody)
logger.LogRelayResponse(c, responseBody)
info.ResponseBody = string(responseBody)
```

### 8.3 Gemini 渠道

```go
// 文件: relay/channel/gemini/relay-gemini.go

// GeminiChatHandler 函数：
info.ResponseBody = string(responseBody)
```

```go
// 文件: relay/channel/gemini/relay-gemini-native.go

// GeminiTextGenerationHandler 函数：
info.ResponseBody = string(responseBody)

// NativeGeminiEmbeddingHandler 函数：
info.ResponseBody = string(responseBody)
```

> 流式响应（GeminiChatStreamHandler、GeminiTextGenerationStreamHandler）通过 StreamScannerHandler 自动收集。

### 8.4 Cohere 渠道

```go
// 文件: relay/channel/cohere/relay-cohere.go
// 需要 import "github.com/QuantumNous/new-api/logger"

// cohereStreamHandler 函数（流式）：
// 使用 helper.NewStreamScanner(resp.Body) 替代 bufio.NewScanner
// 需要维护 streamItems []string 变量，在每个 chunk 时 append，
// 函数结束时：
if len(streamItems) > 0 {
    info.ResponseBody = strings.Join(streamItems, "\n")
}

// cohereHandler 函数：
logger.LogRelayResponse(c, responseBody)
info.ResponseBody = string(responseBody)
```

### 8.5 Ollama 渠道

```go
// 文件: relay/channel/ollama/stream.go

// ollamaChatHandler 函数：
info.ResponseBody = string(body)
```

```go
// 文件: relay/channel/ollama/relay-ollama.go

// ollamaEmbeddingHandler 函数：
info.ResponseBody = string(body)
```

### 8.6 阿里云渠道

```go
// 文件: relay/channel/ali/image.go

// aliImageHandler 函数：
info.ResponseBody = string(responseBody)
```

### 8.7 MokaAI 渠道

```go
// 文件: relay/channel/mokaai/relay-mokaai.go

// mokaEmbeddingHandler 函数：
info.ResponseBody = string(responseBody)
```

### 8.8 Common Handler

```go
// 文件: relay/common_handler/rerank.go

// RerankHandler 函数：
info.ResponseBody = string(responseBody)
```

---

## 第九步：日志写入 — 传递到 RecordConsumeLog

在以下两个文件中将 `RequestBody` 和 `ResponseBody` 传递到日志记录：

```go
// 文件: service/text_quota.go - PostTextConsumeQuota 函数

model.RecordConsumeLog(ctx, userId, model.RecordConsumeLogParams{
    // ... 其他参数
    IsStream:         relayInfo.IsStream,
    Group:            relayInfo.UsingGroup,
    Other:            other,
    RequestBody:      relayInfo.RequestBody,    // 新增
    ResponseBody:     relayInfo.ResponseBody,   // 新增
})
```

```go
// 文件: service/quota.go - PostAudioConsumeQuota 函数

model.RecordConsumeLog(ctx, relayInfo.UserId, model.RecordConsumeLogParams{
    // ... 其他参数
    IsStream:         relayInfo.IsStream,
    Group:            relayInfo.UsingGroup,
    Other:            other,
    RequestBody:      relayInfo.RequestBody,    // 新增
    ResponseBody:     relayInfo.ResponseBody,   // 新增
})
```

---

## 数据流总结

```
客户端请求
    │
    ▼
Handler 入口 (compatible_handler / claude_handler / ...)
    ├─ logger.LogRelayRequest(c, body)     → 输出到控制台日志
    └─ info.RequestBody = string(body)     → 存入 RelayInfo
    │
    ▼
DoRequest → 上游 LLM
    │
    ▼
Channel Handler (openai / claude / gemini / ...)
    ├─ 非流式: info.ResponseBody = string(responseBody)
    └─ 流式: StreamScannerHandler 自动收集 → info.ResponseBody
    │
    ▼
PostTextConsumeQuota / PostAudioConsumeQuota
    └─ RecordConsumeLog(params.RequestBody, params.ResponseBody)
        │
        ▼
    写入 logs 表 (request_body, response_body)
```

---

## 配置说明

通过管理后台 → 通用设置 配置：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `relay_log_enabled` | bool | false | 总开关 |
| `relay_log_request_body` | bool | false | 记录请求体（含 API Key 等敏感信息） |
| `relay_log_response_body` | bool | true | 记录响应体 |
| `relay_log_max_length` | int | 4096 | 单条日志最大字符数，超出截断 |

---

## 升级检查清单

版本升级后，按以下顺序检查并应用：

- [ ] `model/log.go` — Log 结构体包含 `RequestBody`、`ResponseBody` 字段
- [ ] `model/log.go` — RecordConsumeLogParams 包含这两个字段，RecordConsumeLog 中传递
- [ ] `relay/common/relay_info.go` — RelayInfo 包含 `RequestBody`、`ResponseBody` 字段
- [ ] `setting/operation_setting/general_setting.go` — GeneralSetting 包含 4 个日志配置项
- [ ] `logger/logger.go` — 包含 `LogRelayRequest`、`LogRelayResponse`、`LogRelayStreamResponse`
- [ ] `relay/helper/stream_scanner.go` — StreamScannerHandler 中有 streamBuilder 收集逻辑
- [ ] `relay/compatible_handler.go` — TextHelper 中有请求体记录
- [ ] `relay/claude_handler.go` — ClaudeHelper 中有请求体记录
- [ ] `relay/responses_handler.go` — ResponsesHelper 中有请求体记录
- [ ] `relay/embedding_handler.go` — EmbeddingHelper 中有请求体记录
- [ ] `relay/gemini_handler.go` — GeminiEmbeddingHandler 中有请求体记录
- [ ] `relay/rerank_handler.go` — RerankHelper 中有请求体记录
- [ ] `relay/image_handler.go` — ImageHelper 中有请求体记录
- [ ] `relay/channel/openai/relay-openai.go` — OpenaiHandler、OpenaiHandlerWithUsage 有响应体记录
- [ ] `relay/channel/openai/audio.go` — OpenaiTTSHandler、OpenaiSTTHandler 有响应体记录
- [ ] `relay/channel/openai/relay_responses.go` — OaiResponsesHandler 有响应体记录
- [ ] `relay/channel/openai/relay_responses_compact.go` — OaiResponsesCompactionHandler 签名含 info 参数
- [ ] `relay/channel/openai/adaptor.go` — compact 调用传递 info
- [ ] `relay/channel/codex/adaptor.go` — compact 调用传递 info
- [ ] `relay/channel/claude/relay-claude.go` — ClaudeHandler 有响应体记录
- [ ] `relay/channel/gemini/relay-gemini.go` — GeminiChatHandler 有响应体记录
- [ ] `relay/channel/gemini/relay-gemini-native.go` — GeminiTextGenerationHandler、NativeGeminiEmbeddingHandler 有响应体记录
- [ ] `relay/channel/cohere/relay-cohere.go` — cohereHandler、cohereStreamHandler 有响应体记录
- [ ] `relay/channel/ollama/stream.go` — ollamaChatHandler 有响应体记录
- [ ] `relay/channel/ollama/relay-ollama.go` — ollamaEmbeddingHandler 有响应体记录
- [ ] `relay/channel/ali/image.go` — aliImageHandler 有响应体记录
- [ ] `relay/channel/mokaai/relay-mokaai.go` — mokaEmbeddingHandler 有响应体记录
- [ ] `relay/common_handler/rerank.go` — RerankHandler 有响应体记录
- [ ] `service/text_quota.go` — PostTextConsumeQuota 传递 RequestBody/ResponseBody
- [ ] `service/quota.go` — PostAudioConsumeQuota 传递 RequestBody/ResponseBody
- [ ] 数据库迁移 SQL 已执行
- [ ] 编译通过，无报错
