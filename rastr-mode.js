(function initializeRastrMode(global) {
  'use strict';

  const SETTINGS_KEY = 'smartEnergySettings';
  const NODE_TYPES = { slack: 'База', load: 'Нагрузка', generator: 'Генератор', intermediate: 'Промежуточный' };
  const BRANCH_TYPES = { line: 'ЛЭП', transformer: 'Трансформатор', tie: 'Перемычка' };
  const DEFAULT_THRESHOLDS = { criticalLow: 90, warningLow: 95, warningHigh: 105, criticalHigh: 110 };
  const DEFAULT_GRAPH_DISPLAY = {
    voltage: true, angle: true, flows: true, bothEnds: false, current: false,
    losses: false, loading: false, loads: true, generation: true, equipment: false
  };
  const RASTR_NAVIGATION = [
    { title: 'Основное', items: [
      { icon: '🔵', label: 'Узлы', tab: 'nodes' }, { icon: '🔗', label: 'Ветви', tab: 'branches' },
      { icon: '🗺', label: 'Районы', tab: 'regions' }, { icon: '📊', label: 'Графика', tab: 'graphics' }
    ] },
    { title: 'Расчёт', items: [
      { icon: '▶', label: 'Расчёт режима', command: 'calculate' }, { icon: '↔', label: 'Перетоки', tab: 'flows' },
      { icon: '📉', label: 'Потери', tab: 'losses' }, { icon: '⚖', label: 'Баланс', tab: 'balance' }, { icon: '📋', label: 'Результаты', tab: 'results' }
    ] },
    { title: 'Районы', items: [
      { label: 'Районы', tab: 'regions' }, { label: 'Районы + Ветви', tab: 'regions-branches' },
      { label: 'Районы + Потери', tab: 'regions-losses' }, { label: 'Районы + Потери Q', tab: 'regions-losses-q' }
    ] },
    { title: 'Анализ', items: [
      { icon: '🔍', label: 'Контроль данных', tab: 'data-control' }, { icon: '⚡', label: 'Контроль напряжения', tab: 'voltage-control' },
      { icon: '🌡', label: 'Контроль загрузки', tab: 'loading-control' }, { icon: '📈', label: 'Контролируемые величины', tab: 'monitored' },
      { icon: '🔬', label: 'Влияние', planned: true }
    ] },
    { title: 'Расширенный расчёт', items: [
      { icon: '🎯', label: 'Оптимизация', planned: true }, { icon: '📈', label: 'Утяжеление', planned: true },
      { icon: '⚠', label: 'Предельный режим', planned: true }, { icon: '🔌', label: 'Аварийные режимы', tab: 'contingency' },
      { label: 'N−1', tab: 'n-1' }, { icon: '⇄', label: 'Сравнение режимов', tab: 'comparison' }
    ] },
    { title: 'Сеть', items: [
      { icon: '🔄', label: 'Эквивалентирование', planned: true }, { label: 'Трансформаторы', command: 'focus-transformers' },
      { label: 'Шунты', planned: true }, { label: 'Генераторы', command: 'focus-generators' }, { label: 'Нагрузки', command: 'focus-loads' }
    ] },
    { title: 'Автоматизация', items: [
      { label: 'Макросы', planned: true }, { label: 'Импорт', command: 'import' },
      { label: 'Экспорт', command: 'export' }, { label: 'История сценариев', tab: 'scenario-history' }
    ] }
  ];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const optional = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ? null : Number(value);
  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.floor(performance.now()).toString(36)}`;
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
  const fmt = (value, digits = 2) => Number.isFinite(value) ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value) : '—';

  const state = {
    name: 'Новая сеть', nodes: [], branches: [], regions: [], results: null, normalResult: null, contingencyResult: null,
    tab: 'nodes', viewMode: 'input', selection: null, pendingDelete: null, modelInfoOpen: false, menuOpen: false,
    settings: { thresholds: { ...DEFAULT_THRESHOLDS }, voltageLimits: { uMinPU: 0.95, uMaxPU: 1.05 }, powerFlow: { tolerance: 1e-8, maxIterations: 30 } },
    activeOutageId: null, selectedN1Id: null, n1Scenarios: [], n1Running: false, n1CancelRequested: false,
    n1Progress: { completed: 0, total: 0 }, scenarioHistory: [],
    viewport: { zoom: 1, panX: 0, panY: 0 }, regionDisplay: { show: false, filterRegionId: null },
    graphDisplay: { ...DEFAULT_GRAPH_DISPLAY }, graphFullscreen: false,
    regionView: 'list', selectedRegionId: null, editingRegionId: null, dirty: false
  };
  let root = null;

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (error) { return {}; }
  }

  function saveProject(message = 'Схема сохранена.') {
    const settings = readSettings();
    settings.rastrMode = serializeProject();
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      state.dirty = false;
      showMessage(message, 'success');
    } catch (error) { showMessage('Браузер не разрешил сохранить схему.', 'error'); }
  }

  function persistProjectSilently() {
    try {
      const settings = readSettings();
      settings.rastrMode = serializeProject();
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      state.dirty = false;
    } catch (error) {
      // Редактор продолжает работать в памяти, если localStorage недоступен.
    }
  }

  function serializeProject() {
    return {
      schemaVersion: 3, name: state.name,
      nodes: state.nodes.map((node) => ({ ...node })),
      branches: state.branches.map((branch) => ({ ...branch })),
      regions: state.regions.map((region) => ({ ...region })),
      settings: JSON.parse(JSON.stringify(state.settings)),
      scenarioHistory: state.scenarioHistory.slice(-50).map((scenario) => ({ ...scenario })),
      viewport: { ...state.viewport }, regionDisplay: { ...state.regionDisplay }, graphDisplay: { ...state.graphDisplay }, updatedAt: new Date().toISOString()
    };
  }

  function sanitizeNumber(value, { min = -1e9, max = 1e9, nullable = false, defaultValue, field = 'Значение' } = {}) {
    const empty = value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
    if (empty) {
      if (nullable) return null;
      if (defaultValue !== undefined) return defaultValue;
      throw new Error(`${field}: обязательное числовое значение не задано.`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field}: ожидалось конечное число.`);
    if (value < min || value > max) throw new Error(`${field}: число ${value} вне диапазона ${min}…${max}.`);
    return value;
  }

  function sanitizeGenerationMode(value, fallback = 'manual', field = 'Режим генерации') {
    if (value === undefined || value === null || value === '') return fallback;
    if (value !== 'auto' && value !== 'manual') throw new Error(`${field}: допустимы только auto или manual.`);
    return value;
  }

  function sanitizeProject(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes) || !Array.isArray(raw.branches)) throw new Error('В файле нет массивов nodes и branches.');
    if (raw.schemaVersion != null && ![1, 2, 3].includes(raw.schemaVersion)) throw new Error(`Неподдерживаемая версия Rastr Mode: ${raw.schemaVersion}.`);
    if (raw.nodes.length > 300 || raw.branches.length > 600) throw new Error('Схема превышает лимит учебного редактора.');
    const legacySchema = raw.schemaVersion == null || raw.schemaVersion < 2;
    const regionIds = new Set(); const regionCodes = new Set();
    const regions = (Array.isArray(raw.regions) ? raw.regions : []).slice(0, 100).map((item, index) => {
      if (!item || typeof item !== 'object') throw new Error(`Район ${index + 1} имеет неверную структуру.`);
      let id = typeof item.id === 'string' && item.id.trim() && item.id.length <= 80 ? item.id.trim() : uid('region');
      if (regionIds.has(id)) throw new Error('ID районов должны быть уникальными.');
      const code = String(item.code || `R${index + 1}`).trim().slice(0, 30);
      const codeKey = code.toLowerCase();
      if (!code || regionCodes.has(codeKey)) throw new Error('Коды районов должны быть заполнены и уникальны.');
      regionIds.add(id); regionCodes.add(codeKey);
      return { id, number: index + 1, code, name: String(item.name || `Район ${index + 1}`).trim().slice(0, 100), parentRegionId: item.parentRegionId || null, description: String(item.description || '').trim().slice(0, 500) };
    });
    regions.forEach((region) => { if (!regionIds.has(region.parentRegionId) || region.parentRegionId === region.id) region.parentRegionId = null; });
    regions.forEach((region) => {
      const visited = new Set([region.id]); let parentId = region.parentRegionId;
      while (parentId) {
        if (visited.has(parentId)) { region.parentRegionId = null; break; }
        visited.add(parentId); parentId = regions.find((item) => item.id === parentId)?.parentRegionId || null;
      }
    });
    const ids = new Set();
    const numbers = new Set();
    const nodes = raw.nodes.map((item, index) => {
      if (!item || typeof item !== 'object') throw new Error(`Узел ${index + 1} имеет неверную структуру.`);
      const id = typeof item.id === 'string' && item.id.trim() && item.id.length <= 80 ? item.id.trim() : null;
      if (!id) throw new Error(`Узел ${index + 1}, поле id: требуется непустая строка до 80 символов.`);
      const number = Math.trunc(sanitizeNumber(item.number, { min: 1, max: 999999, field: `Узел ${index + 1}, number` }));
      if (ids.has(id) || numbers.has(number)) throw new Error('Номера и ID узлов должны быть уникальными.');
      ids.add(id); numbers.add(number);
      if (!NODE_TYPES[item.type]) throw new Error(`Узел ${index + 1}, type: неизвестный тип «${item.type}».`);
      const legacyPMode = item.type === 'slack' ? 'auto' : 'manual';
      const legacyQMode = item.type === 'slack' || item.type === 'generator' ? 'auto' : 'manual';
      const generationPSource = hasOwn(item, 'generationP_MW') ? item.generationP_MW : item.generationMW;
      const generationQSource = hasOwn(item, 'generationQ_Mvar') ? item.generationQ_Mvar : item.generationMvar;
      return {
        id, number, type: item.type,
        name: String(item.name || `Узел ${number}`).slice(0, 80),
        nominalKV: sanitizeNumber(item.nominalKV, { min: 0.001, max: 1500, field: `Узел ${number}, nominalKV` }),
        loadMW: sanitizeNumber(item.loadMW, { min: 0, nullable: true, field: `Узел ${number}, loadMW` }), loadMvar: sanitizeNumber(item.loadMvar, { min: 0, nullable: true, field: `Узел ${number}, loadMvar` }),
        generationPMode: sanitizeGenerationMode(item.generationPMode, legacyPMode, `Узел ${number}, generationPMode`),
        generationQMode: sanitizeGenerationMode(item.generationQMode, legacyQMode, `Узел ${number}, generationQMode`),
        generationP_MW: sanitizeNumber(generationPSource, { min: 0, nullable: true, field: `Узел ${number}, generationP_MW` }),
        generationQ_Mvar: sanitizeNumber(generationQSource, { nullable: true, field: `Узел ${number}, generationQ_Mvar` }),
        calculatedGenerationP_MW: sanitizeNumber(item.calculatedGenerationP_MW, { nullable: true, field: `Узел ${number}, calculatedGenerationP_MW` }),
        calculatedGenerationQ_Mvar: sanitizeNumber(item.calculatedGenerationQ_Mvar, { nullable: true, field: `Узел ${number}, calculatedGenerationQ_Mvar` }),
        regionId: regionIds.has(item.regionId) ? item.regionId : null,
        setVoltageKV: sanitizeNumber(item.setVoltageKV, { min: 0.001, max: 1500, nullable: true, field: `Узел ${number}, setVoltageKV` }),
        setAngleDeg: sanitizeNumber(item.setAngleDeg, { min: -360, max: 360, defaultValue: 0, field: `Узел ${number}, setAngleDeg` }),
        qMinMvar: sanitizeNumber(item.qMinMvar, { nullable: true, field: `Узел ${number}, qMinMvar` }), qMaxMvar: sanitizeNumber(item.qMaxMvar, { nullable: true, field: `Узел ${number}, qMaxMvar` }),
        x: sanitizeNumber(item.x, { min: 45, max: 1155, nullable: true, field: `Узел ${number}, x` }), y: sanitizeNumber(item.y, { min: 45, max: 505, nullable: true, field: `Узел ${number}, y` }), manualPosition: Boolean(item.manualPosition)
      };
    });
    const branchIds = new Set(); const branchNumbers = new Set();
    nodes.forEach((node) => {
      if (node.qMinMvar !== null && node.qMaxMvar !== null && node.qMinMvar > node.qMaxMvar) {
        throw new Error(`Узел ${node.number}: Qmin не может быть больше Qmax.`);
      }
    });
    const branches = raw.branches.map((item, index) => {
      if (!item || typeof item !== 'object' || !ids.has(item.from) || !ids.has(item.to) || item.from === item.to) throw new Error(`Ветвь ${index + 1} ссылается на несуществующий узел.`);
      const id = typeof item.id === 'string' && item.id.trim() && item.id.length <= 80 ? item.id.trim() : null;
      if (!id) throw new Error(`Ветвь ${index + 1}, поле id: требуется непустая строка до 80 символов.`);
      const number = Math.trunc(sanitizeNumber(item.number, { min: 1, max: 999999, field: `Ветвь ${index + 1}, number` }));
      if (branchIds.has(id) || branchNumbers.has(number)) throw new Error('ID и номера ветвей должны быть уникальными.');
      if (!BRANCH_TYPES[item.type]) throw new Error(`Ветвь ${number}, type: неизвестный тип «${item.type}».`);
      branchIds.add(id); branchNumbers.add(number);
      const legacyCurrent = sanitizeNumber(item.iMaxA, { min: 0.000001, max: 1e9, nullable: true, field: `Ветвь ${number}, iMaxA` });
      const iMaxFromA = hasOwn(item, 'iMaxFromA')
        ? sanitizeNumber(item.iMaxFromA, { min: 0.000001, max: 1e9, nullable: true, field: `Ветвь ${number}, iMaxFromA` })
        : legacyCurrent;
      const iMaxToA = hasOwn(item, 'iMaxToA')
        ? sanitizeNumber(item.iMaxToA, { min: 0.000001, max: 1e9, nullable: true, field: `Ветвь ${number}, iMaxToA` })
        : item.type === 'line' ? legacyCurrent : null;
      return {
        id, number, from: item.from, to: item.to,
        type: item.type, name: String(item.name || `Ветвь ${index + 1}`).slice(0, 80),
        rOhm: sanitizeNumber(item.rOhm, { min: 0, max: 1e7, field: `Ветвь ${number}, rOhm` }), xOhm: sanitizeNumber(item.xOhm, { min: 0, max: 1e7, field: `Ветвь ${number}, xOhm` }),
        bMicroS: sanitizeNumber(item.bMicroS, { min: 0, max: 1e9, defaultValue: legacySchema ? 0 : undefined, field: `Ветвь ${number}, bMicroS` }), ratio: sanitizeNumber(item.ratio, { min: 0.000001, max: 1000, defaultValue: legacySchema ? 1 : undefined, field: `Ветвь ${number}, ratio` }),
        phaseShiftDeg: sanitizeNumber(item.phaseShiftDeg, { min: -360, max: 360, defaultValue: 0, field: `Ветвь ${number}, phaseShiftDeg` }),
        iMaxA: item.type === 'line' && iMaxFromA === iMaxToA ? iMaxFromA : legacyCurrent,
        iMaxFromA, iMaxToA, enabled: item.enabled !== false
      };
    });
    const t = raw.settings?.thresholds || {};
    const thresholds = {
      criticalLow: sanitizeNumber(t.criticalLow, { min: 1, max: 200, defaultValue: DEFAULT_THRESHOLDS.criticalLow, field: 'settings.thresholds.criticalLow' }), warningLow: sanitizeNumber(t.warningLow, { min: 1, max: 200, defaultValue: DEFAULT_THRESHOLDS.warningLow, field: 'settings.thresholds.warningLow' }),
      warningHigh: sanitizeNumber(t.warningHigh, { min: 1, max: 200, defaultValue: DEFAULT_THRESHOLDS.warningHigh, field: 'settings.thresholds.warningHigh' }), criticalHigh: sanitizeNumber(t.criticalHigh, { min: 1, max: 200, defaultValue: DEFAULT_THRESHOLDS.criticalHigh, field: 'settings.thresholds.criticalHigh' })
    };
    if (!(thresholds.criticalLow <= thresholds.warningLow && thresholds.warningLow < thresholds.warningHigh && thresholds.warningHigh <= thresholds.criticalHigh)) throw new Error('settings.thresholds: нарушен порядок criticalLow ≤ warningLow < warningHigh ≤ criticalHigh.');
    const voltageLimits = {
      uMinPU: sanitizeNumber(raw.settings?.voltageLimits?.uMinPU, { min: 0.1, max: 2, defaultValue: 0.95, field: 'settings.voltageLimits.uMinPU' }),
      uMaxPU: sanitizeNumber(raw.settings?.voltageLimits?.uMaxPU, { min: 0.1, max: 2, defaultValue: 1.05, field: 'settings.voltageLimits.uMaxPU' })
    };
    if (voltageLimits.uMinPU >= voltageLimits.uMaxPU) throw new Error('settings.voltageLimits: должно выполняться Umin < Umax.');
    const powerFlow = {
      tolerance: sanitizeNumber(raw.settings?.powerFlow?.tolerance, { min: 1e-10, max: 0.01, defaultValue: 1e-8, field: 'settings.powerFlow.tolerance' }),
      maxIterations: Math.trunc(sanitizeNumber(raw.settings?.powerFlow?.maxIterations, { min: 1, max: 100, defaultValue: 30, field: 'settings.powerFlow.maxIterations' }))
    };
    const scenarioHistory = Array.isArray(raw.scenarioHistory) ? raw.scenarioHistory.slice(-50).filter((item) => item && typeof item === 'object').map((item) => ({
      id: String(item.id || uid('scenario')).slice(0, 80), name: String(item.name || 'Аварийный сценарий').slice(0, 120),
      createdAt: String(item.createdAt || new Date().toISOString()), outageBranchIds: Array.isArray(item.outageBranchIds) ? item.outageBranchIds.filter((id) => branchIds.has(id)).slice(0, 20) : [],
      comment: String(item.comment || '').slice(0, 500)
    })) : [];
    const filterRegionId = regionIds.has(raw.regionDisplay?.filterRegionId) ? raw.regionDisplay.filterRegionId : null;
    const graphDisplay = Object.fromEntries(Object.entries(DEFAULT_GRAPH_DISPLAY).map(([key, fallback]) => [key, typeof raw.graphDisplay?.[key] === 'boolean' ? raw.graphDisplay[key] : fallback]));
    return {
      name: String(raw.name || 'Новая сеть').slice(0, 120), nodes, branches, regions,
      scenarioHistory, settings: { thresholds, voltageLimits, powerFlow },
      viewport: { zoom: Math.min(2.2, Math.max(0.45, finite(raw.viewport?.zoom, 1))), panX: finite(raw.viewport?.panX), panY: finite(raw.viewport?.panY) },
      regionDisplay: { show: Boolean(raw.regionDisplay?.show), filterRegionId }, graphDisplay
    };
  }

  function applyProject(project, persist = false) {
    Object.assign(state, project, { results: null, normalResult: null, contingencyResult: null, activeOutageId: null, selectedN1Id: null, n1Scenarios: [], n1Running: false, n1CancelRequested: false, n1Progress: { completed: 0, total: 0 }, tab: 'nodes', viewMode: 'input', selection: null, pendingDelete: null, menuOpen: false, graphFullscreen: false, regionView: 'list', selectedRegionId: null, editingRegionId: null, dirty: !persist });
    global.RastrGraph.autoLayout(state.nodes, state.branches);
    if (persist) saveProject('Учебный пример загружен и сохранён.');
  }

  function exampleProject() {
    const nodes = [
      { id: 'n1', number: 1, type: 'slack', name: 'Источник', nominalKV: 110, loadMW: 0, loadMvar: 0, generationPMode: 'auto', generationQMode: 'auto', generationP_MW: null, generationQ_Mvar: null, calculatedGenerationP_MW: null, calculatedGenerationQ_Mvar: null, setVoltageKV: 110, setAngleDeg: 0, qMinMvar: null, qMaxMvar: null, x: null, y: null, manualPosition: false },
      { id: 'n2', number: 2, type: 'load', name: 'Узел 2', nominalKV: 110, loadMW: 20, loadMvar: 8, generationPMode: 'manual', generationQMode: 'manual', generationP_MW: 0, generationQ_Mvar: 0, calculatedGenerationP_MW: null, calculatedGenerationQ_Mvar: null, setVoltageKV: null, setAngleDeg: 0, qMinMvar: null, qMaxMvar: null, x: null, y: null, manualPosition: false },
      { id: 'n3', number: 3, type: 'generator', name: 'Генераторный узел', nominalKV: 110, loadMW: 2, loadMvar: 1, generationPMode: 'manual', generationQMode: 'auto', generationP_MW: 18, generationQ_Mvar: null, calculatedGenerationP_MW: null, calculatedGenerationQ_Mvar: null, setVoltageKV: 111.1, setAngleDeg: 0, qMinMvar: -10, qMaxMvar: 20, x: null, y: null, manualPosition: false },
      { id: 'n4', number: 4, type: 'load', name: 'Узел 4', nominalKV: 110, loadMW: 12, loadMvar: 5, generationPMode: 'manual', generationQMode: 'manual', generationP_MW: 0, generationQ_Mvar: 0, calculatedGenerationP_MW: null, calculatedGenerationQ_Mvar: null, setVoltageKV: null, setAngleDeg: 0, qMinMvar: null, qMaxMvar: null, x: null, y: null, manualPosition: false },
      { id: 'n5', number: 5, type: 'load', name: 'Узел 5', nominalKV: 110, loadMW: 10, loadMvar: 4, generationPMode: 'manual', generationQMode: 'manual', generationP_MW: 0, generationQ_Mvar: 0, calculatedGenerationP_MW: null, calculatedGenerationQ_Mvar: null, setVoltageKV: null, setAngleDeg: 0, qMinMvar: null, qMaxMvar: null, x: null, y: null, manualPosition: false }
    ];
    const branches = [
      { id: 'b1', number: 1, from: 'n1', to: 'n2', type: 'line', name: 'ВЛ-1', rOhm: 1.2, xOhm: 4, bMicroS: 2, ratio: 1, iMaxA: 600 },
      { id: 'b2', number: 2, from: 'n2', to: 'n3', type: 'line', name: 'ВЛ-2', rOhm: 1, xOhm: 3.5, bMicroS: 2, ratio: 1, iMaxA: 500 },
      { id: 'b3', number: 3, from: 'n3', to: 'n4', type: 'line', name: 'ВЛ-3', rOhm: 1.1, xOhm: 3.8, bMicroS: 2, ratio: 1, iMaxA: 450 },
      { id: 'b4', number: 4, from: 'n4', to: 'n5', type: 'line', name: 'ВЛ-4', rOhm: 0.8, xOhm: 3, bMicroS: 2, ratio: 1, iMaxA: 400 },
      { id: 'b5', number: 5, from: 'n5', to: 'n1', type: 'line', name: 'ВЛ-5', rOhm: 1.3, xOhm: 4.2, bMicroS: 2, ratio: 1, iMaxA: 550 },
      { id: 'b6', number: 6, from: 'n2', to: 'n5', type: 'line', name: 'ВЛ-6', rOhm: 0.9, xOhm: 3.2, bMicroS: 2, ratio: 1, iMaxA: 450 }
    ];
    return sanitizeProject({ name: 'Учебная замкнутая сеть 110 кВ', nodes, branches, settings: { thresholds: DEFAULT_THRESHOLDS, voltageLimits: { uMinPU: 0.95, uMaxPU: 1.05 }, powerFlow: { tolerance: 1e-8, maxIterations: 30 } }, viewport: { zoom: 1, panX: 0, panY: 0 } });
  }

  function validateTopology() {
    if (!state.nodes.length) throw new Error('Добавьте хотя бы один узел.');
    const bases = state.nodes.filter((node) => node.type === 'slack');
    if (bases.length !== 1) throw new Error('Расчёт требует ровно один Slack-узел.');
    const islands = global.PowerFlow.findIslands(buildPowerFlowNetwork());
    if (islands.length !== 1) throw new Error(`Схема разделена на острова: ${islands.length}.`);
    return { rootId: bases[0].id, islands };
  }

  function validatePowerFlowInputs() {
    state.nodes.forEach((node) => {
      const prefix = `Для узла №${node.number}`;
      if (node.loadMW === null) throw new Error(`${prefix} не задана активная мощность нагрузки Pн.`);
      if (node.loadMvar === null) throw new Error(`${prefix} не задана реактивная мощность нагрузки Qн.`);
      if (node.generationPMode === 'manual' && node.generationP_MW === null) throw new Error(`${prefix} в ручном режиме необходимо задать Pг.`);
      if (node.generationQMode === 'manual' && node.generationQ_Mvar === null) throw new Error(`${prefix} в ручном режиме необходимо задать Qг.`);
      if ((node.type === 'slack' && (node.generationPMode !== 'auto' || node.generationQMode !== 'auto'))
        || (node.type === 'generator' && node.generationPMode !== 'manual')
        || ((node.type === 'load' || node.type === 'intermediate') && (node.generationPMode !== 'manual' || node.generationQMode !== 'manual'))) {
        const recommendation = node.type === 'slack' ? 'Pг = Авто и Qг = Авто' : node.type === 'generator' ? 'Pг = Вручную; Qг может быть Вручную (PQ) или Авто (PV)' : 'Pг = Вручную и Qг = Вручную';
        throw new Error(`${prefix} выбранная комбинация Manual/Auto не поддерживается Newton–Raphson для типа «${NODE_TYPES[node.type]}». Используйте: ${recommendation}.`);
      }
      if ((node.type === 'slack' || (node.type === 'generator' && node.generationQMode === 'auto')) && node.setVoltageKV === null) throw new Error(`${prefix} необходимо задать Uзад.`);
      if (node.qMinMvar !== null && node.qMaxMvar !== null && node.qMinMvar > node.qMaxMvar) throw new Error(`${prefix} должно выполняться Qmin ≤ Qmax.`);
    });
  }

  function buildPowerFlowNetwork(outageBranchIds = []) {
    const outages = new Set(outageBranchIds);
    return {
      name: state.name,
      baseMVA: 100,
      nodes: state.nodes.map((node) => ({
        ...node,
        // Ядро получает только численные спецификации. null и AUTO
        // проверяются до вызова solver и не превращаются в ноль молча.
        generationMW: node.generationPMode === 'manual' ? node.generationP_MW : 0,
        generationMvar: node.generationQMode === 'manual' ? node.generationQ_Mvar : 0,
        // Генератор с ручным Qг математически является PQ-узлом;
        // с Qг=Авто остаётся PV. Исходный тип в state не меняется.
        type: node.type === 'generator' && node.generationQMode === 'manual' ? 'load' : node.type
      })),
      branches: state.branches.map((branch) => ({ ...branch, enabled: branch.enabled !== false && !outages.has(branch.id) })),
      settings: { ...state.settings.powerFlow }
    };
  }

  function validateImportedProject(project) {
    const network = {
      name: project.name,
      baseMVA: 100,
      nodes: project.nodes.map((node) => ({
        ...node,
        generationMW: node.generationPMode === 'manual' ? node.generationP_MW : null,
        generationMvar: node.generationQMode === 'manual' ? node.generationQ_Mvar : null,
        type: node.type === 'generator' && node.generationQMode === 'manual' ? 'load' : node.type
      })),
      branches: project.branches.map((branch) => ({ ...branch })),
      settings: { ...project.settings.powerFlow }
    };
    const report = global.NetworkModel.validateNetwork(network);
    if (!report.ok) throw new Error(`Инженерная диагностика: ${report.errors.slice(0, 6).map((item) => item.message).join(' | ')}`);
    return report;
  }

  function zeroKernel(voltageKV, branch) {
    return { resistance: branch.rOhm, reactance: branch.xOhm, susceptanceMicroS: branch.bMicroS, apparentMVA: 0, powerFactor: 1, current: 0, activeLossesKW: 0, reactiveLossesKvar: 0, voltageDropKV: 0, voltageDropPercent: 0, endVoltageKV: voltageKV, chargingMvar: voltageKV ** 2 * branch.bMicroS / 1e6 };
  }

  function solveRadialLegacy() {
    const topology = validateTopology();
    const nodes = new Map(state.nodes.map((node) => [node.id, node]));
    const children = new Map(state.nodes.map((node) => [node.id, []]));
    topology.order.slice(1).forEach((id) => children.get(topology.parent.get(id)).push(id));
    const voltages = new Map(state.nodes.map((node) => [node.id, node.setVoltageKV || node.nominalKV]));
    const angles = new Map(state.nodes.map((node) => [node.id, 0]));
    const branchResults = new Map();
    const nodeTotals = new Map();

    for (let iteration = 0; iteration < 4; iteration += 1) {
      nodeTotals.clear(); branchResults.clear();
      [...topology.order].reverse().forEach((id) => {
        const node = nodes.get(id);
        let p = node.loadMW;
        let q = node.loadMvar;
        children.get(id).forEach((childId) => {
          const childBranch = branchResults.get(topology.parentBranch.get(childId).id);
          p += childBranch.pFromMW;
          q += childBranch.qFromMvar;
        });
        nodeTotals.set(id, { p, q });
        if (id === topology.rootId) return;
        const branch = topology.parentBranch.get(id);
        const parentId = topology.parent.get(id);
        const parentVoltage = voltages.get(parentId) || nodes.get(parentId).nominalKV;
        const receivingBase = branch.type === 'transformer' ? Math.max(0.001, parentVoltage * branch.ratio) : Math.max(0.001, parentVoltage);
        const kernel = Math.hypot(p, q) < 1e-12 ? zeroKernel(receivingBase, branch) : global.Calculations.calculateRastrwin({ voltageKV: receivingBase, activeMW: p, reactiveMvar: q, lengthKM: 1, resistancePerKM: branch.rOhm, reactancePerKM: branch.xOhm, susceptancePerKM: branch.bMicroS });
        const activeLossMW = kernel.activeLossesKW / 1000;
        const reactiveLossMvar = kernel.reactiveLossesKvar / 1000;
        branchResults.set(branch.id, {
          id: branch.id, fromNode: parentId, toNode: id,
          pFromMW: p + activeLossMW, qFromMvar: q + reactiveLossMvar - kernel.chargingMvar,
          pToMW: p, qToMvar: q, currentFromA: kernel.current, currentToA: kernel.current, currentA: kernel.current,
          activeLossMW, reactiveLossMvar, chargingMvar: kernel.chargingMvar,
          voltageDropKV: kernel.voltageDropKV,
          loadingFromPercent: branch.iMaxFromA && branch.iMaxFromA > 0 ? kernel.current / branch.iMaxFromA * 100 : null,
          loadingToPercent: branch.iMaxToA && branch.iMaxToA > 0 ? kernel.current / branch.iMaxToA * 100 : null,
          loadingPercent: [branch.iMaxFromA, branch.iMaxToA].filter((value) => value && value > 0).length
            ? Math.max(...[branch.iMaxFromA, branch.iMaxToA].filter((value) => value && value > 0).map((value) => kernel.current / value * 100))
            : null
        });
      });
      voltages.set(topology.rootId, nodes.get(topology.rootId).setVoltageKV || nodes.get(topology.rootId).nominalKV);
      angles.set(topology.rootId, 0);
      topology.order.slice(1).forEach((id) => {
        const branch = topology.parentBranch.get(id);
        const parentId = topology.parent.get(id);
        const result = branchResults.get(branch.id);
        const parentVoltage = voltages.get(parentId);
        const sending = branch.type === 'transformer' ? parentVoltage * branch.ratio : parentVoltage;
        const voltage = Math.max(0.001, sending - result.voltageDropKV);
        const denominator = Math.max(0.000001, sending ** 2);
        const angleDrop = (result.pFromMW * branch.xOhm - result.qFromMvar * branch.rOhm) / denominator * 180 / Math.PI;
        voltages.set(id, voltage);
        angles.set(id, angles.get(parentId) - angleDrop);
      });
    }

    const nodeResults = state.nodes.map((node) => ({
      id: node.id, voltageKV: voltages.get(node.id), angleDeg: angles.get(node.id),
      activeMW: node.id === topology.rootId ? nodeTotals.get(node.id).p : -node.loadMW,
      reactiveMvar: node.id === topology.rootId ? nodeTotals.get(node.id).q : -node.loadMvar
    }));
    const branches = state.branches.map((branch) => branchResults.get(branch.id));
    const totalLoadMW = state.nodes.reduce((sum, node) => sum + node.loadMW, 0);
    const totalLoadMvar = state.nodes.reduce((sum, node) => sum + node.loadMvar, 0);
    const activeLossMW = branches.reduce((sum, branch) => sum + branch.activeLossMW, 0);
    const reactiveLossMvar = branches.reduce((sum, branch) => sum + branch.reactiveLossMvar - branch.chargingMvar, 0);
    return {
      calculatedAt: new Date().toISOString(), nodes: nodeResults, branches,
      totals: {
        loadMW: totalLoadMW, loadMvar: totalLoadMvar,
        generationMW: totalLoadMW + activeLossMW, generationMvar: totalLoadMvar + reactiveLossMvar,
        activeLossMW, reactiveLossMvar,
        lineLossMW: branches.reduce((sum, result) => sum + (state.branches.find((branch) => branch.id === result.id).type === 'line' ? result.activeLossMW : 0), 0),
        transformerLossMW: branches.reduce((sum, result) => sum + (state.branches.find((branch) => branch.id === result.id).type === 'transformer' ? result.activeLossMW : 0), 0)
      }
    };
  }

  function solveNetwork(outageBranchIds = []) {
    if (typeof global.calculatePowerFlow !== 'function') throw new Error('Расчётное ядро calculatePowerFlow(network) не загружено.');
    validatePowerFlowInputs();
    return global.calculatePowerFlow(buildPowerFlowNetwork(outageBranchIds));
  }

  function syncCalculatedGenerations(result) {
    const resultMap = new Map((result?.converged ? result.nodes : []).map((node) => [node.id, node]));
    state.nodes.forEach((node) => {
      const calculated = resultMap.get(node.id);
      node.calculatedGenerationP_MW = calculated && Number.isFinite(calculated.calculatedGenerationP_MW) ? calculated.calculatedGenerationP_MW : null;
      node.calculatedGenerationQ_Mvar = calculated && Number.isFinite(calculated.calculatedGenerationQ_Mvar) ? calculated.calculatedGenerationQ_Mvar : null;
    });
  }

  function nodeResult(id) { return state.results?.nodes.find((item) => item.id === id) || null; }
  function branchResult(id) { return state.results?.branches.find((item) => item.id === id) || null; }
  function nodeById(id) { return state.nodes.find((item) => item.id === id) || null; }
  function branchById(id) { return state.branches.find((item) => item.id === id) || null; }
  function branchSideName(branch, side) {
    if (branch?.type !== 'transformer') return side === 'from' ? 'Начало' : 'Конец';
    const fromVoltage = nodeById(branch.from)?.nominalKV; const toVoltage = nodeById(branch.to)?.nominalKV;
    if (!Number.isFinite(fromVoltage) || !Number.isFinite(toVoltage) || fromVoltage === toVoltage) return side === 'from' ? 'Начало' : 'Конец';
    const fromIsHigh = fromVoltage > toVoltage;
    return (side === 'from') === fromIsHigh ? 'ВН' : 'НН';
  }

  function transformerRatioWarning(branch) {
    if (!branch || branch.type !== 'transformer') return null;
    const from = nodeById(branch.from); const to = nodeById(branch.to);
    if (!from || !to || !Number.isFinite(from.nominalKV) || !Number.isFinite(to.nominalKV) || from.nominalKV <= 0 || to.nominalKV <= 0) return null;
    const expected = to.nominalKV / from.nominalKV;
    const deviation = Math.abs(branch.ratio - expected) / expected;
    if (!Number.isFinite(deviation) || deviation <= 0.05) return null;
    return {
      branchId: branch.id,
      expected,
      actual: branch.ratio,
      message: `Kт трансформатора «${branch.name}» не согласован с номинальными напряжениями узлов: ${from.nominalKV} → ${to.nominalKV} кВ требует Kт ≈ ${fmt(expected, 5)}, задано ${fmt(branch.ratio, 5)}.`
    };
  }

  function getTransformerRatioWarnings() {
    return state.branches.map(transformerRatioWarning).filter(Boolean);
  }

  function aggregateDefined(items, getter) {
    const values = items.map(getter).filter(Number.isFinite);
    return { value: values.length ? values.reduce((sum, value) => sum + value, 0) : null, incomplete: values.length !== items.length };
  }

  function getRegionAnalysis(result = state.results) {
    const solved = Boolean(result?.converged);
    const nodeResults = new Map((solved ? result.nodes : []).map((item) => [item.id, item]));
    const branchResults = new Map((solved ? result.branches : []).map((item) => [item.id, item]));
    const regions = state.regions.map((region) => {
      const nodes = state.nodes.filter((node) => node.regionId === region.id);
      const internalBranches = state.branches.filter((branch) => nodeById(branch.from)?.regionId === region.id && nodeById(branch.to)?.regionId === region.id);
      const boundaryBranches = state.branches.filter((branch) => (nodeById(branch.from)?.regionId === region.id) !== (nodeById(branch.to)?.regionId === region.id));
      const loadP = aggregateDefined(nodes, (node) => node.loadMW);
      const loadQ = aggregateDefined(nodes, (node) => node.loadMvar);
      const generationP = aggregateDefined(nodes, (node) => solved ? nodeResults.get(node.id)?.calculatedGenerationP_MW : node.generationPMode === 'manual' ? node.generationP_MW : null);
      const generationQ = aggregateDefined(nodes, (node) => solved ? nodeResults.get(node.id)?.calculatedGenerationQ_Mvar : node.generationQMode === 'manual' ? node.generationQ_Mvar : null);
      let pIn = solved ? 0 : null; let pOut = solved ? 0 : null; let qIn = solved ? 0 : null; let qOut = solved ? 0 : null;
      boundaryBranches.forEach((branch) => {
        const branchResultValue = branchResults.get(branch.id); if (!branchResultValue) return;
        const regionAtFrom = nodeById(branch.from)?.regionId === region.id;
        const pAtBoundary = regionAtFrom ? branchResultValue.pFromMW : -branchResultValue.pToMW;
        const qAtBoundary = regionAtFrom ? branchResultValue.qFromMvar : -branchResultValue.qToMvar;
        pOut += Math.max(0, pAtBoundary); pIn += Math.max(0, -pAtBoundary);
        qOut += Math.max(0, qAtBoundary); qIn += Math.max(0, -qAtBoundary);
      });
      const internalLossP = solved ? internalBranches.reduce((sum, branch) => sum + (branchResults.get(branch.id)?.activeLossMW || 0), 0) : null;
      const internalLossQ = solved ? internalBranches.reduce((sum, branch) => sum + (branchResults.get(branch.id)?.reactiveLossMvar || 0), 0) : null;
      const balanceP = solved && !generationP.incomplete && !loadP.incomplete && [generationP.value, loadP.value, pIn, pOut, internalLossP].every(Number.isFinite) ? generationP.value + pIn - loadP.value - pOut - internalLossP : null;
      const balanceQ = solved && !generationQ.incomplete && !loadQ.incomplete && [generationQ.value, loadQ.value, qIn, qOut, internalLossQ].every(Number.isFinite) ? generationQ.value + qIn - loadQ.value - qOut - internalLossQ : null;
      return { ...region, nodes, internalBranches, boundaryBranches, loadP, loadQ, generationP, generationQ, pIn, pOut, qIn, qOut, internalLossP, internalLossQ, balanceP, balanceQ };
    });
    const interregionalBranches = state.branches.flatMap((branch) => {
      const fromRegion = regionById(nodeById(branch.from)?.regionId); const toRegion = regionById(nodeById(branch.to)?.regionId);
      if (!fromRegion || !toRegion || fromRegion.id === toRegion.id) return [];
      const branchResultValue = branchResults.get(branch.id) || null;
      const forward = !branchResultValue || branchResultValue.pFromMW >= 0;
      return [{ branch, fromRegion, toRegion, result: branchResultValue, direction: `${forward ? fromRegion.name : toRegion.name} → ${forward ? toRegion.name : fromRegion.name}` }];
    });
    return { solved, regions, interregionalBranches };
  }
  function invalidate() {
    state.results = null; state.normalResult = null; state.contingencyResult = null; state.activeOutageId = null;
    state.n1Scenarios = []; state.selectedN1Id = null; state.viewMode = 'input'; state.dirty = true;
    state.nodes.forEach((node) => { node.calculatedGenerationP_MW = null; node.calculatedGenerationQ_Mvar = null; });
  }

  function reflowAutomaticNodes() {
    state.nodes.forEach((node) => { if (!node.manualPosition) { node.x = null; node.y = null; } });
    global.RastrGraph.autoLayout(state.nodes, state.branches);
  }

  function showMessage(message, type = 'info') {
    const element = $('#rastrMessage', root);
    if (!element) return;
    element.textContent = message;
    element.dataset.type = type;
  }

  function optionList(items, selected) {
    return Object.entries(items).map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  }

  function nodeSelectOptions(selected) {
    return state.nodes.map((node) => `<option value="${escapeHtml(node.id)}" ${node.id === selected ? 'selected' : ''}>${escapeHtml(node.number)} — ${escapeHtml(node.name)}</option>`).join('');
  }

  function regionById(id) { return state.regions.find((region) => region.id === id) || null; }

  function regionSelectOptions(selected, excludedId = null) {
    return `<option value="">Без района</option>${state.regions.filter((region) => region.id !== excludedId).map((region) => `<option value="${escapeHtml(region.id)}" ${region.id === selected ? 'selected' : ''}>${escapeHtml(region.code)} — ${escapeHtml(region.name)}</option>`).join('')}`;
  }

  function numberInput(value, attributes = '') {
    return `<input type="number" step="any" value="${value ?? ''}" ${attributes}>`;
  }

  function generationCell(node, result, modeField, valueField, calculatedField, unit) {
    const automatic = node[modeField] === 'auto';
    const calculated = result?.[calculatedField];
    const inputValue = automatic && Number.isFinite(calculated) ? calculated : automatic ? null : node[valueField];
    const readonly = automatic ? 'readonly aria-readonly="true"' : '';
    const minimum = valueField === 'generationP_MW' ? 'min="0"' : '';
    const calculationLabel = !automatic && result && Number.isFinite(calculated) ? `<small>расч.: ${fmt(calculated, 3)}</small>` : automatic ? `<small>${Number.isFinite(calculated) ? 'рассчитано solver' : 'до расчёта —'}</small>` : '';
    return `<td class="rastr-generation-cell ${automatic ? 'rastr-calculated' : ''}"><div class="rastr-generation-control"><select data-node-generation-mode="${modeField}" aria-label="Режим ${unit}"><option value="manual" ${automatic ? '' : 'selected'}>Вручную</option><option value="auto" ${automatic ? 'selected' : ''}>Авто</option></select>${numberInput(inputValue, `${minimum} placeholder="${automatic ? '—' : unit}" data-node-field="${valueField}" ${readonly}`)}</div>${calculationLabel}</td>`;
  }

  function renderNodeRows() {
    return state.nodes.map((node) => {
      const result = nodeResult(node.id);
      const selected = state.selection?.type === 'node' && state.selection.id === node.id;
      const confirm = state.pendingDelete?.type === 'node' && state.pendingDelete.id === node.id;
      return `<tr data-row-type="node" data-row-id="${escapeHtml(node.id)}" class="${selected ? 'is-selected' : ''}">
        <td><input data-node-field="number" type="number" min="1" step="1" value="${node.number}"></td>
        <td><select data-node-field="type">${optionList(NODE_TYPES, node.type)}</select></td>
        <td><input data-node-field="name" maxlength="80" value="${escapeHtml(node.name)}"></td>
        <td><select data-node-region="true" aria-label="Район узла">${regionSelectOptions(node.regionId)}</select></td>
        <td>${numberInput(node.nominalKV, 'min="0.001" data-node-field="nominalKV"')}</td>
        <td>${numberInput(node.loadMW, 'min="0" placeholder="МВт" data-node-field="loadMW"')}</td>
        <td>${numberInput(node.loadMvar, 'min="0" placeholder="Мвар" data-node-field="loadMvar"')}</td>
        ${generationCell(node, result, 'generationPMode', 'generationP_MW', 'calculatedGenerationP_MW', 'МВт')}
        ${generationCell(node, result, 'generationQMode', 'generationQ_Mvar', 'calculatedGenerationQ_Mvar', 'Мвар')}
        <td>${numberInput(node.setVoltageKV, 'min="0.001" data-node-field="setVoltageKV"')}</td>
        <td>${numberInput(node.qMinMvar, 'placeholder="Мвар" data-node-field="qMinMvar"')}</td>
        <td>${numberInput(node.qMaxMvar, 'placeholder="Мвар" data-node-field="qMaxMvar"')}</td>
        <td class="rastr-calculated">${fmt(result?.voltageKV, 3)}</td><td class="rastr-calculated">${fmt(result?.angleDeg, 3)}</td>
        <td><div class="rastr-row-actions">${confirm ? '<button data-action="cancel-delete" type="button">Отмена</button><button class="danger" data-action="confirm-delete" type="button">Точно удалить</button>' : '<button data-action="select-row" type="button">Открыть</button><button class="danger" data-action="request-delete" type="button">Удалить</button>'}</div></td>
      </tr>`;
    }).join('') || '<tr><td colspan="15" class="rastr-empty-cell">Узлов пока нет.</td></tr>';
  }

  function renderBranchRows() {
    return state.branches.map((branch) => {
      const result = branchResult(branch.id);
      const selected = state.selection?.type === 'branch' && state.selection.id === branch.id;
      const confirm = state.pendingDelete?.type === 'branch' && state.pendingDelete.id === branch.id;
      const fromSideName = branchSideName(branch, 'from'); const toSideName = branchSideName(branch, 'to');
      return `<tr data-row-type="branch" data-row-id="${escapeHtml(branch.id)}" class="${selected ? 'is-selected' : ''}">
        <td><input data-branch-field="number" type="number" min="1" step="1" value="${branch.number}"></td>
        <td><input data-branch-field="enabled" type="checkbox" ${branch.enabled !== false ? 'checked' : ''} aria-label="Ветвь включена"></td>
        <td><select data-branch-field="from">${nodeSelectOptions(branch.from)}</select></td>
        <td><select data-branch-field="to">${nodeSelectOptions(branch.to)}</select></td>
        <td><select data-branch-field="type">${optionList(BRANCH_TYPES, branch.type)}</select></td>
        <td><input data-branch-field="name" maxlength="80" value="${escapeHtml(branch.name)}"></td>
        <td>${numberInput(branch.rOhm, 'min="0" data-branch-field="rOhm"')}</td>
        <td>${numberInput(branch.xOhm, 'min="0" data-branch-field="xOhm"')}</td>
        <td>${numberInput(branch.bMicroS, 'min="0" data-branch-field="bMicroS"')}</td>
        <td>${numberInput(branch.ratio, 'min="0.000001" data-branch-field="ratio"')}</td>
        <td>${numberInput(branch.phaseShiftDeg, 'min="-360" max="360" data-branch-field="phaseShiftDeg"')}</td>
        <td><span>${fromSideName}</span>${numberInput(branch.iMaxFromA, `min="0" aria-label="Imax ${fromSideName}, А" data-branch-field="iMaxFromA"`)}</td>
        <td><span>${toSideName}</span>${numberInput(branch.iMaxToA, `min="0" aria-label="Imax ${toSideName}, А" data-branch-field="iMaxToA"`)}</td>
        <td class="rastr-calculated">${fmt(result?.currentFromA, 2)}</td><td class="rastr-calculated">${fmt(result?.currentToA, 2)}</td>
        <td class="rastr-calculated">${result?.loadingFromPercent == null ? '—' : `${fmt(result.loadingFromPercent, 1)} %`}</td><td class="rastr-calculated">${result?.loadingToPercent == null ? '—' : `${fmt(result.loadingToPercent, 1)} %`}</td>
        <td><div class="rastr-row-actions">${confirm ? '<button data-action="cancel-delete" type="button">Отмена</button><button class="danger" data-action="confirm-delete" type="button">Точно удалить</button>' : '<button data-action="select-row" type="button">Открыть</button><button class="danger" data-action="request-delete" type="button">Удалить</button>'}</div></td>
      </tr>`;
    }).join('') || '<tr><td colspan="18" class="rastr-empty-cell">Ветвей пока нет.</td></tr>';
  }

  function renderNodesTab() {
    const slack = state.nodes.find((node) => node.type === 'slack');
    return `<div class="rastr-tab-heading"><div><h2>Узлы</h2><p>Pн/Qн — нагрузка, Pг/Qг — генерация. Пусто, 0 и Авто хранятся как разные состояния. Расчёт использует Pspec = Pг − Pн и Qspec = Qг − Qн.</p></div><button class="secondary-button" data-action="add-node" type="button">+ Добавить узел</button></div>${slack ? `<label class="rastr-slack-angle"><span>Slack ${escapeHtml(slack.number)}: δзад, °</span>${numberInput(slack.setAngleDeg, 'min="-360" max="360" data-slack-angle="true"')}</label>` : ''}<div class="rastr-table-scroll"><table class="rastr-table rastr-nodes-table"><thead><tr><th>№</th><th>Тип</th><th>Название</th><th>Район</th><th>Uном, кВ</th><th>Pн, МВт</th><th>Qн, Мвар</th><th>Pг, МВт</th><th>Qг, Мвар</th><th>Uзад, кВ</th><th>Qmin, Мвар</th><th>Qmax, Мвар</th><th>Uрасч, кВ</th><th>δ, °</th><th>Действия</th></tr></thead><tbody>${renderNodeRows()}</tbody></table></div>`;
  }

  function renderBranchesTab() {
    return `<div class="rastr-tab-heading"><div><h2>Ветви</h2><p>Для трансформатора подписи ВН/НН определяются по Uном связанных узлов; ток каждой стороны сравнивается только с её Imax.</p></div><button class="secondary-button" data-action="add-branch" type="button" ${state.nodes.length < 2 ? 'disabled' : ''}>+ Добавить ветвь</button></div><div class="rastr-table-scroll"><table class="rastr-table"><thead><tr><th>№</th><th>Вкл.</th><th>Начало</th><th>Конец</th><th>Тип</th><th>Название</th><th>R, Ом</th><th>X, Ом</th><th>B, мкСм</th><th>Kт</th><th>θ, °</th><th>Imax стороны начала, А</th><th>Imax стороны конца, А</th><th>Iнач, А</th><th>Iкон, А</th><th>Загр. нач.</th><th>Загр. кон.</th><th>Действия</th></tr></thead><tbody>${renderBranchRows()}</tbody></table></div>`;
  }

  function renderResultsTab() {
    if (!state.results) return state.normalResult && !state.normalResult.converged ? `<h2>Результат расчёта</h2>${renderModeDiagnostics(state.normalResult)}` : '<div class="rastr-empty-state"><strong>Режим ещё не рассчитан</strong><span>Проверьте топологию и нажмите «Рассчитать».</span></div>';
    const nodes = [...state.nodes].sort((a, b) => a.number - b.number).map((node) => { const r = nodeResult(node.id); return `<tr><td>${node.number}</td><td>${escapeHtml(r.busMode)}</td><td>${fmt(node.nominalKV, 2)}</td><td>${fmt(r.voltageKV, 3)}</td><td>${fmt(r.angleDeg, 3)}</td><td>${fmt(node.loadMW, 3)}</td><td>${fmt(node.loadMvar, 3)}</td><td>${fmt(r.calculatedGenerationP_MW, 3)}</td><td>${fmt(r.calculatedGenerationQ_Mvar, 3)}</td><td>${fmt(r.activeMW, 3)}</td><td>${fmt(r.reactiveMvar, 3)}</td></tr>`; }).join('');
    const branches = state.results.branches.map((r) => `<tr><td>${escapeHtml(nodeById(r.fromNode)?.number)}</td><td>${escapeHtml(nodeById(r.toNode)?.number)}</td><td>${fmt(r.pFromMW, 3)}</td><td>${fmt(r.qFromMvar, 3)}</td><td>${fmt(r.pToMW, 3)}</td><td>${fmt(r.qToMvar, 3)}</td><td>${fmt(r.currentFromA, 2)}</td><td>${fmt(r.currentToA, 2)}</td><td>${r.loadingFromPercent == null ? '—' : `${fmt(r.loadingFromPercent, 1)} %`}</td><td>${r.loadingToPercent == null ? '—' : `${fmt(r.loadingToPercent, 1)} %`}</td><td>${fmt(r.activeLossMW, 4)}</td><td>${fmt(r.reactiveLossMvar, 4)}</td></tr>`).join('');
    return `<h2>Результаты режима</h2><h3 class="rastr-result-title">Узлы</h3><div class="rastr-table-scroll"><table class="rastr-table"><thead><tr><th>№</th><th>Режим</th><th>Uном</th><th>Uрасч</th><th>δ, °</th><th>Pн</th><th>Qн</th><th>Pг расч.</th><th>Qг расч.</th><th>Pspec</th><th>Qspec</th></tr></thead><tbody>${nodes}</tbody></table></div><h3 class="rastr-result-title">Ветви</h3><div class="rastr-table-scroll"><table class="rastr-table"><thead><tr><th>Начало</th><th>Конец</th><th>Pнач</th><th>Qнач</th><th>Pкон</th><th>Qкон</th><th>Iнач, А</th><th>Iкон, А</th><th>Загр. нач.</th><th>Загр. кон.</th><th>ΔP</th><th>ΔQ</th></tr></thead><tbody>${branches}</tbody></table></div>`;
  }

  function renderLossesTab() {
    if (!state.results) return '<div class="rastr-empty-state"><strong>Потери пока не рассчитаны</strong><span>Они появятся после расчёта режима.</span></div>';
    const t = state.results.totals;
    const cards = [['ΣP нагрузки', t.loadMW, 'МВт'], ['ΣQ нагрузки', t.loadMvar, 'Мвар'], ['ΣP генерации', t.generationMW, 'МВт'], ['ΣQ генерации', t.generationMvar, 'Мвар'], ['ΣΔP сети', t.activeLossMW, 'МВт'], ['ΣΔQ сети', t.reactiveLossMvar, 'Мвар'], ['ΔP ЛЭП', t.lineLossMW, 'МВт'], ['ΔP трансформаторов', t.transformerLossMW, 'МВт']];
    return `<h2>Баланс и потери</h2><div class="rastr-loss-grid">${cards.map(([label, value, unit]) => `<div><span>${label}</span><strong>${fmt(value, 4)}</strong><small>${unit}</small></div>`).join('')}</div><p class="rastr-model-note">Баланс рассчитан по комплексным потокам полной π-модели ветвей; реактивные потери включают влияние поперечной проводимости B.</p>`;
  }

  function renderFlowsTab() {
    if (!state.results) return '<div class="rastr-empty-state"><strong>Перетоки ещё не рассчитаны</strong><span>Запустите расчёт режима.</span></div>';
    const rows = state.results.branches.map((result) => {
      const branch = branchById(result.id);
      const direction = result.pFromMW >= 0 ? `${nodeById(result.fromNode)?.number} → ${nodeById(result.toNode)?.number}` : `${nodeById(result.toNode)?.number} → ${nodeById(result.fromNode)?.number}`;
      return `<tr data-row-type="branch" data-row-id="${escapeHtml(result.id)}"><td>${escapeHtml(branch?.name)}</td><td>${escapeHtml(direction)}</td><td>${fmt(result.pFromMW, 3)}</td><td>${fmt(result.qFromMvar, 3)}</td><td>${fmt(result.pToMW, 3)}</td><td>${fmt(result.qToMvar, 3)}</td><td>${fmt(result.currentA, 2)}</td><td>${result.loadingPercent == null ? '—' : `${fmt(result.loadingPercent, 1)} %`}</td></tr>`;
    }).join('');
    return `<div class="rastr-tab-heading"><div><h2>Перетоки мощности</h2><p>Направление определяется знаком расчётной активной мощности.</p></div></div><div class="rastr-table-scroll"><table class="rastr-table"><thead><tr><th>Ветвь</th><th>Направление</th><th>Pнач, МВт</th><th>Qнач, Мвар</th><th>Pкон, МВт</th><th>Qкон, Мвар</th><th>I, А</th><th>Загрузка</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderBalanceTab() {
    if (!state.results) return '<div class="rastr-empty-state"><strong>Баланс ещё не рассчитан</strong><span>Запустите расчёт режима.</span></div>';
    const t = state.results.totals;
    const pMismatch = t.generationMW - t.loadMW - t.activeLossMW;
    const qMismatch = t.generationMvar - t.loadMvar - t.reactiveLossMvar;
    return `<h2>Баланс мощности</h2><div class="rastr-balance-equations"><div><span>Активная мощность</span><strong>${fmt(t.generationMW, 4)} = ${fmt(t.loadMW, 4)} + ${fmt(t.activeLossMW, 4)} МВт</strong><small>Небаланс: ${fmt(pMismatch, 6)} МВт</small></div><div><span>Реактивная мощность</span><strong>${fmt(t.generationMvar, 4)} = ${fmt(t.loadMvar, 4)} + ${fmt(t.reactiveLossMvar, 4)} Мвар</strong><small>Небаланс: ${fmt(qMismatch, 6)} Мвар</small></div></div>`;
  }

  function renderDataControlTab() {
    let topologyMessage = 'Топология готова к расчёту.'; let topologyOk = true;
    try { validateTopology(); } catch (error) { topologyMessage = error.message; topologyOk = false; }
    let inputMessage = 'Режимы Manual/Auto и исходные P/Q совместимы.'; let inputOk = true;
    try { validatePowerFlowInputs(); } catch (error) { inputMessage = error.message; inputOk = false; }
    const duplicateBranchNumbers = new Set(state.branches.map((branch) => branch.number)).size !== state.branches.length;
    const missingLimits = state.branches.filter((branch) => branch.iMaxFromA == null || branch.iMaxToA == null).length;
    const ratioWarnings = getTransformerRatioWarnings();
    const checks = [
      [state.nodes.length > 0, 'Узлы', state.nodes.length ? `Задано: ${state.nodes.length}` : 'Нет узлов'],
      [state.nodes.filter((node) => node.type === 'slack').length === 1, 'Базовый узел', `Количество: ${state.nodes.filter((node) => node.type === 'slack').length}`],
      [inputOk, 'P/Q и Manual/Auto', inputMessage],
      [topologyOk, 'Топология', topologyMessage],
      [!ratioWarnings.length, 'Kт трансформаторов', ratioWarnings.length ? ratioWarnings.map((warning) => warning.message).join(' ') : 'Согласован с отношением Uном связанных узлов'],
      [!duplicateBranchNumbers, 'Номера ветвей', duplicateBranchNumbers ? 'Есть повторяющиеся номера' : 'Повторов нет'],
      [true, 'Imax сторон', missingLimits ? `Не заданы все паспортные токи сторон для ${missingLimits} ветвей — контроль загрузки будет неполным` : 'Заданы для обеих сторон всех ветвей']
    ];
    return `<h2>Контроль исходных данных</h2><div class="rastr-check-list">${checks.map(([ok, title, text]) => `<article class="${ok ? 'is-ok' : 'is-error'}"><b>${ok ? '✓' : '!'}</b><div><strong>${title}</strong><span>${escapeHtml(text)}</span></div></article>`).join('')}</div>`;
  }

  function voltageStatus(result, node) {
    const value = Number.isFinite(result.voltagePU) ? result.voltagePU : result.voltageKV / node.nominalKV;
    const limits = state.settings.voltageLimits;
    if (value < limits.uMinPU) return ['critical', 'LOW'];
    if (value > limits.uMaxPU) return ['warning', 'HIGH'];
    return ['normal', 'NORMAL'];
  }

  function renderVoltageControlTab() {
    if (!state.results) return '<div class="rastr-empty-state"><strong>Напряжения ещё не рассчитаны</strong><span>Запустите расчёт режима.</span></div>';
    return `<div class="rastr-tab-heading"><div><h2>Контроль напряжения</h2><p>Пользовательские границы: ${fmt(state.settings.voltageLimits.uMinPU, 3)}–${fmt(state.settings.voltageLimits.uMaxPU, 3)} pu. Они не являются универсальными нормативами.</p></div></div><div class="rastr-control-grid">${state.nodes.map((node) => { const result = nodeResult(node.id); const valuePU = Number.isFinite(result.voltagePU) ? result.voltagePU : result.voltageKV / node.nominalKV; const [status, label] = voltageStatus(result, node); return `<article class="status-${status}"><div><span>Узел ${node.number}</span><strong>${escapeHtml(node.name)}</strong></div><b>${fmt(result.voltageKV, 3)} кВ</b><small>${fmt(valuePU, 4)} pu · ${label}</small></article>`; }).join('')}</div>`;
  }

  function renderLoadingControlTab() {
    if (!state.results) return '<div class="rastr-empty-state"><strong>Загрузка ещё не рассчитана</strong><span>Запустите расчёт режима.</span></div>';
    return `<div class="rastr-tab-heading"><div><h2>Контроль загрузки ветвей</h2><p>Токи начала и конца сравниваются только с паспортным током соответствующей стороны.</p></div></div><div class="rastr-control-grid">${state.branches.map((branch) => { const result = branchResult(branch.id); const percent = result.loadingPercent; const status = percent == null ? 'unknown' : percent > 100 ? 'critical' : percent >= 80 ? 'warning' : 'normal'; const side = (label, current, limit, loading) => `${label}: ${fmt(current, 2)} А · ${loading == null ? 'Imax не задан' : `${fmt(loading, 1)} % от ${fmt(limit, 2)} А`}`; return `<article class="status-${status}"><div><span>Ветвь ${branch.number}</span><strong>${escapeHtml(branch.name)}</strong></div><b>${percent == null ? '—' : `${fmt(percent, 1)} % max`}</b><small>${side(branchSideName(branch, 'from'), result.currentFromA, branch.iMaxFromA, result.loadingFromPercent)}<br>${side(branchSideName(branch, 'to'), result.currentToA, branch.iMaxToA, result.loadingToPercent)}</small></article>`; }).join('')}</div>`;
  }

  function renderMonitoredTab() {
    if (!state.results) return '<div class="rastr-empty-state"><strong>Нет расчётных величин</strong><span>Запустите расчёт режима.</span></div>';
    return `<h2>Контролируемые величины</h2><p class="rastr-model-note">Узлы: U и δ. Ветви: P, Q, I, ΔP, ΔQ и загрузка по Imax. Все значения взяты из актуального расчёта.</p>${renderResultsTab()}`;
  }

  function analyzeModeResult(result) {
    const limits = state.settings.voltageLimits;
    if (!result?.converged) {
      const islanded = result?.diagnostics?.reason === 'islanded';
      return { converged: false, islanded, severity: islanded ? 1 : 0, violations: result?.diagnostics?.messages || ['Режим не сошёлся.'] };
    }
    const voltageViolations = result.nodes.filter((node) => node.voltagePU < limits.uMinPU || node.voltagePU > limits.uMaxPU);
    const overloaded = result.branches.filter((branch) => branch.enabled !== false && branch.loadingPercent != null && branch.loadingPercent > 100);
    const minVoltage = result.nodes.length ? Math.min(...result.nodes.map((node) => node.voltagePU)) : null;
    const maxVoltage = result.nodes.length ? Math.max(...result.nodes.map((node) => node.voltagePU)) : null;
    const activeBranches = result.branches.filter((branch) => branch.enabled !== false);
    const maxCurrent = activeBranches.length ? Math.max(...activeBranches.map((branch) => branch.currentA)) : null;
    const knownLoading = activeBranches.filter((branch) => branch.loadingPercent != null);
    const maxLoading = knownLoading.length ? Math.max(...knownLoading.map((branch) => branch.loadingPercent)) : null;
    const violations = [
      ...voltageViolations.map((item) => `Узел ${nodeById(item.id)?.number}: U = ${fmt(item.voltagePU, 4)} pu`),
      ...overloaded.map((item) => `Ветвь ${branchById(item.id)?.number}: ${fmt(item.loadingPercent, 1)} %`)
    ];
    return {
      converged: true, islanded: false, minVoltage, maxVoltage, maxCurrent, maxLoading,
      voltageViolations: voltageViolations.length, overloads: overloaded.length, violations,
      severity: voltageViolations.length ? 2 : overloaded.length ? 3 : 4
    };
  }

  function renderModeDiagnostics(result) {
    if (!result) return '<p class="rastr-model-note">Режим ещё не рассчитан.</p>';
    if (!result.converged) return `<div class="rastr-mode-diagnostic is-error"><strong>${result.diagnostics?.reason === 'islanded' ? 'ОСТРОВНОЙ РЕЖИМ' : 'НЕ СОШЁЛСЯ'}</strong><span>Итерации: ${result.iterations || 0} · max mismatch: ${result.maxMismatch == null ? '—' : fmt(result.maxMismatch, 8)}</span>${(result.diagnostics?.messages || []).map((message) => `<p>${escapeHtml(message)}</p>`).join('')}</div>`;
    return `<div class="rastr-mode-diagnostic is-ok"><strong>Режим сошёлся</strong><span>Newton–Raphson · итерации: ${result.iterations} · max mismatch: ${fmt(result.maxMismatch, 8)}</span></div>`;
  }

  function renderContingencyTab() {
    const selectable = state.branches.filter((branch) => branch.enabled !== false);
    const selected = state.activeOutageId && branchById(state.activeOutageId) ? state.activeOutageId : selectable[0]?.id || '';
    return `<div class="rastr-tab-heading"><div><h2>Аварийный режим</h2><p>Ветвь временно отключается копией <code>network</code>. Исходные данные не изменяются.</p></div></div>
      <div class="rastr-contingency-controls"><label>Отключаемый элемент<select id="rastrContingencyBranch">${selectable.map((branch) => `<option value="${escapeHtml(branch.id)}" ${branch.id === selected ? 'selected' : ''}>${escapeHtml(branch.name)} · ${BRANCH_TYPES[branch.type]}</option>`).join('')}</select></label><button class="primary-button" data-action="run-contingency" type="button" ${selectable.length ? '' : 'disabled'}>Отключить и рассчитать</button><button class="secondary-button" data-action="return-normal" type="button" ${state.normalResult ? '' : 'disabled'}>Вернуться к нормальному режиму</button></div>
      <div class="rastr-mode-summary-grid"><section><h3>Нормальный режим</h3>${renderModeDiagnostics(state.normalResult)}</section><section><h3>Аварийный режим</h3>${renderModeDiagnostics(state.contingencyResult)}</section></div>
      ${state.contingencyResult ? `<div class="rastr-scenario-save"><input id="rastrScenarioName" maxlength="120" value="${escapeHtml(state.activeOutageId ? `Отключение ${branchById(state.activeOutageId)?.name || ''}` : 'Аварийный сценарий')}" aria-label="Название сценария"><input id="rastrScenarioComment" maxlength="500" placeholder="Комментарий (необязательно)" aria-label="Комментарий"><button class="secondary-button" data-action="save-scenario" type="button">Сохранить сценарий</button></div>` : ''}`;
  }

  function resultById(result, collection, id) { return result?.[collection]?.find((item) => item.id === id) || null; }

  function renderComparisonTab() {
    const before = state.normalResult; const after = state.contingencyResult;
    if (!before || !after) return '<div class="rastr-empty-state"><strong>Нет двух режимов для сравнения</strong><span>Рассчитайте нормальный и аварийный режимы.</span></div>';
    if (!before.converged || !after.converged) return `<h2>Сравнение режимов</h2>${renderModeDiagnostics(after)}<p class="rastr-model-note">Числовое сравнение не строится, если один из режимов не сошёлся.</p>`;
    const nodeRows = state.nodes.map((node) => { const a = resultById(before, 'nodes', node.id); const b = resultById(after, 'nodes', node.id); return `<tr><td>${node.number}</td><td>${fmt(a?.voltageKV, 3)}</td><td>${fmt(b?.voltageKV, 3)}</td><td>${fmt((b?.voltageKV ?? 0) - (a?.voltageKV ?? 0), 3)}</td><td>${fmt(a?.angleDeg, 3)}</td><td>${fmt(b?.angleDeg, 3)}</td></tr>`; }).join('');
    const branchRows = state.branches.map((branch) => { const a = resultById(before, 'branches', branch.id); const b = resultById(after, 'branches', branch.id); return `<tr><td>${escapeHtml(branch.name)}</td><td>${fmt(a?.currentA, 2)}</td><td>${fmt(b?.currentA, 2)}</td><td>${fmt((b?.currentA ?? 0) - (a?.currentA ?? 0), 2)}</td><td>${a?.loadingPercent == null ? '—' : `${fmt(a.loadingPercent, 1)} %`}</td><td>${b?.loadingPercent == null ? '—' : `${fmt(b.loadingPercent, 1)} %`}</td><td>${fmt(a?.activeLossMW, 4)}</td><td>${fmt(b?.activeLossMW, 4)}</td></tr>`; }).join('');
    return `<div class="rastr-tab-heading"><div><h2>Сравнение режимов</h2><p>${escapeHtml(state.activeOutageId ? `Отключена ветвь: ${branchById(state.activeOutageId)?.name || ''}` : '')}</p></div><div class="rastr-n1-actions"><button class="secondary-button" data-action="return-normal" type="button">Нормальный</button><button class="secondary-button" data-action="show-contingency" type="button">Аварийный</button></div></div>
      <h3 class="rastr-result-title">Узлы</h3><div class="rastr-table-scroll"><table class="rastr-table"><thead><tr><th>Узел</th><th>U до, кВ</th><th>U после, кВ</th><th>ΔU, кВ</th><th>δ до</th><th>δ после</th></tr></thead><tbody>${nodeRows}</tbody></table></div>
      <h3 class="rastr-result-title">Ветви</h3><div class="rastr-table-scroll"><table class="rastr-table"><thead><tr><th>Ветвь</th><th>I до</th><th>I после</th><th>ΔI</th><th>Загрузка до</th><th>Загрузка после</th><th>ΔP до</th><th>ΔP после</th></tr></thead><tbody>${branchRows}</tbody></table></div>
      <div class="rastr-balance-equations"><div><span>Потери P</span><strong>${fmt(before.totals.activeLossMW, 4)} → ${fmt(after.totals.activeLossMW, 4)} МВт</strong></div><div><span>Потери Q</span><strong>${fmt(before.totals.reactiveLossMvar, 4)} → ${fmt(after.totals.reactiveLossMvar, 4)} Мвар</strong></div></div>`;
  }

  function renderN1Tab() {
    const progress = state.n1Progress;
    const rows = state.n1Scenarios.map((scenario) => { const a = scenario.analysis; const selected = scenario.id === state.selectedN1Id; return `<tr class="${selected ? 'is-selected' : ''}" data-row-id="${escapeHtml(scenario.id)}" data-row-type="n1"><td><button class="text-button" data-action="select-n1" data-scenario-id="${escapeHtml(scenario.id)}" type="button">${escapeHtml(scenario.branchName)}</button></td><td>Отключена</td><td>${a.converged ? '✓' : '✕'}</td><td>${a.converged ? fmt(a.minVoltage, 4) : '—'}</td><td>${a.converged ? fmt(a.maxVoltage, 4) : '—'}</td><td>${a.converged ? `${fmt(a.maxCurrent, 1)} А` : '—'}</td><td>${a.maxLoading == null ? '—' : `${fmt(a.maxLoading, 1)} %`}</td><td>${scenario.result?.totals ? fmt(scenario.result.totals.activeLossMW, 4) : '—'}</td><td>${scenario.result?.totals ? fmt(scenario.result.totals.reactiveLossMvar, 4) : '—'}</td><td>${escapeHtml(a.violations?.length ? a.violations.join('; ') : a.converged ? 'Нет' : 'Не сошёлся')}</td></tr>`; }).join('');
    return `<div class="rastr-tab-heading"><div><h2>N−1 анализ</h2><p>Каждая включённая ветвь отключается в отдельной копии network.</p></div><div class="rastr-n1-actions"><button class="primary-button" data-action="run-n1" type="button" ${state.n1Running ? 'disabled' : ''}>Запустить N−1</button>${state.n1Running ? '<button class="rastr-danger-button" data-action="cancel-n1" type="button">Отмена</button>' : ''}<button class="secondary-button" data-action="return-normal" type="button" ${state.normalResult ? '' : 'disabled'}>Нормальный режим</button></div></div>
      ${state.n1Running ? `<div class="rastr-n1-progress"><span>N−1: ${progress.completed} / ${progress.total}</span><i><b style="width:${progress.total ? progress.completed / progress.total * 100 : 0}%"></b></i></div>` : ''}
      ${rows ? `<div class="rastr-table-scroll"><table class="rastr-table"><thead><tr><th>Элемент</th><th>Состояние</th><th>Сходимость</th><th>Min U, pu</th><th>Max U, pu</th><th>Max I</th><th>Max загрузка</th><th>ΔP</th><th>ΔQ</th><th>Нарушения</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="rastr-empty-state"><strong>N−1 ещё не выполнен</strong><span>Результаты не сохраняются в localStorage автоматически.</span></div>'}`;
  }

  function renderScenarioHistoryTab() {
    const rows = [...state.scenarioHistory].reverse().map((scenario) => `<article><div><strong>${escapeHtml(scenario.name)}</strong><span>${new Date(scenario.createdAt).toLocaleString('ru-RU')}</span></div><p>${scenario.outageBranchIds.map((id) => escapeHtml(branchById(id)?.name || id)).join(', ') || 'Без отключений'}</p>${scenario.comment ? `<small>${escapeHtml(scenario.comment)}</small>` : ''}</article>`).join('');
    return `<div class="rastr-tab-heading"><div><h2>История сценариев</h2><p>Хранятся только сценарии, явно сохранённые пользователем.</p></div></div><div class="rastr-scenario-history">${rows || '<p class="rastr-model-note">Сохранённых сценариев пока нет.</p>'}</div>`;
  }

  function regionAggregateLabel(metric, digits = 3) {
    if (!metric || !Number.isFinite(metric.value)) return '—';
    return `${fmt(metric.value, digits)}${metric.incomplete ? ' *' : ''}`;
  }

  function renderRegionForm() {
    const region = regionById(state.editingRegionId) || { id: '', name: '', code: `R${nextNumber(state.regions)}`, parentRegionId: null, description: '' };
    const parentOptions = `<option value="">Нет</option>${state.regions.filter((item) => item.id !== region.id).map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === region.parentRegionId ? 'selected' : ''}>${escapeHtml(item.code)} — ${escapeHtml(item.name)}</option>`).join('')}`;
    return `<form id="rastrRegionForm" class="rastr-region-form" data-region-id="${escapeHtml(region.id)}"><div class="rastr-form-grid"><label><span>Название</span><input name="name" maxlength="100" value="${escapeHtml(region.name)}" placeholder="Южный район" required></label><label><span>Код</span><input name="code" maxlength="30" value="${escapeHtml(region.code)}" placeholder="R2" required></label><label><span>Родительский район</span><select name="parentRegionId">${parentOptions}</select></label><label class="rastr-form-wide"><span>Описание</span><textarea name="description" maxlength="500" rows="3">${escapeHtml(region.description)}</textarea></label></div><div class="rastr-row-actions"><button class="primary-button" type="submit">${region.id ? 'Сохранить' : 'Добавить'}</button><button class="secondary-button" data-action="cancel-region-form" type="button">Отмена</button></div></form>`;
  }

  function renderRegionDetail() {
    const analysis = getRegionAnalysis(); const region = analysis.regions.find((item) => item.id === state.selectedRegionId);
    if (!region) { state.regionView = 'list'; state.selectedRegionId = null; return renderRegionsTab(); }
    const branchRows = (items, boundary = false) => items.map((branch) => {
      const from = nodeById(branch.from); const to = nodeById(branch.to); const result = branchResult(branch.id);
      return `<tr><td>${escapeHtml(branch.name)}</td><td>${escapeHtml(from?.number)} — ${escapeHtml(from?.name)}</td><td>${escapeHtml(to?.number)} — ${escapeHtml(to?.name)}</td><td>${result ? fmt(result.pFromMW, 3) : '—'}</td><td>${result ? fmt(result.qFromMvar, 3) : '—'}</td>${boundary ? `<td>${escapeHtml(regionById((from?.regionId === region.id ? to : from)?.regionId)?.name || 'Без района')}</td>` : ''}</tr>`;
    }).join('');
    return `<div class="rastr-tab-heading"><div><button class="text-button" data-action="back-regions" type="button">← Районы</button><h2>${escapeHtml(region.name)}</h2><p>${escapeHtml(region.code)}${region.description ? ` · ${escapeHtml(region.description)}` : ''}</p></div><button class="secondary-button" data-action="edit-region" data-region-id="${escapeHtml(region.id)}" type="button">Изменить</button></div><div class="rastr-region-summary">${[['Узлов', region.nodes.length], ['Внутренних ветвей', region.internalBranches.length], ['Граничных ветвей', region.boundaryBranches.length], ['Pн, МВт', regionAggregateLabel(region.loadP)], ['Qн, Мвар', regionAggregateLabel(region.loadQ)], ['Pг, МВт', regionAggregateLabel(region.generationP)], ['Qг, Мвар', regionAggregateLabel(region.generationQ)], ['P вход, МВт', fmt(region.pIn, 3)], ['P выход, МВт', fmt(region.pOut, 3)], ['ΔP, МВт', fmt(region.internalLossP, 4)], ['ΔQ, Мвар', fmt(region.internalLossQ, 4)], ['Баланс P, МВт', fmt(region.balanceP, 6)]].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>${analysis.solved ? '' : '<p class="rastr-model-note">Выполните расчёт режима, чтобы увидеть перетоки, потери и баланс.</p>'}<h3 class="rastr-result-title">Узлы района</h3><div class="rastr-region-node-list">${region.nodes.map((node) => `<button class="text-button" data-action="open-region-node" data-node-id="${escapeHtml(node.id)}" type="button">Узел ${escapeHtml(node.number)} — ${escapeHtml(node.name)}</button>`).join('') || '<span>Узлов нет.</span>'}</div><h3 class="rastr-result-title">Внутренние ветви</h3><div class="rastr-table-scroll"><table class="rastr-table"><thead><tr><th>Ветвь</th><th>Начало</th><th>Конец</th><th>Pнач</th><th>Qнач</th></tr></thead><tbody>${branchRows(region.internalBranches) || '<tr><td colspan="5">Нет внутренних ветвей.</td></tr>'}</tbody></table></div><h3 class="rastr-result-title">Граничные ветви</h3><div class="rastr-table-scroll"><table class="rastr-table"><thead><tr><th>Ветвь</th><th>Начало</th><th>Конец</th><th>Pнач</th><th>Qнач</th><th>Смежный район</th></tr></thead><tbody>${branchRows(region.boundaryBranches, true) || '<tr><td colspan="6">Нет граничных ветвей.</td></tr>'}</tbody></table></div>`;
  }

  function renderRegionsTab() {
    if (state.regionView === 'detail') return renderRegionDetail();
    const analysis = getRegionAnalysis();
    const rows = analysis.regions.map((region) => {
      const confirm = state.pendingDelete?.type === 'region' && state.pendingDelete.id === region.id;
      return `<tr data-row-id="${escapeHtml(region.id)}" data-row-type="region"><td>${region.number}</td><td>${escapeHtml(region.name)}</td><td>${escapeHtml(region.code)}</td><td>${escapeHtml(regionById(region.parentRegionId)?.name || '—')}</td><td>${region.nodes.length}</td><td>${regionAggregateLabel(region.loadP)}</td><td>${regionAggregateLabel(region.loadQ)}</td><td>${regionAggregateLabel(region.generationP)}</td><td>${regionAggregateLabel(region.generationQ)}</td><td><div class="rastr-row-actions"><button data-action="open-region" data-region-id="${escapeHtml(region.id)}" type="button">Открыть</button><button data-action="edit-region" data-region-id="${escapeHtml(region.id)}" type="button">Изменить</button>${confirm ? `<div class="rastr-region-delete-confirm"><span>В районе находятся ${region.nodes.length} узл. После удаления они будут переведены в «Без района». Продолжить?</span><button data-action="cancel-delete" type="button">Отмена</button><button class="danger" data-action="confirm-region-delete" data-region-id="${escapeHtml(region.id)}" type="button">Удалить район</button></div>` : `<button class="danger" data-action="request-region-delete" data-region-id="${escapeHtml(region.id)}" type="button">Удалить</button>`}</div></td></tr>`;
    }).join('');
    return `<div class="rastr-tab-heading"><div><h2>🗺 Районы</h2><p>Мощности агрегируются из узлов; звёздочка означает, что часть исходных значений не заполнена.</p></div><button class="secondary-button" data-action="add-region" type="button">+ Добавить район</button></div>${state.regionView === 'form' ? renderRegionForm() : ''}<div class="rastr-table-scroll"><table class="rastr-table rastr-regions-table"><thead><tr><th>№</th><th>Название</th><th>Код</th><th>Родительский район</th><th>Узлов</th><th>Pн, МВт</th><th>Qн, Мвар</th><th>Pг, МВт</th><th>Qг, Мвар</th><th>Действия</th></tr></thead><tbody>${rows || '<tr><td colspan="10" class="rastr-empty-cell">Районов пока нет.</td></tr>'}</tbody></table></div>`;
  }

  function renderRegionsBranchesTab() {
    const analysis = getRegionAnalysis();
    const rows = analysis.interregionalBranches.map(({ branch, fromRegion, toRegion, result, direction }) => `<tr><td>${escapeHtml(branch.name)}</td><td>${escapeHtml(nodeById(branch.from)?.number)}</td><td>${escapeHtml(fromRegion.name)}</td><td>${escapeHtml(nodeById(branch.to)?.number)}</td><td>${escapeHtml(toRegion.name)}</td><td>${result ? fmt(result.pFromMW, 3) : '—'}</td><td>${result ? fmt(result.qFromMvar, 3) : '—'}</td><td>${result ? fmt(result.pToMW, 3) : '—'}</td><td>${result ? fmt(result.qToMvar, 3) : '—'}</td><td>${result ? fmt(result.currentA, 2) : '—'}</td><td>${result ? escapeHtml(direction) : '—'}</td></tr>`).join('');
    const exchanges = analysis.regions.map((region) => `<tr><td>${escapeHtml(region.name)}</td><td>${fmt(region.pIn, 3)}</td><td>${fmt(region.pOut, 3)}</td><td>${fmt(region.qIn, 3)}</td><td>${fmt(region.qOut, 3)}</td><td>${Number.isFinite(region.pIn) ? fmt(region.pIn - region.pOut, 3) : '—'}</td></tr>`).join('');
    return `<div class="rastr-tab-heading"><div><h2>🔗 Районы + Ветви</h2><p>Межрайонная ветвь определяется по regionId её конечных узлов.</p></div></div>${analysis.solved ? '' : '<p class="rastr-model-note">Выполните расчёт режима. До расчёта перетоки и токи не вычисляются.</p>'}<div class="rastr-table-scroll"><table class="rastr-table rastr-region-branches-table"><thead><tr><th>Ветвь</th><th>Начало</th><th>Район начала</th><th>Конец</th><th>Район конца</th><th>Pнач</th><th>Qнач</th><th>Pкон</th><th>Qкон</th><th>I, А</th><th>Направление P</th></tr></thead><tbody>${rows || '<tr><td colspan="11" class="rastr-empty-cell">Межрайонных ветвей нет.</td></tr>'}</tbody></table></div><h3 class="rastr-result-title">Суммарный внешний обмен</h3><div class="rastr-table-scroll"><table class="rastr-table"><thead><tr><th>Район</th><th>P вход</th><th>P выход</th><th>Q вход</th><th>Q выход</th><th>Итог P (вход − выход)</th></tr></thead><tbody>${exchanges || '<tr><td colspan="6">Районов нет.</td></tr>'}</tbody></table></div>`;
  }

  function renderRegionsLossesTab(reactive = false) {
    const analysis = getRegionAnalysis(); const symbol = reactive ? 'Q' : 'P'; const unit = reactive ? 'Мвар' : 'МВт';
    const rows = analysis.regions.map((region) => `<tr><td>${escapeHtml(region.name)}</td><td>${regionAggregateLabel(reactive ? region.generationQ : region.generationP)}</td><td>${regionAggregateLabel(reactive ? region.loadQ : region.loadP)}</td><td>${fmt(reactive ? region.qIn : region.pIn, 3)}</td><td>${fmt(reactive ? region.qOut : region.pOut, 3)}</td><td>${fmt(reactive ? region.internalLossQ : region.internalLossP, 4)}</td><td>${fmt(reactive ? region.balanceQ : region.balanceP, 6)}</td></tr>`).join('');
    const interregional = analysis.interregionalBranches.map(({ branch, fromRegion, toRegion, result }) => `<tr><td>${escapeHtml(fromRegion.name)} ↔ ${escapeHtml(toRegion.name)}</td><td>${escapeHtml(branch.name)}</td><td>${result ? fmt(reactive ? result.reactiveLossMvar : result.activeLossMW, 4) : '—'}</td></tr>`).join('');
    return `<div class="rastr-tab-heading"><div><h2>📉 Районы + Потери ${reactive ? 'Q' : ''}</h2><p>Внутренние потери относятся к району; потери межрайонных ветвей показаны отдельно и не делятся произвольно.</p></div></div>${analysis.solved ? '' : '<p class="rastr-model-note">Выполните расчёт режима, чтобы получить потери и баланс.</p>'}<div class="rastr-table-scroll"><table class="rastr-table"><thead><tr><th>Район</th><th>${symbol}г</th><th>${symbol}н</th><th>${symbol} вход</th><th>${symbol} выход</th><th>Δ${symbol} внутренних ветвей</th><th>Баланс ${symbol}, ${unit}</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="rastr-empty-cell">Районов нет.</td></tr>'}</tbody></table></div><h3 class="rastr-result-title">Межрайонные Δ${symbol}</h3><div class="rastr-table-scroll"><table class="rastr-table"><thead><tr><th>Районы</th><th>Ветвь</th><th>Δ${symbol}, ${unit}</th></tr></thead><tbody>${interregional || '<tr><td colspan="3">Межрайонных ветвей нет.</td></tr>'}</tbody></table></div>`;
  }

  function renderGraphicsTab() {
    const limits = state.settings.voltageLimits;
    return `<div class="rastr-settings-grid"><section><h2>Пользовательские границы напряжения</h2><p>Значения не являются универсальными нормативами.</p><div class="rastr-threshold-grid"><label>Umin, pu${numberInput(limits.uMinPU, 'min="0.1" max="2" data-voltage-limit="uMinPU"')}</label><label>Umax, pu${numberInput(limits.uMaxPU, 'min="0.1" max="2" data-voltage-limit="uMaxPU"')}</label></div></section><section><h2>Модель расчёта</h2><p>AC power flow: Ybus и Newton–Raphson в относительных единицах. Поддерживаются Slack, PV и PQ узлы, радиальные и замкнутые сети.</p><p>Генератор с Qг=Авто работает как PV; с ручным Qг — как PQ. Для PV контролируются Qmin/Qmax с переключением в PQ. Трансформаторы учитывают off-nominal tap и фазовый сдвиг на стороне начального узла.</p></section></div>`;
  }

  function renderInspector() {
    if (!state.selection) return '<div class="rastr-inspector-empty">Нажмите узел или ветвь на схеме.</div>';
    if (state.selection.type === 'node') {
      const node = nodeById(state.selection.id); const result = node && nodeResult(node.id);
      if (!node) return '';
      const sourceP = node.generationPMode === 'auto' ? 'Авто' : node.generationP_MW === null ? '—' : `${node.generationP_MW} МВт`;
      const sourceQ = node.generationQMode === 'auto' ? 'Авто' : node.generationQ_Mvar === null ? '—' : `${node.generationQ_Mvar} Мвар`;
      return `<div class="rastr-inspector-head"><span>Узел</span><strong>${node.number}</strong></div><dl>${[['Название', node.name], ['Тип', NODE_TYPES[node.type]], ['Режим solver', result?.busMode || '—'], ['Uном', `${node.nominalKV} кВ`], ['Uрасч', result ? `${fmt(result.voltageKV, 3)} кВ` : '—'], ['δ', result ? `${fmt(result.angleDeg, 3)}°` : '—'], ['Pн', node.loadMW === null ? '—' : `${node.loadMW} МВт`], ['Qн', node.loadMvar === null ? '—' : `${node.loadMvar} Мвар`], ['Pг, исходное', sourceP], ['Qг, исходное', sourceQ], ['Pг, расчётное', result ? `${fmt(result.calculatedGenerationP_MW, 3)} МВт` : '—'], ['Qг, расчётное', result ? `${fmt(result.calculatedGenerationQ_Mvar, 3)} Мвар` : '—']].map(([key, value]) => `<div><dt>${key}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl><button class="secondary-button" data-action="edit-selection" type="button">Редактировать</button>`;
    }
    const branch = branchById(state.selection.id); const result = branch && branchResult(branch.id);
    if (!branch) return '';
    const ratioWarning = transformerRatioWarning(branch);
    const rows = [['Тип', BRANCH_TYPES[branch.type]], ['R', `${branch.rOhm} Ом`], ['X', `${branch.xOhm} Ом`], ['B', `${branch.bMicroS} мкСм`], ['Kт', branch.ratio], ['Фазовый сдвиг', `${branch.phaseShiftDeg} °`], ['Pнач', result ? `${fmt(result.pFromMW, 3)} МВт` : '—'], ['Qнач', result ? `${fmt(result.qFromMvar, 3)} Мвар` : '—'], ['Pкон', result ? `${fmt(result.pToMW, 3)} МВт` : '—'], ['Qкон', result ? `${fmt(result.qToMvar, 3)} Мвар` : '—'], ['Iнач', result ? `${fmt(result.currentFromA ?? result.currentA, 2)} А` : '—'], ['Iкон', result ? `${fmt(result.currentToA ?? result.currentA, 2)} А` : '—'], [`Imax ${branchSideName(branch, 'from')}`, branch.iMaxFromA == null ? '—' : `${fmt(branch.iMaxFromA, 2)} А`], [`Imax ${branchSideName(branch, 'to')}`, branch.iMaxToA == null ? '—' : `${fmt(branch.iMaxToA, 2)} А`], [`Загрузка ${branchSideName(branch, 'from')}`, result?.loadingFromPercent == null ? '—' : `${fmt(result.loadingFromPercent, 1)} %`], [`Загрузка ${branchSideName(branch, 'to')}`, result?.loadingToPercent == null ? '—' : `${fmt(result.loadingToPercent, 1)} %`], ['ΔP', result ? `${fmt(result.activeLossMW, 4)} МВт` : '—'], ['ΔQ', result ? `${fmt(result.reactiveLossMvar, 4)} Мвар` : '—']];
    return `<div class="rastr-inspector-head"><span>Ветвь</span><strong>${escapeHtml(nodeById(branch.from)?.number)} → ${escapeHtml(nodeById(branch.to)?.number)}</strong></div><h3>${escapeHtml(branch.name)}</h3>${ratioWarning ? `<p class="rastr-inspector-warning">${escapeHtml(ratioWarning.message)}</p>` : ''}<dl>${rows.map(([key, value]) => `<div><dt>${key}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl><button class="secondary-button" data-action="edit-selection" type="button">Редактировать</button>`;
  }

  function renderTabContent() {
    const renderers = {
      nodes: renderNodesTab,
      branches: renderBranchesTab,
      flows: renderFlowsTab,
      losses: renderLossesTab,
      balance: renderBalanceTab,
      results: renderResultsTab,
      graphics: renderGraphicsTab,
      'data-control': renderDataControlTab,
      'voltage-control': renderVoltageControlTab,
      'loading-control': renderLoadingControlTab,
      monitored: renderMonitoredTab,
      regions: renderRegionsTab,
      'regions-branches': renderRegionsBranchesTab,
      'regions-losses': () => renderRegionsLossesTab(false),
      'regions-losses-q': () => renderRegionsLossesTab(true),
      contingency: renderContingencyTab,
      comparison: renderComparisonTab,
      'n-1': renderN1Tab,
      'scenario-history': renderScenarioHistoryTab
    };
    return (renderers[state.tab] || renderNodesTab)();
  }

  function renderRastrNavigation() {
    const groups = RASTR_NAVIGATION.map((group) => `<section class="rastr-nav-group">
      <h2>${escapeHtml(group.title)}</h2>
      <div class="rastr-nav-list">${group.items.map((item) => {
        const active = item.tab && item.tab === state.tab;
        const attributes = item.tab ? `data-tab="${escapeHtml(item.tab)}"` : item.command ? `data-command="${escapeHtml(item.command)}"` : '';
        return `<button class="rastr-nav-item ${active ? 'active' : ''} ${item.planned ? 'is-planned' : ''}" data-action="rastr-nav" ${attributes} type="button" ${item.planned ? 'disabled aria-disabled="true" title="Функция ещё не поддерживается расчётным ядром"' : ''}>
          <span class="rastr-nav-icon" aria-hidden="true">${escapeHtml(item.icon || '·')}</span><span class="rastr-nav-label">${escapeHtml(item.label)}</span>${item.planned ? '<small>В развитии</small>' : ''}
        </button>`;
      }).join('')}</div>
    </section>`).join('');
    return `<aside class="rastr-sidebar ${state.menuOpen ? 'is-open' : ''}" aria-label="Разделы Rastr Mode">
      <div class="rastr-sidebar-brand"><span aria-hidden="true">⚡</span><div><strong>RASTR MODE</strong><small>Редактор сети</small></div></div>
      ${groups}
    </aside>`;
  }

  function renderGraphRegionControls() {
    const options = `<option value="">Все районы</option>${state.regions.map((region) => `<option value="${escapeHtml(region.id)}" ${state.regionDisplay.filterRegionId === region.id ? 'selected' : ''}>${escapeHtml(region.code)} — ${escapeHtml(region.name)}</option>`).join('')}`;
    return `<div class="rastr-region-graph-controls"><label><input type="checkbox" data-region-display="true" ${state.regionDisplay.show ? 'checked' : ''}> Показывать районы</label><label><span>Район</span><select data-region-filter="true">${options}</select></label></div>`;
  }

  function renderGraphDisplayPanel() {
    const controls = [
      ['voltage', 'U'], ['angle', 'δ'], ['flows', 'P/Q перетоки'], ['bothEnds', 'Оба конца'],
      ['current', 'Ток'], ['losses', 'Потери'], ['loading', 'Загрузка'], ['loads', 'Нагрузки'],
      ['generation', 'Генерация'], ['equipment', 'R/X/B/Kт/Imax']
    ];
    const warnings = getTransformerRatioWarnings();
    return `<div class="rastr-graph-display-panel"><strong>Показывать</strong><div class="rastr-graph-display-options">${controls.map(([key, label]) => `<label><input type="checkbox" data-graph-display="${key}" ${state.graphDisplay[key] ? 'checked' : ''}>${label}</label>`).join('')}</div>${warnings.length ? `<div class="rastr-transformer-warning" role="status"><b>⚠ Несогласованный Kт</b>${warnings.map((warning) => `<span>${escapeHtml(warning.message)}</span>`).join('')}</div>` : ''}</div>`;
  }

  function render() {
    root.classList.toggle('rastr-graph-fullscreen-active', state.graphFullscreen);
    root.innerHTML = `<a class="breadcrumb" href="../index.html">← Все расчёты</a>
      <button class="rastr-menu-toggle secondary-button" data-action="toggle-rastr-menu" type="button" aria-expanded="${state.menuOpen}">☰ Разделы Rastr Mode</button>
      <div class="rastr-app-layout">${renderRastrNavigation()}<div class="rastr-main-area">
      <div class="rastr-header"><div><p class="rastr-kicker">RASTR MODE</p><h1>Расчёт режима электрической сети</h1><p>Визуальный редактор узлов, ветвей и режимных параметров.</p></div></div>
      <section class="rastr-toolbar panel"><div class="rastr-toolbar-main"><button class="secondary-button" data-action="add-node" type="button">+ Узел</button><button class="secondary-button" data-action="add-branch" type="button" ${state.nodes.length < 2 ? 'disabled' : ''}>+ Ветвь</button><button class="primary-button" data-action="calculate" type="button">Рассчитать</button><button class="secondary-button" data-action="save" type="button">Сохранить схему</button></div><div class="rastr-toolbar-secondary"><button class="secondary-button" data-action="load-example" type="button">${state.pendingDelete?.type === 'example' ? 'Подтвердить пример' : 'Загрузить пример'}</button><button class="secondary-button" data-action="export" type="button">Экспорт JSON</button><button class="secondary-button" data-action="import" type="button">Импорт JSON</button><button class="rastr-danger-button" data-action="reset" type="button">${state.pendingDelete?.type === 'reset' ? 'Подтвердить сброс' : 'Сброс'}</button></div><input id="rastrImport" type="file" accept="application/json,.json" hidden></section>
      <p class="rastr-message" id="rastrMessage" data-type="info" aria-live="polite">${state.dirty ? 'Есть несохранённые изменения.' : 'Данные схемы готовы.'}</p>
      <section class="rastr-diagram-panel panel ${state.graphFullscreen ? 'is-fullscreen' : ''}"><div class="rastr-diagram-heading"><label><span>Графическая схема</span><input class="rastr-project-name" id="rastrProjectName" maxlength="120" value="${escapeHtml(state.name)}" aria-label="Название схемы"></label>${renderGraphRegionControls()}<div class="rastr-mode-switch"><button data-action="view-input" class="${state.viewMode === 'input' ? 'active' : ''}" type="button">Исходные данные</button><button data-action="view-results" class="${state.viewMode === 'results' ? 'active' : ''}" type="button">Результаты режима</button></div></div>${renderGraphDisplayPanel()}
        <div class="rastr-diagram-layout"><div class="rastr-canvas-wrap"><div class="rastr-zoom-controls"><button data-action="zoom-in" title="Увеличить" type="button">+</button><button data-action="zoom-out" title="Уменьшить" type="button">−</button><button data-action="zoom-100" type="button">100%</button><button data-action="fit" type="button">По размеру</button><button data-action="toggle-graph-fullscreen" type="button">${state.graphFullscreen ? 'Закрыть экран' : 'На весь экран'}</button><span>${Math.round(state.viewport.zoom * 100)}%</span></div><div id="rastrGraph" class="rastr-graph"></div><p class="rastr-graph-help">Перетаскивайте узлы. Для pan тяните свободное место; колесо изменяет масштаб.</p></div><aside class="rastr-inspector">${renderInspector()}</aside></div>
      </section>
      <section class="rastr-data-panel panel"><div class="rastr-tabs" role="tablist">${[['nodes', 'Узлы'], ['branches', 'Ветви'], ['results', 'Результаты'], ['losses', 'Потери'], ['graphics', 'Графика']].map(([id, label]) => `<button class="${state.tab === id ? 'active' : ''}" data-action="tab" data-tab="${id}" type="button" role="tab" aria-selected="${state.tab === id}">${label}</button>`).join('')}</div><div class="rastr-tab-content">${renderTabContent()}</div></section>
      <section class="rastr-model-summary"><div><strong>Rastr Mode — система расчёта и анализа режимов электрических сетей.</strong><span>Расчётное ядро находится в развитии.</span></div><button class="secondary-button" data-action="toggle-model-info" type="button" aria-expanded="${state.modelInfoOpen}">ⓘ О модели</button></section>
      ${state.modelInfoOpen ? `<section class="rastr-model-details panel" aria-label="Возможности расчётной модели"><div class="rastr-model-details-head"><div><p class="rastr-kicker">Текущая версия</p><h2>Возможности расчётной модели</h2></div><button class="text-button" data-action="toggle-model-info" type="button">Закрыть</button></div><dl class="rastr-model-capabilities"><div><dt>Типы сетей</dt><dd>Связные радиальные и замкнутые AC-сети с одним Slack-узлом.</dd></div><div><dt>Типы узлов</dt><dd>Slack, PQ и PV. Генератор с Qг=Авто рассчитывается как PV, с ручным Qг — как PQ; для PV поддержаны Qmin/Qmax с переключением в PQ.</dd></div><div><dt>Метод</dt><dd>Ybus и Newton–Raphson в per-unit. Сохраняются iterations, maxMismatch и diagnostics.</dd></div><div><dt>Трансформаторы</dt><dd>Поддержаны R, X, B и фиксированный Kт. РПН, фазовый сдвиг и группы соединений не моделируются.</dd></div><div><dt>Замкнутые сети</dt><dd>Поддержаны. При отключении ветви до расчёта выполняется проверка островов.</dd></div><div><dt>Ограничения</dt><dd>Нет РПН, фазосдвига и раздельного расчёта островов с несколькими Slack-узлами.</dd></div></dl></section>` : ''}</div></div>`;
    renderGraph();
  }

  function renderGraph() {
    const container = $('#rastrGraph', root);
    if (!container) return;
    const displayedOutageId = state.results === state.normalResult ? null : state.activeOutageId;
    const graphState = {
      ...state,
      calculationFailed: state.viewMode === 'results' && !state.results && Boolean(state.normalResult || state.contingencyResult),
      branches: state.branches.map((branch) => ({ ...branch, ratioWarning: transformerRatioWarning(branch), enabled: branch.enabled !== false && branch.id !== displayedOutageId }))
    };
    global.RastrGraph.render(container, graphState, {
      onSelect(type, id) { state.selection = { type, id }; state.pendingDelete = null; render(); },
      onNodeMove(id, x, y, commit) {
        const node = nodeById(id); if (!node) return;
        node.x = Math.max(55, Math.min(global.RastrGraph.WIDTH - 55, x)); node.y = Math.max(55, Math.min(global.RastrGraph.HEIGHT - 85, y)); node.manualPosition = true; state.dirty = true;
        if (commit) saveProject('Координаты узла сохранены.');
      },
      onPan(x, y, commit) { state.viewport.panX = x; state.viewport.panY = y; state.dirty = true; if (commit) saveProject('Положение рабочего поля сохранено.'); },
      onZoom(delta) { state.viewport.zoom = Math.min(2.2, Math.max(0.45, state.viewport.zoom + delta)); state.dirty = true; render(); }
    });
  }

  function nextNumber(collection) { return collection.reduce((max, item) => Math.max(max, item.number), 0) + 1; }

  function saveRegionForm(form) {
    const data = new FormData(form); const id = form.dataset.regionId || '';
    const name = String(data.get('name') || '').trim().slice(0, 100); const code = String(data.get('code') || '').trim().slice(0, 30);
    const parentRegionId = regionById(String(data.get('parentRegionId') || ''))?.id || null; const description = String(data.get('description') || '').trim().slice(0, 500);
    if (!name || !code) { showMessage('Заполните название и уникальный код района.', 'error'); return; }
    if (state.regions.some((region) => region.id !== id && region.code.toLowerCase() === code.toLowerCase())) { showMessage(`Код ${code} уже используется.`, 'error'); return; }
    let cursor = parentRegionId;
    while (cursor) {
      if (cursor === id) { showMessage('Нельзя создать циклическую иерархию районов.', 'error'); return; }
      cursor = regionById(cursor)?.parentRegionId || null;
    }
    const existing = regionById(id);
    if (existing) Object.assign(existing, { name, code, parentRegionId, description });
    else state.regions.push({ id: uid('region'), number: nextNumber(state.regions), name, code, parentRegionId, description });
    state.regionView = 'list'; state.editingRegionId = null; state.pendingDelete = null; persistProjectSilently(); render();
    showMessage(existing ? `Район ${code} обновлён.` : `Район ${code} добавлен.`, 'success');
  }

  function removeRegion(regionId) {
    const region = regionById(regionId); if (!region) return;
    state.nodes.forEach((node) => { if (node.regionId === regionId) node.regionId = null; });
    state.regions.forEach((item) => { if (item.parentRegionId === regionId) item.parentRegionId = null; });
    state.regions = state.regions.filter((item) => item.id !== regionId);
    state.regions.forEach((item, index) => { item.number = index + 1; });
    if (state.regionDisplay.filterRegionId === regionId) state.regionDisplay.filterRegionId = null;
    state.selectedRegionId = null; state.editingRegionId = null; state.regionView = 'list'; state.pendingDelete = null;
    persistProjectSilently(); render(); showMessage(`Район ${region.code} удалён. Узлы переведены в «Без района».`, 'success');
  }

  function addNode() {
    const number = nextNumber(state.nodes);
    const node = { id: uid('node'), number, type: state.nodes.length ? 'load' : 'slack', name: state.nodes.length ? `Узел ${number}` : 'Базовый узел', regionId: null, nominalKV: 110, loadMW: null, loadMvar: null, generationPMode: 'manual', generationQMode: 'manual', generationP_MW: null, generationQ_Mvar: null, calculatedGenerationP_MW: null, calculatedGenerationQ_Mvar: null, setVoltageKV: state.nodes.length ? null : 110, setAngleDeg: 0, qMinMvar: null, qMaxMvar: null, x: null, y: null, manualPosition: false };
    state.nodes.push(node); invalidate(); reflowAutomaticNodes(); state.selection = { type: 'node', id: node.id }; state.tab = 'nodes'; persistProjectSilently(); render();
  }

  function addBranch() {
    if (state.nodes.length < 2) { showMessage('Сначала добавьте два узла.', 'error'); return; }
    const number = nextNumber(state.branches);
    const branch = { id: uid('branch'), number, from: state.nodes[0].id, to: state.nodes[1].id, type: 'line', name: `Ветвь ${number}`, rOhm: 0, xOhm: 0, bMicroS: 0, ratio: 1, phaseShiftDeg: 0, iMaxA: null, iMaxFromA: null, iMaxToA: null, enabled: true };
    state.branches.push(branch); invalidate(); reflowAutomaticNodes(); state.selection = { type: 'branch', id: branch.id }; state.tab = 'branches'; render();
  }

  function updateNode(input) {
    const row = input.closest('[data-row-id]'); const node = nodeById(row?.dataset.rowId); const field = input.dataset.nodeField;
    if (!node || !field) return;
    if (field === 'number') {
      const number = Math.trunc(Number(input.value));
      if (!Number.isInteger(number) || number < 1 || state.nodes.some((item) => item.id !== node.id && item.number === number)) { input.value = node.number; showMessage('Номер узла должен быть уникальным целым числом.', 'error'); return; }
      node.number = number;
    } else if (field === 'type') node.type = NODE_TYPES[input.value] ? input.value : node.type;
    else if (field === 'name') node.name = input.value.trim().slice(0, 80) || node.name;
    else {
      const nullable = ['loadMW', 'loadMvar', 'generationP_MW', 'generationQ_Mvar', 'setVoltageKV', 'qMinMvar', 'qMaxMvar'].includes(field);
      const value = optional(input.value);
      const nonNegative = ['loadMW', 'loadMvar', 'generationP_MW'].includes(field);
      if ((value !== null && !Number.isFinite(value)) || (!nullable && !Number.isFinite(value)) || (['nominalKV', 'setVoltageKV'].includes(field) && value !== null && value <= 0) || (nonNegative && value !== null && value < 0)) { input.value = node[field] ?? ''; showMessage('Проверьте значение: пустое поле сохраняется как null, введённое значение должно быть конечным числом.', 'error'); return; }
      if ((field === 'qMinMvar' && value !== null && node.qMaxMvar !== null && value > node.qMaxMvar) || (field === 'qMaxMvar' && value !== null && node.qMinMvar !== null && value < node.qMinMvar)) { input.value = node[field] ?? ''; showMessage('Должно выполняться Qmin ≤ Qmax.', 'error'); return; }
      node[field] = value;
    }
    invalidate(); reflowAutomaticNodes(); persistProjectSilently(); render();
  }

  function updateBranch(input) {
    const row = input.closest('[data-row-id]'); const branch = branchById(row?.dataset.rowId); const field = input.dataset.branchField;
    if (!branch || !field) return;
    if (field === 'enabled') branch.enabled = input.checked;
    else if (field === 'from' || field === 'to') {
      if (!nodeById(input.value) || (field === 'from' ? input.value === branch.to : input.value === branch.from)) { input.value = branch[field]; showMessage('Ветвь должна соединять два разных существующих узла.', 'error'); return; }
      branch[field] = input.value;
    } else if (field === 'type') branch.type = BRANCH_TYPES[input.value] ? input.value : branch.type;
    else if (field === 'name') branch.name = input.value.trim().slice(0, 80) || branch.name;
    else if (field === 'number') {
      const value = Math.trunc(Number(input.value)); if (!Number.isInteger(value) || value < 1) { input.value = branch.number; return; } branch.number = value;
    } else {
      const value = optional(input.value); const nullable = ['iMaxA', 'iMaxFromA', 'iMaxToA'].includes(field);
      const valid = field === 'phaseShiftDeg'
        ? Number.isFinite(value) && value >= -360 && value <= 360
        : ['rOhm', 'xOhm', 'bMicroS', 'iMaxA', 'iMaxFromA', 'iMaxToA'].includes(field) ? value !== null && value >= 0 : value !== null && value > 0;
      if ((!nullable && !Number.isFinite(value)) || (value !== null && (!Number.isFinite(value) || !valid))) { input.value = branch[field] ?? ''; showMessage('Проверьте параметр ветви: числа должны быть конечными, угол — от −360° до 360°.', 'error'); return; }
      branch[field] = value;
      if (field === 'iMaxFromA' || field === 'iMaxToA') branch.iMaxA = branch.type === 'line' && branch.iMaxFromA === branch.iMaxToA ? branch.iMaxFromA : null;
    }
    invalidate(); reflowAutomaticNodes(); render();
  }

  function removeSelection(type, id) {
    if (type === 'node') {
      state.nodes = state.nodes.filter((item) => item.id !== id);
      state.branches = state.branches.filter((item) => item.from !== id && item.to !== id);
    } else state.branches = state.branches.filter((item) => item.id !== id);
    state.selection = null; state.pendingDelete = null; invalidate(); reflowAutomaticNodes(); render();
  }

  function calculate() {
    try {
      const result = solveNetwork();
      syncCalculatedGenerations(result); persistProjectSilently();
      state.normalResult = result; state.contingencyResult = null; state.activeOutageId = null; state.selectedN1Id = null;
      state.results = result.converged ? result : null; state.viewMode = 'results'; state.tab = 'results'; state.pendingDelete = null; render();
      const ratioWarnings = getTransformerRatioWarnings();
      showMessage(result.converged ? `Режим сошёлся за ${result.iterations} итераций. SVG и таблицы используют один результат.${ratioWarnings.length ? ` Предупреждений Kт: ${ratioWarnings.length}.` : ''}` : result.diagnostics?.messages?.join(' ') || 'Режим не сошёлся.', result.converged ? (ratioWarnings.length ? 'info' : 'success') : 'error');
    } catch (error) { state.results = null; state.normalResult = null; state.viewMode = 'input'; render(); showMessage(error.message || 'Не удалось рассчитать режим.', 'error'); }
  }

  function getOrCalculateNormalResult() {
    if (state.normalResult?.converged) return state.normalResult;
    const result = solveNetwork(); syncCalculatedGenerations(result); persistProjectSilently(); state.normalResult = result; return result;
  }

  function runContingency() {
    const branchId = $('#rastrContingencyBranch', root)?.value;
    if (!branchById(branchId)) { showMessage('Выберите ветвь для отключения.', 'error'); return; }
    try {
      const normal = getOrCalculateNormalResult();
      if (!normal.converged) { render(); showMessage('Нормальный режим не сошёлся. Сравнение невозможно.', 'error'); return; }
      const contingency = solveNetwork([branchId]);
      state.contingencyResult = contingency; state.activeOutageId = branchId; state.selectedN1Id = null;
      state.results = contingency.converged ? contingency : null; state.viewMode = 'results'; state.tab = 'contingency'; render();
      showMessage(contingency.converged ? `Аварийный режим: ${branchById(branchId).name} отключена.` : contingency.diagnostics?.messages?.join(' ') || 'Аварийный режим не сошёлся.', contingency.converged ? 'success' : 'error');
    } catch (error) { showMessage(error.message || 'Ошибка аварийного расчёта.', 'error'); }
  }

  function returnToNormalMode() {
    state.selectedN1Id = null; state.results = state.normalResult?.converged ? state.normalResult : null;
    state.viewMode = state.normalResult ? 'results' : 'input'; render();
    showMessage(state.results ? 'Восстановлено отображение нормального режима.' : 'Нормальный режим ещё не рассчитан.', state.results ? 'success' : 'info');
  }

  function showContingencyMode() {
    if (!state.contingencyResult) { showMessage('Аварийный режим ещё не рассчитан.', 'info'); return; }
    state.results = state.contingencyResult.converged ? state.contingencyResult : null;
    state.viewMode = 'results'; render();
    showMessage(state.results ? 'Показан аварийный режим.' : 'Аварийный режим не сошёлся.', state.results ? 'success' : 'error');
  }

  function sortN1Scenarios() {
    state.n1Scenarios.sort((a, b) => a.analysis.severity - b.analysis.severity || (b.analysis.maxLoading || 0) - (a.analysis.maxLoading || 0));
  }

  function runN1Analysis() {
    if (state.n1Running) return;
    let normal;
    try { normal = getOrCalculateNormalResult(); } catch (error) { showMessage(error.message, 'error'); return; }
    if (!normal.converged) { render(); showMessage('Нормальный режим не сошёлся. N−1 не запущен.', 'error'); return; }
    const candidates = state.branches.filter((branch) => branch.enabled !== false);
    state.n1Scenarios = []; state.n1Running = true; state.n1CancelRequested = false; state.n1Progress = { completed: 0, total: candidates.length }; state.tab = 'n-1'; render();
    let index = 0;
    const step = () => {
      if (state.n1CancelRequested || index >= candidates.length) {
        state.n1Running = false; sortN1Scenarios(); render();
        showMessage(state.n1CancelRequested ? `N−1 остановлен: ${state.n1Progress.completed} / ${state.n1Progress.total}.` : `N−1 завершён: ${state.n1Progress.completed} сценариев.`, state.n1CancelRequested ? 'info' : 'success');
        return;
      }
      const branch = candidates[index]; const result = solveNetwork([branch.id]); const analysis = analyzeModeResult(result);
      state.n1Scenarios.push({ id: `n1_${branch.id}`, branchId: branch.id, branchName: branch.name, result, analysis });
      index += 1; state.n1Progress.completed = index; render(); global.setTimeout(step, 0);
    };
    global.setTimeout(step, 0);
  }

  function selectN1Scenario(id) {
    const scenario = state.n1Scenarios.find((item) => item.id === id); if (!scenario) return;
    state.selectedN1Id = id; state.activeOutageId = scenario.branchId; state.contingencyResult = scenario.result;
    state.results = scenario.result.converged ? scenario.result : null; state.viewMode = 'results'; render();
  }

  function saveCurrentScenario() {
    if (!state.contingencyResult || !state.activeOutageId) return;
    const name = $('#rastrScenarioName', root)?.value.trim() || 'Аварийный сценарий'; const comment = $('#rastrScenarioComment', root)?.value.trim() || '';
    state.scenarioHistory.push({ id: uid('scenario'), name: name.slice(0, 120), createdAt: new Date().toISOString(), outageBranchIds: [state.activeOutageId], comment: comment.slice(0, 500) });
    if (state.scenarioHistory.length > 50) state.scenarioHistory = state.scenarioHistory.slice(-50);
    saveProject('Сценарий сохранён.'); render(); showMessage('Сценарий сохранён в localStorage.', 'success');
  }

  function exportProject() {
    const payload = JSON.stringify(serializeProject(), null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `smart-energy-rastr-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
    showMessage('Схема экспортирована в JSON.', 'success');
  }

  async function importProject(file) {
    try {
      if (!file || file.size > 2_000_000) throw new Error('Выберите JSON-файл размером до 2 МБ.');
      if (file.type && !['application/json', 'text/json', 'text/plain'].includes(file.type) && !/\.json$/i.test(file.name || '')) throw new Error('Выбранный файл не является JSON-проектом.');
      const parsed = JSON.parse(await file.text());
      const project = sanitizeProject(parsed);
      const report = validateImportedProject(project);
      if (state.dirty && !global.confirm('Импорт заменит текущие несохранённые изменения. Продолжить?')) return;
      applyProject(project);
      render();
      showMessage(`Схема проверена и импортирована в память. Предупреждений: ${report.warnings.length}. Нажмите «Сохранить схему» после проверки.`, 'success');
    } catch (error) { showMessage(error.message || 'Неверный JSON-файл.', 'error'); }
  }

  function focusNetworkItems(command) {
    const config = {
      'focus-transformers': { tab: 'branches', type: 'branch', item: state.branches.find((branch) => branch.type === 'transformer'), empty: 'В схеме пока нет трансформаторов.' },
      'focus-generators': { tab: 'nodes', type: 'node', item: state.nodes.find((node) => node.type === 'generator' || node.type === 'slack'), empty: 'В схеме пока нет генераторных или базовых узлов.' },
      'focus-loads': { tab: 'nodes', type: 'node', item: state.nodes.find((node) => node.type === 'load'), empty: 'В схеме пока нет нагрузочных узлов.' }
    }[command];
    if (!config) return;
    state.tab = config.tab;
    state.selection = config.item ? { type: config.type, id: config.item.id } : null;
    state.menuOpen = false;
    render();
    if (!config.item) showMessage(config.empty, 'info');
  }

  function handleRastrNavigation(button) {
    state.pendingDelete = null;
    state.menuOpen = false;
    if (button.dataset.tab) {
      state.tab = button.dataset.tab;
      render();
      return;
    }
    const command = button.dataset.command;
    if (command === 'calculate') { calculate(); return; }
    if (command === 'import') { render(); $('#rastrImport', root)?.click(); return; }
    if (command === 'export') { render(); exportProject(); return; }
    if (command?.startsWith('focus-')) focusNetworkItems(command);
  }

  function handleClick(event) {
    const button = event.target.closest('[data-action]');
    const row = event.target.closest('[data-row-id]');
    if (!button) {
      if (row && ['node', 'branch'].includes(row.dataset.rowType) && !event.target.matches('input, select')) { state.selection = { type: row.dataset.rowType, id: row.dataset.rowId }; render(); }
      return;
    }
    const action = button.dataset.action;
    if (action === 'add-region') { state.regionView = 'form'; state.editingRegionId = null; state.pendingDelete = null; render(); return; }
    if (action === 'cancel-region-form' || action === 'back-regions') { state.regionView = 'list'; state.editingRegionId = null; state.selectedRegionId = null; state.pendingDelete = null; render(); return; }
    if (action === 'edit-region') { state.regionView = 'form'; state.editingRegionId = button.dataset.regionId; state.selectedRegionId = null; state.pendingDelete = null; render(); return; }
    if (action === 'open-region') { state.regionView = 'detail'; state.selectedRegionId = button.dataset.regionId; state.pendingDelete = null; render(); return; }
    if (action === 'request-region-delete') { state.pendingDelete = { type: 'region', id: button.dataset.regionId }; render(); return; }
    if (action === 'confirm-region-delete') { removeRegion(button.dataset.regionId); return; }
    if (action === 'open-region-node') { state.selection = { type: 'node', id: button.dataset.nodeId }; state.tab = 'nodes'; state.regionView = 'list'; render(); return; }
    if (action === 'toggle-rastr-menu') { state.menuOpen = !state.menuOpen; render(); return; }
    if (action === 'rastr-nav') { handleRastrNavigation(button); return; }
    if (action === 'run-contingency') { runContingency(); return; }
    if (action === 'return-normal') { returnToNormalMode(); return; }
    if (action === 'show-contingency') { showContingencyMode(); return; }
    if (action === 'run-n1') { runN1Analysis(); return; }
    if (action === 'cancel-n1') { state.n1CancelRequested = true; showMessage('Отмена N−1 будет выполнена после текущего сценария.', 'info'); return; }
    if (action === 'select-n1') { selectN1Scenario(button.dataset.scenarioId); return; }
    if (action === 'save-scenario') { saveCurrentScenario(); return; }
    if (action === 'add-node') addNode();
    if (action === 'add-branch') addBranch();
    if (action === 'calculate') calculate();
    if (action === 'save') saveProject();
    if (action === 'load-example') {
      if (state.pendingDelete?.type === 'example') { applyProject(exampleProject(), true); render(); }
      else { state.pendingDelete = { type: 'example' }; render(); showMessage('Учебный пример заменит текущую схему. Нажмите ещё раз для подтверждения.', 'error'); }
    }
    if (action === 'export') exportProject();
    if (action === 'import') $('#rastrImport', root)?.click();
    if (action === 'reset') {
      if (state.pendingDelete?.type === 'reset') { applyProject(sanitizeProject({ name: 'Новая сеть', nodes: [], branches: [], settings: { thresholds: DEFAULT_THRESHOLDS } })); saveProject('Схема очищена.'); render(); }
      else { state.pendingDelete = { type: 'reset' }; render(); showMessage('Нажмите «Подтвердить сброс» ещё раз.', 'error'); }
    }
    if (action === 'tab') { state.tab = button.dataset.tab; state.pendingDelete = null; render(); }
    if (action === 'view-input') { state.viewMode = 'input'; render(); }
    if (action === 'view-results') { state.viewMode = 'results'; render(); }
    if (action === 'toggle-graph-fullscreen') { state.graphFullscreen = !state.graphFullscreen; render(); }
    if (action === 'toggle-model-info') { state.modelInfoOpen = !state.modelInfoOpen; render(); }
    if (action === 'zoom-in' || action === 'zoom-out') { state.viewport.zoom = Math.min(2.2, Math.max(0.45, state.viewport.zoom + (action === 'zoom-in' ? 0.1 : -0.1))); state.dirty = true; render(); }
    if (action === 'zoom-100') { state.viewport.zoom = 1; state.viewport.panX = 0; state.viewport.panY = 0; state.dirty = true; render(); }
    if (action === 'fit') { state.viewport = { zoom: 1, panX: 0, panY: 0 }; state.dirty = true; render(); }
    if (action === 'select-row' && row) { state.selection = { type: row.dataset.rowType, id: row.dataset.rowId }; render(); }
    if (action === 'request-delete' && row) { state.pendingDelete = { type: row.dataset.rowType, id: row.dataset.rowId }; render(); }
    if (action === 'cancel-delete') { state.pendingDelete = null; render(); }
    if (action === 'confirm-delete' && row) removeSelection(row.dataset.rowType, row.dataset.rowId);
    if (action === 'edit-selection' && state.selection) { state.tab = state.selection.type === 'node' ? 'nodes' : 'branches'; render(); setTimeout(() => root.querySelector(`[data-row-id="${state.selection.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0); }
  }

  function handleChange(event) {
    const input = event.target;
    if (input.dataset.nodeRegion) {
      const row = input.closest('[data-row-id]');
      const node = nodeById(row?.dataset.rowId);
      if (!node) return;
      node.regionId = regionById(input.value)?.id || null;
      persistProjectSilently();
      render();
    }
    else if (input.dataset.regionDisplay) {
      state.regionDisplay.show = input.checked;
      persistProjectSilently();
      render();
    }
    else if (input.dataset.regionFilter) {
      state.regionDisplay.filterRegionId = regionById(input.value)?.id || null;
      persistProjectSilently();
      render();
    }
    else if (input.dataset.graphDisplay) {
      const key = input.dataset.graphDisplay;
      if (!hasOwn(DEFAULT_GRAPH_DISPLAY, key)) return;
      state.graphDisplay[key] = input.checked;
      persistProjectSilently();
      render();
    }
    else if (input.dataset.nodeGenerationMode) {
      const row = input.closest('[data-row-id]'); const node = nodeById(row?.dataset.rowId); const field = input.dataset.nodeGenerationMode;
      if (!node || !['generationPMode', 'generationQMode'].includes(field)) return;
      node[field] = input.value === 'auto' ? 'auto' : 'manual';
      invalidate(); persistProjectSilently(); render();
    }
    else if (input.dataset.nodeField) updateNode(input);
    else if (input.dataset.branchField) updateBranch(input);
    else if (input.dataset.slackAngle) {
      const slack = state.nodes.find((node) => node.type === 'slack'); const value = Number(input.value);
      if (!slack || !Number.isFinite(value) || value < -360 || value > 360) { if (slack) input.value = slack.setAngleDeg; showMessage('δзад должен быть конечным числом от −360° до 360°.', 'error'); return; }
      slack.setAngleDeg = value; invalidate(); render();
    }
    else if (input.dataset.threshold) {
      const next = { ...state.settings.thresholds, [input.dataset.threshold]: Number(input.value) };
      if (![next.criticalLow, next.warningLow, next.warningHigh, next.criticalHigh].every(Number.isFinite) || !(next.criticalLow <= next.warningLow && next.warningLow < next.warningHigh && next.warningHigh <= next.criticalHigh)) { input.value = state.settings.thresholds[input.dataset.threshold]; showMessage('Пороги должны идти по возрастанию: критический низ ≤ предупреждение низ < предупреждение верх ≤ критический верх.', 'error'); return; }
      state.settings.thresholds = next; state.dirty = true; render();
    } else if (input.dataset.voltageLimit) {
      const next = { ...state.settings.voltageLimits, [input.dataset.voltageLimit]: Number(input.value) };
      if (![next.uMinPU, next.uMaxPU].every(Number.isFinite) || next.uMinPU <= 0 || next.uMinPU >= next.uMaxPU) { input.value = state.settings.voltageLimits[input.dataset.voltageLimit]; showMessage('Должно выполняться 0 < Umin < Umax.', 'error'); return; }
      state.settings.voltageLimits = next; state.dirty = true; render();
    } else if (input.id === 'rastrProjectName') {
      state.name = input.value.trim().slice(0, 120) || 'Новая сеть'; state.dirty = true; render();
    } else if (input.id === 'rastrImport') importProject(input.files?.[0]);
  }

  function init(container) {
    root = container;
    let project = null;
    try { const saved = readSettings().rastrMode; if (saved) project = sanitizeProject(saved); } catch (error) { project = null; }
    applyProject(project || sanitizeProject({ name: 'Новая сеть', nodes: [], branches: [], settings: { thresholds: DEFAULT_THRESHOLDS } }));
    root.classList.add('rastr-mode-root');
    root.addEventListener('click', handleClick);
    root.addEventListener('change', handleChange);
    root.addEventListener('submit', (event) => {
      if (event.target?.id !== 'rastrRegionForm') return;
      event.preventDefault();
      saveRegionForm(event.target);
    });
    render();
  }

  global.RastrMode = Object.freeze({
    init,
    solveNetwork,
    sanitizeProject,
    validateImportedProject,
    exampleProject,
    serializeProject,
    getRegionAnalysis,
    getTransformerRatioWarnings,
    getState: () => state
  });
})(window);
