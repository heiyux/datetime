/* ============================================
   时间间隔计算器 — 主逻辑
   多事件支持 / 标记点 / 全部+单日视图 / 时间状态着色
   ============================================ */

// ========== localStorage 存储键名 ==========
const EVENTS_KEY = "tc_events";       // 事件列表 [{id, name}]
const EVENT_PREFIX = "tc_event_";     // 单事件数据前缀，完整键 = 前缀+id
const CURRENT_KEY = "tc_currentEvent"; // 当前选中的事件 ID
const SORT_KEY = "tc_sort";             // 下拉排序偏好
const APP_VERSION = "1.0.0";            // 应用版本号
const MAX_EVENTS = 20;                  // 最多事件数

// ========== 全局状态 ==========
let eventList = [];           // 所有事件 [{id, name}]
let currentEventId = null;     // 当前事件 ID
let currentEventData = null;   // 当前事件完整数据（配置+计算结果）
let currentDayDate = null;     // 单日视图当前选中的日期
let allResultsData = [];       // 所有计算结果（全部视图/单日视图共用）

// ========== 工具函数 ==========

/** 获取今天 0 点的 Date 对象 */
function getCurrentDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Date 对象 → "HH:MM:SS" 字符串 */
function formatTime(d) {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/** "HH:MM:SS" 字符串 → 毫秒数 */
function parseTimeToMs(str) {
  const parts = str.split(":");
  return (
    (parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])) * 1000
  );
}

/** 生成 [a, b] 的整数数组 */
function range(a, b) {
  const arr = [];
  for (let i = a; i <= b; i++) arr.push(i);
  return arr;
}
/** 数字补零 */
function pad(n) { return String(n).padStart(2, "0"); }
/** 某年某月的天数 */
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
/** 防抖 */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/**
 * 获取当前事件的有效时差（带符号）毫秒
 * 时差 = 设备时间 - 系统时间
 */
function getEffectiveOffsetMs() {
  if (!currentEventData) return 0;
  const mode = currentEventData.timeOffsetMode || "off";
  if (mode === "off") return 0;
  const val = currentEventData.timeOffset || "00:00:00";
  const ms = parseTimeToMs(val);
  return currentEventData.timeOffsetNeg ? -ms : ms;
}

/**
 * 获取着色/比较用的"当前时间"（毫秒时间戳）
 * - off: 用系统时间
 * - countdown: 用系统时间（列表着色不变）
 * - both: 用 系统时间 - 时差（与列表显示 +时差 一致）
 */
function getCompareNow() {
  const mode = currentEventData?.timeOffsetMode || "off";
  if (mode === "both") {
    return Date.now() - getEffectiveOffsetMs();
  }
  return Date.now();
}

/**
 * 获取倒计时用的"当前时间"（毫秒时间戳）
 * - off: 系统时间
 * - countdown / both: 系统时间 - 时差
 */
function getCountdownNow() {
  const mode = currentEventData?.timeOffsetMode || "off";
  if (mode === "off") return Date.now();
  return Date.now() - getEffectiveOffsetMs();
}

/**
 * 是否在列表显示时需要偏移时间
 * 仅 mode === "both" 时，显示时间 = 原始时间 + 时差
 */
function isDisplayOffset() {
  return (currentEventData?.timeOffsetMode || "off") === "both";
}

// ========== 事件数据存取（localStorage） ==========

/** 从 localStorage 加载事件列表 */
function loadEventList() {
  try {
    const raw = localStorage.getItem(EVENTS_KEY);
    eventList = raw ? JSON.parse(raw) : [];
  } catch {
    eventList = [];
  }
}

/** 保存事件列表到 localStorage */
function saveEventList() {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(eventList));
}

/** 加载指定事件的完整数据 */
function loadEventData(id) {
  try {
    const raw = localStorage.getItem(EVENT_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 保存指定事件的完整数据 */
function saveEventData(id, data) {
  localStorage.setItem(EVENT_PREFIX + id, JSON.stringify(data));
}

/** 删除指定事件的数据 */
function deleteEventData(id) {
  localStorage.removeItem(EVENT_PREFIX + id);
}

/** 创建默认事件数据（当前时间为开始时间） */
function createDefaultEventData() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return {
    interval: "04:00:00",
    startDate: `${year}-${month}-${day}`,
    startTime: `${hours}:${minutes}:${seconds}`,
    duration: "00:30:00",
    anchorCount: "1",
    calcMode: "count",
    calcCount: "100",
    rangeStart: "1",
    rangeEnd: "100",
    markers: [
      { name: "", offset: "00:00:00" },
      { name: "", offset: "00:00:00" },
      { name: "", offset: "00:00:00" },
    ],
    timeOffset: "00:00:00",      // 时差（设备时间 - 系统时间），正值
    timeOffsetNeg: false,          // 是否为负
    timeOffsetMode: "off",         // off / countdown / both
    stopped: false,                // 是否已停用（清空缓存但保留配置）
    updatedAt: Date.now(),         // 最后修改时间（开始/间隔/标记点/时差变更时更新）
    filter: {                     // 筛选条件
      timeStart: "00:00:00",
      timeEnd: "23:59:59",
      oddEven: "",
      weekdays: [],
      seqStart: "",
      seqEnd: "",
    },
    timestamps: [],
    actualStart: 1,
    durationMs: 0,
  };
}

/** 创建新事件（含默认数据），返回事件 ID */
function createEvent(name) {
  if (eventList.length >= MAX_EVENTS) {
    alert(`最多只能创建 ${MAX_EVENTS} 个事件`);
    return null;
  }
  const id = "evt_" + Date.now();
  const data = createDefaultEventData();
  data.name = name;
  eventList.push({ id, name });
  saveEventList();
  saveEventData(id, data);
  return id;
}

/** 删除事件（允许删空），如果删的是当前事件则清空状态 */
function deleteEvent(id) {
  const idx = eventList.findIndex((e) => e.id === id);
  if (idx === -1) return;
  const name = eventList[idx].name;
  if (!confirm(`确定删除事件"${name}"？`)) return;
  eventList.splice(idx, 1);
  deleteEventData(id);
  saveEventList();
  if (currentEventId === id) {
    currentEventId = null;
    localStorage.removeItem(CURRENT_KEY);
    currentEventData = null;
    allResultsData = [];
    // 清空结果区
    document.getElementById("resultBody").innerHTML = "";
    document.getElementById("resultHead").innerHTML = "";
    document.getElementById("result").style.display = "none";
    document.getElementById("resultEmpty").style.display = "block";
    document.getElementById("resultHeaderControls").style.display = "none";
    document.getElementById("countdownCard").style.display = "none";
    // 配置页表单填入默认值
    const def = createDefaultEventData();
    document.getElementById("eventName").value = def.name || "";
    document.getElementById("interval").value = def.interval;
    document.getElementById("startDate").value = def.startDate;
    document.getElementById("startTime").value = def.startTime;
    document.getElementById("duration").value = def.duration;
    document.getElementById("anchorCount").value = def.anchorCount;
    document.getElementById("calcCount").value = def.calcCount;
    document.getElementById("rangeStart").value = def.rangeStart;
    document.getElementById("rangeEnd").value = def.rangeEnd;
    const radio = document.querySelector(`input[name="calcMode"][value="${def.calcMode}"]`);
    if (radio) radio.checked = true;
    switchMode();
    for (let i = 0; i < 3; i++) {
      document.getElementById(`markerName${i + 1}`).value = "";
      document.getElementById(`markerOffset${i + 1}`).value = "00:00:00";
    }
    document.getElementById("timeOffsetVal").value = "00:00:00";
    document.getElementById("timeOffsetNeg").checked = false;
    const offRadio = document.querySelector('input[name="timeOffsetMode"][value="off"]');
    if (offRadio) offRadio.checked = true;
    document.getElementById("markerBody").style.display = "none";
    document.getElementById("markerToggleIcon").textContent = "▸";
  }
  renderEventDropdown("config");
  renderEventDropdown("result");
  updateEventSelectorLabels();
}

// ========== 当前事件加载 ==========

/** 加载当前事件：填充表单 + 重建结果 + 更新标签 */
function loadCurrentEvent() {
  currentEventData = loadEventData(currentEventId);
  if (!currentEventData) {
    currentEventData = createDefaultEventData();
  }
  // 兼容旧数据：确保 filter 字段存在
  if (!currentEventData.filter) {
    currentEventData.filter = {
      timeStart: "00:00:00",
      timeEnd: "23:59:59",
      oddEven: "",
      weekdays: [],
      seqStart: "",
      seqEnd: "",
    };
  }
  fillFormFromEvent();
  rebuildResultsFromEvent();
  updateEventSelectorLabels();
  updateFilterBadge();
}

/** 将事件数据填入配置表单 */
function fillFormFromEvent() {
  const d = currentEventData;
  document.getElementById("eventName").value = d.name || "";
  document.getElementById("interval").value = d.interval || "04:00:00";
  document.getElementById("startDate").value = d.startDate || "";
  document.getElementById("startTime").value = d.startTime || "00:00:00";
  document.getElementById("duration").value = d.duration || "00:30:00";
  document.getElementById("anchorCount").value = d.anchorCount || "1";
  document.getElementById("calcCount").value = d.calcCount || "100";
  document.getElementById("rangeStart").value = d.rangeStart || "1";
  document.getElementById("rangeEnd").value = d.rangeEnd || "100";
  const mode = d.calcMode || "count";
  const radio = document.querySelector(`input[name="calcMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  switchMode();

  // 标记点
  const markers = d.markers || [{ name: "", offset: "00:00:00" }, { name: "", offset: "00:00:00" }, { name: "", offset: "00:00:00" }];
  for (let i = 0; i < 3; i++) {
    document.getElementById(`markerName${i + 1}`).value = markers[i]?.name || "";
    document.getElementById(`markerOffset${i + 1}`).value = markers[i]?.offset || "00:00:00";
  }
  // 时差修正
  document.getElementById("timeOffsetVal").value = d.timeOffset || "00:00:00";
  document.getElementById("timeOffsetNeg").checked = !!d.timeOffsetNeg;
  const offMode = d.timeOffsetMode || "off";
  const offRadio = document.querySelector(`input[name="timeOffsetMode"][value="${offMode}"]`);
  if (offRadio) offRadio.checked = true;
  // 有标记点或时差开启时自动展开折叠区
  const hasMarkers = markers.some((m) => m && m.name && m.name.trim());
  const hasOffset = offMode !== "off" && (d.timeOffset || "00:00:00") !== "00:00:00";
  const expand = hasMarkers || hasOffset;
  document.getElementById("markerBody").style.display = expand ? "block" : "none";
  document.getElementById("markerToggleIcon").textContent = expand ? "▾" : "▸";
}

/** 从表单收集数据到当前事件对象 */
function collectFormToEvent() {
  const d = currentEventData;
  d.name = document.getElementById("eventName").value.trim() || "未命名";
  d.interval = document.getElementById("interval").value;
  d.startDate = document.getElementById("startDate").value;
  d.startTime = document.getElementById("startTime").value;
  d.duration = document.getElementById("duration").value;
  d.anchorCount = document.getElementById("anchorCount").value;
  d.calcCount = document.getElementById("calcCount").value;
  d.rangeStart = document.getElementById("rangeStart").value;
  d.rangeEnd = document.getElementById("rangeEnd").value;
  d.calcMode = document.querySelector('input[name="calcMode"]:checked').value;
  d.markers = [
    { name: document.getElementById("markerName1").value.trim(), offset: document.getElementById("markerOffset1").value },
    { name: document.getElementById("markerName2").value.trim(), offset: document.getElementById("markerOffset2").value },
    { name: document.getElementById("markerName3").value.trim(), offset: document.getElementById("markerOffset3").value },
  ];
  // 时差修正
  d.timeOffset = document.getElementById("timeOffsetVal").value;
  d.timeOffsetNeg = document.getElementById("timeOffsetNeg").checked;
  d.timeOffsetMode = document.querySelector('input[name="timeOffsetMode"]:checked').value;
}

/** 更新两处事件选择器的显示名称 */
function updateEventSelectorLabels() {
  const evt = eventList.find((e) => e.id === currentEventId);
  const name = evt ? evt.name : (eventList.length === 0 ? "暂无事件" : "");
  document.getElementById("currentEventNameConfig").textContent = name;
  document.getElementById("currentEventNameResult").textContent = name;
}

/** 同步事件列表中的名称（用户改了事件名时） */
function updateEventListName() {
  const evt = eventList.find((e) => e.id === currentEventId);
  if (evt) {
    evt.name = currentEventData.name;
    saveEventList();
  }
}

// ========== 事件下拉选择器 ==========

let dropdownManageMode = { config: false, result: false }; // 管理模式（显示删除按钮）

/** 切换下拉面板开合 */
function toggleEventDropdown(page) {
  const dd = document.getElementById("eventDropdown" + cap(page));
  const isOpen = dd.classList.contains("open");
  closeAllDropdowns();
  if (!isOpen) {
    renderEventDropdown(page);
    dd.classList.add("open");
  }
}

/** 关闭所有下拉 */
function closeAllDropdowns() {
  document.querySelectorAll(".event-dropdown").forEach((d) => d.classList.remove("open"));
  dropdownManageMode = { config: false, result: false };
}

/** 首字母大写：'config' → 'Config' */
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 渲染下拉选项列表 */
/**
 * 计算事件状态、次序和倒计时
 * @returns {{label, cls, seqText, cdText, cdColor}}
 *   running: 进行中(红) / pending: 待开始(蓝) / stopped: 已停用(灰) / unconfigured: 未配置(橙)
 */
function getEventStatus(id) {
  const data = loadEventData(id);
  if (!data) return { label: "未配置", cls: "st-unconfigured", seqText: "", cdText: "", cdColor: "" };
  if (data.stopped) return { label: "已停用", cls: "st-stopped", seqText: "", cdText: "", cdColor: "" };
  if (!data.timestamps || data.timestamps.length === 0) {
    return { label: "未配置", cls: "st-unconfigured", seqText: "", cdText: "", cdColor: "" };
  }
  // 用该事件自己的时差计算"当前时间"
  const offMode = data.timeOffsetMode || "off";
  let now = Date.now();
  if (offMode !== "off") {
    const offMs = (data.timeOffsetNeg ? -1 : 1) * parseTimeToMs(data.timeOffset || "00:00:00");
    now = Date.now() - offMs;
  }
  const dur = data.durationMs || 0;
  const actualStart = data.actualStart || 1;

  // 找进行中
  for (let i = 0; i < data.timestamps.length; i++) {
    const ts = data.timestamps[i];
    if (ts <= now && now <= ts + dur) {
      const endTs = ts + dur;
      return {
        label: "进行中", cls: "st-running",
        seqText: `第${actualStart + i}次`,
        cdText: formatCountdown(endTs - now),
        cdColor: "#dc3545",
      };
    }
  }
  // 找下一次未发生
  for (let i = 0; i < data.timestamps.length; i++) {
    const ts = data.timestamps[i];
    if (ts > now) {
      return {
        label: "待开始", cls: "st-pending",
        seqText: `第${actualStart + i}次`,
        cdText: formatCountdown(ts - now),
        cdColor: "#007bff",
      };
    }
  }
  // 所有都结束了，显示最后一条
  const lastIdx = data.timestamps.length - 1;
  return {
    label: "待开始", cls: "st-pending",
    seqText: `第${actualStart + lastIdx}次`,
    cdText: "已结束",
    cdColor: "#999",
  };
}

// 排序状态：{ by: 'status'|'name'|'order', asc: true }
let sortPref = loadSortPref();
function loadSortPref() {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { by: "status", asc: true };
}
function saveSortPref() {
  localStorage.setItem(SORT_KEY, JSON.stringify(sortPref));
}

/** 状态排序权重：进行中=0, 待开始=1, 已停用=2, 未配置=3 */
function statusWeight(cls) {
  if (cls === "st-running") return 0;
  if (cls === "st-pending") return 1;
  if (cls === "st-stopped") return 2;
  return 3; // st-unconfigured
}

function getSortedEventList() {
  const arr = eventList.slice();
  arr.sort((a, b) => {
    let cmp = 0;
    if (sortPref.by === "status") {
      cmp = statusWeight(getEventStatus(a.id).cls) - statusWeight(getEventStatus(b.id).cls);
    } else if (sortPref.by === "name") {
      cmp = (a.name || "").localeCompare(b.name || "", "zh");
    } else {
      cmp = 0; // 建立顺序保持原数组顺序
    }
    return sortPref.asc ? cmp : -cmp;
  });
  return arr;
}

function renderEventDropdown(page) {
  const dd = document.getElementById("eventDropdown" + cap(page));
  const manage = dropdownManageMode[page];
  let html = "";

  // 顶部操作按钮（新建事件 + 事件管理）
  html += `<div class="event-dropdown-footer" style="border-top:none;border-bottom:1px solid #f0f0f0;margin-bottom:4px">`;
  if (eventList.length < MAX_EVENTS) {
    html += `<button onclick="event.stopPropagation();newEvent()">➕ 新建事件</button>`;
  } else {
    html += `<button disabled style="opacity:0.4">已达上限(${MAX_EVENTS})</button>`;
  }
  html += `<button class="manage" onclick="event.stopPropagation();toggleManageMode('${page}')">${manage ? "✓ 完成" : "⚙ 事件管理"}</button>`;
  html += `</div>`;

  // 排序栏
  const sortLabels = { status: "状态", name: "名称", order: "顺序" };
  html += `<div class="sort-bar">`;
  html += `<span class="sort-label">排序</span>`;
  ["status", "name", "order"].forEach((k) => {
    const active = sortPref.by === k ? " active" : "";
    html += `<button class="sort-btn${active}" onclick="event.stopPropagation();setSortBy('${k}')">${sortLabels[k]}</button>`;
  });
  html += `<button class="sort-btn sort-dir" onclick="event.stopPropagation();toggleSortDir()">${sortPref.asc ? "↑" : "↓"}</button>`;
  html += `</div>`;

  // 列表区域（可滚动）
  html += `<div class="event-dropdown-list">`;
  if (eventList.length === 0) {
    html += `<div class="event-dropdown-item" style="justify-content:center;color:#999;cursor:default">暂无事件</div>`;
  }
  getSortedEventList().forEach((evt) => {
    const active = evt.id === currentEventId ? " active" : "";
    const st = getEventStatus(evt.id);
    html += `<div class="event-dropdown-item${active}" onclick="selectEvent('${evt.id}')">
      <span class="evt-name">${escapeHtml(evt.name)}</span>`;
    if (st.seqText) {
      html += `<span class="evt-seq">${st.seqText}</span>`;
      html += `<span class="evt-cd" style="color:${st.cdColor}">${st.cdText}</span>`;
    }
    html += `<span class="event-status-tag ${st.cls}">${st.label}</span>`;
    if (manage) {
      const data = loadEventData(evt.id);
      const isStopped = data && data.stopped;
      html += `<button class="del-btn" style="color:${isStopped ? '#28a745' : '#ffc107'}" onclick="event.stopPropagation();toggleStop('${evt.id}')">${isStopped ? "启" : "停"}</button>`;
      html += `<button class="del-btn" onclick="event.stopPropagation();deleteEvent('${evt.id}')">✕</button>`;
    }
    html += `</div>`;
  });
  html += `</div>`; // /event-dropdown-list

  dd.innerHTML = html;
}

function setSortBy(k) {
  sortPref.by = k;
  saveSortPref();
  renderEventDropdown("config");
  renderEventDropdown("result");
}
function toggleSortDir() {
  sortPref.asc = !sortPref.asc;
  saveSortPref();
  renderEventDropdown("config");
  renderEventDropdown("result");
}

/** 切换事件停用/启用 */
function toggleStop(id) {
  const data = loadEventData(id);
  if (!data) return;
  if (data.stopped) {
    // 启用：仅标记，不清缓存（缓存应该在停用时已清）
    data.stopped = false;
    saveEventData(id, data);
  } else {
    // 停用：标记 + 清空计算缓存
    data.stopped = true;
    data.timestamps = [];
    saveEventData(id, data);
    // 如果停的是当前事件，刷新界面
    if (id === currentEventId) {
      loadCurrentEvent();
    }
  }
  renderEventDropdown("config");
  renderEventDropdown("result");
}

/** 切换管理模式（显示/隐藏删除按钮） */
function toggleManageMode(page) {
  dropdownManageMode[page] = !dropdownManageMode[page];
  renderEventDropdown(page);
}

/** 选择事件：切换当前事件并缓存 */
function selectEvent(id) {
  if (id === currentEventId) {
    closeAllDropdowns();
    return;
  }
  currentEventId = id;
  localStorage.setItem(CURRENT_KEY, id);
  loadCurrentEvent();
  renderEventDropdown("config");
  renderEventDropdown("result");
  closeAllDropdowns();
}

/** 新建事件并切换到它 */
function newEvent() {
  const id = createEvent(`事件${eventList.length + 1}`);
  if (!id) return;
  currentEventId = id;
  localStorage.setItem(CURRENT_KEY, id);
  loadCurrentEvent();
  renderEventDropdown("config");
  renderEventDropdown("result");
  closeAllDropdowns();
}

/** HTML 转义，防止 XSS */
function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ========== 页面切换 ==========

/** 切换三页：配置/结果/关于 */
function switchPage(pageId) {
  closeAllDropdowns();
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.getElementById(pageId).classList.add("active");
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === pageId);
  });
  if (pageId !== "page-result") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

// ========== 标记点折叠 ==========

function toggleMarkers() {
  const body = document.getElementById("markerBody");
  const icon = document.getElementById("markerToggleIcon");
  const open = body.style.display !== "none";
  body.style.display = open ? "none" : "block";
  icon.textContent = open ? "▸" : "▾";
}

// ========== 计算模式切换 ==========

/** 切换"按次数"/"按范围"，显示对应输入框 */
function switchMode() {
  const mode = document.querySelector('input[name="calcMode"]:checked').value;
  if (mode === "count") {
    document.getElementById("calcCountGroup").style.display = "block";
    document.getElementById("rangeStartGroup").style.display = "none";
    document.getElementById("rangeEndGroup").style.display = "none";
  } else {
    document.getElementById("calcCountGroup").style.display = "none";
    document.getElementById("rangeStartGroup").style.display = "block";
    document.getElementById("rangeEndGroup").style.display = "block";
  }
}

// ========== 结果数据构建 ==========

let activeMarkers = []; // 当前事件有名称的标记点 [{name, offsetMs}]

/** 根据当前事件数据重建全部结果 */
function rebuildResultsFromEvent() {
  const d = currentEventData;
  allResultsData = [];
  document.getElementById("resultBody").innerHTML = "";
  if (!d.timestamps || d.timestamps.length === 0) {
    document.getElementById("result").style.display = "none";
    document.getElementById("resultEmpty").style.display = "block";
    document.getElementById("resultHeaderControls").style.display = "none";
    document.getElementById("countdownCard").style.display = "none";
    return;
  }
  document.getElementById("resultEmpty").style.display = "none";
  document.getElementById("result").style.display = "block";
  document.getElementById("resultHeaderControls").style.display = "block";

  // 只保留有名称的标记点（无名的不显示列）
  activeMarkers = (d.markers || [])
    .filter((mk) => mk.name && mk.name.trim())
    .map((mk) => ({ name: mk.name.trim(), offsetMs: parseTimeToMs(mk.offset) }));

  // 动态构建表头：日期 | 次序 | 开始时间 | [标记点列...] | 结束时间
  let headHtml = "<tr><th>日期</th><th>次序</th><th>开始时间</th>";
  activeMarkers.forEach((mk) => {
    headHtml += `<th>${escapeHtml(mk.name)}</th>`;
  });
  headHtml += "<th>结束时间</th></tr>";
  document.getElementById("resultHead").innerHTML = headHtml;

  // 计算每条结果数据
  const offMs = getEffectiveOffsetMs();
  const dispShift = isDisplayOffset() ? +offMs : 0; // 显示偏移：both 模式下加时差
  for (let i = 0; i < d.timestamps.length; i++) {
    const ts = d.timestamps[i];
    const dispTs = ts + dispShift;              // 用于显示的开始时间戳
    const dispEndTs = dispTs + d.durationMs;
    const startDate = new Date(dispTs);
    const endDate = new Date(dispEndTs);
    const month = String(startDate.getMonth() + 1).padStart(2, "0");
    const day = String(startDate.getDate()).padStart(2, "0");
    const markerTimes = activeMarkers.map((mk) => formatTime(new Date(dispTs + mk.offsetMs)));

    allResultsData.push({
      timestamp: ts,                 // 原始时间戳（用于着色/倒计时/locateNearest）
      displayTimestamp: dispTs,       // 显示用时间戳（both 模式下偏移后）
      displayEndTimestamp: dispEndTs,
      durationMs: d.durationMs,
      dateStr: `${month}/${day}`,
      seq: d.actualStart + i,
      startTimeStr: formatTime(startDate),
      endTimeStr: formatTime(endDate),
      markers: markerTimes,
    });
  }

  // 重置为全部视图
  document.getElementById("btnViewAll").classList.add("active");
  document.getElementById("btnViewDay").classList.remove("active");
  document.getElementById("dayNavigator").classList.remove("visible");
  currentDayDate = null;
  displayAllResults();
  updateCountdownCard();
}

/** 构建单行 HTML */
function buildRowHtml(item) {
  let html = `<td>${item.dateStr}</td><td>${item.seq}</td><td>${item.startTimeStr}</td>`;
  item.markers.forEach((t) => {
    html += `<td>${t}</td>`;
  });
  html += `<td>${item.endTimeStr}</td>`;
  return html;
}

/** 测量第一列宽度，动态设置第二列 sticky left 值 */
function fixStickyColumns() {
  const table = document.querySelector("#resultContent table");
  if (!table) return;
  const firstCell = table.querySelector("th:nth-child(1)");
  if (!firstCell) return;
  const w = firstCell.offsetWidth;
  table.querySelectorAll("th:nth-child(2), td:nth-child(2)").forEach((el) => {
    el.style.left = w + "px";
  });
}

// ========== 视图切换（全部/单日） ==========

/** @param {'all'|'day'} view */
function switchView(view) {
  const btnAll = document.getElementById("btnViewAll");
  const btnDay = document.getElementById("btnViewDay");
  const dayNav = document.getElementById("dayNavigator");

  if (view === "all") {
    btnAll.classList.add("active");
    btnDay.classList.remove("active");
    dayNav.classList.remove("visible");
    displayAllResults();
  } else {
    btnAll.classList.remove("active");
    btnDay.classList.add("active");
    dayNav.classList.add("visible");
    if (!currentDayDate) currentDayDate = getCurrentDate();
    updateDayDisplay();
    displayDayResults();
  }
}

/** 前后翻日 */
function changeDay(delta) {
  if (!currentDayDate) currentDayDate = getCurrentDate();
  currentDayDate.setDate(currentDayDate.getDate() + delta);
  updateDayDisplay();
  displayDayResults();
}

/** 更新日期按钮显示文字 */
function updateDayDisplay() {
  if (!currentDayDate) return;
  document.getElementById("btnDayDisplay").textContent =
    `${currentDayDate.getMonth() + 1}月${currentDayDate.getDate()}日`;
}

/** 弹出原生日期选择器 */
function showDatePicker() {
  let val = "2026-01-01";
  if (currentDayDate) {
    const y = currentDayDate.getFullYear();
    const m = String(currentDayDate.getMonth() + 1).padStart(2, "0");
    const d = String(currentDayDate.getDate()).padStart(2, "0");
    val = `${y}-${m}-${d}`;
  }
  openWheelPanel("date", val, (v) => {
    const parts = v.split("-");
    currentDayDate = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    updateDayDisplay();
    displayDayResults();
  });
}

/**
 * 判断事件是否在指定日期有进行
 * 跨日事件会在开始日和结束日都显示
 */
function isEventOnDay(startTimestamp, durationMs, targetDate) {
  const startDate = new Date(startTimestamp);
  const endDate = new Date(startTimestamp + durationMs);
  const ty = targetDate.getFullYear(), tm = targetDate.getMonth(), td = targetDate.getDate();
  const sy = startDate.getFullYear(), sm = startDate.getMonth(), sd = startDate.getDate();
  if (sy === ty && sm === tm && sd === td) return true;
  const ey = endDate.getFullYear(), em = endDate.getMonth(), ed = endDate.getDate();
  if (ey === ty && em === tm && ed === td) return true;
  const tMs = new Date(ty, tm, td).getTime();
  const sMs = new Date(sy, sm, sd).getTime();
  const eMs = new Date(ey, em, ed).getTime();
  return sMs <= tMs && eMs >= tMs;
}

// ========== 表格行渲染 ==========

/** 一次性构建所有行（全部视图和单日视图共用，不重建只显隐） */
function buildAllRows() {
  const resultBody = document.getElementById("resultBody");
  resultBody.innerHTML = "";
  allResultsData.forEach((item) => {
    const tr = document.createElement("tr");
    tr.dataset.timestamp = item.timestamp;
    tr.dataset.durationMs = item.durationMs;
    tr.innerHTML = buildRowHtml(item);
    resultBody.appendChild(tr);
  });
  colorRowsByTime();
}

/**
 * 根据当前时间给每行着色：
 * - row-past: 已过去（结束时间 < 当前时间）→ 浅灰
 * - row-current: 进行中（开始 < 当前 < 结束）→ 红色
 * - row-next: 无进行中时最近的未来事件 → 蓝色
 */
function colorRowsByTime() {
  const now = getCompareNow();
  const resultBody = document.getElementById("resultBody");
  const rows = resultBody.querySelectorAll("tr");
  if (rows.length === 0) return;

  let currentRow = null;
  let nextRow = null;
  let nextDiff = Infinity;

  rows.forEach((tr) => {
    const ts = +tr.dataset.timestamp;
    const dur = +tr.dataset.durationMs;
    const endTs = ts + dur;
    tr.classList.remove("row-past", "row-current", "row-next");
    if (now > endTs) {
      tr.classList.add("row-past");
    } else if (ts <= now && now <= endTs) {
      tr.classList.add("row-current");
      currentRow = tr;
    } else {
      const diff = ts - now;
      if (diff < nextDiff) {
        nextDiff = diff;
        nextRow = tr;
      }
    }
  });

  if (!currentRow && nextRow) {
    nextRow.classList.add("row-next");
  }
}

// ========== 倒计时卡片 ==========

/** 将毫秒差格式化为 HH:MM:SS */
function formatCountdown(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * 更新倒计时卡片
 * 优先级：进行中事件 > 下一次事件
 * - 进行中：显示距下一个未到达标记点的时间，无标记点则显示距结束
 * - 待开始：显示距下一次开始的时间
 * - 超过24小时：显示"24小时内无事发生"
 * - 无数据：隐藏卡片
 */
function updateCountdownCard() {
  const card = document.getElementById("countdownCard");
  if (!card) return;
  if (allResultsData.length === 0) {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";

  const now = getCountdownNow();
  const durMs = allResultsData[0].durationMs;
  const evtName = currentEventData.name || "";
  // 筛选后的数据
  const filteredItems = getFilteredIndices().map((i) => allResultsData[i]);
  if (filteredItems.length === 0) {
    card.style.display = "none";
    return;
  }

  // 找进行中的事件
  let ongoing = null;
  for (const item of filteredItems) {
    if (item.timestamp <= now && now <= item.timestamp + durMs) {
      ongoing = item;
      break;
    }
  }

  // 找下一次未来事件
  let next = null;
  for (const item of filteredItems) {
    if (item.timestamp > now) {
      next = item;
      break;
    }
  }

  const nameEl = document.getElementById("cdEventName");
  const offsetEl = document.getElementById("cdOffsetStatus");
  const seqEl = document.getElementById("cdSeq");
  const statusEl = document.getElementById("cdStatus");
  const labelEl = document.getElementById("cdLabel");
  const markerEl = document.getElementById("cdMarker");
  const timerEl = document.getElementById("cdTimer");

  // 设置时差状态标签
  const offMode = currentEventData?.timeOffsetMode || "off";
  if (offMode === "off") {
    offsetEl.textContent = "";
  } else if (offMode === "countdown") {
    offsetEl.textContent = "时差→倒计时";
  } else {
    offsetEl.textContent = "时差→倒计时+列表";
  }

  if (ongoing) {
    // ---- 进行中 ----
    nameEl.textContent = evtName;
    seqEl.textContent = `第${ongoing.seq}次`;
    statusEl.textContent = "进行中";
    statusEl.className = "cd-status active";
    timerEl.classList.remove("pending");
    timerEl.classList.add("active");

    // 找下一个未到达的标记点
    let nextMarker = null;
    let nextMarkerName = "";
    for (let i = 0; i < activeMarkers.length; i++) {
      const mk = activeMarkers[i];
      const markerTs = ongoing.timestamp + mk.offsetMs;
      if (markerTs > now) {
        nextMarker = markerTs;
        nextMarkerName = mk.name;
        break;
      }
    }

    if (nextMarker !== null) {
      labelEl.textContent = "距离";
      markerEl.textContent = nextMarkerName;
      timerEl.textContent = formatCountdown(nextMarker - now);
      timerEl.classList.remove("overflow");
    } else {
      labelEl.textContent = "距离结束";
      markerEl.textContent = "";
      const endTs = ongoing.timestamp + durMs;
      timerEl.textContent = formatCountdown(endTs - now);
      timerEl.classList.remove("overflow");
    }
  } else if (next) {
    const diff = next.timestamp - now;
    if (diff > 24 * 3600 * 1000) {
      nameEl.textContent = evtName;
      seqEl.textContent = "";
      statusEl.textContent = "待开始";
      statusEl.className = "cd-status pending";
      labelEl.textContent = "";
      markerEl.textContent = "";
      timerEl.textContent = "24小时内无事发生";
      timerEl.classList.remove("active", "pending");
      timerEl.classList.add("overflow");
    } else {
      nameEl.textContent = evtName;
      seqEl.textContent = `第${next.seq}次`;
      statusEl.textContent = "待开始";
      statusEl.className = "cd-status pending";
      labelEl.textContent = "距离开始";
      markerEl.textContent = "";
      timerEl.textContent = formatCountdown(diff);
      timerEl.classList.remove("active", "overflow");
      timerEl.classList.add("pending");
    }
  } else {
    card.style.display = "none";
  }
}

/** 显示全部结果 */
function displayAllResults() {
  document.getElementById("resultContent").style.display = "block";
  document.getElementById("noData").style.display = "none";
  const resultBody = document.getElementById("resultBody");
  if (resultBody.children.length === 0) buildAllRows();
  resultBody.querySelectorAll("tr").forEach((tr, i) => {
    const item = allResultsData[i];
    tr.style.display = (item && passFilter(item)) ? "" : "none";
  });
  fixStickyColumns();
  setTimeout(fixStickyColumns, 200);
}

/** 显示单日结果（只显隐行，不重建） */
function displayDayResults() {
  if (!currentDayDate || allResultsData.length === 0) {
    document.getElementById("resultContent").style.display = "none";
    document.getElementById("noData").style.display = "block";
    return;
  }
  const durationMs = allResultsData[0].durationMs;
  const resultBody = document.getElementById("resultBody");
  if (resultBody.children.length === 0) buildAllRows();
  let visibleCount = 0;
  resultBody.querySelectorAll("tr").forEach((tr, i) => {
    const item = allResultsData[i];
    const show = item && isEventOnDay(item.displayTimestamp, durationMs, currentDayDate) && passFilter(item);
    tr.style.display = show ? "" : "none";
    if (show) visibleCount++;
  });
  if (visibleCount === 0) {
    document.getElementById("resultContent").style.display = "none";
    document.getElementById("noData").style.display = "block";
  } else {
    document.getElementById("resultContent").style.display = "block";
    document.getElementById("noData").style.display = "none";
    fixStickyColumns();
    setTimeout(fixStickyColumns, 200);
  }
}

// ========== 找到最近一次 ==========

/**
 * 滚动到目标事件行
 * 优先级：正在进行中 > 下一个未发生（筛选后的数据）
 */
function locateNearest() {
  if (allResultsData.length === 0) return;
  const now = getCountdownNow();
  const durMs = allResultsData[0].durationMs;
  const filtered = getFilteredIndices();
  if (filtered.length === 0) return;

  // 1. 找正在进行中的
  let targetIdx = -1;
  for (const i of filtered) {
    const ts = allResultsData[i].timestamp;
    if (ts <= now && now <= ts + durMs) {
      targetIdx = i;
      break;
    }
  }
  // 2. 没进行中，找下一个未发生
  if (targetIdx === -1) {
    let minDiff = Infinity;
    for (const i of filtered) {
      const ts = allResultsData[i].timestamp;
      if (ts > now && (ts - now) < minDiff) {
        minDiff = ts - now;
        targetIdx = i;
      }
    }
  }
  // 3. 兜底：第一个筛选结果
  if (targetIdx === -1) targetIdx = filtered[0];

  const targetTs = allResultsData[targetIdx].timestamp;
  const resultBody = document.getElementById("resultBody");
  const targetRow = resultBody.children[targetIdx];

  // 单日视图：目标不在当前日期则自动切换
  const dayNav = document.getElementById("dayNavigator");
  const isDayView = dayNav.classList.contains("visible") && currentDayDate;
  let needSwitchDay = false;

  if (isDayView) {
    const d = new Date(targetTs);
    const targetDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (targetDay.getTime() !== currentDayDate.getTime()) {
      currentDayDate = targetDay;
      updateDayDisplay();
      displayDayResults();
      needSwitchDay = true;
    }
  }

  const doScroll = () => {
    if (!targetRow) return;
    const scroller = document.querySelector(".result-page-scroll");
    if (scroller) {
      const top = targetRow.offsetTop - scroller.clientHeight / 2;
      scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  };
  if (needSwitchDay) {
    setTimeout(doScroll, 100);
  } else {
    doScroll();
  }
}

// ========== 计算入口 ==========

/** 点击"确定"：校验 → 计算 → 保存 → 跳转结果页 */
function calculate() {
  if (!currentEventData) {
    alert("请先新建事件");
    return;
  }
  // 快照关键字段，用于判断是否需要更新 modified time
  const oldD = currentEventData;
  const oldSig = [
    oldD.startDate, oldD.startTime, oldD.interval,
    JSON.stringify(oldD.markers),
    oldD.timeOffset, oldD.timeOffsetNeg, oldD.timeOffsetMode,
  ].join("|");

  collectFormToEvent();
  const d = currentEventData;

  // 基本校验
  if (!d.interval || !d.startDate || !d.startTime || !d.duration) {
    alert("请填写完整且有效的信息");
    return;
  }
  const anchorCount = parseInt(d.anchorCount);
  if (isNaN(anchorCount) || anchorCount < 1) {
    alert("该次次数（锚点）必须大于等于1");
    return;
  }
  const intervalMs = parseTimeToMs(d.interval);
  if (intervalMs <= 0) {
    alert("间隔时长必须大于0");
    return;
  }
  d.durationMs = parseTimeToMs(d.duration);
  if (d.durationMs <= 0) {
    alert("持续时间必须大于0");
    return;
  }

  // 计算范围
  const anchorTimeMs = new Date(`${d.startDate}T${d.startTime}`).getTime();
  let actualStart, actualEnd;

  if (d.calcMode === "count") {
    const calcCount = parseInt(d.calcCount);
    if (isNaN(calcCount) || calcCount < 1) {
      alert("计算次数必须大于等于1");
      return;
    }
    actualStart = anchorCount;
    actualEnd = anchorCount + calcCount - 1;
  } else {
    let rs = parseInt(d.rangeStart);
    let re = parseInt(d.rangeEnd);
    if (isNaN(rs) || rs < 1) { alert("开始次数必须大于等于1"); return; }
    if (isNaN(re) || re < 1) { alert("结束次数必须大于等于1"); return; }
    if (rs > re) { [rs, re] = [re, rs]; }
    actualStart = rs;
    actualEnd = re;
  }

  // 生成时间戳数组
  const total = actualEnd - actualStart + 1;
  d.timestamps = [];
  for (let i = 0; i < total; i++) {
    const n = actualStart + i;
    d.timestamps.push(anchorTimeMs + (n - anchorCount) * intervalMs);
  }
  d.actualStart = actualStart;

  // 关键字段变更时更新最后修改时间
  const newSig = [
    d.startDate, d.startTime, d.interval,
    JSON.stringify(d.markers),
    d.timeOffset, d.timeOffsetNeg, d.timeOffsetMode,
  ].join("|");
  if (newSig !== oldSig) d.updatedAt = Date.now();
  // 重新计算后自动启用
  d.stopped = false;

  updateEventListName();
  saveEventData(currentEventId, d);
  rebuildResultsFromEvent();
  updateEventSelectorLabels();
  renderEventDropdown("config");
  renderEventDropdown("result");
  switchPage("page-result");
}

// ========== 回到顶部 ==========

/** 静默重算单个事件的 timestamps（不弹提示、不切页），用于恢复后批量计算 */
function silentRecalc(d) {
  try {
    if (!d.interval || !d.startDate || !d.startTime || !d.duration) return false;
    const anchorCount = parseInt(d.anchorCount);
    if (isNaN(anchorCount) || anchorCount < 1) return false;
    const intervalMs = parseTimeToMs(d.interval);
    if (intervalMs <= 0) return false;
    d.durationMs = parseTimeToMs(d.duration);
    if (d.durationMs <= 0) return false;
    const anchorTimeMs = new Date(`${d.startDate}T${d.startTime}`).getTime();
    let actualStart, actualEnd;
    if (d.calcMode === "count") {
      const calcCount = parseInt(d.calcCount);
      if (isNaN(calcCount) || calcCount < 1) return false;
      actualStart = anchorCount;
      actualEnd = anchorCount + calcCount - 1;
    } else {
      let rs = parseInt(d.rangeStart);
      let re = parseInt(d.rangeEnd);
      if (isNaN(rs) || rs < 1) return false;
      if (isNaN(re) || re < 1) return false;
      if (rs > re) [rs, re] = [re, rs];
      actualStart = rs;
      actualEnd = re;
    }
    const total = actualEnd - actualStart + 1;
    d.timestamps = [];
    for (let i = 0; i < total; i++) {
      const n = actualStart + i;
      d.timestamps.push(anchorTimeMs + (n - anchorCount) * intervalMs);
    }
    d.actualStart = actualStart;
    return true;
  } catch {
    return false;
  }
}

function scrollToTop() {
  const resultPage = document.getElementById("page-result");
  if (resultPage.classList.contains("active")) {
    const scroller = resultPage.querySelector(".result-page-scroll");
    if (scroller) scroller.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

// 监听结果页滚动，控制回到顶部按钮显示
document.addEventListener("DOMContentLoaded", function () {
  const scroller = document.querySelector(".result-page-scroll");
  if (scroller) {
    scroller.addEventListener("scroll", function () {
      const btn = document.getElementById("btnTop");
      if (scroller.scrollTop > window.innerHeight * 0.5) {
        btn.classList.add("visible");
      } else {
        btn.classList.remove("visible");
      }
    });
  }
});

// ========== 筛选功能 ==========

/** 判断筛选是否激活（有任意条件非默认值） */
function isFilterActive() {
  const f = currentEventData?.filter;
  if (!f) return false;
  if (f.oddEven) return true;
  if (f.weekdays && f.weekdays.length > 0) return true;
  if (f.seqStart) return true;
  if (f.seqEnd) return true;
  if (f.timeStart && f.timeStart !== "00:00:00") return true;
  if (f.timeEnd && f.timeEnd !== "23:59:59") return true;
  return false;
}

/** 判断单条数据是否通过筛选 */
function passFilter(item) {
  const f = currentEventData?.filter;
  if (!f) return true;

  // 开始/结束时间（显示时间戳）
  const startD = new Date(item.displayTimestamp);
  const endD = new Date(item.displayEndTimestamp);
  const startStr = item.startTimeStr;       // HH:MM:SS
  const endStr = item.endTimeStr;            // HH:MM:SS

  // --- 时间段：开始或结束任意一个在范围内即通过 ---
  if (f.timeStart && f.timeStart !== "00:00:00") {
    if (startStr < f.timeStart && endStr < f.timeStart) return false;
  }
  if (f.timeEnd && f.timeEnd !== "23:59:59") {
    if (startStr > f.timeEnd && endStr > f.timeEnd) return false;
  }

  // --- 单双日：开始日或结束日任意一个匹配即通过 ---
  if (f.oddEven === "odd") {
    const sOdd = startD.getDate() % 2 === 1;
    const eOdd = endD.getDate() % 2 === 1;
    if (!sOdd && !eOdd) return false;
  } else if (f.oddEven === "even") {
    const sEven = startD.getDate() % 2 === 0;
    const eEven = endD.getDate() % 2 === 0;
    if (!sEven && !eEven) return false;
  }

  // --- 星期：开始日或结束日任意一个匹配即通过 ---
  if (f.weekdays && f.weekdays.length > 0) {
    const sDow = startD.getDay();
    const eDow = endD.getDay();
    if (!f.weekdays.includes(sDow) && !f.weekdays.includes(eDow)) return false;
  }

  // --- 次序范围（只有一个值） ---
  if (f.seqStart && item.seq < parseInt(f.seqStart)) return false;
  if (f.seqEnd && item.seq > parseInt(f.seqEnd)) return false;

  return true;
}

/** 获取筛选后的数据索引列表 */
function getFilteredIndices() {
  const indices = [];
  allResultsData.forEach((item, i) => {
    if (passFilter(item)) indices.push(i);
  });
  return indices;
}

/** 打开/关闭筛选面板 */
function toggleFilterPanel() {
  const mask = document.getElementById("filterMask");
  const panel = document.getElementById("filterPanel");
  const open = panel.classList.contains("open");
  if (open) {
    mask.classList.remove("open");
    panel.classList.remove("open");
  } else {
    loadFilterToUI();
    mask.classList.add("open");
    panel.classList.add("open");
  }
}

/** 把当前事件的筛选条件填入 UI */
function loadFilterToUI() {
  const f = currentEventData.filter || {};
  document.getElementById("filterTimeStart").value = f.timeStart || "00:00:00";
  document.getElementById("filterTimeEnd").value = f.timeEnd || "23:59:59";
  const oe = f.oddEven || "";
  const oeRadio = document.querySelector(`input[name="filterOddEven"][value="${oe}"]`);
  if (oeRadio) oeRadio.checked = true;
  document.getElementById("filterSeqStart").value = f.seqStart || "";
  document.getElementById("filterSeqEnd").value = f.seqEnd || "";
  // 星期按钮
  document.querySelectorAll("#weekdayPicker button").forEach((btn) => {
    const d = parseInt(btn.dataset.d);
    btn.classList.toggle("active", (f.weekdays || []).includes(d));
  });
}

/** 星期按钮点击切换 */
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll("#weekdayPicker button").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
    });
  });
});

/** 应用筛选 */
function applyFilter() {
  const f = currentEventData.filter;
  f.timeStart = document.getElementById("filterTimeStart").value;
  f.timeEnd = document.getElementById("filterTimeEnd").value;
  f.oddEven = document.querySelector('input[name="filterOddEven"]:checked').value;
  f.seqStart = document.getElementById("filterSeqStart").value;
  f.seqEnd = document.getElementById("filterSeqEnd").value;
  f.weekdays = [];
  document.querySelectorAll("#weekdayPicker button.active").forEach((btn) => {
    f.weekdays.push(parseInt(btn.dataset.d));
  });
  saveEventData(currentEventId, currentEventData);
  updateFilterBadge();
  toggleFilterPanel();
  // 重新渲染当前视图
  if (document.getElementById("btnViewDay").classList.contains("active")) {
    displayDayResults();
  } else {
    displayAllResults();
  }
  colorRowsByTime();
  updateCountdownCard();
}

/** 清除筛选 */
function clearFilter() {
  const f = currentEventData.filter;
  f.timeStart = "00:00:00";
  f.timeEnd = "23:59:59";
  f.oddEven = "";
  f.weekdays = [];
  f.seqStart = "";
  f.seqEnd = "";
  saveEventData(currentEventId, currentEventData);
  updateFilterBadge();
  loadFilterToUI();
  if (document.getElementById("btnViewDay").classList.contains("active")) {
    displayDayResults();
  } else {
    displayAllResults();
  }
  colorRowsByTime();
  updateCountdownCard();
}

/** 更新筛选按钮上的角标 */
function updateFilterBadge() {
  const badge = document.getElementById("filterBadge");
  if (isFilterActive()) {
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }
}

// ========== 三列滚轮选择器 ==========

const WHEEL_ITEM_H = 36;
let wheelConfig = null; // { type, onConfirm }

/** 入口：给 input 元素绑定，自动判断 date/time 类型 */
function openWheelFor(inputEl) {
  const type = inputEl.type === "date" ? "date" : "time";
  const val = inputEl.value || (type === "time" ? "00:00:00" : "2026-01-01");
  openWheelPanel(type, val, (v) => {
    inputEl.value = v;
  });
}

/** 打开滚轮面板 */
function openWheelPanel(type, currentValue, onConfirm) {
  const panel = document.getElementById("wheelPanel");
  const mask = document.getElementById("wheelMask");
  const body = document.getElementById("wheelBody");
  const title = document.getElementById("wheelTitle");

  let columns = [];
  if (type === "time") {
    title.textContent = "选择时间";
    const [h, m, s] = currentValue.split(":").map(Number);
    columns = [
      { values: range(0, 23), selected: h, unit: "时" },
      { values: range(0, 59), selected: m, unit: "分" },
      { values: range(0, 59), selected: s, unit: "秒" },
    ];
  } else {
    title.textContent = "选择日期";
    const parts = currentValue.split("-").map(Number);
    const y = parts[0], mo = parts[1], d = parts[2];
    const thisYear = new Date().getFullYear();
    columns = [
      { values: range(thisYear - 5, thisYear + 5), selected: y, unit: "年" },
      { values: range(1, 12), selected: mo, unit: "月" },
      { values: range(1, daysInMonth(y, mo)), selected: Math.min(d, daysInMonth(y, mo)), unit: "日" },
    ];
  }

  wheelConfig = { type, columns, onConfirm };

  body.innerHTML = "";
  columns.forEach((col, ci) => {
    const colEl = document.createElement("div");
    colEl.className = "wheel-col";
    colEl.dataset.col = ci;
    col.values.forEach((v) => {
      const item = document.createElement("div");
      item.className = "wheel-item";
      item.textContent = pad(v) + col.unit;
      item.dataset.val = v;
      colEl.appendChild(item);
    });
    body.appendChild(colEl);
    requestAnimationFrame(() => {
      const idx = col.values.indexOf(col.selected);
      colEl.scrollTop = idx * WHEEL_ITEM_H;
      updateWheelSelected(colEl);
    });
    colEl.addEventListener("scroll", debounce(() => {
      updateWheelSelected(colEl);
      if (type === "date" && (ci === 0 || ci === 1)) {
        rebuildDayColumn();
      }
    }, 100));
  });

  mask.classList.add("open");
  panel.classList.add("open");
}

function updateWheelSelected(colEl) {
  const idx = Math.round(colEl.scrollTop / WHEEL_ITEM_H);
  const items = colEl.querySelectorAll(".wheel-item");
  items.forEach((it, i) => it.classList.toggle("selected", i === idx));
}

function rebuildDayColumn() {
  const cols = document.querySelectorAll(".wheel-col");
  const y = parseInt(cols[0].querySelectorAll(".wheel-item")[Math.round(cols[0].scrollTop / WHEEL_ITEM_H)].dataset.val);
  const m = parseInt(cols[1].querySelectorAll(".wheel-item")[Math.round(cols[1].scrollTop / WHEEL_ITEM_H)].dataset.val);
  const days = daysInMonth(y, m);
  const dayCol = cols[2];
  const oldIdx = Math.round(dayCol.scrollTop / WHEEL_ITEM_H);
  const oldVal = parseInt(dayCol.querySelectorAll(".wheel-item")[oldIdx].dataset.val);
  dayCol.innerHTML = "";
  for (let d = 1; d <= days; d++) {
    const it = document.createElement("div");
    it.className = "wheel-item";
    it.textContent = pad(d) + "日";
    it.dataset.val = d;
    dayCol.appendChild(it);
  }
  const newIdx = Math.min(oldVal, days) - 1;
  dayCol.scrollTop = newIdx * WHEEL_ITEM_H;
  updateWheelSelected(dayCol);
}

function closeWheel() {
  document.getElementById("wheelMask").classList.remove("open");
  document.getElementById("wheelPanel").classList.remove("open");
}

function confirmWheel() {
  const cols = document.querySelectorAll(".wheel-col");
  const vals = [];
  cols.forEach((col) => {
    const idx = Math.round(col.scrollTop / WHEEL_ITEM_H);
    vals.push(parseInt(col.querySelectorAll(".wheel-item")[idx].dataset.val));
  });
  if (wheelConfig.type === "time") {
    wheelConfig.onConfirm(vals.map(pad).join(":"));
  } else {
    wheelConfig.onConfirm(vals.map(pad).join("-"));
  }
  closeWheel();
}

// ========== 备份与恢复 ==========

function backupData() {
  // 导出所有事件配置（不含 timestamps 计算结果）
  const events = {};
  eventList.forEach((e) => {
    const data = loadEventData(e.id);
    if (!data) return;
    const copy = { ...data, timestamps: [] }; // 清空计算结果
    events[e.id] = copy;
  });
  const payload = {
    version: APP_VERSION,
    exportedAt: Date.now(),
    events: events,
    eventList: eventList,
    sort: sortPref,
  };
  // 概览文本
  const d = new Date(payload.exportedAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}_${String(d.getHours()).padStart(2,"0")}${String(d.getMinutes()).padStart(2,"0")}${String(d.getSeconds()).padStart(2,"0")}`;
  let overview = `时间间隔计算器备份\n`;
  overview += `版本: ${APP_VERSION}\n`;
  overview += `导出时间: ${d.toLocaleString()}\n`;
  overview += `事件数量: ${eventList.length}\n`;
  overview += `---- 事件列表 ----\n`;
  eventList.forEach((e, i) => {
    const data = events[e.id];
    const mt = data && data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "未知";
    overview += `${i+1}. ${e.name} (修改时间: ${mt})\n`;
  });
  overview += `---- 数据 ----\n`;
  const fullText = overview + JSON.stringify(payload);
  const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tc_backup_${stamp}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function restoreData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    // 找到 JSON 起始位置（跳过概览）
    const idx = text.indexOf("{");
    if (idx === -1) { alert("文件格式错误，未找到数据"); return; }
    let payload;
    try {
      payload = JSON.parse(text.slice(idx));
    } catch {
      alert("文件解析失败，可能已被修改或损坏");
      return;
    }
    if (!payload.version || !payload.events) {
      alert("备份数据不完整");
      return;
    }
    // 展示解析结果
    let summary = `检测到备份文件 v${payload.version}\n`;
    summary += `事件数量: ${payload.eventList ? payload.eventList.length : Object.keys(payload.events).length}\n`;
    summary += `事件列表:\n`;
    const list = payload.eventList || Object.keys(payload.events).map((id) => ({ id, name: payload.events[id].name || "未命名" }));
    list.forEach((e, i) => {
      summary += `  ${i+1}. ${e.name}\n`;
    });
    summary += `\n⚠️ 此操作将覆盖当前所有数据！\n请确保备份文件来源可信且未被修改。`;
    if (!confirm(summary)) return;
    // 执行恢复
    // 清除现有数据
    eventList.forEach((e) => deleteEventData(e.id));
    // 写入新数据
    let recalcCount = 0;
    list.forEach((e) => {
      const d = payload.events[e.id];
      if (!d) return;
      // 启用的事件：清掉旧 timestamps 并自动重算
      if (!d.stopped) {
        d.timestamps = [];
        if (silentRecalc(d)) recalcCount++;
      }
      saveEventData(e.id, d);
    });
    eventList = list;
    saveEventList();
    if (payload.sort) { sortPref = payload.sort; saveSortPref(); }
    // 选第一个事件
    currentEventId = list[0] ? list[0].id : null;
    if (currentEventId) localStorage.setItem(CURRENT_KEY, currentEventId);
    else localStorage.removeItem(CURRENT_KEY);
    alert(`恢复完成，已自动计算 ${recalcCount} 个启用事件`);
    location.reload();
  };
  reader.readAsText(file);
  event.target.value = "";
}

// ========== 初始化 ==========

// 加载事件列表（允许为空，不自动创建）
loadEventList();
if (eventList.length > 0) {
  const saved = localStorage.getItem(CURRENT_KEY);
  const exists = saved && eventList.find((e) => e.id === saved);
  currentEventId = exists ? saved : eventList[0].id;
  loadCurrentEvent();
} else {
  currentEventId = null;
  currentEventData = null;
  allResultsData = [];
  updateEventSelectorLabels();
}
renderEventDropdown("config");
renderEventDropdown("result");
updateFilterBadge();

// 绑定视图按钮
document.getElementById("btnViewAll").classList.add("active");

// 底部 Tab 按钮绑定
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchPage(btn.dataset.page));
});

// 点击页面其他区域关闭下拉
document.addEventListener("click", function (e) {
  if (!e.target.closest(".event-selector")) {
    closeAllDropdowns();
  }
});

// 有缓存数据时自动跳到结果页并切到单日视图
if (currentEventData && currentEventData.timestamps && currentEventData.timestamps.length > 0) {
  switchPage("page-result");
  switchView("day");
}

// 每秒刷新：倒计时 + 时间状态着色 + 展开的下拉
setInterval(() => {
  if (allResultsData.length > 0) {
    updateCountdownCard();
    colorRowsByTime();
  }
  // 下拉展开时轻量刷新事件倒计时（不重建 DOM，保留滚动位置）
  refreshDropdownLive("config");
  refreshDropdownLive("result");
}, 1000);

/** 只更新下拉中每个事件的倒计时文字和颜色，不重建 DOM */
function refreshDropdownLive(page) {
  const dd = document.getElementById("eventDropdown" + cap(page));
  if (!dd.classList.contains("open")) return;
  const items = dd.querySelectorAll(".event-dropdown-item");
  items.forEach((item) => {
    // 从 onclick 属性提取事件 id
    const onclickStr = item.getAttribute("onclick") || "";
    const m = onclickStr.match(/selectEvent\('([^']+)'\)/);
    if (!m) return;
    const st = getEventStatus(m[1]);
    const cdEl = item.querySelector(".evt-cd");
    if (cdEl) {
      cdEl.textContent = st.cdText;
      cdEl.style.color = st.cdColor;
    }
    const seqEl = item.querySelector(".evt-seq");
    if (seqEl) seqEl.textContent = st.seqText;
    const tagEl = item.querySelector(".event-status-tag");
    if (tagEl) {
      tagEl.textContent = st.label;
      tagEl.className = "event-status-tag " + st.cls;
    }
  });
}
