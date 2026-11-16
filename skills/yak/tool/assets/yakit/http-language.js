// Adapted from Yakit; AGPL-3.0, see YAKIT-LICENSE.txt.
monaco.languages.register({id:'http'});
monaco.languages.setMonarchTokensProvider('http', {
  brackets: [],
  defaultToken: '',
  ignoreCase: true,
  includeLF: true,
  start: '',
  tokenPostfix: '',
  unicode: false,
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  tokenizer: {
    root: [
      // HTTP请求方法
      // 基础 Fuzz 标签解析
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/(GET|POST|OPTIONS|DELETE|PUT|PATCH)/g, 'http.method'],
      [/\s/, 'delimiter', '@http_path'],
      // [/(html|div|src|\<\/?title\>|<alert>)/i, "keyword"],
      // [/(\<script\>|<alert>|<prompt>|<svg )/i, "keyword"],
      // [/(secret)|(access)|(password)|(verify)|(login)/i, "bold-keyword"],
    ],
    fuzz_tag: [
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag_second'],
      [/}}/, 'fuzz.tag.inner', '@pop'],
      [/[\w:]+}}/, 'fuzz.tag.inner', '@pop'],
      [/[\w:]+\(/, 'fuzz.tag.inner', '@fuzz_tag_param'],
    ],
    fuzz_tag_second: [
      [/{{/, 'fuzz.tag.second', '@fuzz_tag'],
      [/}}/, 'fuzz.tag.second', '@pop'],
      [/[\w:]+}}/, 'fuzz.tag.second', '@pop'],
      [/[\w:]+\(/, 'fuzz.tag.second', '@fuzz_tag_param_second'],
    ],
    fuzz_tag_param: [
      [/\(/, 'fuzz.tag.inner', '@fuzz_tag_param'],
      [/\\\)/, 'bold-keyword'],
      [/\)/, 'fuzz.tag.inner', '@pop'],
      [/{{/, 'fuzz.tag.second', '@fuzz_tag_second'],
      [/./, 'bold-keyword'],
    ],
    fuzz_tag_param_second: [
      [/\\\)/, 'bold-keyword'],
      [/\)/, 'fuzz.tag.second', '@pop'],
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/./, 'bold-keyword'],
    ],
    http_path: [
      [/\s/, 'delimiter', '@http_protocol'],
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      ['/(((http)|(https):)?//[^s]+?)/', 'http.url'],
      [/#/, 'http.anchor', '@http_anchor'],
      // [/\/[^\s^?^\/]+/, "http.path"],
      [/\?/, 'http.query', '@query'],
    ],
    http_anchor: [
      [/\s/, 'delimiter', '@http_protocol'],
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/./, 'http.anchor'],
    ],
    http_protocol: [
      [/\n/, 'delimiter', '@http_header'],
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/HTTP\/[0-9.]+/, 'http.protocol'],
    ],
    http_header: [
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/^\n$/, 'body.delimiter', '@body'],
      [/(Cookie)(:)/g, ['http.header.danger', { token: 'delimiter', next: '@http_cookie' }]],
      [/(Content-Type)(:)/g, ['http.header.danger', { token: 'delimiter', next: '@content_type' }]],
      [
        /(Content-Length|Host|Origin|Referer)(:)/g,
        ['http.header.danger', { token: 'delimiter', next: '@http_header_value' }],
      ],
      [
        /(Authorization|X-Forward|Real|User-Agent|Protection|CSP|X-Requested-With)(:)/g,
        ['http.header.danger', { token: 'delimiter', next: '@http_header_value' }],
      ],
      [/Sec/, 'http.header.warning', '@sec_http_header'],
      [/:/, 'delimiter', '@http_header_value'],
      [/\S/, 'http.header.info'],
    ],
    sec_http_header: [
      [/\n/, 'body.delimiter', '@pop'],
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/:/, 'delimiter', '@http_header_value'],
      [/\S/, 'http.header.warning'],
    ],
    content_type: [
      [/\s+$/, 'delimiter', '@pop'],
      [/\s+/, 'delimiter'],
      [/^\n$/, 'body.delimiter', '@pop'],
      [/multipart\/form-data[^\n]*/, 'http.header.mime.form'],
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/application\/xml/, 'http.header.mime.xml'],
      [/application\/json/, 'http.header.mime.json'],
      [/application\/x-www-form-urlencoded/, 'http.header.mime.urlencoded'],
      [/\S/, 'http.header.mime.default'],
    ],
    query: [
      [/\s/, 'delimiter', '@http_protocol'],
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/#/, 'http.anchor', '@http_anchor'],
      [/[^=&?\[\]\s]/, 'http.query.params', '@http_query_params'],
      [/%[0-9ABCDEFabcdef]{2}/, 'http.urlencoded'],
    ],
    http_query_params: [
      [/\s/, { token: 'delimiter', next: '@pop', goBack: 1 }],
      [/#/, 'http.anchor', '@http_anchor'],
      [/&/, 'delimiter', '@pop'],
      [/(\[)(\w+)(\])/, ['http.query.index', 'http.query.index.values', 'http.query.index']],
      [/\=/, 'http.query.equal', 'http_query_params_values'],
      [/./, 'http.query.params'],
    ],
    http_query_params_values: [
      [/\s/, { token: 'delimiter', next: '@pop', goBack: 1 }],
      [/#/, 'http.anchor', '@http_anchor'],
      [/&/, { token: 'delimiter', next: '@pop', goBack: 1 }],
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/[^=&?\s]/, 'http.query.values'],
      [/%[0-9ABCDEFabcdef]{2}/, 'http.urlencoded'],
    ],
    http_cookie: [
      [/\n/, 'delimiter', '@pop'],
      [/\s/, 'delimiter'],
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/[^=;\s]+/, 'http.query.params', '@http_cookie_params'],
      [/%[0-9ABCDEFabcdef]{2}/, 'http.urlencoded'],
    ],
    http_cookie_params: [
      [/\n/, { token: 'delimiter', next: '@pop', goBack: 1 }],
      [/[\s|;]/, 'delimiter', '@pop'],
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/\=/, 'http.query.equal'],
      [/[^=;?\s]/, 'http.query.values'],
      [/%[0-9ABCDEFabcdef]{2}/, 'http.urlencoded'],
    ],
    http_header_value: [
      [/\n/, { token: 'delimiter', next: '@pop', goBack: 1 }],
      [/\s/, 'delimiter'],
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
    ],
    string_double: [
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/[^\\"]/, 'json.key'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'json.key', '@pop'],
    ],
    string_double_value: [
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/[^\\"]/, 'json.value'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'json.value', '@pop'],
    ],
    body: [
      // fuzztag 优先级必须高于 JSON 根节点，否则 {{ 的首个 { 会被 JSON 规则吞掉导致渲染失败
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/(\{)/, { token: 'json.start', next: '@body_json_object' }], // JSON 对象根节点
      [/(\[)/, { token: 'json.array.start', next: '@body_json_array' }], // JSON 数组根节点
      [/-{2,}.*/, 'body.boundary', '@body_form'],
      [/%[0-9ABCDEFabcdef]{2}/, 'http.urlencoded'],
      [/./, 'http.query.params', '@http_query_params'],
    ],
    // 通用 JSON 对象内部（用于根对象和嵌套对象）
    body_json_object: [
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'], // 优先解析 fuzztag，避免被 { 规则吞掉
      [/\s+/, 'whitespace'], // 跳过空白/缩进/换行
      [/}/, { token: 'json.end', next: '@pop' }], // 对象结束
      [/"/, 'json.key', '@string_double'], // 字符串键
      [/(\d+\.?\d*)/, 'json.key'], // 数字键
      [/true|false|null/, 'json.key'], // 字面量键（非标准但容错）
      [/{/, { token: 'json.start', next: '@body_json_object' }], // 嵌套对象
      [/\[/, { token: 'json.array.start', next: '@body_json_array' }], // 嵌套数组
      [/(:)/, { token: 'delimiter', next: '@body_json_value' }], // 键值分隔符
    ],
    // JSON 值部分（对象内部）
    body_json_value: [
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'], // 优先解析 fuzztag，避免被 {/数字 规则吞掉
      [/\s+/, 'whitespace'], // 跳过空白
      [/,/, { token: 'delimiter', next: '@pop' }], // 值结束，返回对象状态处理下一个键
      [/}/, { token: 'json.end', next: '@pop', goBack: 1 }], // 对象直接结束（兼容无逗号）
      [/"/, 'json.value', '@string_double_value'], // 字符串值
      [/(\d+\.?\d*)/, 'json.value'], // 数值
      [/true|false|null/, 'json.value'], // 布尔/null
      [/{/, { token: 'json.start', next: '@body_json_object' }], // 对象值
      [/\[/, { token: 'json.array.start', next: '@body_json_array' }], // 数组值
    ],
    // JSON 数组（支持顶层数组及嵌套数组）
    body_json_array: [
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'], // 优先解析 fuzztag，避免被 {/数字 规则吞掉
      [/\s+/, 'whitespace'], // 跳过空白
      [/\]/, { token: 'json.array.end', next: '@pop' }], // 数组结束
      [/,/, 'delimiter'], // 元素分隔符
      [/"/, 'json.value', '@string_double_value'], // 字符串元素
      [/(\d+\.?\d*)/, 'json.value'], // 数值元素
      [/true|false|null/, 'json.value'], // 布尔/null元素
      [/{/, { token: 'json.start', next: '@body_json_object' }], // 对象元素
      [/\[/, { token: 'json.array.start', next: '@body_json_array' }], // 嵌套数组
    ],
    body_form: [
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/^\n$/, 'body.delimiter', '@body_data'],
      [/([^:]*?)(:)/g, ['http.header.info', { token: 'delimiter', next: '@http_header_value' }]],
    ],
    body_data: [
      [/{{/, 'fuzz.tag.inner', '@fuzz_tag'],
      [/(-{2,}[a-zA-z0-9]+--)/, [{ token: 'body.boundary.end', next: '@end' }]],
      [/(-{2,}[a-zA-z0-9]+)/, [{ token: 'body.boundary', next: '@pop' }]],
    ],
    end: [],
  },
})

