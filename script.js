'use strict';

// Демонстрационные границы легко изменить в одном месте.
// Они не являются официальными нормативными значениями.
const CURRENT_THRESHOLDS = Object.freeze({
  normalMax: 13,
  warningMax: 16
});

const UPDATE_INTERVAL_MS = 2000;
const MAX_CHART_POINTS = 30;
const STORAGE_KEY = 'smartEnergySettings';
const SOLVER_HISTORY_KEY = 'smartEnergySolverHistory';
const MeasurementData = window.SmartEnergyData || null;
const realDeviceApi = window.SmartEnergyRealDeviceApi && MeasurementData
  ? window.SmartEnergyRealDeviceApi.createAdapter({ staleAfterMs: MeasurementData.DEFAULT_STALE_AFTER_MS })
  : null;

function emptyRealMeasurement(overrides = {}) {
  if (MeasurementData) return MeasurementData.createEmptyMeasurement('real', overrides);
  return {
    source: 'real', deviceId: null, timestamp: null,
    voltageV: null, currentA: null, activePowerKw: null, reactivePowerKvar: null,
    apparentPowerKva: null, powerFactor: null, frequencyHz: null, energyKwh: null,
    connectionStatus: 'offline', alarms: [], ...overrides
  };
}

const SOLVER_CATEGORY_LABELS = Object.freeze({
  math: 'Математика',
  electrical: 'Электротехника',
  energy: 'Электроэнергетика',
  physics: 'Физика'
});

const SOLVER_EXAMPLES = Object.freeze({
  current: 'P = 15 кВт\nU = 380 В\ncosφ = 0.85\nТрёхфазная сеть. Найти I.',
  triangle: 'P = 80 кВт\nQ = 30 квар\nНайти S.\nS = √(P² + Q²)',
  efficiency: 'P1 = 12 кВт\nP2 = 10.2 кВт\nНайти η.\nη = P2 / P1 × 100%'
});

const UNIT_DEFINITIONS = Object.freeze([
  { key: 'V', label: 'В', dimension: 'voltage', factor: 1 },
  { key: 'kV', label: 'кВ', dimension: 'voltage', factor: 1_000 },
  { key: 'A', label: 'А', dimension: 'current', factor: 1 },
  { key: 'kA', label: 'кА', dimension: 'current', factor: 1_000 },
  { key: 'W', label: 'Вт', dimension: 'activePower', factor: 1 },
  { key: 'kW', label: 'кВт', dimension: 'activePower', factor: 1_000 },
  { key: 'MW', label: 'МВт', dimension: 'activePower', factor: 1_000_000 },
  { key: 'var', label: 'вар', dimension: 'reactivePower', factor: 1 },
  { key: 'kvar', label: 'квар', dimension: 'reactivePower', factor: 1_000 },
  { key: 'Mvar', label: 'Мвар', dimension: 'reactivePower', factor: 1_000_000 },
  { key: 'VA', label: 'ВА', dimension: 'apparentPower', factor: 1 },
  { key: 'kVA', label: 'кВА', dimension: 'apparentPower', factor: 1_000 },
  { key: 'MVA', label: 'МВА', dimension: 'apparentPower', factor: 1_000_000 },
  { key: 'ohm', label: 'Ом', dimension: 'resistance', factor: 1 },
  { key: 'kohm', label: 'кОм', dimension: 'resistance', factor: 1_000 },
  { key: 'Hz', label: 'Гц', dimension: 'frequency', factor: 1 },
  { key: 'kWh', label: 'кВт·ч', dimension: 'energy', factor: 1 }
]);

const LOAD_CONFIG = Object.freeze({
  lighting: { name: 'Освещение', powerW: 100, powerFactor: 0.95, eventOn: 'Освещение включено', eventOff: 'Освещение выключено' },
  computer: { name: 'Компьютер', powerW: 500, powerFactor: 0.92, eventOn: 'Включён компьютер', eventOff: 'Компьютер выключен' },
  television: { name: 'Телевизор', powerW: 150, powerFactor: 0.90, eventOn: 'Включён телевизор', eventOff: 'Телевизор выключен' },
  kettle: { name: 'Чайник', powerW: 2000, powerFactor: 1, eventOn: 'Включён чайник', eventOff: 'Чайник выключен' },
  conditioner: { name: 'Кондиционер', powerW: 1500, powerFactor: 0.85, eventOn: 'Включён кондиционер', eventOff: 'Кондиционер выключен' }
});

const ENERGY_LAB_BREAKERS = Object.freeze({
  qf0: { name: 'QF0', description: 'Главный ввод', rating: 32 },
  qf1: { name: 'QF1', description: 'Розетки', rating: 16 },
  qf2: { name: 'QF2', description: 'Освещение', rating: 10 },
  qf3: { name: 'QF3', description: 'Кухня', rating: 16 }
});

const BREAKER_RATINGS_A = Object.freeze([6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125]);
const BREAKER_CHARACTERISTICS = Object.freeze(['B', 'C', 'D']);
const BREAKER_PHASES = Object.freeze(['L1', 'L2', 'L3', '3~']);

const ENERGY_LAB_LINES = Object.freeze({
  outlets: { name: 'Розетки', breakerId: 'qf1', length: 20, material: 'copper', section: 2.5, breakerRating: 16 },
  lighting: { name: 'Освещение', breakerId: 'qf2', length: 15, material: 'copper', section: 1.5, breakerRating: 10 },
  kitchen: { name: 'Кухня', breakerId: 'qf3', length: 25, material: 'copper', section: 2.5, breakerRating: 16 }
});

const DEFAULT_PHASE_ASSIGNMENTS = Object.freeze({
  lighting: 'L1',
  computer: 'L2',
  television: 'L3',
  kettle: 'L1',
  conditioner: 'L2'
});

const EQUIPMENT_TYPES = Object.freeze({
  circuit_breaker: 'Автоматический выключатель', transformer: 'Трансформатор', contactor: 'Контактор', magnetic_starter: 'Магнитный пускатель', relay: 'Реле', protection_relay: 'Реле защиты', energy_meter: 'Счётчик электроэнергии', motor: 'Электродвигатель', frequency_converter: 'Частотный преобразователь', rcd: 'УЗО', differential_breaker: 'Дифавтомат', fuse: 'Предохранитель', cable: 'Кабель', busbar: 'Шина', disconnector: 'Разъединитель', load_switch: 'Выключатель нагрузки', current_transformer: 'Измерительный трансформатор тока', voltage_transformer: 'Измерительный трансформатор напряжения', plc: 'PLC', sensor: 'Датчик', communication_device: 'Устройство связи', other: 'Другое'
});

const EQUIPMENT_STATUSES = Object.freeze({
  active: 'В работе', reserve: 'Резерв', disabled: 'Отключено', needs_check: 'Требует проверки', maintenance: 'На обслуживании', faulty: 'Неисправно', retired: 'Списано'
});

const MAINTENANCE_TYPES = Object.freeze(['Осмотр', 'Проверка', 'Измерение', 'Очистка', 'Подтяжка соединений', 'Испытание', 'Ремонт', 'Замена', 'Другое']);

const EQUIPMENT_DYNAMIC_FIELDS = Object.freeze({
  circuit_breaker: [
    { key: 'characteristic', label: 'Характеристика', type: 'select', options: ['', 'B', 'C', 'D'] },
    { key: 'poles', label: 'Количество полюсов', placeholder: '1P / 3P / 4P' },
    { key: 'breakingCapacityKA', label: 'Отключающая способность', unit: 'кА', number: true }
  ],
  transformer: [
    { key: 'powerKVA', label: 'Номинальная мощность', unit: 'кВА', number: true }, { key: 'highVoltageKV', label: 'UВН', unit: 'кВ', number: true }, { key: 'lowVoltageKV', label: 'UНН', unit: 'кВ', number: true }, { key: 'vectorGroup', label: 'Группа соединения' }, { key: 'impedancePercent', label: 'Uk', unit: '%', number: true }, { key: 'noLoadLossKW', label: 'Потери холостого хода', unit: 'кВт', number: true }, { key: 'shortCircuitLossKW', label: 'Потери КЗ', unit: 'кВт', number: true }
  ],
  motor: [
    { key: 'speedRPM', label: 'Обороты', unit: 'об/мин', number: true }, { key: 'connection', label: 'Соединение', type: 'select', options: ['', 'Y', 'Δ', 'Y/Δ'] }
  ],
  cable: [
    { key: 'brand', label: 'Марка кабеля' }, { key: 'material', label: 'Материал', type: 'select', options: ['', 'Медь', 'Алюминий'] }, { key: 'cores', label: 'Количество жил', number: true }, { key: 'sectionMM2', label: 'Сечение', unit: 'мм²', number: true }, { key: 'lengthM', label: 'Длина', unit: 'м', number: true }
  ],
  energy_meter: [
    { key: 'meterKind', label: 'Тип счётчика' }, { key: 'maxCurrentA', label: 'Максимальный ток', unit: 'А', number: true }, { key: 'accuracyClass', label: 'Класс точности' }, { key: 'interface', label: 'Интерфейс связи' }
  ],
  contactor: [
    { key: 'powerCircuitVoltageV', label: 'Напряжение силовой цепи', unit: 'В', number: true }, { key: 'coilVoltageV', label: 'Напряжение катушки', unit: 'В', number: true }, { key: 'utilizationCategory', label: 'Категория применения', placeholder: 'AC-3' }
  ],
  protection_relay: [
    { key: 'protectionType', label: 'Тип защиты' }, { key: 'settingsText', label: 'Уставки' }, { key: 'interface', label: 'Интерфейс связи' }
  ]
});

let customLoadIdCounter = 0;
let customBreakerIdCounter = 0;

const defaultSettings = {
  theme: 'dark',
  loads: { lighting: false, computer: false, television: false, kettle: false, conditioner: false },
  customLoads: [],
  dataSource: 'simulator',
  chartMetric: 'voltage',
  energyKWh: 8.4,
  selectedPeriod: 'today',
  equipment: [],
  rastrMode: null,
  energyLab: {
    networkType: 'single',
    breakers: Object.fromEntries(Object.keys(ENERGY_LAB_BREAKERS).map((id) => [id, true])),
    breakerTrips: {},
    customBreakers: [],
    lines: Object.fromEntries(Object.entries(ENERGY_LAB_LINES).map(([id, line]) => [id, { ...line }])),
    phaseAssignments: { ...DEFAULT_PHASE_ASSIGNMENTS }
  }
};

function createDefaultSettings() {
  return {
    ...defaultSettings,
    loads: { ...defaultSettings.loads },
    customLoads: [],
    equipment: [],
    rastrMode: null,
    energyLab: {
      networkType: 'single',
      breakers: { ...defaultSettings.energyLab.breakers },
      breakerTrips: {},
      customBreakers: [],
      lines: Object.fromEntries(Object.entries(ENERGY_LAB_LINES).map(([id, line]) => [id, { ...line }])),
      phaseAssignments: { ...DEFAULT_PHASE_ASSIGNMENTS }
    }
  };
}

const elements = {
  voltage: document.getElementById('voltageValue'),
  current: document.getElementById('currentValue'),
  activePower: document.getElementById('activePowerValue'),
  reactivePower: document.getElementById('reactivePowerValue'),
  apparentPower: document.getElementById('apparentPowerValue'),
  powerFactor: document.getElementById('powerFactorValue'),
  frequency: document.getElementById('frequencyValue'),
  energy: document.getElementById('energyValue'),
  startButton: document.getElementById('startMonitoring'),
  stopButton: document.getElementById('stopMonitoring'),
  updateState: document.getElementById('updateState'),
  statusBadge: document.getElementById('networkStatusBadge'),
  statusText: document.getElementById('networkStatusText'),
  statusCurrent: document.getElementById('statusCurrent'),
  statusMessage: document.getElementById('networkStatusMessage'),
  thresholdMarker: document.getElementById('thresholdMarker'),
  chart: document.getElementById('voltageChart'),
  chartMetric: document.getElementById('chartMetric'),
  chartTitle: document.getElementById('chartTitle'),
  chartLegendLabel: document.getElementById('chartLegendLabel'),
  sourceMessage: document.getElementById('sourceMessage'),
  monitoringEyebrow: document.getElementById('monitoringEyebrow'),
  monitoringDescription: document.getElementById('monitoringDescription'),
  monitoringFooterText: document.getElementById('monitoringFooterText'),
  realConnectionStatus: document.getElementById('realConnectionStatus'),
  realLastUpdated: document.getElementById('realLastUpdated'),
  realDeviceNote: document.getElementById('realDeviceNote'),
  realAlarmList: document.getElementById('realAlarmList'),
  addCustomLoadButton: document.getElementById('addCustomLoadButton'),
  customLoadForm: document.getElementById('customLoadForm'),
  customLoadsList: document.getElementById('customLoadsList'),
  customLoadName: document.getElementById('customLoadName'),
  customLoadPower: document.getElementById('customLoadPower'),
  customLoadPowerFactor: document.getElementById('customLoadPowerFactor'),
  customLoadQuantity: document.getElementById('customLoadQuantity'),
  customLoadEnabled: document.getElementById('customLoadEnabled'),
  customLoadFormTitle: document.getElementById('customLoadFormTitle'),
  customLoadStartState: document.getElementById('customLoadStartState'),
  customLoadSubmit: document.getElementById('customLoadSubmit'),
  eventList: document.getElementById('eventList'),
  themeToggle: document.getElementById('themeToggle'),
  consumptionValue: document.getElementById('consumptionValue'),
  consumptionProgress: document.getElementById('consumptionProgress'),
  consumptionProgressFill: document.getElementById('consumptionProgressFill'),
  consumptionCaption: document.getElementById('consumptionCaption'),
  consumptionRemaining: document.getElementById('consumptionRemaining'),
  energyLabHome: document.getElementById('energyLabHome'),
  energyLabTool: document.getElementById('energyLabTool'),
  energyLabToolTitle: document.getElementById('energyLabToolTitle'),
  energyLabToolContent: document.getElementById('energyLabToolContent'),
  energyLabBack: document.getElementById('energyLabBack'),
  energyLabSummaryStatus: document.getElementById('energyLabSummaryStatus'),
  energyLabVoltage: document.getElementById('energyLabVoltage'),
  energyLabCurrent: document.getElementById('energyLabCurrent'),
  energyLabPower: document.getElementById('energyLabPower'),
  energyLabPowerFactor: document.getElementById('energyLabPowerFactor'),
  energyLabFrequency: document.getElementById('energyLabFrequency'),
  homeSystemStatus: document.getElementById('homeSystemStatus'),
  homeActivePower: document.getElementById('homeActivePower'),
  homeLoadPercent: document.getElementById('homeLoadPercent'),
  homePowerRing: document.getElementById('homePowerRing'),
  homeVoltage: document.getElementById('homeVoltage'),
  homeCurrent: document.getElementById('homeCurrent'),
  homePowerFactor: document.getElementById('homePowerFactor'),
  homeFrequency: document.getElementById('homeFrequency'),
  homeEnergy: document.getElementById('homeEnergy'),
  homeLastEvent: document.getElementById('homeLastEvent'),
  homeEquipmentAlert: document.getElementById('homeEquipmentAlert'),
  homeEquipmentAlertText: document.getElementById('homeEquipmentAlertText'),
  homeProblemAction: document.getElementById('homeProblemAction'),
  bottomNavigation: document.getElementById('bottomNavigation')
};

const state = {
  settings: loadSettings(),
  storagePersistenceFailed: false,
  monitoringTimer: null,
  lastSampleAt: Date.now(),
  simulationTick: 0,
  chartHistory: {
    voltage: [230],
    current: [0],
    power: [0],
    reactive: [0],
    apparent: [0],
    powerFactor: [1]
  },
  eventCount: 0,
  events: [],
  realMeasurement: emptyRealMeasurement(),
  currentMeasurement: null,
  activePage: 'home',
  homeAnimationFrames: new Map(),
  networkStatus: 'normal',
  energyLab: {
    activeTool: null,
    emergencyMode: null,
    balanceSuggestion: null,
    eventFilter: 'all',
    analysisMetric: 'voltage',
    lineResult: null,
    equipmentView: 'list',
    equipmentId: null,
    equipmentTab: 'overview',
    equipmentSearch: '',
    equipmentFilters: { type: '', manufacturer: '', status: '', object: '', panel: '', line: '' },
    equipmentSort: 'created_desc',
    equipmentAttentionOnly: false,
    equipmentMeasurementMetric: 'voltageV',
    equipmentEditingMeasurementId: null,
    equipmentMeasurementDeleteId: null,
    equipmentEditingNoteId: null,
    equipmentNoteDeleteId: null,
    equipmentDeleteId: null,
    equipmentShowMeasurementForm: false,
    equipmentShowMaintenanceForm: false,
    breakerView: 'list',
    breakerId: null,
    breakerDeleteId: null
  },
  lastMeasurements: {
    voltage: 230,
    current: 0,
    frequency: 50,
    powerFactor: 1,
    activePower: 0,
    reactivePower: 0,
    apparentPower: 0
  }
};

let editingCustomLoadId = null;

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== 'object') return createDefaultSettings();
    const savedLoads = saved.loads && typeof saved.loads === 'object' ? saved.loads : {};
    const customLoads = sanitizeCustomLoads(saved.customLoads);
    // Миграция единственной пользовательской нагрузки из предыдущей версии.
    if (!Array.isArray(saved.customLoads) && Number.isFinite(saved.customPowerW)) {
      customLoads.push({
        id: createCustomLoadId(),
        name: 'Своя нагрузка',
        powerW: clamp(saved.customPowerW, 1, 1_000_000),
        powerFactor: 0.95,
        quantity: 1,
        enabled: Boolean(savedLoads.custom)
      });
    }
    return {
      theme: saved.theme === 'light' ? 'light' : 'dark',
      loads: Object.fromEntries(Object.keys(defaultSettings.loads).map((loadId) => [loadId, Boolean(savedLoads[loadId])])),
      customLoads,
      dataSource: saved.dataSource === 'real' ? 'real' : 'simulator',
      chartMetric: ['voltage', 'current', 'power'].includes(saved.chartMetric) ? saved.chartMetric : 'voltage',
      energyKWh: Number.isFinite(saved.energyKWh) ? Math.max(0, saved.energyKWh) : defaultSettings.energyKWh,
      selectedPeriod: ['today', 'week', 'month'].includes(saved.selectedPeriod) ? saved.selectedPeriod : 'today',
      equipment: sanitizeEquipmentList(saved.equipment),
      rastrMode: saved.rastrMode && typeof saved.rastrMode === 'object' ? saved.rastrMode : null,
      energyLab: sanitizeEnergyLabSettings(saved.energyLab)
    };
  } catch (error) {
    return createDefaultSettings();
  }
}

function sanitizeEnergyLabSettings(saved) {
  const source = saved && typeof saved === 'object' ? saved : {};
  const savedBreakers = source.breakers && typeof source.breakers === 'object' ? source.breakers : {};
  const savedLines = source.lines && typeof source.lines === 'object' ? source.lines : {};
  const savedAssignments = source.phaseAssignments && typeof source.phaseAssignments === 'object' ? source.phaseAssignments : {};
  const phases = ['L1', 'L2', 'L3'];

  const breakers = Object.fromEntries(Object.keys(ENERGY_LAB_BREAKERS).map((id) => [id, savedBreakers[id] !== false]));
  const lines = Object.fromEntries(Object.entries(ENERGY_LAB_LINES).map(([id, defaults]) => {
    const value = savedLines[id] && typeof savedLines[id] === 'object' ? savedLines[id] : {};
    const length = Number(value.length);
    const section = Number(value.section);
    const breakerRating = Number(value.breakerRating);
    return [id, {
      ...defaults,
      length: Number.isFinite(length) && length >= 0 ? length : defaults.length,
      material: value.material === 'aluminum' ? 'aluminum' : 'copper',
      section: Number.isFinite(section) && section > 0 ? section : defaults.section,
      breakerRating: Number.isFinite(breakerRating) && breakerRating > 0 ? breakerRating : defaults.breakerRating
    }];
  }));
  const phaseAssignments = { ...DEFAULT_PHASE_ASSIGNMENTS };
  Object.entries(savedAssignments).forEach(([loadId, phase]) => {
    if (phases.includes(phase)) phaseAssignments[loadId] = phase;
  });

  const usedIds = new Set(Object.keys(ENERGY_LAB_BREAKERS));
  const usedDesignations = new Set(Object.values(ENERGY_LAB_BREAKERS).map((item) => item.name.toLowerCase()));
  const customBreakers = Array.isArray(source.customBreakers) ? source.customBreakers.slice(0, 100).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const designation = String(item.designation || '').trim().slice(0, 20);
    const designationKey = designation.toLowerCase();
    if (!designation || usedDesignations.has(designationKey)) return [];
    let id = String(item.id || '').trim().slice(0, 80);
    if (!id || usedIds.has(id)) id = createCustomBreakerId();
    usedIds.add(id); usedDesignations.add(designationKey);
    const networkType = item.networkType === 'three' ? 'three' : 'single';
    const voltageV = Number(item.voltageV); const powerW = Number(item.powerW); const powerFactor = Number(item.powerFactor); const efficiency = Number(item.efficiency);
    const manualCurrentA = Number(item.manualCurrentA); const ratingA = Number(item.ratingA); const sectionMM2 = Number(item.cable?.sectionMM2);
    return [{
      id, designation, name: String(item.name || designation).trim().slice(0, 100) || designation,
      networkType,
      voltageV: Number.isFinite(voltageV) && voltageV > 0 ? voltageV : networkType === 'three' ? 400 : 230,
      powerW: Number.isFinite(powerW) && powerW >= 0 ? powerW : 0,
      powerFactor: Number.isFinite(powerFactor) && powerFactor > 0 && powerFactor <= 1 ? powerFactor : 1,
      efficiency: Number.isFinite(efficiency) && efficiency > 0 && efficiency <= 1 ? efficiency : 1,
      currentMode: item.currentMode === 'manual' ? 'manual' : 'auto',
      manualCurrentA: Number.isFinite(manualCurrentA) && manualCurrentA > 0 ? manualCurrentA : null,
      characteristic: BREAKER_CHARACTERISTICS.includes(item.characteristic) ? item.characteristic : 'C',
      ratingA: BREAKER_RATINGS_A.includes(ratingA) ? ratingA : 16,
      phase: networkType === 'three' ? '3~' : BREAKER_PHASES.slice(0, 3).includes(item.phase) ? item.phase : 'L1',
      cable: { material: item.cable?.material === 'aluminum' ? 'aluminum' : 'copper', sectionMM2: Number.isFinite(sectionMM2) && sectionMM2 > 0 ? sectionMM2 : 2.5, ampacityA: null },
      linkedLoadIds: Array.isArray(item.linkedLoadIds) ? [...new Set(item.linkedLoadIds.filter((value) => typeof value === 'string').map((value) => value.slice(0, 100)))].slice(0, 100) : [],
      enabled: item.enabled !== false,
      snapshotPowerW: Number.isFinite(Number(item.snapshotPowerW)) ? Math.max(0, Number(item.snapshotPowerW)) : Number.isFinite(powerW) ? Math.max(0, powerW) : 0,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString()
    }];
  }) : [];
  const breakerTrips = {};
  const savedTrips = source.breakerTrips && typeof source.breakerTrips === 'object' ? source.breakerTrips : {};
  [...Object.keys(ENERGY_LAB_BREAKERS), ...customBreakers.map((item) => item.id)].forEach((id) => { breakerTrips[id] = Boolean(savedTrips[id]); });

  return {
    networkType: source.networkType === 'three' ? 'three' : 'single',
    breakers,
    breakerTrips,
    customBreakers,
    lines,
    phaseAssignments
  };
}

function createCustomBreakerId() {
  customBreakerIdCounter += 1;
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return `breaker-${window.crypto.randomUUID()}`;
  return `breaker-${Date.now()}-${customBreakerIdCounter}`;
}

function createCustomLoadId() {
  customLoadIdCounter += 1;
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return `load-${Date.now()}-${customLoadIdCounter}`;
}

function sanitizeCustomLoads(loads) {
  if (!Array.isArray(loads)) return [];
  return loads.slice(0, 100).flatMap((load) => {
    const name = typeof load?.name === 'string' ? load.name.trim().slice(0, 80) : '';
    const powerW = Number(load?.powerW);
    const powerFactor = Number(load?.powerFactor);
    const quantity = Number(load?.quantity);
    if (!name || !Number.isFinite(powerW) || powerW <= 0 || powerW > 1_000_000) return [];
    if (!Number.isFinite(powerFactor) || powerFactor <= 0 || powerFactor > 1) return [];
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) return [];
    return [{
      id: typeof load.id === 'string' && load.id ? load.id : createCustomLoadId(),
      name,
      powerW,
      powerFactor,
      quantity,
      enabled: Boolean(load.enabled)
    }];
  });
}

function createEquipmentId() {
  const suffix = window.crypto && typeof window.crypto.randomUUID === 'function'
    ? window.crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : `${Date.now().toString(36)}${Math.floor(performance.now()).toString(36)}`;
  return `eq_${suffix}`;
}

function safeText(value, maxLength = 240) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function safeOptionalNumber(value, { min = 0, max = 1_000_000_000 } = {}) {
  if (value === '' || value === null || value === undefined) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= min && numberValue <= max ? numberValue : null;
}

function safeDateTime(value, fallback = new Date().toISOString()) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function isValidDateInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function sanitizeEquipmentList(records) {
  if (!Array.isArray(records)) return [];
  const usedIds = new Set();
  return records.slice(0, 2000).flatMap((record) => {
    if (!record || typeof record !== 'object') return [];
    const designation = safeText(record.designation, 80);
    const name = safeText(record.name, 160);
    const type = Object.hasOwn(EQUIPMENT_TYPES, record.type) ? record.type : 'other';
    const status = Object.hasOwn(EQUIPMENT_STATUSES, record.status) ? record.status : 'active';
    if (!designation || !name) return [];
    let id = safeText(record.id, 80) || createEquipmentId();
    if (usedIds.has(id)) id = createEquipmentId();
    usedIds.add(id);
    const ratings = record.ratings && typeof record.ratings === 'object' ? record.ratings : {};
    const location = record.location && typeof record.location === 'object' ? record.location : {};
    const specs = record.specs && typeof record.specs === 'object' ? record.specs : {};
    const allowedSpecs = Object.fromEntries(Object.entries(specs).slice(0, 40).flatMap(([key, value]) => {
      if (!/^[a-zA-Z0-9_]{1,60}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) return [];
      if (typeof value === 'number' && Number.isFinite(value)) return [[key, value]];
      if (typeof value === 'string') return [[key, safeText(value, 300)]];
      return [];
    }));
    const measurements = Array.isArray(record.measurements) ? record.measurements.slice(0, 5000).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const measuredAt = safeDateTime(item.measuredAt, '');
      if (!measuredAt) return [];
      return [{
        id: safeText(item.id, 80) || createEquipmentId(),
        measuredAt,
        dataSource: item.dataSource === 'simulation' ? 'simulation' : ['real_device', 'device', 'api', 'modbus', 'mqtt'].includes(item.dataSource) ? 'real_device' : 'manual',
        voltageV: safeOptionalNumber(item.voltageV), currentA: safeOptionalNumber(item.currentA), activePowerKW: safeOptionalNumber(item.activePowerKW), reactivePowerKvar: safeOptionalNumber(item.reactivePowerKvar, { min: -1_000_000, max: 1_000_000 }), apparentPowerKVA: safeOptionalNumber(item.apparentPowerKVA), powerFactor: safeOptionalNumber(item.powerFactor, { min: 0, max: 1 }), frequencyHz: safeOptionalNumber(item.frequencyHz), temperatureC: safeOptionalNumber(item.temperatureC, { min: -273.15 }), insulationMOhm: safeOptionalNumber(item.insulationMOhm), note: safeText(item.note, 1000), createdAt: safeDateTime(item.createdAt)
      }];
    }) : [];
    const maintenance = Array.isArray(record.maintenance) ? record.maintenance.slice(0, 2000).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const date = safeText(item.date, 10);
      if (!isValidDateInput(date)) return [];
      return [{ id: safeText(item.id, 80) || createEquipmentId(), date, workType: MAINTENANCE_TYPES.includes(item.workType) ? item.workType : 'Другое', performer: safeText(item.performer, 160), work: safeText(item.work, 1000), result: safeText(item.result, 1000), comment: safeText(item.comment, 1000), nextDate: isValidDateInput(item.nextDate) ? item.nextDate : '', createdAt: safeDateTime(item.createdAt) }];
    }) : [];
    const notes = Array.isArray(record.notes) ? record.notes.slice(0, 2000).flatMap((item) => item && typeof item === 'object' && safeText(item.text, 2000) ? [{ id: safeText(item.id, 80) || createEquipmentId(), text: safeText(item.text, 2000), createdAt: safeDateTime(item.createdAt) }] : []) : [];
    const history = Array.isArray(record.history) ? record.history.slice(0, 3000).flatMap((item) => item && typeof item === 'object' && safeText(item.message, 500) ? [{ id: safeText(item.id, 80) || createEquipmentId(), timestamp: safeDateTime(item.timestamp), type: safeText(item.type, 40) || 'update', message: safeText(item.message, 500) }] : []) : [];
    const documents = Array.isArray(record.documents) ? record.documents.slice(0, 500).flatMap((item) => item && typeof item === 'object' ? [{ id: safeText(item.id, 80) || createEquipmentId(), category: safeText(item.category, 80), name: safeText(item.name, 240), storageRef: safeText(item.storageRef, 500), createdAt: safeDateTime(item.createdAt) }] : []) : [];
    return [{
      id, designation, name, type,
      manufacturer: safeText(record.manufacturer, 120), model: safeText(record.model, 120), serialNumber: safeText(record.serialNumber, 120), inventoryNumber: safeText(record.inventoryNumber, 120), year: safeOptionalNumber(record.year, { min: 1800, max: 3000 }), installationDate: isValidDateInput(record.installationDate) ? record.installationDate : '', quantity: Math.max(1, Math.trunc(safeOptionalNumber(record.quantity, { min: 1, max: 100000 }) || 1)), status,
      ratings: { voltageV: safeOptionalNumber(ratings.voltageV), currentA: safeOptionalNumber(ratings.currentA), powerKW: safeOptionalNumber(ratings.powerKW), powerKVA: safeOptionalNumber(ratings.powerKVA), frequencyHz: safeOptionalNumber(ratings.frequencyHz), phases: safeOptionalNumber(ratings.phases, { min: 1, max: 3 }), powerFactor: safeOptionalNumber(ratings.powerFactor, { min: 0, max: 1 }), efficiencyPercent: safeOptionalNumber(ratings.efficiencyPercent, { min: 0, max: 100 }) },
      specs: allowedSpecs,
      location: { objectId: safeText(location.objectId, 100) || null, object: safeText(location.object, 160), buildingId: safeText(location.buildingId, 100) || null, building: safeText(location.building, 160), roomId: safeText(location.roomId, 100) || null, room: safeText(location.room, 160), panelId: safeText(location.panelId, 100) || null, panel: safeText(location.panel, 120), lineId: safeText(location.lineId, 100) || null, line: safeText(location.line, 160), cellId: safeText(location.cellId, 100) || null, cell: safeText(location.cell, 80), description: safeText(location.description, 1000) },
      measurements, maintenance, notes, history, documents,
      dataSource: ['manual', 'simulation', 'api', 'modbus', 'mqtt'].includes(record.dataSource) ? record.dataSource : 'manual',
      linkedLineId: safeText(record.linkedLineId, 100) || null, linkedBreakerId: safeText(record.linkedBreakerId, 100) || null, linkedNodeId: safeText(record.linkedNodeId, 100) || null,
      createdAt: safeDateTime(record.createdAt), updatedAt: safeDateTime(record.updatedAt || record.createdAt)
    }];
  });
}

function validateEquipmentImportPayload(payload) {
  const warnings = [];
  let incoming;
  if (Array.isArray(payload)) {
    incoming = payload;
    warnings.push('Импортируется устаревший формат без schemaVersion. После сохранения будет использована версия 1.');
  } else {
    if (!payload || typeof payload !== 'object') throw new Error('Корневое значение JSON должно быть объектом или массивом старого формата.');
    if (payload.schemaVersion !== 1) throw new Error(`Неподдерживаемая версия оборудования: ${payload.schemaVersion ?? 'не указана'}.`);
    incoming = payload.equipment;
  }
  if (!Array.isArray(incoming)) throw new Error('Файл не содержит массив equipment.');
  if (incoming.length > 2000) throw new Error('Файл содержит более 2000 записей оборудования.');
  const errors = [];
  const ids = new Set();
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const optionalNumber = (value, path, { min = -Infinity, max = Infinity, integer = false } = {}) => {
    if (value === null || value === undefined || value === '') return;
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path}: ожидалось конечное число или null.`);
    else if (value < min || value > max || (integer && !Number.isInteger(value))) errors.push(`${path}: значение вне допустимого диапазона.`);
  };
  const optionalDateTime = (value, path) => {
    if (value === null || value === undefined || value === '') return;
    if (typeof value !== 'string' || !Number.isFinite(new Date(value).getTime())) errors.push(`${path}: некорректная дата и время.`);
  };
  incoming.forEach((record, index) => {
    const prefix = `Запись ${index + 1}`;
    if (!object(record)) { errors.push(`${prefix}: ожидался объект.`); return; }
    if (typeof record.designation !== 'string' || !record.designation.trim()) errors.push(`${prefix}.designation: требуется непустая строка.`);
    if (typeof record.name !== 'string' || !record.name.trim()) errors.push(`${prefix}.name: требуется непустая строка.`);
    ['manufacturer', 'model', 'serialNumber', 'inventoryNumber', 'linkedLineId', 'linkedBreakerId', 'linkedNodeId'].forEach((key) => { if (record[key] != null && typeof record[key] !== 'string') errors.push(`${prefix}.${key}: ожидалась строка или null.`); });
    if (!Object.hasOwn(EQUIPMENT_TYPES, record.type)) errors.push(`${prefix}.type: неизвестный тип «${record.type}».`);
    if (!Object.hasOwn(EQUIPMENT_STATUSES, record.status)) errors.push(`${prefix}.status: неизвестное состояние «${record.status}».`);
    if (record.id != null) {
      if (typeof record.id !== 'string' || !record.id.trim()) errors.push(`${prefix}.id: ожидалась непустая строка.`);
      else if (ids.has(record.id)) errors.push(`${prefix}.id: дублирующийся ID «${record.id}».`);
      else ids.add(record.id);
    }
    optionalNumber(record.year, `${prefix}.year`, { min: 1800, max: 3000, integer: true }); optionalNumber(record.quantity, `${prefix}.quantity`, { min: 1, max: 100000, integer: true });
    if (record.installationDate != null && record.installationDate !== '' && (typeof record.installationDate !== 'string' || !isValidDateInput(record.installationDate))) errors.push(`${prefix}.installationDate: ожидается дата YYYY-MM-DD.`);
    if (record.ratings != null && !object(record.ratings)) errors.push(`${prefix}.ratings: ожидался объект.`);
    else {
      const ratings = record.ratings || {};
      ['voltageV', 'currentA', 'powerKW', 'powerKVA', 'frequencyHz'].forEach((key) => optionalNumber(ratings[key], `${prefix}.ratings.${key}`, { min: 0 }));
      optionalNumber(ratings.phases, `${prefix}.ratings.phases`, { min: 1, max: 3, integer: true });
      optionalNumber(ratings.powerFactor, `${prefix}.ratings.powerFactor`, { min: 0, max: 1 });
      optionalNumber(ratings.efficiencyPercent, `${prefix}.ratings.efficiencyPercent`, { min: 0, max: 100 });
    }
    if (record.location != null && !object(record.location)) errors.push(`${prefix}.location: ожидался объект.`);
    else Object.entries(record.location || {}).forEach(([key, value]) => { if (value != null && typeof value !== 'string') errors.push(`${prefix}.location.${key}: ожидалась строка или null.`); });
    if (record.specs != null && !object(record.specs)) errors.push(`${prefix}.specs: ожидался объект.`);
    else Object.entries(record.specs || {}).forEach(([key, value]) => {
      if (!/^[a-zA-Z0-9_]{1,60}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) errors.push(`${prefix}.specs: недопустимое имя поля «${key}».`);
      if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) errors.push(`${prefix}.specs.${key}: допустимы строка или конечное число.`);
    });
    const checkArray = (name, limit, checker) => {
      const collection = record[name];
      if (collection == null) return;
      if (!Array.isArray(collection)) { errors.push(`${prefix}.${name}: ожидался массив.`); return; }
      if (collection.length > limit) errors.push(`${prefix}.${name}: превышен лимит ${limit} записей.`);
      collection.forEach((item, itemIndex) => { if (!object(item)) errors.push(`${prefix}.${name}[${itemIndex}]: ожидался объект.`); else checker(item, `${prefix}.${name}[${itemIndex}]`); });
    };
    checkArray('measurements', 5000, (item, path) => {
      optionalDateTime(item.measuredAt, `${path}.measuredAt`);
      if (!item.measuredAt) errors.push(`${path}.measuredAt: поле обязательно.`);
      ['voltageV', 'currentA', 'activePowerKW', 'apparentPowerKVA', 'frequencyHz', 'insulationMOhm'].forEach((key) => optionalNumber(item[key], `${path}.${key}`, { min: 0 }));
      optionalNumber(item.reactivePowerKvar, `${path}.reactivePowerKvar`, { min: -1_000_000, max: 1_000_000 });
      optionalNumber(item.powerFactor, `${path}.powerFactor`, { min: 0, max: 1 });
      optionalNumber(item.temperatureC, `${path}.temperatureC`, { min: -273.15 });
      if (item.dataSource != null && !['manual', 'simulation', 'real_device', 'device', 'api', 'modbus', 'mqtt'].includes(item.dataSource)) errors.push(`${path}.dataSource: неизвестный источник.`);
      if (item.note != null && typeof item.note !== 'string') errors.push(`${path}.note: ожидалась строка.`);
    });
    checkArray('maintenance', 2000, (item, path) => {
      if (typeof item.date !== 'string' || !isValidDateInput(item.date)) errors.push(`${path}.date: ожидается дата YYYY-MM-DD.`);
      if (item.nextDate != null && item.nextDate !== '' && (typeof item.nextDate !== 'string' || !isValidDateInput(item.nextDate))) errors.push(`${path}.nextDate: ожидается дата YYYY-MM-DD или пустое значение.`);
      if (item.workType != null && !MAINTENANCE_TYPES.includes(item.workType)) errors.push(`${path}.workType: неизвестный тип работы.`);
      ['performer', 'work', 'result', 'comment'].forEach((key) => { if (item[key] != null && typeof item[key] !== 'string') errors.push(`${path}.${key}: ожидалась строка.`); });
    });
    checkArray('notes', 2000, (item, path) => { if (typeof item.text !== 'string' || !item.text.trim()) errors.push(`${path}.text: требуется непустая строка.`); });
    checkArray('history', 3000, (item, path) => { if (typeof item.message !== 'string' || !item.message.trim()) errors.push(`${path}.message: требуется непустая строка.`); optionalDateTime(item.timestamp, `${path}.timestamp`); });
    checkArray('documents', 500, (item, path) => { ['category', 'name', 'storageRef'].forEach((key) => { if (item[key] != null && typeof item[key] !== 'string') errors.push(`${path}.${key}: ожидалась строка.`); }); });
    if (record.dataSource != null && !['manual', 'simulation', 'api', 'modbus', 'mqtt'].includes(record.dataSource)) errors.push(`${prefix}.dataSource: неизвестный источник.`);
    optionalDateTime(record.createdAt, `${prefix}.createdAt`); optionalDateTime(record.updatedAt, `${prefix}.updatedAt`);
  });
  if (errors.length) {
    const visible = errors.slice(0, 12).join(' | ');
    const suffix = errors.length > 12 ? ` | Ещё ошибок: ${errors.length - 12}.` : '';
    throw new Error(`Некорректные записи (${errors.length}): ${visible}${suffix}`);
  }
  const records = sanitizeEquipmentList(incoming);
  if (records.length !== incoming.length) throw new Error('После проверки часть записей не прошла нормализацию. Импорт отменён.');
  return { records, warnings };
}

let storageFailurePrompted = false;

function exportSettingsBackup() {
  const payload = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), settings: state.settings }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `smart-energy-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function notifyStorageFailure() {
  state.storagePersistenceFailed = true;
  if (window.__SMART_ENERGY_TEST__ || storageFailurePrompted) return;
  storageFailurePrompted = true;
  const shouldExport = window.confirm('Не удалось сохранить изменения в localStorage. Данные остаются в памяти текущей вкладки, но могут быть потеряны после её закрытия. Скачать резервную копию JSON сейчас?');
  if (shouldExport) exportSettingsBackup();
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    state.storagePersistenceFailed = false;
    storageFailurePrompted = false;
    return true;
  } catch (error) {
    notifyStorageFailure();
    return false;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getCustomBreakerById(breakerId) {
  return state.settings.energyLab.customBreakers.find((breaker) => breaker.id === breakerId) || null;
}

function getCustomBreakerForLoad(loadKey) {
  return state.settings.energyLab.customBreakers.find((breaker) => breaker.linkedLoadIds.includes(loadKey)) || null;
}

function getLoadBranch(loadId, custom = false) {
  const loadKey = custom ? `custom:${loadId}` : loadId;
  const linkedBreaker = getCustomBreakerForLoad(loadKey);
  if (linkedBreaker) return linkedBreaker.id;
  if (custom) return 'qf1';
  if (loadId === 'lighting') return 'qf2';
  if (loadId === 'kettle' || loadId === 'conditioner') return 'qf3';
  return 'qf1';
}

function isBreakerEnabled(breakerId) {
  if (!state.settings.energyLab.breakers.qf0) return false;
  if (breakerId === 'qf0') return true;
  const customBreaker = getCustomBreakerById(breakerId);
  return customBreaker ? customBreaker.enabled : state.settings.energyLab.breakers[breakerId] !== false;
}

function isLoadEnergized(loadId, custom = false) {
  if (state.energyLab.emergencyMode === 'line-outage') return false;
  return isBreakerEnabled(getLoadBranch(loadId, custom));
}

function ensurePhaseAssignments() {
  const assignments = state.settings.energyLab.phaseAssignments;
  const phases = ['L1', 'L2', 'L3'];
  state.settings.customLoads.forEach((load, index) => {
    const key = `custom:${load.id}`;
    if (!phases.includes(assignments[key])) assignments[key] = phases[index % phases.length];
  });
  Object.keys(assignments).forEach((key) => {
    if (!key.startsWith('custom:')) return;
    const id = key.slice(7);
    if (!state.settings.customLoads.some((load) => load.id === id)) delete assignments[key];
  });
}

function collectLoadModels({ onlyActive = false, respectBreakers = true, includeBreakerLoads = true } = {}) {
  ensurePhaseAssignments();
  const loads = [];
  Object.entries(LOAD_CONFIG).forEach(([id, config]) => {
    const enabled = Boolean(state.settings.loads[id]);
    const energized = !respectBreakers || isLoadEnergized(id);
    const branch = getLoadBranch(id);
    const linkedBreaker = getCustomBreakerById(branch);
    if (onlyActive && (!enabled || !energized)) return;
    loads.push({
      id,
      name: config.name,
      powerW: config.powerW,
      powerFactor: config.powerFactor,
      enabled,
      energized,
      branch,
      phase: linkedBreaker?.phase || state.settings.energyLab.phaseAssignments[id] || 'L1',
      efficiency: linkedBreaker?.efficiency || 1,
      custom: false
    });
  });
  state.settings.customLoads.forEach((load) => {
    const enabled = Boolean(load.enabled);
    const energized = !respectBreakers || isLoadEnergized(load.id, true);
    const branch = getLoadBranch(load.id, true);
    const linkedBreaker = getCustomBreakerById(branch);
    if (onlyActive && (!enabled || !energized)) return;
    loads.push({
      id: `custom:${load.id}`,
      sourceId: load.id,
      name: load.name,
      powerW: load.powerW * load.quantity,
      unitPowerW: load.powerW,
      quantity: load.quantity,
      powerFactor: load.powerFactor,
      enabled,
      energized,
      branch,
      phase: linkedBreaker?.phase || state.settings.energyLab.phaseAssignments[`custom:${load.id}`] || 'L1',
      efficiency: linkedBreaker?.efficiency || 1,
      custom: true
    });
  });
  if (includeBreakerLoads) {
    state.settings.energyLab.customBreakers.filter((breaker) => !breaker.linkedLoadIds.length).forEach((breaker) => {
      const enabled = breaker.enabled;
      const energized = !respectBreakers || (state.energyLab.emergencyMode !== 'line-outage' && isBreakerEnabled(breaker.id));
      if (onlyActive && (!enabled || !energized)) return;
      loads.push({
        id: `breaker-load:${breaker.id}`, name: breaker.name, powerW: breaker.powerW, powerFactor: breaker.powerFactor,
        efficiency: breaker.efficiency, enabled, energized, branch: breaker.id, phase: breaker.phase,
        custom: true, customBreaker: true
      });
    });
  }
  return loads;
}

function calculateLoadTotals(loads, voltage = 230, networkType = 'single') {
  const lineVoltage = Number(voltage);
  const phaseFactor = networkType === 'three' ? Math.sqrt(3) : 1;
  let activePowerW = 0;
  let usefulPowerW = 0;
  let reactivePowerVar = 0;
  loads.forEach((load) => {
    const powerW = Number(load.powerW);
    const factor = Number(load.powerFactor); const efficiency = Number(load.efficiency ?? 1);
    if (!Number.isFinite(powerW) || powerW < 0 || !Number.isFinite(factor) || factor <= 0 || factor > 1 || !Number.isFinite(efficiency) || efficiency <= 0 || efficiency > 1) return;
    const inputPowerW = powerW / efficiency;
    const apparentPowerVA = inputPowerW / factor;
    usefulPowerW += powerW;
    activePowerW += inputPowerW;
    reactivePowerVar += Math.sqrt(Math.max(0, apparentPowerVA ** 2 - inputPowerW ** 2));
  });
  const apparentPowerVA = Math.sqrt(activePowerW ** 2 + reactivePowerVar ** 2);
  return {
    usefulPowerW,
    activePowerW,
    reactivePowerVar,
    apparentPowerVA,
    powerFactor: apparentPowerVA > 0 ? activePowerW / apparentPowerVA : 1,
    currentA: lineVoltage > 0 ? apparentPowerVA / (phaseFactor * lineVoltage) : 0
  };
}

// Все электрические величины выводятся из фиксированной мощности включённых приборов.
function calculateSimulatorMeasurements() {
  const activeLoads = collectLoadModels({ onlyActive: true });
  const networkType = state.settings.energyLab.networkType === 'three' ? 'three' : 'single';
  const nominalVoltage = networkType === 'three' ? 400 : 230;
  if (state.energyLab.emergencyMode === 'overload') {
    activeLoads.push({ id: 'emergency-overload', name: 'Учебная перегрузка', powerW: 5000, powerFactor: 0.9 });
  }
  if (state.energyLab.emergencyMode === 'low-power-factor') {
    activeLoads.push({ id: 'emergency-reactive', name: 'Учебная реактивная нагрузка', powerW: 1000, powerFactor: 0.45 });
  }
  const initialTotals = calculateLoadTotals(activeLoads, nominalVoltage, networkType);
  const estimatedCurrent = initialTotals.currentA;
  const voltageVariation = Math.sin(state.simulationTick * 0.72) * (networkType === 'three' ? 0.95 : 0.55);
  let voltage = clamp(nominalVoltage + voltageVariation - estimatedCurrent * (networkType === 'three' ? 0.13 : 0.075), networkType === 'three' ? 390 : 225, networkType === 'three' ? 402 : 231);
  if (state.energyLab.emergencyMode === 'undervoltage') voltage = (networkType === 'three' ? 355 : 205) + voltageVariation;
  if (state.energyLab.emergencyMode === 'overvoltage') voltage = (networkType === 'three' ? 433 : 250) + voltageVariation;
  const totals = calculateLoadTotals(activeLoads, voltage, networkType);
  const current = totals.currentA;
  const frequency = 50 + Math.sin(state.simulationTick * 0.41) * 0.025 - Math.min(current, 25) * 0.0007;

  return {
    voltage,
    current,
    activePower: totals.activePowerW / 1000,
    reactivePower: totals.reactivePowerVar / 1000,
    apparentPower: totals.apparentPowerVA / 1000,
    powerFactor: totals.powerFactor,
    frequency
  };
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animateHomeNumber(key, element, target, digits) {
  if (!element || !Number.isFinite(target)) return;
  const previousFrame = state.homeAnimationFrames.get(key);
  if (previousFrame) window.cancelAnimationFrame(previousFrame);
  const currentValue = Number(element.dataset.value);
  const startValue = Number.isFinite(currentValue) ? currentValue : target;
  element.dataset.value = String(target);
  if (prefersReducedMotion() || Math.abs(target - startValue) < 10 ** (-digits)) {
    element.textContent = target.toFixed(digits);
    state.homeAnimationFrames.delete(key);
    return;
  }
  const startedAt = performance.now();
  const duration = 600;
  const renderFrame = (now) => {
    const progress = clamp((now - startedAt) / duration, 0, 1);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = (startValue + (target - startValue) * eased).toFixed(digits);
    if (progress < 1) {
      state.homeAnimationFrames.set(key, window.requestAnimationFrame(renderFrame));
    } else {
      state.homeAnimationFrames.delete(key);
    }
  };
  state.homeAnimationFrames.set(key, window.requestAnimationFrame(renderFrame));
}

function updateHomeLastEvent() {
  if (!elements.homeLastEvent) return;
  elements.homeLastEvent.textContent = state.events[0]?.message || 'Событий пока нет';
}

function updateHomeScreen() {
  if (!elements.homeActivePower) return;
  const measurements = state.lastMeasurements;
  const mainBreakerRating = ENERGY_LAB_BREAKERS.qf0.rating;
  const loadPercent = mainBreakerRating > 0 ? measurements.current / mainBreakerRating * 100 : 0;
  const safePercent = Number.isFinite(loadPercent) ? Math.max(0, loadPercent) : 0;
  const status = state.networkStatus;
  const statusLabels = {
    normal: 'СИСТЕМА В НОРМЕ',
    warning: 'ВНИМАНИЕ',
    emergency: state.energyLab.emergencyMode ? 'АВАРИЯ' : 'ПЕРЕГРУЗКА'
  };

  animateHomeNumber('power', elements.homeActivePower, measurements.activePower, 2);
  animateHomeNumber('voltage', elements.homeVoltage, measurements.voltage, 1);
  animateHomeNumber('current', elements.homeCurrent, measurements.current, 2);
  animateHomeNumber('powerFactor', elements.homePowerFactor, measurements.powerFactor, 2);
  animateHomeNumber('frequency', elements.homeFrequency, measurements.frequency, 2);
  animateHomeNumber('energy', elements.homeEnergy, state.settings.energyKWh, 3);
  animateHomeNumber('loadPercent', elements.homeLoadPercent, safePercent, 0);

  elements.homePowerRing.style.strokeDashoffset = String(100 - clamp(safePercent, 0, 100));
  elements.homePowerRing.dataset.empty = String(safePercent <= 0);
  elements.homePowerRing.dataset.status = status;
  elements.homeSystemStatus.dataset.status = status;
  elements.homeSystemStatus.querySelector('span').textContent = statusLabels[status];
  elements.homeProblemAction.hidden = status === 'normal';
  const equipmentAttention = getEquipmentAttentionItems(true);
  elements.homeEquipmentAlert.hidden = equipmentAttention.length === 0;
  elements.homeEquipmentAlertText.textContent = equipmentAttention.length
    ? `${equipmentAttention.length} ед. оборудования требуют внимания`
    : '';
  updateHomeLastEvent();
}

function getPageFromHash() {
  const hash = window.location.hash.replace('#', '');
  if (['monitoring', 'dashboard', 'diagram', 'loads', 'events'].includes(hash)) return 'monitoring';
  if (hash === 'energy-lab') return 'energy-lab';
  return 'home';
}

function showAppPage(page, scrollToTop = true) {
  const nextPage = ['home', 'monitoring', 'energy-lab'].includes(page) ? page : 'home';
  state.activePage = nextPage;
  document.querySelectorAll('[data-app-page]').forEach((section) => {
    section.hidden = section.dataset.appPage !== nextPage;
  });
  document.querySelectorAll('[data-app-nav]').forEach((item) => {
    const active = item.dataset.appNav === nextPage;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  if (scrollToTop) window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  if (nextPage === 'home') updateHomeScreen();
  if (nextPage === 'monitoring') window.requestAnimationFrame(drawMeasurementChart);
  if (nextPage === 'energy-lab') {
    updateEnergyLabSummary();
    if (state.energyLab.activeTool) renderEnergyLabTool(state.energyLab.activeTool);
  }
}

function navigateToAppPage(page) {
  const hashes = { home: 'home', monitoring: 'monitoring', 'energy-lab': 'energy-lab' };
  showAppPage(page);
  const nextHash = `#${hashes[page] || 'home'}`;
  if (window.location.hash !== nextHash) window.history.pushState(null, '', nextHash);
}

function initializeAppNavigation() {
  showAppPage(getPageFromHash(), false);
  document.querySelectorAll('[data-app-target]').forEach((control) => {
    control.addEventListener('click', (event) => {
      event.preventDefault();
      navigateToAppPage(control.dataset.appTarget);
    });
  });
  elements.bottomNavigation.addEventListener('click', (event) => {
    const link = event.target.closest('[data-app-nav]');
    if (!link || link.dataset.appNav === 'calculators') return;
    event.preventDefault();
    navigateToAppPage(link.dataset.appNav);
  });
  elements.homeProblemAction.addEventListener('click', () => {
    navigateToAppPage('energy-lab');
    openEnergyLabTool('breakers');
  });
  elements.homeEquipmentAlert.addEventListener('click', () => {
    state.energyLab.equipmentAttentionOnly = true;
    state.energyLab.equipmentFilters.status = '';
    navigateToAppPage('energy-lab');
    openEnergyLabTool('equipment');
  });
  window.addEventListener('popstate', () => showAppPage(getPageFromHash()));
}

function renderMeasurements(measurements) {
  const unified = MeasurementData
    ? MeasurementData.fromSimulation(measurements, state.settings.energyKWh)
    : {
        source: 'simulation', timestamp: new Date().toISOString(), connectionStatus: 'online',
        voltageV: measurements.voltage, currentA: measurements.current,
        activePowerKw: measurements.activePower, reactivePowerKvar: measurements.reactivePower,
        apparentPowerKva: measurements.apparentPower, powerFactor: measurements.powerFactor,
        frequencyHz: measurements.frequency, energyKwh: state.settings.energyKWh, alarms: []
      };
  state.currentMeasurement = unified;
  renderMeasurementCards(unified);
  renderCustomLoads(measurements.voltage);
}

function renderMetric(element, value, digits) {
  const present = Number.isFinite(value);
  element.textContent = present ? Number(value).toFixed(digits) : '—';
  const valueRow = element.closest('.metric-value');
  if (valueRow) valueRow.classList.toggle('is-missing', !present);
}

function renderMeasurementCards(measurement) {
  renderMetric(elements.voltage, measurement.voltageV, 1);
  renderMetric(elements.current, measurement.currentA, 2);
  renderMetric(elements.activePower, measurement.activePowerKw, 2);
  renderMetric(elements.reactivePower, measurement.reactivePowerKvar, 2);
  renderMetric(elements.apparentPower, measurement.apparentPowerKva, 2);
  renderMetric(elements.powerFactor, measurement.powerFactor, 2);
  renderMetric(elements.frequency, measurement.frequencyHz, 2);
  renderMetric(elements.energy, measurement.energyKwh, 3);
  document.querySelectorAll('.metric-card').forEach((card) => {
    card.classList.toggle('is-stale', measurement.connectionStatus === 'stale');
  });
}

function formatRealTimestamp(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function renderRealHome(measurement) {
  const fields = [elements.homeActivePower, elements.homeVoltage, elements.homeCurrent, elements.homePowerFactor, elements.homeFrequency, elements.homeEnergy];
  fields.forEach((element) => {
    if (!element) return;
    element.textContent = '—';
    delete element.dataset.value;
  });
  if (elements.homeLoadPercent) elements.homeLoadPercent.textContent = '—';
  if (elements.homePowerRing) {
    elements.homePowerRing.style.strokeDashoffset = '100';
    elements.homePowerRing.dataset.empty = 'true';
    elements.homePowerRing.dataset.status = measurement.connectionStatus === 'stale' ? 'warning' : 'emergency';
  }
  if (elements.homeSystemStatus) {
    elements.homeSystemStatus.dataset.status = measurement.connectionStatus === 'stale' ? 'warning' : 'emergency';
    const label = measurement.connectionStatus === 'online' ? 'REAL · ONLINE' : measurement.connectionStatus === 'stale' ? 'REAL · STALE DATA' : 'УСТРОЙСТВО НЕ ПОДКЛЮЧЕНО';
    elements.homeSystemStatus.querySelector('span').textContent = label;
  }
  if (elements.homeLastEvent) elements.homeLastEvent.textContent = measurement.connectionStatus === 'offline' ? 'Потеря связи с реальным устройством' : 'Данные REAL получены';
  if (elements.homeProblemAction) elements.homeProblemAction.hidden = true;
}

function renderRealAlarms(measurement) {
  if (!elements.realAlarmList) return;
  if (measurement.connectionStatus === 'offline') {
    elements.realAlarmList.innerHTML = '<p class="is-critical">⚠ Потеря связи — устройство не подключено.</p>';
    return;
  }
  if (measurement.connectionStatus === 'stale') {
    elements.realAlarmList.innerHTML = '<p class="is-warning">⚠ STALE DATA — измерения давно не обновлялись.</p>';
    return;
  }
  const alarms = Array.isArray(measurement.alarms) ? measurement.alarms : [];
  if (!alarms.length) {
    elements.realAlarmList.innerHTML = '<p>Активных аварий от backend нет.</p>';
    return;
  }
  elements.realAlarmList.innerHTML = '';
  alarms.forEach((alarm) => {
    const item = document.createElement('p');
    item.className = alarm.severity === 'critical' ? 'is-critical' : alarm.severity === 'warning' ? 'is-warning' : '';
    item.textContent = `⚠ ${alarm.message}`;
    elements.realAlarmList.appendChild(item);
  });
}

function renderRealMeasurement(measurement = emptyRealMeasurement()) {
  state.realMeasurement = measurement;
  state.currentMeasurement = measurement;
  renderMeasurementCards(measurement);
  const status = measurement.connectionStatus === 'online' ? 'ONLINE' : measurement.connectionStatus === 'stale' ? 'STALE DATA' : 'OFFLINE';
  const marker = measurement.connectionStatus === 'online' ? '🟢' : measurement.connectionStatus === 'stale' ? '🟡' : '🔴';
  elements.realConnectionStatus.textContent = `${marker} ${status}`;
  elements.realConnectionStatus.className = `real-status is-${measurement.connectionStatus}`;
  elements.realLastUpdated.textContent = formatRealTimestamp(measurement.timestamp);
  elements.realDeviceNote.textContent = measurement.connectionStatus === 'online'
    ? 'Показания получены от backend API. Интерфейс работает только на чтение.'
    : measurement.connectionStatus === 'stale'
      ? 'Данные устарели и не считаются текущими. Проверьте шлюз и связь с backend.'
      : 'Реальное устройство ещё не подключено. Показания не генерируются.';
  renderRealAlarms(measurement);
  renderRealHome(measurement);
}

function appendChartSample(measurements) {
  const samples = {
    voltage: measurements.voltage,
    current: measurements.current,
    power: measurements.activePower,
    reactive: measurements.reactivePower,
    apparent: measurements.apparentPower,
    powerFactor: measurements.powerFactor
  };
  Object.entries(samples).forEach(([metric, value]) => {
    state.chartHistory[metric].push(value);
    if (state.chartHistory[metric].length > MAX_CHART_POINTS) state.chartHistory[metric].shift();
  });
}

function updateMeasurements(accumulateEnergy = true) {
  if (state.settings.dataSource !== 'simulator') {
    elements.sourceMessage.textContent = 'Источник: Нет подключения. Реальное устройство не передаёт данные.';
    return;
  }

  const measurements = calculateSimulatorMeasurements();
  const now = Date.now();
  if (accumulateEnergy) {
    const elapsedHours = Math.max(now - state.lastSampleAt, 0) / 3_600_000;
    state.settings.energyKWh += measurements.activePower * elapsedHours;
  }
  state.lastSampleAt = now;
  state.simulationTick += 1;
  state.lastMeasurements = measurements;

  renderMeasurements(measurements);
  appendChartSample(measurements);
  updateSystemStatus(measurements.current);
  updateHomeScreen();
  updateConsumption();
  drawMeasurementChart();
  updateEnergyLabSummary();
  updateEnergyLabLiveTool();
  saveSettings();
}

function accumulateCurrentEnergyUntilNow() {
  if (!state.monitoringTimer) return;
  const now = Date.now();
  const elapsedHours = Math.max(now - state.lastSampleAt, 0) / 3_600_000;
  state.settings.energyKWh += state.lastMeasurements.activePower * elapsedHours;
  state.lastSampleAt = now;
}

function getCurrentStatus(current) {
  if (current < CURRENT_THRESHOLDS.normalMax) return 'normal';
  if (current <= CURRENT_THRESHOLDS.warningMax) return 'warning';
  return 'emergency';
}

function updateSystemStatus(currentA) {
  const newStatus = state.energyLab.emergencyMode ? 'emergency' : getCurrentStatus(currentA);
  const statusData = {
    normal: {
      label: 'НОРМА',
      className: 'status-normal',
      message: 'Ток находится ниже демонстрационного порога 13 А.',
      event: 'Ток вернулся в демонстрационный нормальный диапазон',
      eventType: 'success'
    },
    warning: {
      label: 'ВНИМАНИЕ',
      className: 'status-warning',
      message: 'Ток находится в демонстрационном диапазоне внимания 13–16 А.',
      event: 'Предупреждение: высокий ток',
      eventType: 'warning'
    },
    emergency: {
      label: 'ПЕРЕГРУЗКА',
      className: 'status-emergency',
      message: 'Ток выше демонстрационного порога перегрузки 16 А.',
      event: 'Перегрузка: ток выше 16 А',
      eventType: 'emergency'
    }
  };
  const currentStatus = statusData[newStatus];
  if (state.energyLab.emergencyMode) {
    const messages = {
      undervoltage: 'Активен учебный сценарий пониженного напряжения.',
      overvoltage: 'Активен учебный сценарий повышенного напряжения.',
      overload: 'Активен учебный сценарий перегрузки.',
      'low-power-factor': 'Активен учебный сценарий низкого cosφ.',
      'line-outage': 'Активен учебный сценарий отключения линии.'
    };
    currentStatus.message = messages[state.energyLab.emergencyMode];
  }

  elements.statusBadge.className = `status-badge ${currentStatus.className}`;
  elements.statusText.textContent = currentStatus.label;
  elements.statusCurrent.textContent = Number.isFinite(currentA) ? currentA.toFixed(2) : '0.00';
  elements.statusMessage.textContent = currentStatus.message;

  const markerPosition = clamp(currentA / 20 * 100, 0, 100);
  elements.thresholdMarker.style.left = `${markerPosition}%`;

  if (newStatus !== state.networkStatus) {
    addEvent(currentStatus.event, currentStatus.eventType);
    state.networkStatus = newStatus;
  }
}

function startMonitoring() {
  if (state.monitoringTimer) return;
  if (state.settings.dataSource === 'real') {
    const deviceId = getConfiguredRealDeviceId();
    if (!deviceId) {
      const message = 'Источник REAL: устройство не настроено. Укажите deviceId для backend API.';
      elements.sourceMessage.textContent = message;
      elements.updateState.textContent = '🔴 Устройство не подключено';
      renderRealMeasurement(emptyRealMeasurement());
      return;
    }
    refreshRealMeasurements();
    state.monitoringTimer = window.setInterval(refreshRealMeasurements, UPDATE_INTERVAL_MS);
    elements.startButton.disabled = true;
    elements.stopButton.disabled = false;
    elements.updateState.textContent = 'REAL · опрос backend каждые 2 секунды';
    elements.updateState.classList.add('live');
    return;
  }
  state.lastSampleAt = Date.now();
  updateMeasurements(false);
  state.monitoringTimer = window.setInterval(() => updateMeasurements(true), UPDATE_INTERVAL_MS);
  elements.startButton.disabled = true;
  elements.stopButton.disabled = false;
  elements.updateState.textContent = 'Симуляция · обновление каждые 2 секунды';
  elements.updateState.classList.add('live');
  addEvent('Мониторинг запущен', 'success');
}

function stopMonitoring() {
  if (!state.monitoringTimer) return;
  if (state.settings.dataSource === 'simulator') accumulateCurrentEnergyUntilNow();
  window.clearInterval(state.monitoringTimer);
  state.monitoringTimer = null;
  elements.startButton.disabled = state.settings.dataSource === 'real' && !getConfiguredRealDeviceId();
  elements.stopButton.disabled = true;
  elements.updateState.textContent = state.settings.dataSource === 'simulator' ? 'Симуляция остановлена' : 'REAL мониторинг остановлен';
  elements.updateState.classList.remove('live');
  if (state.settings.dataSource === 'simulator') addEvent('Мониторинг остановлен');
}

function toggleLoad(loadId) {
  if (!(loadId in LOAD_CONFIG)) return;
  if (state.settings.dataSource !== 'simulator') {
    addEvent('Переключение нагрузок доступно только в режиме «Симулятор»', 'warning');
    return;
  }
  accumulateCurrentEnergyUntilNow();
  const previousPower = state.lastMeasurements.activePower;
  state.settings.loads[loadId] = !state.settings.loads[loadId];
  const enabled = state.settings.loads[loadId];
  addEvent(enabled ? LOAD_CONFIG[loadId].eventOn : LOAD_CONFIG[loadId].eventOff, enabled ? 'success' : 'warning');
  updateLoadControls();
  updateDiagram();
  updateMeasurements(false);
  const nextPower = state.lastMeasurements.activePower;
  if (Math.abs(nextPower - previousPower) >= 0.05) {
    addEvent(`Мощность ${nextPower > previousPower ? 'увеличилась' : 'снизилась'} до ${nextPower.toFixed(2)} кВт`, nextPower > previousPower ? 'success' : 'info');
  }
  saveSettings();
}

function updateLoadControls() {
  document.querySelectorAll('[data-load]').forEach((button) => {
    const loadId = button.dataset.load;
    const enabled = Boolean(state.settings.loads[loadId]);
    const card = document.querySelector(`[data-load-card="${loadId}"]`);
    if (!card || !button.querySelector('em')) return;
    const energized = isLoadEnergized(loadId);
    button.setAttribute('aria-pressed', String(enabled));
    button.querySelector('em').textContent = enabled ? 'ВКЛ' : 'ВЫКЛ';
    card.classList.toggle('disabled', !enabled || !energized);
    card.querySelector('.load-status-text').textContent = enabled && !energized ? 'Нет питания' : enabled ? 'Включено' : 'Отключено';
  });
}

function updateDiagram() {
  Object.keys(LOAD_CONFIG).forEach((loadId) => {
    const enabled = Boolean(state.settings.loads[loadId]);
    const branch = document.getElementById(`diagram-${loadId}`);
    if (!branch) return;
    const energized = isLoadEnergized(loadId);
    const active = enabled && energized;
    const indicator = branch.querySelector('.line-state');
    const label = branch.querySelector('small');
    branch.classList.toggle('active', active);
    branch.classList.toggle('disconnected', !active);
    indicator.className = `line-state ${active ? 'on' : 'off'}`;
    label.textContent = enabled && !energized ? 'Нет питания' : active ? 'Линия включена' : 'Линия отключена';
  });

  const customBranch = document.getElementById('diagram-custom');
  if (!customBranch) return;
  const enabledCustomLoads = state.settings.customLoads.filter((load) => load.enabled && isLoadEnergized(load.id, true)).length;
  const customEnabled = enabledCustomLoads > 0;
  customBranch.classList.toggle('active', customEnabled);
  customBranch.classList.toggle('disconnected', !customEnabled);
  customBranch.querySelector('.line-state').className = `line-state ${customEnabled ? 'on' : 'off'}`;
  customBranch.querySelector('small').textContent = customEnabled
    ? `Включено приборов: ${enabledCustomLoads}`
    : 'Нет включённых приборов';
}

function formatLoadNumber(value, digits = 2, useGrouping = true) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits, useGrouping }).format(value);
}

function formatLoadFixed(value, digits = 2) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function renderCustomLoads(voltage = state.lastMeasurements.voltage) {
  elements.customLoadsList.innerHTML = '';
  if (!state.settings.customLoads.length) {
    const empty = document.createElement('p');
    empty.className = 'custom-loads-empty';
    empty.textContent = 'Свои нагрузки пока не добавлены.';
    elements.customLoadsList.appendChild(empty);
    return;
  }

  state.settings.customLoads.forEach((load) => {
    const totalPowerW = load.powerW * load.quantity;
    const currentA = totalPowerW / (voltage * load.powerFactor);
    const energized = isLoadEnergized(load.id, true);
    const card = document.createElement('article');
    card.className = `custom-load-item${load.enabled && energized ? '' : ' disabled'}`;
    card.dataset.customLoadId = load.id;
    card.innerHTML = `
      <div class="custom-load-item-head">
        <span class="load-symbol" aria-hidden="true">🔌</span>
        <div><strong class="custom-load-name"></strong><span class="custom-load-state"><span>Состояние:</span><i class="load-indicator"></i><b></b></span></div>
      </div>
      <dl class="custom-load-metrics">
        <div><dt>Мощность</dt><dd class="custom-load-power"></dd></div>
        <div><dt>Ток</dt><dd class="custom-load-current"></dd></div>
        <div><dt>cosφ</dt><dd class="custom-load-factor"></dd></div>
        <div><dt>Количество</dt><dd class="custom-load-quantity"></dd></div>
      </dl>
      <div class="custom-load-actions">
        <button class="load-toggle" type="button" data-custom-action="toggle" aria-pressed="false"><span></span><em></em></button>
        <button class="custom-load-edit" type="button" data-custom-action="edit">Изменить</button>
        <button class="custom-load-delete" type="button" data-custom-action="delete">Удалить</button>
      </div>`;
    card.querySelector('.custom-load-name').textContent = load.name;
    card.querySelector('.custom-load-state b').textContent = load.enabled && !energized ? 'НЕТ ПИТАНИЯ' : load.enabled ? 'ВКЛ' : 'ВЫКЛ';
    card.querySelector('.custom-load-power').textContent = `${formatLoadNumber(totalPowerW, 2, false)} Вт`;
    card.querySelector('.custom-load-current').textContent = `${formatLoadFixed(currentA)} А`;
    card.querySelector('.custom-load-factor').textContent = formatLoadFixed(load.powerFactor);
    card.querySelector('.custom-load-quantity').textContent = String(load.quantity);
    const toggle = card.querySelector('.load-toggle');
    toggle.setAttribute('aria-pressed', String(load.enabled));
    toggle.disabled = state.settings.dataSource !== 'simulator';
    toggle.querySelector('em').textContent = load.enabled ? 'ВКЛ' : 'ВЫКЛ';
    card.querySelector('.custom-load-edit').disabled = state.settings.dataSource !== 'simulator';
    card.querySelector('.custom-load-delete').disabled = state.settings.dataSource !== 'simulator';
    elements.customLoadsList.appendChild(card);
  });
}

function clearCustomLoadErrors() {
  ['Name', 'Power', 'PowerFactor', 'Quantity'].forEach((suffix) => {
    document.getElementById(`customLoad${suffix}Error`).textContent = '';
  });
}

function validateCustomLoadValues(values) {
  const errors = {};
  if (!values.name) errors.name = 'Введите название прибора.';
  if (!Number.isFinite(values.powerW) || values.powerW <= 0 || values.powerW > 1_000_000) errors.powerW = 'Мощность должна быть больше 0 и не более 1 000 000 Вт.';
  if (!Number.isFinite(values.powerFactor) || values.powerFactor <= 0 || values.powerFactor > 1) errors.powerFactor = 'cosφ должен быть больше 0 и не более 1.';
  if (!Number.isFinite(values.quantity) || !Number.isInteger(values.quantity) || values.quantity < 1 || values.quantity > 10_000) errors.quantity = 'Количество должно быть целым числом от 1 до 10 000.';
  return { valid: Object.keys(errors).length === 0, errors };
}

function validateCustomLoadForm() {
  clearCustomLoadErrors();
  const values = {
    name: elements.customLoadName.value.trim(),
    powerW: Number(elements.customLoadPower.value),
    powerFactor: Number(elements.customLoadPowerFactor.value),
    quantity: Number(elements.customLoadQuantity.value),
    enabled: elements.customLoadEnabled.checked
  };
  const validation = validateCustomLoadValues(values);
  document.getElementById('customLoadNameError').textContent = validation.errors.name || '';
  document.getElementById('customLoadPowerError').textContent = validation.errors.powerW || '';
  document.getElementById('customLoadPowerFactorError').textContent = validation.errors.powerFactor || '';
  document.getElementById('customLoadQuantityError').textContent = validation.errors.quantity || '';
  return validation.valid ? values : null;
}

function resetCustomLoadForm() {
  elements.customLoadForm.reset();
  elements.customLoadPower.value = '1500';
  elements.customLoadPowerFactor.value = '0.85';
  elements.customLoadQuantity.value = '1';
  editingCustomLoadId = null;
  elements.customLoadFormTitle.textContent = 'СВОЯ НАГРУЗКА';
  elements.customLoadSubmit.textContent = 'Добавить';
  elements.customLoadStartState.hidden = false;
  clearCustomLoadErrors();
  elements.customLoadForm.hidden = true;
  elements.addCustomLoadButton.setAttribute('aria-expanded', 'false');
}

function openCustomLoadForm(loadId = null) {
  clearCustomLoadErrors();
  editingCustomLoadId = loadId;
  if (loadId) {
    const load = state.settings.customLoads.find((item) => item.id === loadId);
    if (!load) return;
    elements.customLoadName.value = load.name;
    elements.customLoadPower.value = String(load.powerW);
    elements.customLoadPowerFactor.value = String(load.powerFactor);
    elements.customLoadQuantity.value = String(load.quantity);
    elements.customLoadEnabled.checked = load.enabled;
    elements.customLoadFormTitle.textContent = 'ИЗМЕНИТЬ НАГРУЗКУ';
    elements.customLoadSubmit.textContent = 'Сохранить изменения';
    elements.customLoadStartState.hidden = true;
  } else {
    elements.customLoadForm.reset();
    elements.customLoadPower.value = '1500';
    elements.customLoadPowerFactor.value = '0.85';
    elements.customLoadQuantity.value = '1';
    elements.customLoadFormTitle.textContent = 'СВОЯ НАГРУЗКА';
    elements.customLoadSubmit.textContent = 'Добавить';
    elements.customLoadStartState.hidden = false;
  }
  elements.customLoadForm.hidden = false;
  elements.addCustomLoadButton.setAttribute('aria-expanded', 'true');
  elements.customLoadName.focus();
}

function addCustomLoad(event) {
  event.preventDefault();
  if (state.settings.dataSource !== 'simulator') return;
  const values = validateCustomLoadForm();
  if (!values) return;
  accumulateCurrentEnergyUntilNow();
  const previousPower = state.lastMeasurements.activePower;
  if (editingCustomLoadId) {
    const load = state.settings.customLoads.find((item) => item.id === editingCustomLoadId);
    if (!load) {
      resetCustomLoadForm();
      return;
    }
    const previous = { ...load };
    load.name = values.name;
    load.powerW = values.powerW;
    load.powerFactor = values.powerFactor;
    load.quantity = values.quantity;
    const powerChanged = previous.powerW !== load.powerW;
    const eventText = powerChanged
      ? `${load.name} изменён: ${formatLoadNumber(previous.powerW, 2, false)} → ${formatLoadNumber(load.powerW, 2, false)} Вт`
      : `${load.name} изменён`;
    addEvent(eventText, 'success');
  } else {
    const load = { id: createCustomLoadId(), ...values };
    state.settings.customLoads.push(load);
    ensurePhaseAssignments();
    addEvent(`Добавлена нагрузка «${load.name}», ${formatLoadNumber(load.powerW, 2, false)} Вт`, 'success');
    if (load.enabled) addEvent(`${load.name} включён`, 'success');
  }
  resetCustomLoadForm();
  updateDiagram();
  updateMeasurements(false);
  if (state.lastMeasurements.activePower > previousPower) {
    addEvent(`Мощность увеличилась до ${state.lastMeasurements.activePower.toFixed(2)} кВт`, 'success');
  }
  saveSettings();
}

function toggleCustomLoad(loadId) {
  if (state.settings.dataSource !== 'simulator') return;
  const load = state.settings.customLoads.find((item) => item.id === loadId);
  if (!load) return;
  accumulateCurrentEnergyUntilNow();
  const previousPower = state.lastMeasurements.activePower;
  load.enabled = !load.enabled;
  addEvent(`${load.name} ${load.enabled ? 'включён' : 'выключен'}`, load.enabled ? 'success' : 'warning');
  updateDiagram();
  updateMeasurements(false);
  if (Math.abs(state.lastMeasurements.activePower - previousPower) >= 0.001) {
    addEvent(`Мощность ${load.enabled ? 'увеличилась' : 'снизилась'} до ${state.lastMeasurements.activePower.toFixed(2)} кВт`, load.enabled ? 'success' : 'info');
  }
  saveSettings();
}

function deleteCustomLoad(loadId) {
  if (state.settings.dataSource !== 'simulator') return;
  const index = state.settings.customLoads.findIndex((item) => item.id === loadId);
  if (index < 0) return;
  accumulateCurrentEnergyUntilNow();
  const [removed] = state.settings.customLoads.splice(index, 1);
  delete state.settings.energyLab.phaseAssignments[`custom:${removed.id}`];
  if (editingCustomLoadId === loadId) resetCustomLoadForm();
  addEvent(`${removed.name} удалён`, 'warning');
  updateDiagram();
  updateMeasurements(false);
  saveSettings();
}

function addEvent(message, type = 'info', metadata = {}) {
  const emptyState = elements.eventList.querySelector('.event-empty');
  if (emptyState) emptyState.remove();

  const item = document.createElement('li');
  const now = new Date();
  item.className = `event-item ${type}`;
  item.innerHTML = `<time class="event-time">${now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span class="event-marker" aria-hidden="true"></span><span class="event-message"></span>`;
  item.querySelector('.event-message').textContent = message;
  elements.eventList.prepend(item);
  state.eventCount += 1;
  const normalized = String(message).toLowerCase();
  const category = type === 'emergency'
    ? 'emergency'
    : type === 'warning' || normalized.includes('предупреж') || normalized.includes('высокий ток')
      ? 'warning'
      : normalized.includes('включ') || normalized.includes('выключ') || normalized.includes('qf')
        ? 'switching'
        : 'info';
  state.events.unshift({
    timestamp: now.getTime(),
    message: String(message),
    type,
    category,
    equipmentId: safeText(metadata.equipmentId, 80) || null,
    eventType: safeText(metadata.eventType, 80) || null
  });
  state.events = state.events.slice(0, 40);
  updateHomeLastEvent();

  while (elements.eventList.children.length > 40) {
    elements.eventList.lastElementChild.remove();
  }
}

function setDataSource(source) {
  const normalizedSource = source === 'real' ? 'real' : 'simulator';
  if (state.settings.dataSource === normalizedSource) return;
  stopMonitoring();
  state.settings.dataSource = normalizedSource;
  const simulatorMode = normalizedSource === 'simulator';
  const realDeviceMessage = 'Источник REAL: backend не получает данные устройства. Значения не генерируются.';
  document.body.dataset.activeSource = normalizedSource;
  updateModePresentation(normalizedSource);
  elements.sourceMessage.textContent = simulatorMode
    ? 'Источник: Симуляция. Значения рассчитываются по включённым учебным нагрузкам.'
    : realDeviceMessage;
  elements.startButton.disabled = !simulatorMode && !getConfiguredRealDeviceId();
  elements.updateState.textContent = simulatorMode ? 'Симуляция остановлена' : '🔴 Устройство не подключено';
  document.querySelectorAll('[data-load]').forEach((button) => { button.disabled = !simulatorMode; });
  elements.addCustomLoadButton.disabled = !simulatorMode;
  if (!simulatorMode) resetCustomLoadForm();
  renderCustomLoads();
  addEvent(simulatorMode ? 'Выбран режим «Симулятор»' : 'Выбран режим «Реальное устройство»: источник не подключён', simulatorMode ? 'success' : 'warning');
  if (simulatorMode) updateMeasurements(false);
  else renderRealMeasurement(emptyRealMeasurement({ deviceId: getConfiguredRealDeviceId() }));
  saveSettings();
}

function getConfiguredRealDeviceId() {
  const value = document.querySelector('meta[name="smart-energy-device-id"]')?.content?.trim();
  return value || null;
}

async function getRealMeasurements(deviceId = getConfiguredRealDeviceId()) {
  if (!realDeviceApi) throw new Error('REAL API adapter недоступен.');
  return realDeviceApi.getLatestMeasurement(deviceId);
}

async function refreshRealMeasurements() {
  if (state.settings.dataSource !== 'real') return;
  const deviceId = getConfiguredRealDeviceId();
  if (!deviceId) {
    renderRealMeasurement(emptyRealMeasurement());
    return;
  }
  try {
    const measurement = await getRealMeasurements(deviceId);
    if (state.settings.dataSource !== 'real') return;
    renderRealMeasurement(measurement);
    elements.sourceMessage.textContent = measurement.connectionStatus === 'online'
      ? `Источник REAL: устройство ${deviceId}, данные backend API.`
      : 'Источник REAL: данные устарели. Проверьте связь со шлюзом.';
  } catch (error) {
    if (state.settings.dataSource !== 'real') return;
    renderRealMeasurement(emptyRealMeasurement({ deviceId }));
    elements.sourceMessage.textContent = 'Источник REAL: backend недоступен или устройство не передаёт данные.';
  }
}

function updateModePresentation(source) {
  const realMode = source === 'real';
  elements.monitoringEyebrow.textContent = realMode ? 'REAL · только чтение' : 'SIMULATION · учебная модель';
  elements.monitoringDescription.textContent = realMode
    ? 'Показания только от real-device source/API. При отсутствии данных отображается «—».'
    : 'Расчётные данные симулятора — не реальные измерения.';
  elements.monitoringFooterText.textContent = realMode
    ? 'SMART ENERGY REAL — интерфейс мониторинга только для чтения. Защита оборудования не зависит от сайта или интернета.'
    : 'SMART ENERGY — учебный симулятор. Отображаемые значения не являются реальными измерениями и не предназначены для промышленной защиты или управления.';
  document.querySelectorAll('.metric-note').forEach((note) => {
    if (!note.dataset.simulationText) note.dataset.simulationText = note.textContent;
    note.textContent = realMode ? 'Данные реального устройства' : note.dataset.simulationText;
  });
}

function clearEvents() {
  elements.eventList.innerHTML = '';
  state.eventCount = 0;
  state.events = [];
  addEvent('Журнал событий очищен');
}

function getConsumptionData(period) {
  const today = state.settings.energyKWh;
  const periods = {
    today: { value: today, target: 15, label: 'дневной цели' },
    week: { value: today * 6.2 + 12, target: 100, label: 'недельной цели' },
    month: { value: today * 24.5 + 65, target: 400, label: 'месячной цели' }
  };
  return periods[period];
}

function updateConsumption() {
  const data = getConsumptionData(state.settings.selectedPeriod);
  const percent = clamp(data.value / data.target * 100, 0, 100);
  const remaining = Math.max(0, data.target - data.value);
  elements.consumptionValue.textContent = data.value.toFixed(1);
  elements.consumptionProgressFill.style.width = `${percent}%`;
  elements.consumptionProgress.setAttribute('aria-valuenow', String(Math.round(percent)));
  elements.consumptionCaption.textContent = `${Math.round(percent)}% от демонстрационной ${data.label} ${data.target} кВт·ч`;
  elements.consumptionRemaining.textContent = `Осталось ${remaining.toFixed(1)} кВт·ч`;
}

function selectConsumptionPeriod(period) {
  state.settings.selectedPeriod = period;
  document.querySelectorAll('[data-period]').forEach((button) => {
    const active = button.dataset.period === period;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  updateConsumption();
  saveSettings();
}

function updateChartMetricControls() {
  elements.chartMetric.querySelectorAll('[data-chart-metric]').forEach((button) => {
    const active = button.dataset.chartMetric === state.settings.chartMetric;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function selectChartMetric(metric) {
  if (!['voltage', 'current', 'power'].includes(metric)) return;
  state.settings.chartMetric = metric;
  updateChartMetricControls();
  drawMeasurementChart();
  saveSettings();
}

// График рисуется нативным Canvas API, поэтому внешняя библиотека не нужна.
function drawMeasurementChart() {
  const canvas = elements.chart;
  const container = canvas.parentElement;
  const width = Math.max(container.clientWidth, 280);
  const height = Math.max(container.clientHeight, 220);
  const ratio = window.devicePixelRatio || 1;
  const styles = getComputedStyle(document.body);
  const primary = styles.getPropertyValue('--primary').trim();
  const muted = styles.getPropertyValue('--muted').trim();
  const border = styles.getPropertyValue('--border').trim();

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const padding = { top: 16, right: 16, bottom: 28, left: 43 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const metric = state.settings.chartMetric;
  const metricConfig = {
    voltage: { title: 'Напряжение в реальном времени', label: 'Напряжение, В', minimum: 224, fallbackMaximum: 232, digits: 1 },
    current: { title: 'Ток в реальном времени', label: 'Ток, А', minimum: 0, fallbackMaximum: 18, digits: 1 },
    power: { title: 'Активная мощность в реальном времени', label: 'Мощность, кВт', minimum: 0, fallbackMaximum: 4, digits: 1 }
  }[metric];
  const values = state.chartHistory[metric];
  const dataMaximum = values.length ? Math.max(...values) : 0;
  const minValue = metricConfig.minimum;
  const maxValue = metric === 'voltage'
    ? metricConfig.fallbackMaximum
    : Math.max(metricConfig.fallbackMaximum, Math.ceil(dataMaximum * 1.2 * 10) / 10);

  elements.chartTitle.textContent = metricConfig.title;
  elements.chartLegendLabel.textContent = metricConfig.label;
  canvas.setAttribute('aria-label', `График последних измерений: ${metricConfig.label}`);

  context.font = '11px system-ui';
  context.fillStyle = muted;
  context.strokeStyle = border;
  context.lineWidth = 1;

  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + chartHeight / 4 * index;
    const value = maxValue - (maxValue - minValue) / 4 * index;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(value.toFixed(metricConfig.digits), 5, y + 4);
  }

  const points = values.map((value, index, allValues) => {
    const denominator = Math.max(allValues.length - 1, 1);
    return {
      x: padding.left + chartWidth * index / denominator,
      y: padding.top + (maxValue - value) / (maxValue - minValue) * chartHeight
    };
  });

  if (!points.length) return;

  const gradient = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  gradient.addColorStop(0, `${primary}45`);
  gradient.addColorStop(1, `${primary}00`);
  context.beginPath();
  context.moveTo(points[0].x, height - padding.bottom);
  points.forEach((point) => context.lineTo(point.x, point.y));
  context.lineTo(points[points.length - 1].x, height - padding.bottom);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.strokeStyle = primary;
  context.lineWidth = 2.5;
  context.lineJoin = 'round';
  context.stroke();

  const latest = points[points.length - 1];
  context.beginPath();
  context.arc(latest.x, latest.y, 4.5, 0, Math.PI * 2);
  context.fillStyle = primary;
  context.shadowColor = primary;
  context.shadowBlur = 12;
  context.fill();
  context.shadowBlur = 0;
}

// ---------- EnergyLab: десять интерфейсов одной модели сети ----------

const ENERGY_LAB_TOOL_TITLES = Object.freeze({
  'single-line': '🔌 Однолинейная схема',
  home: '🏠 Симулятор дома',
  breakers: '🛡 Автоматические выключатели',
  loads: '⚡ Нагрузки',
  'three-phase': '3~ Трёхфазная сеть',
  'phase-balance': '⚖ Баланс фаз',
  emergency: '⚠ Аварийные режимы',
  analysis: '📊 Анализ сети',
  line: '🔧 Параметры линии',
  events: '📋 Журнал событий',
  equipment: '⚙ Оборудование'
});

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function getAllBreakerDefinitions() {
  const threePhaseMode = state.settings.energyLab.networkType === 'three';
  const phaseVoltage = threePhaseMode ? state.lastMeasurements.voltage / Math.sqrt(3) : state.lastMeasurements.voltage;
  const base = Object.entries(ENERGY_LAB_BREAKERS).map(([id, config]) => {
    const line = Object.values(state.settings.energyLab.lines).find((item) => item.breakerId === id);
    return {
      id, designation: config.name, name: config.description, description: config.description,
      rating: config.rating, ratingA: config.rating, characteristic: 'C', networkType: id === 'qf0' && threePhaseMode ? 'three' : 'single',
      voltageV: id === 'qf0' && threePhaseMode ? state.lastMeasurements.voltage : phaseVoltage || 230, phase: id === 'qf0' ? '3~' : '—',
      cable: line ? { material: line.material, sectionMM2: line.section, ampacityA: null } : { material: 'copper', sectionMM2: null, ampacityA: null },
      linkedLoadIds: [], enabled: state.settings.energyLab.breakers[id] !== false, fixed: true
    };
  });
  return [...base, ...state.settings.energyLab.customBreakers.map((breaker) => ({ ...breaker, rating: breaker.ratingA, description: breaker.name, fixed: false }))];
}

function getBreakerDefinition(breakerId) {
  return getAllBreakerDefinitions().find((breaker) => breaker.id === breakerId) || null;
}

function getBreakerLoadCatalog() {
  return collectLoadModels({ respectBreakers: false, includeBreakerLoads: false }).map((load) => ({ ...load, efficiency: 1 }));
}

function calculateBreakerValues({ networkType = 'single', voltageV = 230, powerW = 0, powerFactor = 1, efficiency = 1 }) {
  const p = Number(powerW); const voltage = Number(voltageV); const factor = Number(powerFactor); const eta = Number(efficiency);
  if (![p, voltage, factor, eta].every(Number.isFinite) || p < 0 || voltage <= 0 || factor <= 0 || factor > 1 || eta <= 0 || eta > 1) return null;
  const inputPowerW = p / eta;
  const apparentPowerVA = inputPowerW / factor;
  const reactivePowerVar = Math.sqrt(Math.max(0, apparentPowerVA ** 2 - inputPowerW ** 2));
  const phaseFactor = networkType === 'three' ? Math.sqrt(3) : 1;
  return {
    usefulPowerW: p, activePowerW: inputPowerW, reactivePowerVar, apparentPowerVA,
    powerFactor: apparentPowerVA > 0 ? inputPowerW / apparentPowerVA : 1,
    calculatedCurrentA: apparentPowerVA / (phaseFactor * voltage)
  };
}

function getConfiguredBreakerValues(breaker) {
  const catalog = getBreakerLoadCatalog();
  const selected = breaker.linkedLoadIds?.length ? catalog.filter((load) => breaker.linkedLoadIds.includes(load.id)) : [];
  let powerW = breaker.powerW; let powerFactor = breaker.powerFactor;
  if (selected.length) {
    const totals = calculateLoadTotals(selected.map((load) => ({ ...load, efficiency: 1 })), breaker.voltageV);
    powerW = totals.activePowerW; powerFactor = totals.powerFactor;
  }
  const values = calculateBreakerValues({ networkType: breaker.networkType, voltageV: breaker.voltageV, powerW, powerFactor, efficiency: breaker.efficiency });
  if (!values) return null;
  return {
    ...values, powerW, selectedLoads: selected,
    currentA: breaker.currentMode === 'manual' && Number.isFinite(breaker.manualCurrentA) ? breaker.manualCurrentA : values.calculatedCurrentA,
    loadChanged: Boolean(selected.length && Number.isFinite(breaker.snapshotPowerW) && Math.abs(powerW - breaker.snapshotPowerW) > 0.5)
  };
}

function suggestBreakerRating(currentA) {
  return BREAKER_RATINGS_A.find((rating) => rating >= currentA) || BREAKER_RATINGS_A[BREAKER_RATINGS_A.length - 1];
}

function getCableCheck(breaker, currentA) {
  const ampacity = Number(breaker.cable?.ampacityA);
  if (breaker.ratingA < currentA) return { status: 'danger', text: 'Автомат меньше расчётного тока нагрузки', ampacityA: Number.isFinite(ampacity) && ampacity > 0 ? ampacity : null };
  if (!Number.isFinite(ampacity) || ampacity <= 0) return { status: 'unknown', text: 'Допустимый ток кабеля необходимо проверить', ampacityA: null };
  if (breaker.ratingA > ampacity) return { status: 'danger', text: 'Автомат не обеспечивает требуемую защиту кабеля', ampacityA: ampacity };
  return { status: 'ok', text: 'Предварительно подходит: Ib ≤ In ≤ Iz', ampacityA: ampacity };
}

function getBreakerMeasurements() {
  const voltage = state.lastMeasurements.voltage || (state.settings.energyLab.networkType === 'three' ? 400 : 230);
  const phaseVoltage = state.settings.energyLab.networkType === 'three' ? voltage / Math.sqrt(3) : voltage;
  const activeLoads = collectLoadModels({ onlyActive: true });
  return Object.fromEntries(getAllBreakerDefinitions().map((config) => {
    const id = config.id;
    const loads = id === 'qf0' ? activeLoads : activeLoads.filter((load) => load.branch === id);
    const lineVoltage = config.fixed ? (config.networkType === 'three' ? voltage : phaseVoltage) : config.voltageV;
    const totals = calculateLoadTotals(loads, lineVoltage, config.networkType);
    const calculatedCurrent = totals.apparentPowerVA / ((config.networkType === 'three' ? Math.sqrt(3) : 1) * Math.max(lineVoltage, 0.001));
    const configured = config.fixed ? null : getConfiguredBreakerValues(config);
    const enabled = isBreakerEnabled(id);
    // Рабочий ток карточки всегда приходит из фактически включённых нагрузок.
    // Ручной Imax остаётся проектным параметром для подбора автомата/кабеля,
    // но не подменяет текущий ток симулятора.
    const current = enabled ? calculatedCurrent : 0;
    return [id, {
      ...config,
      enabled,
      tripped: Boolean(state.settings.energyLab.breakerTrips[id]),
      current,
      calculatedCurrent,
      percent: current / config.ratingA * 100,
      loads,
      totals,
      configured,
      loadChanged: configured?.loadChanged || false
    }];
  }));
}

function calculatePhaseData() {
  const phases = {
    L1: { name: 'L1', voltage: 230, loads: [] },
    L2: { name: 'L2', voltage: 230, loads: [] },
    L3: { name: 'L3', voltage: 230, loads: [] }
  };
  collectLoadModels({ onlyActive: true }).forEach((load) => {
    if (load.phase === '3~') {
      Object.values(phases).forEach((phase) => phase.loads.push({ ...load, id: `${load.id}:${phase.name}`, powerW: load.powerW / 3 }));
    } else (phases[load.phase] || phases.L1).loads.push(load);
  });
  Object.values(phases).forEach((phase) => Object.assign(phase, calculateLoadTotals(phase.loads, phase.voltage)));
  return phases;
}

function breakerStatusText(breaker) {
  if (breaker.tripped) return { label: 'СРАБОТАЛ', className: 'is-danger' };
  if (!breaker.enabled) return { label: 'ОТКЛ', className: 'is-off' };
  if (breaker.percent > 100) return { label: 'ПЕРЕГРУЗКА', className: 'is-danger' };
  if (breaker.percent >= 80) return { label: 'ВНИМАНИЕ', className: 'is-warning' };
  return { label: 'ВКЛ', className: 'is-on' };
}

function renderEnergyLabMetric(label, value, unit = '') {
  return `<div class="energylab-metric"><span>${label}</span><strong>${value}${unit ? ` <small>${unit}</small>` : ''}</strong></div>`;
}

function renderSingleLineTool() {
  const breakers = getBreakerMeasurements();
  const branch = (id) => {
    const breaker = breakers[id];
    const status = breakerStatusText(breaker);
    return `<div class="energylab-diagram-branch ${status.className}"><span class="energylab-wire"></span><div class="energylab-device"><b>${escapeHtml(breaker.designation)} ${breaker.characteristic || 'C'}${breaker.ratingA}</b><span>${escapeHtml(breaker.description)}</span><small>${breaker.current.toFixed(2)} А · ${status.label}</small></div></div>`;
  };
  const childIds = Object.keys(breakers).filter((id) => id !== 'qf0');
  return `<article class="panel energylab-tool-panel"><p class="tool-description">Однолинейная схема использует те же нагрузки и автоматы, что и Dashboard.</p><div class="energylab-diagram-scroll"><div class="energylab-single-line"><div class="energylab-device source"><b>СЕТЬ ${state.lastMeasurements.voltage.toFixed(1)} В</b><small>${state.lastMeasurements.frequency.toFixed(2)} Гц</small></div><span class="energylab-wire vertical"></span><div class="energylab-device"><b>СЧЁТЧИК</b><small>${state.settings.energyKWh.toFixed(3)} кВт·ч</small></div><span class="energylab-wire vertical"></span><div class="energylab-device ${breakerStatusText(breakers.qf0).className}"><b>QF0 C32</b><small>${breakers.qf0.current.toFixed(2)} А · ${breakerStatusText(breakers.qf0).label}</small></div><div class="energylab-branch-bus">${childIds.map(branch).join('')}</div></div></div><p class="energylab-note">Токи и статусы обновляются из общей модели симулятора. Пользовательские автоматы добавляются сюда автоматически.</p></article>`;
}

function renderHomeTool() {
  const activeLoads = collectLoadModels({ onlyActive: true });
  const groups = [
    { title: 'КУХНЯ', icon: '🍽', ids: ['kettle', 'conditioner'] },
    { title: 'ГОСТИНАЯ', icon: '🛋', ids: ['television', 'computer'] },
    { title: 'ОСВЕЩЕНИЕ', icon: '💡', ids: ['lighting'] },
    { title: 'СВОИ НАГРУЗКИ', icon: '🔌', custom: true }
  ];
  return `<div class="energylab-room-grid">${groups.map((group) => {
    const loads = activeLoads.filter((load) => group.custom ? load.custom : group.ids.includes(load.id));
    const totals = calculateLoadTotals(loads, state.lastMeasurements.voltage);
    const energyShare = state.lastMeasurements.activePower > 0 ? state.settings.energyKWh * (totals.activePowerW / 1000) / state.lastMeasurements.activePower : 0;
    return `<article class="panel energylab-room"><span class="energylab-room-icon">${group.icon}</span><h3>${group.title}</h3><p>${loads.length ? loads.map((load) => escapeHtml(load.name)).join(', ') : 'Нет активных нагрузок'}</p><div class="energylab-inline-metrics">${renderEnergyLabMetric('P', (totals.activePowerW / 1000).toFixed(2), 'кВт')}${renderEnergyLabMetric('I', totals.currentA.toFixed(2), 'А')}${renderEnergyLabMetric('Доля E', energyShare.toFixed(3), 'кВт·ч')}</div></article>`;
  }).join('')}</div>`;
}

function nextBreakerDesignation() {
  const used = new Set(getAllBreakerDefinitions().map((breaker) => breaker.designation.toUpperCase()));
  let number = 0; while (used.has(`QF${number}`)) number += 1;
  return `QF${number}`;
}

function renderBreakerForm(existing = null) {
  const item = existing || { designation: nextBreakerDesignation(), name: '', networkType: 'single', voltageV: 230, powerW: 0, powerFactor: 1, efficiency: 1, currentMode: 'auto', manualCurrentA: null, characteristic: 'C', ratingA: null, phase: 'L1', cable: { material: 'copper', sectionMM2: 2.5 }, linkedLoadIds: [] };
  const catalog = getBreakerLoadCatalog();
  const linked = new Set(item.linkedLoadIds || []);
  const preview = existing ? getConfiguredBreakerValues(item) : calculateBreakerValues(item);
  const previewCurrent = item.currentMode === 'manual' && Number.isFinite(item.manualCurrentA) ? item.manualCurrentA : preview?.calculatedCurrentA || 0;
  return `<div class="energylab-breaker-editor"><button class="text-button" type="button" data-energy-action="breaker-cancel">← К автоматам</button><form class="panel energylab-breaker-form" id="energyLabBreakerForm" data-breaker-id="${escapeHtml(item.id || '')}" novalidate><div class="energylab-section-heading"><div><p class="eyebrow">EnergyLab</p><h3>${existing ? `Изменить ${escapeHtml(item.designation)}` : 'Добавить автоматический выключатель'}</h3></div></div><div class="energylab-form-grid"><label><span>Название линии</span><input name="name" maxlength="100" required value="${escapeHtml(item.name)}" placeholder="Кондиционер"></label><label><span>Обозначение</span><input name="designation" maxlength="20" required value="${escapeHtml(item.designation)}"></label><label><span>Тип сети</span><select name="networkType" id="breakerNetworkType"><option value="single" ${item.networkType === 'single' ? 'selected' : ''}>1-фазная</option><option value="three" ${item.networkType === 'three' ? 'selected' : ''}>3-фазная</option></select></label><label><span>Напряжение, В</span><input name="voltageV" id="breakerVoltage" type="number" min="1" step="any" value="${item.voltageV}"></label><label><span>Полезная мощность, Вт</span><input name="powerW" id="breakerPower" type="number" min="0" step="any" value="${item.powerW}"></label><label><span>cosφ</span><input name="powerFactor" id="breakerPowerFactor" type="number" min="0.01" max="1" step="0.01" value="${item.powerFactor}"></label><label><span>КПД η</span><input name="efficiency" type="number" min="0.01" max="1" step="0.01" value="${item.efficiency}"></label><label><span>Максимальный рабочий ток</span><select name="currentMode" id="breakerCurrentMode"><option value="auto" ${item.currentMode !== 'manual' ? 'selected' : ''}>AUTO</option><option value="manual" ${item.currentMode === 'manual' ? 'selected' : ''}>MANUAL</option></select></label><label><span>Максимальный ток, А</span><input name="manualCurrentA" id="breakerManualCurrent" type="number" min="0.001" step="any" value="${item.currentMode === 'manual' && item.manualCurrentA ? item.manualCurrentA : previewCurrent.toFixed(3)}" ${item.currentMode === 'manual' ? '' : 'readonly'}></label><label><span>Характеристика</span><select name="characteristic">${BREAKER_CHARACTERISTICS.map((value) => `<option ${value === item.characteristic ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label><span>Номинальный ток автомата</span><select name="ratingA" id="breakerRating"><option value="">АВТО — предложить</option>${BREAKER_RATINGS_A.map((value) => `<option value="${value}" ${value === item.ratingA ? 'selected' : ''}>${value} A</option>`).join('')}</select></label><label><span>Фаза</span><select name="phase" id="breakerPhase">${BREAKER_PHASES.map((value) => `<option value="${value}" ${value === item.phase ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label><span>Материал кабеля</span><select name="cableMaterial"><option value="copper" ${item.cable.material === 'copper' ? 'selected' : ''}>Медь</option><option value="aluminum" ${item.cable.material === 'aluminum' ? 'selected' : ''}>Алюминий</option></select></label><label><span>Сечение, мм²</span><input name="cableSection" type="number" min="0.1" step="0.1" value="${item.cable.sectionMM2}"></label></div><p class="energylab-note">Введённая P — полезная выходная мощность. Электрическая входная мощность Pвх = P / η.</p><fieldset class="energylab-breaker-load-picker"><legend>Выбрать существующие нагрузки</legend>${catalog.map((load) => `<label><input type="checkbox" name="linkedLoadIds" value="${escapeHtml(load.id)}" ${linked.has(load.id) ? 'checked' : ''}><span>${escapeHtml(load.name)} — ${load.powerW.toFixed(0)} Вт</span></label>`).join('') || '<p>Нагрузки ещё не созданы.</p>'}</fieldset><div class="energylab-breaker-preview" id="breakerFormPreview"><strong>Расчётный ток: ${previewCurrent.toFixed(2)} А</strong><span>Нажмите «Рассчитать автоматически» для предложения номинала.</span></div><p class="field-error" id="energyLabBreakerError"></p><div class="energylab-action-row"><button class="button button-secondary" type="button" data-energy-action="breaker-auto-calculate">⚡ Рассчитать автоматически</button><button class="button button-primary" type="submit">${existing ? 'Сохранить изменения' : 'Добавить автомат'}</button><button class="button button-secondary" type="button" data-energy-action="breaker-cancel">Отмена</button></div></form></div>`;
}

function renderBreakerDetail(breakerId) {
  const measurement = getBreakerMeasurements()[breakerId];
  if (!measurement) { state.energyLab.breakerView = 'list'; return renderBreakersTool(); }
  const status = breakerStatusText(measurement); const configured = measurement.fixed ? null : getConfiguredBreakerValues(measurement);
  const current = configured?.currentA ?? measurement.current; const check = getCableCheck(measurement, current);
  const totals = configured || measurement.totals;
  const loads = measurement.fixed ? measurement.loads : configured?.selectedLoads || [];
  return `<div class="energylab-breaker-detail"><button class="text-button" type="button" data-energy-action="breaker-back">← Автоматические выключатели</button><article class="panel energylab-tool-panel"><div class="energylab-card-heading"><div><span>${escapeHtml(measurement.name)}</span><h3>${escapeHtml(measurement.designation)}</h3></div><b class="energylab-breaker-status">● ${status.label}</b></div><div class="energylab-breaker-passport">${renderEnergyLabMetric('Тип сети', measurement.networkType === 'three' ? '3-фазная' : '1-фазная')}${renderEnergyLabMetric('Напряжение', Number(measurement.voltageV).toFixed(0), 'В')}${renderEnergyLabMetric('Pполезн.', (totals.usefulPowerW / 1000).toFixed(2), 'кВт')}${renderEnergyLabMetric('Pвх', (totals.activePowerW / 1000).toFixed(2), 'кВт')}${renderEnergyLabMetric('Q', (totals.reactivePowerVar / 1000).toFixed(2), 'квар')}${renderEnergyLabMetric('S', (totals.apparentPowerVA / 1000).toFixed(2), 'кВА')}${renderEnergyLabMetric('cosφ', totals.powerFactor.toFixed(2))}${renderEnergyLabMetric('Текущий ток', measurement.current.toFixed(2), 'А')}${configured ? renderEnergyLabMetric('Ib для подбора', current.toFixed(2), 'А') : ''}${renderEnergyLabMetric('Автомат', `${measurement.characteristic}${measurement.ratingA}`)}${renderEnergyLabMetric('Загрузка', (measurement.current / measurement.ratingA * 100).toFixed(1), '%')}${renderEnergyLabMetric('Фаза', measurement.phase)}${renderEnergyLabMetric('Кабель', `${measurement.cable.material === 'aluminum' ? 'Al' : 'Cu'} ${measurement.cable.sectionMM2 ?? '—'}`, measurement.cable.sectionMM2 ? 'мм²' : '')}${renderEnergyLabMetric('Iz кабеля', check.ampacityA == null ? '—' : check.ampacityA.toFixed(1), check.ampacityA == null ? '' : 'А')}</div><p class="energylab-cable-check is-${check.status}">${check.status === 'ok' ? '✓' : '⚠'} ${escapeHtml(check.text)}</p><section class="energylab-connected-loads"><h4>Подключённые нагрузки</h4><p>${loads.length ? loads.map((load) => escapeHtml(load.name)).join(', ') : measurement.fixed ? 'Нет активных нагрузок' : 'Отдельная нагрузка линии'}</p></section><div class="energylab-action-row">${measurement.fixed ? '' : `<button class="button button-primary" type="button" data-energy-action="breaker-edit" data-breaker-id="${escapeHtml(breakerId)}">Изменить</button>`}<button class="button button-secondary" type="button" data-energy-action="breaker-back">Закрыть</button></div></article></div>`;
}

function renderBreakersTool() {
  if (state.energyLab.breakerView === 'form') return renderBreakerForm(getCustomBreakerById(state.energyLab.breakerId));
  if (state.energyLab.breakerView === 'detail') return renderBreakerDetail(state.energyLab.breakerId);
  const breakers = getBreakerMeasurements();
  return `<div class="energylab-toolbar"><p class="tool-description">Срабатывание и пороги в этом экране учебные и не заменяют проект защиты.</p><button class="button button-primary" type="button" data-energy-action="breaker-add">+ Добавить автомат</button></div><div class="energylab-breaker-grid">${Object.entries(breakers).map(([id, breaker]) => {
    const status = breakerStatusText(breaker); const deleteConfirm = state.energyLab.breakerDeleteId === id;
    const powerKW = (breaker.totals.activePowerW / 1000).toFixed(2);
    return `<article class="panel energylab-breaker-card ${status.className}"><div class="energylab-card-heading"><div><span>${escapeHtml(breaker.description)}</span><h3>${escapeHtml(breaker.designation)}</h3></div><b>${breaker.characteristic || 'C'}${breaker.ratingA}</b></div><div class="energylab-breaker-reading"><strong>${breaker.current.toFixed(2)} А</strong><span>${breaker.percent.toFixed(0)}% номинала</span></div><div class="energylab-load-bar"><i style="width:${clamp(breaker.percent, 0, 100)}%"></i></div><p class="energylab-breaker-status">● ${status.label}</p>${breaker.loadChanged ? '<p class="energylab-breaker-warning">⚠ Нагрузка изменилась. Рекомендуется повторно проверить выбранный автомат.</p>' : ''}<div class="energylab-breaker-meta"><span>${Number(breaker.voltageV).toFixed(0)} В</span><span>${powerKW} кВт</span><span>${breaker.cable.sectionMM2 ? `${breaker.cable.material === 'aluminum' ? 'Al' : 'Cu'} ${breaker.cable.sectionMM2} мм²` : 'Кабель —'}</span><span>${breaker.phase}</span></div><div class="energylab-action-row"><button class="button button-secondary" type="button" data-energy-action="toggle-breaker" data-breaker-id="${escapeHtml(id)}">${breaker.enabled ? 'Отключить' : 'Включить'}</button><button class="text-button" type="button" data-energy-action="breaker-open" data-breaker-id="${escapeHtml(id)}">Открыть</button>${breaker.fixed ? '' : `<button class="text-button" type="button" data-energy-action="breaker-edit" data-breaker-id="${escapeHtml(id)}">Изменить</button>${breaker.loadChanged ? `<button class="text-button" type="button" data-energy-action="breaker-recalculate" data-breaker-id="${escapeHtml(id)}">Пересчитать</button>` : ''}<button class="text-button danger" type="button" data-energy-action="breaker-delete" data-breaker-id="${escapeHtml(id)}">${deleteConfirm ? `Удалить ${escapeHtml(breaker.designation)}?` : 'Удалить'}</button>`}<button class="text-button" type="button" data-energy-action="trip-breaker" data-breaker-id="${escapeHtml(id)}">Учебное срабатывание</button></div></article>`;
  }).join('')}</div>`;
}

function renderLoadsTool() {
  const measuredVoltage = state.lastMeasurements.voltage || (state.settings.energyLab.networkType === 'three' ? 400 : 230);
  const phaseVoltage = state.settings.energyLab.networkType === 'three' ? measuredVoltage / Math.sqrt(3) : measuredVoltage;
  const loads = collectLoadModels({ includeBreakerLoads: false });
  const formLoad = state.energyLab.editingLoadId ? state.settings.customLoads.find((load) => load.id === state.energyLab.editingLoadId) : null;
  const form = state.energyLab.showLoadForm ? `<form class="panel energylab-load-form" id="energyLabLoadForm" novalidate data-edit-id="${formLoad ? escapeHtml(formLoad.id) : ''}"><h3>${formLoad ? 'Изменить нагрузку' : 'Добавить свою нагрузку'}</h3><div class="energylab-form-grid"><label><span>Название</span><input name="name" maxlength="80" value="${formLoad ? escapeHtml(formLoad.name) : ''}" placeholder="Насос"></label><label><span>Мощность, Вт</span><input name="powerW" type="number" min="0" value="${formLoad ? formLoad.powerW : 1500}"></label><label><span>cosφ</span><input name="powerFactor" type="number" min="0" max="1" step="0.01" value="${formLoad ? formLoad.powerFactor : 0.85}"></label><label><span>Количество</span><input name="quantity" type="number" min="1" step="1" value="${formLoad ? formLoad.quantity : 1}"></label></div><p class="field-error" id="energyLabLoadFormError"></p><div class="energylab-action-row"><button class="button button-primary" type="submit">${formLoad ? 'Сохранить' : 'Добавить'}</button><button class="button button-secondary" type="button" data-energy-action="cancel-load-form">Отмена</button></div></form>` : '';
  return `<div class="energylab-toolbar"><p>Напряжение для расчёта: <strong>${state.settings.energyLab.networkType === 'three' ? `${measuredVoltage.toFixed(1)} В линейное / ${phaseVoltage.toFixed(1)} В фазное` : `${phaseVoltage.toFixed(1)} В`}</strong></p><button class="button button-primary" type="button" data-energy-action="show-add-load">+ Добавить свою нагрузку</button></div>${form}<div class="energylab-load-grid">${loads.map((load) => {
    const breaker = getCustomBreakerById(load.branch);
    const networkType = breaker?.networkType === 'three' || load.phase === '3~' ? 'three' : 'single';
    const loadVoltage = breaker?.voltageV || (networkType === 'three' ? measuredVoltage : phaseVoltage);
    const totals = calculateLoadTotals([load], loadVoltage, networkType);
    const current = totals.currentA;
    const status = load.enabled && load.energized ? '● ВКЛ' : load.enabled ? '● НЕТ ПИТАНИЯ' : '● ВЫКЛ';
    return `<article class="panel energylab-load-card ${load.enabled && load.energized ? 'is-on' : 'is-off'}"><div class="energylab-card-heading"><div><span>${load.custom ? '🔌' : ''} ${escapeHtml(load.name)}</span><h3>${(load.powerW / 1000).toFixed(2)} кВт полезн.</h3></div><b>${status}</b></div><div class="energylab-inline-metrics">${renderEnergyLabMetric('Pвх', (totals.activePowerW / 1000).toFixed(2), 'кВт')}${renderEnergyLabMetric('I', current.toFixed(2), 'А')}${renderEnergyLabMetric('cosφ', load.powerFactor.toFixed(2))}${renderEnergyLabMetric('Фаза', load.phase)}</div><div class="energylab-action-row"><button class="button button-secondary" type="button" data-energy-action="toggle-energy-load" data-load-id="${escapeHtml(load.sourceId || load.id)}" data-custom="${load.custom}">${load.enabled ? 'Выключить' : 'Включить'}</button>${load.custom ? `<button class="text-button" type="button" data-energy-action="edit-energy-load" data-load-id="${escapeHtml(load.sourceId)}">Изменить</button><button class="text-button danger" type="button" data-energy-action="delete-energy-load" data-load-id="${escapeHtml(load.sourceId)}">Удалить</button>` : ''}</div></article>`;
  }).join('')}</div>`;
}

function renderThreePhaseTool() {
  const phases = calculatePhaseData();
  const currents = Object.values(phases).map((phase) => phase.currentA);
  const neutralEstimate = Math.max(...currents) - Math.min(...currents);
  return `<article class="panel energylab-tool-panel"><div class="energylab-toolbar"><div><span class="eyebrow">Тип сети</span><h3>3-фазная 400/230 В</h3></div><button class="button button-secondary" type="button" data-energy-action="set-network-type" data-network-type="${state.settings.energyLab.networkType === 'three' ? 'single' : 'three'}">${state.settings.energyLab.networkType === 'three' ? 'Вернуть 1-фазный режим' : 'Перейти на 3 фазы'}</button></div><div class="energylab-phase-grid">${Object.values(phases).map((phase) => `<section class="energylab-phase-card ${phase.name.toLowerCase()}"><h3>${phase.name}</h3>${renderEnergyLabMetric('U', phase.voltage.toFixed(1), 'В')}${renderEnergyLabMetric('I', phase.currentA.toFixed(2), 'А')}${renderEnergyLabMetric('P', (phase.activePowerW / 1000).toFixed(2), 'кВт')}<p>${phase.loads.length ? phase.loads.map((load) => escapeHtml(load.name)).join(', ') : 'Нет нагрузок'}</p></section>`).join('')}<section class="energylab-phase-card neutral"><h3>N</h3><p>Нейтраль</p><strong>Оценка несимметрии: ${neutralEstimate.toFixed(2)} А</strong></section></div><p class="energylab-note">Однофазные нагрузки распределены по L1/L2/L3. Это учебная модель, ток нейтрали показан как простая оценка.</p></article>`;
}

function getBalanceSuggestion() {
  const phases = calculatePhaseData();
  const ordered = Object.values(phases).sort((a, b) => a.currentA - b.currentA);
  const target = ordered[0];
  const source = ordered[2];
  const movable = [...source.loads].sort((a, b) => b.powerW - a.powerW)[0];
  if (!movable || source.currentA - target.currentA < 0.1) return null;
  const linkedBreaker = getCustomBreakerById(movable.branch);
  return { loadId: movable.id, breakerId: linkedBreaker?.networkType === 'single' ? linkedBreaker.id : null, loadName: linkedBreaker?.name || movable.name, from: source.name, to: target.name };
}

function renderPhaseBalanceTool() {
  const phases = calculatePhaseData();
  const values = Object.values(phases);
  const average = values.reduce((sum, phase) => sum + phase.currentA, 0) / 3;
  const max = Math.max(...values.map((phase) => phase.currentA), 1);
  const unbalance = average > 0 ? (Math.max(...values.map((phase) => phase.currentA)) - Math.min(...values.map((phase) => phase.currentA))) / average * 100 : 0;
  const suggestion = state.energyLab.balanceSuggestion;
  return `<article class="panel energylab-tool-panel"><div class="phase-balance-bars">${values.map((phase) => `<div class="phase-balance-row"><b>${phase.name}</b><div><i style="width:${phase.currentA / max * 100}%"></i></div><strong>${phase.currentA.toFixed(2)} A</strong></div>`).join('')}</div><div class="energylab-summary-grid compact">${renderEnergyLabMetric('Средний ток', average.toFixed(2), 'А')}${renderEnergyLabMetric('Неравномерность', unbalance.toFixed(1), '%')}</div>${suggestion ? `<div class="energylab-suggestion"><span>Предложение</span><strong>Перенести «${escapeHtml(suggestion.loadName)}»: ${suggestion.from} → ${suggestion.to}</strong><div class="energylab-action-row"><button class="button button-primary" type="button" data-energy-action="apply-balance">Применить</button><button class="button button-secondary" type="button" data-energy-action="cancel-balance">Отмена</button></div></div>` : '<button class="button button-primary" type="button" data-energy-action="suggest-balance">⚖ Предложить балансировку</button>'}<p class="energylab-note">Неравномерность рассчитана для учебной визуализации как (Imax − Imin) / Iср.</p></article>`;
}

function renderEmergencyTool() {
  const scenarios = [
    ['undervoltage', '📉', 'Пониженное напряжение'],
    ['overvoltage', '📈', 'Повышенное напряжение'],
    ['overload', '🔥', 'Перегрузка'],
    ['low-power-factor', '⚡', 'Низкий cosφ'],
    ['line-outage', '🔌', 'Отключение линии']
  ];
  return `<p class="tool-description">Сценарии меняют общую модель Dashboard, схемы, графиков и журнала. После перезагрузки аварийный режим не продолжается.</p><div class="energylab-scenario-grid">${scenarios.map(([id, icon, label]) => `<button class="energylab-scenario ${state.energyLab.emergencyMode === id ? 'active' : ''}" type="button" data-energy-action="set-emergency" data-emergency="${id}"><span>${icon}</span><strong>${label}</strong><small>${state.energyLab.emergencyMode === id ? 'Сценарий активен' : 'Запустить'}</small></button>`).join('')}</div><button class="button button-secondary" type="button" data-energy-action="restore-normal">Восстановить нормальный режим</button>`;
}

function renderAnalysisTool() {
  const m = state.lastMeasurements;
  const metrics = [['U', m.voltage.toFixed(1), 'В'], ['I', m.current.toFixed(2), 'А'], ['P', m.activePower.toFixed(2), 'кВт'], ['Q', m.reactivePower.toFixed(2), 'квар'], ['S', m.apparentPower.toFixed(2), 'кВА'], ['cosφ', m.powerFactor.toFixed(2), ''], ['f', m.frequency.toFixed(2), 'Гц'], ['E', state.settings.energyKWh.toFixed(3), 'кВт·ч']];
  const controls = [['voltage', 'U'], ['current', 'I'], ['power', 'P'], ['reactive', 'Q'], ['apparent', 'S'], ['powerFactor', 'cosφ']];
  return `<div class="energylab-analysis-grid">${metrics.map(([label, value, unit]) => renderEnergyLabMetric(label, value, unit)).join('')}</div><article class="panel energylab-analysis-chart"><div class="energylab-toolbar"><h3>График общей модели</h3><div class="chart-metric-tabs">${controls.map(([id, label]) => `<button type="button" class="${state.energyLab.analysisMetric === id ? 'active' : ''}" data-energy-action="analysis-metric" data-metric="${id}">${label}</button>`).join('')}</div></div><div class="chart-container"><canvas id="energyLabAnalysisChart" aria-label="График EnergyLab"></canvas></div></article>`;
}

function getLineLoads(lineId) {
  const branchId = ENERGY_LAB_LINES[lineId]?.breakerId;
  return collectLoadModels({ onlyActive: true }).filter((load) => load.branch === branchId);
}

function renderLineTool() {
  const selectedId = state.energyLab.selectedLine || 'kitchen';
  const line = state.settings.energyLab.lines[selectedId];
  const result = state.energyLab.lineResult;
  return `<article class="panel energylab-tool-panel"><form id="energyLabLineForm" class="energylab-form-grid" novalidate><label><span>Линия</span><select name="lineId">${Object.entries(state.settings.energyLab.lines).map(([id, item]) => `<option value="${id}" ${id === selectedId ? 'selected' : ''}>${item.name}</option>`).join('')}</select></label><label><span>Длина, м</span><input name="length" type="number" min="0" step="0.1" value="${line.length}"></label><label><span>Материал</span><select name="material"><option value="copper" ${line.material === 'copper' ? 'selected' : ''}>Медь</option><option value="aluminum" ${line.material === 'aluminum' ? 'selected' : ''}>Алюминий</option></select></label><label><span>Сечение, мм²</span><input name="section" type="number" min="0.1" step="0.1" value="${line.section}"></label><label><span>Автомат, А</span><input name="breakerRating" type="number" min="1" step="1" value="${line.breakerRating}"></label><div class="form-actions"><button class="button button-primary" type="submit">Рассчитать</button></div><p class="field-error" id="energyLabLineError"></p></form>${result ? `<div class="energylab-line-results">${renderEnergyLabMetric('Ток', result.current.toFixed(2), 'А')}${renderEnergyLabMetric('Сопротивление', result.resistance.toFixed(4), 'Ом')}${renderEnergyLabMetric('ΔU', result.voltageDrop.toFixed(2), 'В')}${renderEnergyLabMetric('ΔU', result.dropPercent.toFixed(2), '%')}${renderEnergyLabMetric('Uкон', result.endVoltage.toFixed(2), 'В')}</div>` : '<p class="energylab-note">Задайте параметры и нажмите «Рассчитать».</p>'}<p class="energylab-note">Используется уже существующая функция <code>calculateVoltageDrop()</code>. Расчёт приближённый: учитывает активное сопротивление.</p></article>`;
}

function renderEventsTool() {
  const filters = [['all', 'Все'], ['switching', 'Переключения'], ['warning', 'Предупреждения'], ['emergency', 'Аварии']];
  const events = state.energyLab.eventFilter === 'all' ? state.events : state.events.filter((event) => event.category === state.energyLab.eventFilter);
  return `<article class="panel energylab-tool-panel"><div class="chart-metric-tabs energylab-event-filters">${filters.map(([id, label]) => `<button type="button" class="${state.energyLab.eventFilter === id ? 'active' : ''}" data-energy-action="event-filter" data-filter="${id}">${label}</button>`).join('')}</div><ol class="energylab-event-list">${events.length ? events.map((event) => `<li class="event-item ${event.type}"><time class="event-time">${new Date(event.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time><span class="event-marker"></span><span class="event-message">${escapeHtml(event.message)}</span></li>`).join('') : '<li class="energylab-empty">Нет событий в этой категории.</li>'}</ol></article>`;
}

const equipmentRepository = Object.freeze({
  all: () => state.settings.equipment,
  find: (id) => state.settings.equipment.find((item) => item.id === id) || null,
  insert(record) {
    state.settings.equipment.push(record);
    saveSettings();
    return record;
  },
  update(id, nextRecord) {
    const index = state.settings.equipment.findIndex((item) => item.id === id);
    if (index < 0) return null;
    state.settings.equipment[index] = nextRecord;
    saveSettings();
    return nextRecord;
  },
  remove(id) {
    const index = state.settings.equipment.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const [removed] = state.settings.equipment.splice(index, 1);
    saveSettings();
    return removed;
  }
});

function equipmentStatusClass(status) {
  if (status === 'active' || status === 'reserve') return 'is-ok';
  if (status === 'needs_check' || status === 'maintenance' || status === 'disabled') return 'is-warning';
  if (status === 'faulty' || status === 'retired') return 'is-danger';
  return '';
}

function formatEquipmentDate(value, includeTime = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', includeTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }).format(date);
}

function localDateValue(date = new Date()) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

function localTimeValue(date = new Date()) {
  return date.toTimeString().slice(0, 5);
}

function equipmentValue(value, unit = '') {
  if (value === null || value === undefined || value === '') return '—';
  return `${escapeHtml(value)}${unit ? ` ${unit}` : ''}`;
}

function addEquipmentHistory(equipment, type, message) {
  equipment.history.unshift({ id: createEquipmentId(), timestamp: new Date().toISOString(), type, message });
  equipment.history = equipment.history.slice(0, 3000);
  equipment.updatedAt = new Date().toISOString();
}

function getEquipmentNextMaintenance(equipment) {
  const groups = groupMaintenanceByNextDate(equipment.maintenance);
  return groups.overdue[0] || groups.upcoming[0] || null;
}

function groupMaintenanceByNextDate(records, todayValue = localDateValue()) {
  const today = new Date(`${todayValue}T00:00:00`).getTime();
  const dated = records.flatMap((item) => {
    if (!item.nextDate || !isValidDateInput(item.nextDate)) return [];
    const timestamp = new Date(`${item.nextDate}T00:00:00`).getTime();
    return Number.isFinite(timestamp) ? [{ ...item, timestamp }] : [];
  }).sort((a, b) => a.timestamp - b.timestamp || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return {
    overdue: dated.filter((item) => item.timestamp < today),
    upcoming: dated.filter((item) => item.timestamp >= today),
    unscheduled: records.filter((item) => !item.nextDate || !isValidDateInput(item.nextDate)).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  };
}

function getEquipmentAttentionItems(includeUpcoming = false) {
  const today = new Date(`${localDateValue()}T00:00:00`).getTime();
  const upcomingLimit = today + 30 * 86400000;
  return equipmentRepository.all().flatMap((equipment) => {
    const next = getEquipmentNextMaintenance(equipment);
    const statusAttention = ['needs_check', 'faulty'].includes(equipment.status);
    const dueAttention = next && next.timestamp <= (includeUpcoming ? upcomingLimit : today);
    if (!statusAttention && !dueAttention) return [];
    return [{ equipment, next, overdueDays: next ? Math.floor((today - next.timestamp) / 86400000) : null }];
  });
}

function getEquipmentCounters() {
  const records = equipmentRepository.all();
  return {
    total: records.length,
    active: records.filter((item) => item.status === 'active').length,
    maintenance: records.filter((item) => item.status === 'maintenance').length,
    needs_check: records.filter((item) => item.status === 'needs_check').length,
    faulty: records.filter((item) => item.status === 'faulty').length
  };
}

function equipmentOptions(items, selected = '', emptyLabel = 'Все') {
  return `<option value="">${emptyLabel}</option>${items.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}`;
}

function uniqueEquipmentOptions(path) {
  const values = equipmentRepository.all().map((equipment) => path(equipment)).filter(Boolean);
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'ru')).map((value) => [value, value]);
}

function getFilteredEquipment() {
  const search = state.energyLab.equipmentSearch.trim().toLocaleLowerCase('ru');
  const filters = state.energyLab.equipmentFilters;
  const attentionIds = new Set(getEquipmentAttentionItems(true).map((item) => item.equipment.id));
  const statusOrder = Object.keys(EQUIPMENT_STATUSES);
  const records = equipmentRepository.all().filter((equipment) => {
    if (state.energyLab.equipmentAttentionOnly && !attentionIds.has(equipment.id)) return false;
    if (filters.type && equipment.type !== filters.type) return false;
    if (filters.manufacturer && equipment.manufacturer !== filters.manufacturer) return false;
    if (filters.status && equipment.status !== filters.status) return false;
    if (filters.object && equipment.location.object !== filters.object) return false;
    if (filters.panel && equipment.location.panel !== filters.panel) return false;
    if (filters.line && equipment.location.line !== filters.line) return false;
    if (!search) return true;
    const haystack = [equipment.designation, equipment.name, equipment.manufacturer, equipment.model, equipment.serialNumber, equipment.inventoryNumber, equipment.location.object, equipment.location.panel, equipment.location.line].join(' ').toLocaleLowerCase('ru');
    return haystack.includes(search);
  });
  return records.sort((a, b) => {
    if (state.energyLab.equipmentSort === 'name') return `${a.designation} ${a.name}`.localeCompare(`${b.designation} ${b.name}`, 'ru');
    if (state.energyLab.equipmentSort === 'status') return statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
    if (state.energyLab.equipmentSort === 'maintenance') {
      const nextA = getEquipmentNextMaintenance(a)?.timestamp;
      const nextB = getEquipmentNextMaintenance(b)?.timestamp;
      if (!Number.isFinite(nextA) && !Number.isFinite(nextB)) return 0;
      if (!Number.isFinite(nextA)) return 1;
      if (!Number.isFinite(nextB)) return -1;
      return nextA - nextB;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function renderEquipmentCounters() {
  const counters = getEquipmentCounters();
  return `<div class="equipment-counters">${[['Всего', counters.total], ['В работе', counters.active], ['Обслуживание', counters.maintenance], ['Требует проверки', counters.needs_check], ['Неисправно', counters.faulty]].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>`;
}

function renderEquipmentAttention() {
  const items = getEquipmentAttentionItems(true);
  if (!items.length) return '';
  return `<section class="equipment-attention"><div class="equipment-section-heading"><div><span class="eyebrow">Требует внимания</span><h3>Ближайшее обслуживание и проверки</h3></div>${state.energyLab.equipmentAttentionOnly ? '<button class="text-button" type="button" data-energy-action="equipment-clear-attention">Показать все</button>' : ''}</div><div class="equipment-attention-list">${items.slice(0, 8).map(({ equipment, next, overdueDays }) => `<button type="button" data-energy-action="equipment-open" data-equipment-id="${escapeHtml(equipment.id)}"><strong>${escapeHtml(equipment.designation)}</strong><span>${next ? overdueDays >= 0 ? `Просрочено на ${overdueDays} дн.` : `Через ${Math.abs(overdueDays)} дн.` : EQUIPMENT_STATUSES[equipment.status]}</span></button>`).join('')}</div></section>`;
}

function renderEquipmentCard(equipment) {
  const statusClass = equipmentStatusClass(equipment.status);
  const primaryRating = equipment.ratings.currentA !== null
    ? `${equipment.ratings.currentA} А`
    : equipment.ratings.powerKVA !== null ? `${equipment.ratings.powerKVA} кВА` : equipment.ratings.powerKW !== null ? `${equipment.ratings.powerKW} кВт` : '—';
  const voltage = equipment.ratings.voltageV !== null ? `${equipment.ratings.voltageV} В` : '';
  return `<article class="equipment-card"><div class="equipment-card-head"><div><span>${escapeHtml(EQUIPMENT_TYPES[equipment.type])}</span><h3>${escapeHtml(equipment.designation)}</h3></div><i class="equipment-status ${statusClass}">● ${escapeHtml(EQUIPMENT_STATUSES[equipment.status])}</i></div><p class="equipment-name">${escapeHtml(equipment.name)}</p><strong class="equipment-model">${escapeHtml([equipment.manufacturer, equipment.model].filter(Boolean).join(' ') || 'Не указано')}</strong><p class="equipment-rating">${escapeHtml([primaryRating, voltage].filter(Boolean).join(' · '))}</p><dl class="equipment-location"><div><dt>Объект</dt><dd>${escapeHtml(equipment.location.object || '—')}</dd></div><div><dt>Щит / линия</dt><dd>${escapeHtml([equipment.location.panel, equipment.location.line].filter(Boolean).join(' / ') || '—')}</dd></div></dl><div class="equipment-card-actions"><button class="button button-primary" type="button" data-energy-action="equipment-open" data-equipment-id="${escapeHtml(equipment.id)}">Открыть</button><button class="text-button" type="button" data-energy-action="equipment-duplicate" data-equipment-id="${escapeHtml(equipment.id)}">Дублировать</button></div></article>`;
}

function renderEquipmentResults() {
  const container = document.getElementById('equipmentResults');
  if (!container) return;
  const records = getFilteredEquipment();
  container.innerHTML = records.length ? records.map(renderEquipmentCard).join('') : '<div class="equipment-empty"><strong>Оборудование не найдено</strong><span>Измените поиск или фильтры.</span></div>';
  const count = document.getElementById('equipmentResultCount');
  if (count) count.textContent = `Найдено: ${records.length}`;
}

function renderEquipmentList() {
  const filters = state.energyLab.equipmentFilters;
  return `<div class="equipment-module"><div class="equipment-toolbar"><div><p class="tool-description">Цифровой журнал паспортных данных, измерений и обслуживания.</p></div><div class="equipment-toolbar-actions"><button class="button button-primary" type="button" data-energy-action="equipment-add">+ Добавить оборудование</button><button class="button button-secondary" type="button" data-energy-action="equipment-export">Экспорт JSON</button><button class="button button-secondary" type="button" data-energy-action="equipment-import">Импорт JSON</button><input id="equipmentImportFile" type="file" accept="application/json,.json" hidden></div></div>${renderEquipmentCounters()}${renderEquipmentAttention()}<section class="panel equipment-filters"><label class="equipment-search"><span>Поиск</span><input id="equipmentSearch" type="search" value="${escapeHtml(state.energyLab.equipmentSearch)}" placeholder="Обозначение, модель, щит, линия…"></label><div class="equipment-filter-grid"><label><span>Тип</span><select data-equipment-filter="type">${equipmentOptions(Object.entries(EQUIPMENT_TYPES), filters.type)}</select></label><label><span>Производитель</span><select data-equipment-filter="manufacturer">${equipmentOptions(uniqueEquipmentOptions((item) => item.manufacturer), filters.manufacturer)}</select></label><label><span>Состояние</span><select data-equipment-filter="status">${equipmentOptions(Object.entries(EQUIPMENT_STATUSES), filters.status)}</select></label><label><span>Объект</span><select data-equipment-filter="object">${equipmentOptions(uniqueEquipmentOptions((item) => item.location.object), filters.object)}</select></label><label><span>Щит</span><select data-equipment-filter="panel">${equipmentOptions(uniqueEquipmentOptions((item) => item.location.panel), filters.panel)}</select></label><label><span>Линия</span><select data-equipment-filter="line">${equipmentOptions(uniqueEquipmentOptions((item) => item.location.line), filters.line)}</select></label><label><span>Сортировка</span><select id="equipmentSort"><option value="created_desc" ${state.energyLab.equipmentSort === 'created_desc' ? 'selected' : ''}>По дате добавления</option><option value="name" ${state.energyLab.equipmentSort === 'name' ? 'selected' : ''}>По названию</option><option value="status" ${state.energyLab.equipmentSort === 'status' ? 'selected' : ''}>По статусу</option><option value="maintenance" ${state.energyLab.equipmentSort === 'maintenance' ? 'selected' : ''}>По ближайшему обслуживанию</option></select></label></div><div class="equipment-filter-footer"><span id="equipmentResultCount"></span><button class="text-button" type="button" data-energy-action="equipment-reset-filters">Сбросить фильтры</button></div></section><div class="equipment-grid" id="equipmentResults">${getFilteredEquipment().map(renderEquipmentCard).join('') || '<div class="equipment-empty"><strong>Оборудование не найдено</strong><span>Добавьте первую запись или измените фильтры.</span></div>'}</div><p class="equipment-data-note">Записи являются пользовательским учётом и не подтверждают заводские характеристики.</p></div>`;
}

function renderEquipmentDynamicFields(type, specs = {}) {
  const fields = EQUIPMENT_DYNAMIC_FIELDS[type] || [];
  if (!fields.length) return '<p class="equipment-form-hint">Для выбранного типа дополнительных паспортных полей нет. Используйте общие параметры и примечание места установки.</p>';
  return fields.map((field) => {
    const value = specs[field.key] ?? '';
    const control = field.type === 'select'
      ? `<select name="spec_${field.key}">${field.options.map((option) => `<option value="${escapeHtml(option)}" ${String(value) === option ? 'selected' : ''}>${escapeHtml(option || 'Не указано')}</option>`).join('')}</select>`
      : `<input name="spec_${field.key}" type="${field.number ? 'number' : 'text'}" ${field.number ? 'min="0" step="any" inputmode="decimal"' : ''} value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || '')}">`;
    return `<label><span>${escapeHtml(field.label)}${field.unit ? `, ${escapeHtml(field.unit)}` : ''}</span>${control}</label>`;
  }).join('');
}

function renderEquipmentFormBase(equipment = null) {
  const item = equipment || {
    designation: '', name: '', type: 'circuit_breaker', manufacturer: '', model: '', serialNumber: '', inventoryNumber: '', year: '', quantity: 1, status: 'active', ratings: {}, specs: {}, location: {}, linkedLineId: null, linkedBreakerId: null, linkedNodeId: null, dataSource: 'manual'
  };
  const typeOptions = Object.entries(EQUIPMENT_TYPES).map(([value, label]) => `<option value="${value}" ${item.type === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const statusOptions = Object.entries(EQUIPMENT_STATUSES).map(([value, label]) => `<option value="${value}" ${item.status === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const lineOptions = equipmentOptions(Object.entries(ENERGY_LAB_LINES).map(([id, line]) => [id, line.name]), item.linkedLineId || '', 'Не привязано');
  const breakerOptions = equipmentOptions(getAllBreakerDefinitions().map((breaker) => [breaker.id, `${breaker.designation} — ${breaker.description}`]), item.linkedBreakerId || '', 'Не привязано');
  const field = (name, label, value = '', attrs = '') => `<label><span>${label}</span><input name="${name}" value="${escapeHtml(value ?? '')}" ${attrs}></label>`;
  return `<div class="equipment-module equipment-editor"><div class="equipment-subnav"><button class="text-button" type="button" data-energy-action="equipment-back">← К списку оборудования</button></div><form id="equipmentForm" class="equipment-form" data-equipment-id="${escapeHtml(equipment?.id || '')}" novalidate><section class="panel equipment-form-section"><div class="equipment-section-heading"><div><p class="eyebrow">Цифровой паспорт</p><h3>${equipment ? `Редактирование ${escapeHtml(equipment.designation)}` : 'Новое оборудование'}</h3></div></div><div class="equipment-form-grid">${field('designation', 'Обозначение *', item.designation, 'required maxlength="80" placeholder="QF1"')}${field('name', 'Название *', item.name, 'required maxlength="160" placeholder="Автомат линии розеток"')}<label><span>Тип оборудования *</span><select name="type" id="equipmentType">${typeOptions}</select></label>${field('manufacturer', 'Производитель', item.manufacturer, 'maxlength="120" placeholder="IEK"')}${field('model', 'Модель', item.model, 'maxlength="120" placeholder="ВА47-29"')}${field('serialNumber', 'Серийный номер', item.serialNumber, 'maxlength="120"')}${field('inventoryNumber', 'Инвентарный номер', item.inventoryNumber, 'maxlength="120"')}${field('year', 'Год выпуска', item.year, 'type="number" min="1800" max="3000" inputmode="numeric"')}${field('quantity', 'Количество *', item.quantity, 'type="number" min="1" step="1" required inputmode="numeric"')}<label><span>Состояние *</span><select name="status">${statusOptions}</select></label></div></section><section class="panel equipment-form-section"><div class="equipment-section-heading"><div><p class="eyebrow">Номинальные данные</p><h3>Электрические параметры</h3></div><small>Необязательные поля</small></div><div class="equipment-form-grid">${field('voltageV', 'Напряжение, В', item.ratings.voltageV, 'type="number" min="0" step="any" inputmode="decimal"')}${field('currentA', 'Ток, А', item.ratings.currentA, 'type="number" min="0" step="any" inputmode="decimal"')}${field('powerKW', 'Мощность, кВт', item.ratings.powerKW, 'type="number" min="0" step="any" inputmode="decimal"')}${field('powerKVA', 'Полная мощность, кВА', item.ratings.powerKVA, 'type="number" min="0" step="any" inputmode="decimal"')}${field('frequencyHz', 'Частота, Гц', item.ratings.frequencyHz, 'type="number" min="0" step="any" inputmode="decimal"')}<label><span>Количество фаз</span><select name="phases"><option value="">Не указано</option><option value="1" ${item.ratings.phases === 1 ? 'selected' : ''}>1</option><option value="3" ${item.ratings.phases === 3 ? 'selected' : ''}>3</option></select></label>${field('powerFactor', 'cosφ', item.ratings.powerFactor, 'type="number" min="0.01" max="1" step="0.01" inputmode="decimal"')}${field('efficiencyPercent', 'КПД, %', item.ratings.efficiencyPercent, 'type="number" min="0" max="100" step="0.1" inputmode="decimal"')}</div></section><section class="panel equipment-form-section"><div class="equipment-section-heading"><div><p class="eyebrow">По типу аппарата</p><h3>Специальные параметры</h3></div></div><div class="equipment-form-grid" id="equipmentDynamicFields">${renderEquipmentDynamicFields(item.type, item.specs)}</div></section><section class="panel equipment-form-section"><div class="equipment-section-heading"><div><p class="eyebrow">Монтаж</p><h3>Место установки</h3></div></div><div class="equipment-form-grid">${field('locationObject', 'Объект', item.location.object, 'maxlength="160" placeholder="Учебная лаборатория"')}${field('locationBuilding', 'Здание', item.location.building, 'maxlength="160" placeholder="Корпус A"')}${field('locationRoom', 'Помещение', item.location.room, 'maxlength="160" placeholder="Электрощитовая"')}${field('locationPanel', 'Щит', item.location.panel, 'maxlength="120" placeholder="ЩР-1"')}${field('locationLine', 'Линия', item.location.line, 'maxlength="160" placeholder="Розетки"')}${field('locationCell', 'Ячейка', item.location.cell, 'maxlength="80" placeholder="№3"')}<label class="equipment-field-wide"><span>Дополнительное описание</span><textarea name="locationDescription" rows="3" maxlength="1000">${escapeHtml(item.location.description || '')}</textarea></label></div></section><section class="panel equipment-form-section"><div class="equipment-section-heading"><div><p class="eyebrow">Будущая интеграция</p><h3>Связь с EnergyLab</h3></div></div><div class="equipment-form-grid"><label><span>Линия EnergyLab</span><select name="linkedLineId">${lineOptions}</select></label><label><span>Автомат EnergyLab</span><select name="linkedBreakerId">${breakerOptions}</select></label>${field('linkedNodeId', 'ID узла схемы', item.linkedNodeId, 'maxlength="100" placeholder="Необязательно"')}</div><p class="equipment-form-hint">Связи сохраняются в паспорте и подготовлены для будущего открытия аппарата из однолинейной схемы.</p></section><p class="field-error equipment-form-error" id="equipmentFormError" role="alert"></p><div class="equipment-form-actions"><button class="button button-primary" type="submit">${equipment ? 'Сохранить изменения' : 'Добавить оборудование'}</button><button class="button button-secondary" type="button" data-energy-action="equipment-cancel-form">Отмена</button></div></form></div>`;
}

function renderEquipmentForm(equipment = null) {
  const html = renderEquipmentFormBase(equipment);
  const installationDate = equipment?.installationDate || '';
  const installationField = `<label><span>Дата установки</span><input name="installationDate" type="date" value="${escapeHtml(installationDate)}"></label>`;
  return html.replace('<label><span>Количество *', `${installationField}<label><span>Количество *`);
}

function renderEquipmentDefinitionList(rows) {
  return `<dl class="equipment-data-grid">${rows.map(([label, value, unit = '']) => `<div><dt>${escapeHtml(label)}</dt><dd>${equipmentValue(value, unit)}</dd></div>`).join('')}</dl>`;
}

function measurementSourceLabel(source) {
  return ({ manual: 'Ручной ввод', simulation: 'Симулятор', real_device: 'Реальное устройство' })[source] || 'Ручной ввод';
}

function renderMaintenanceForm() {
  return `<form id="equipmentMaintenanceForm" class="panel equipment-entry-form" novalidate><div class="equipment-section-heading"><h3>Новое обслуживание</h3><button class="text-button" type="button" data-energy-action="equipment-cancel-maintenance">Закрыть</button></div><div class="equipment-form-grid"><label><span>Дата *</span><input name="date" type="date" value="${localDateValue()}" required></label><label><span>Тип работы *</span><select name="workType">${MAINTENANCE_TYPES.map((type) => `<option>${escapeHtml(type)}</option>`).join('')}</select></label><label><span>Исполнитель</span><input name="performer" maxlength="160"></label><label><span>Следующее обслуживание</span><input name="nextDate" type="date"></label><label class="equipment-field-wide"><span>Выполнено</span><textarea name="work" rows="3" maxlength="1000"></textarea></label><label class="equipment-field-wide"><span>Результат</span><textarea name="result" rows="3" maxlength="1000"></textarea></label><label class="equipment-field-wide"><span>Комментарий</span><textarea name="comment" rows="3" maxlength="1000"></textarea></label></div><p class="field-error" data-form-error></p><button class="button button-primary" type="submit">Сохранить обслуживание</button></form>`;
}

function renderEquipmentDocuments(equipment) {
  const categories = ['Фото оборудования', 'Фото шильдика', 'Паспорт', 'Инструкция', 'Протокол испытаний', 'Схема подключения', 'Другое'];
  return `<section class="panel equipment-documents"><div class="equipment-section-heading"><div><p class="eyebrow">Подготовлено к расширению</p><h3>Документы</h3></div><button class="button button-secondary" type="button" disabled>Добавить фото шильдика</button></div><div class="equipment-document-grid">${categories.map((category) => `<div><span aria-hidden="true">□</span><strong>${escapeHtml(category)}</strong><small>Нет файлов</small></div>`).join('')}</div><p class="equipment-data-note">Постоянное хранение файлов и OCR шильдика требуют backend/API и файлового хранилища. Локальная версия не имитирует загрузку и распознавание.</p><p class="equipment-form-hint">ID для будущей привязки документов: <code>${escapeHtml(equipment.id)}</code></p></section>`;
}

function renderEquipmentHistory(equipment) {
  return `<ol class="equipment-history">${equipment.history.length ? equipment.history.map((item) => `<li><i></i><div><time>${formatEquipmentDate(item.timestamp, true)}</time><p>${escapeHtml(item.message)}</p></div></li>`).join('') : '<li class="equipment-empty-inline">История изменений пуста.</li>'}</ol>`;
}

function getLatestEquipmentMeasurement(equipment) {
  return [...equipment.measurements].sort((a, b) => new Date(b.measuredAt) - new Date(a.measuredAt))[0] || null;
}

function getMaintenanceCalendarState(equipment) {
  const next = getEquipmentNextMaintenance(equipment);
  if (!next) return { next: null, state: 'none', label: 'НЕ ЗАПЛАНИРОВАНО', description: 'Следующая дата не указана пользователем.' };
  const today = new Date(`${localDateValue()}T00:00:00`).getTime();
  const days = Math.round((next.timestamp - today) / 86400000);
  if (days < 0) return { next, days, state: 'overdue', label: 'ПРОСРОЧЕНО', description: `Дата прошла ${Math.abs(days)} дн. назад.` };
  if (days <= 30) return { next, days, state: 'soon', label: 'СКОРО', description: days === 0 ? 'Дата обслуживания сегодня.' : `До даты осталось ${days} дн.` };
  return { next, days, state: 'normal', label: 'НОРМА', description: `До даты осталось ${days} дн.` };
}

function getEquipmentSimulationSnapshot(equipment) {
  let loads = null;
  let breaker = null;
  if (equipment.linkedBreakerId && getBreakerDefinition(equipment.linkedBreakerId)) {
    breaker = getBreakerMeasurements()[equipment.linkedBreakerId];
    loads = breaker.loads;
  } else if (equipment.linkedLineId && ENERGY_LAB_LINES[equipment.linkedLineId]) {
    loads = getLineLoads(equipment.linkedLineId);
  }
  if (!loads) return null;
  const voltage = state.lastMeasurements.voltage || 230;
  const totals = calculateLoadTotals(loads, voltage);
  const phases = [...new Set(loads.map((load) => load.phase).filter(Boolean))];
  return {
    voltageV: voltage,
    currentA: breaker ? breaker.current : totals.currentA,
    activePowerKW: totals.activePowerW / 1000,
    reactivePowerKvar: totals.reactivePowerVar / 1000,
    apparentPowerKVA: totals.apparentPowerVA / 1000,
    powerFactor: totals.powerFactor,
    frequencyHz: state.lastMeasurements.frequency,
    phase: phases.join(', ') || null,
    enabled: breaker ? breaker.enabled : true
  };
}

function renderEquipmentEnergyLabLink(equipment) {
  const breaker = equipment.linkedBreakerId ? getBreakerDefinition(equipment.linkedBreakerId) : null;
  const line = equipment.linkedLineId ? state.settings.energyLab.lines[equipment.linkedLineId] : null;
  const snapshot = getEquipmentSimulationSnapshot(equipment);
  if (!breaker && !line && !equipment.linkedNodeId) {
    return `<section class="panel equipment-link-panel"><div><p class="eyebrow">Связь с EnergyLab</p><h3>Не связано с EnergyLab</h3><p>Привязка выполняется по ID линии, автомата или узла.</p></div><button class="button button-secondary" type="button" data-energy-action="equipment-edit" data-equipment-id="${escapeHtml(equipment.id)}">Привязать</button></section>`;
  }
  return `<section class="panel equipment-link-panel"><div class="equipment-section-heading"><div><p class="eyebrow">Связь с EnergyLab</p><h3>${breaker ? escapeHtml(breaker.designation) : 'Связанный элемент'}</h3></div><span class="equipment-simulation-badge">СИМУЛЯЦИЯ</span></div>${renderEquipmentDefinitionList([['Элемент', breaker ? `${breaker.designation} — ${breaker.description}` : equipment.linkedNodeId], ['Линия', line?.name || equipment.location.line], ['Фаза', snapshot?.phase], ['ID автомата', equipment.linkedBreakerId], ['ID линии', equipment.linkedLineId]])}${snapshot ? `<div class="equipment-simulation-readings">${renderEnergyLabMetric('U', snapshot.voltageV.toFixed(1), 'В')}${renderEnergyLabMetric('I', snapshot.currentA.toFixed(2), 'А')}${renderEnergyLabMetric('P', snapshot.activePowerKW.toFixed(2), 'кВт')}${renderEnergyLabMetric('cosφ', snapshot.powerFactor.toFixed(2))}</div><p class="equipment-simulation-note">Источник: EnergyLab Simulator. Это текущие учебные данные, а не реальное измерение.</p>` : ''}<div class="equipment-link-actions"><button class="button button-secondary" type="button" data-energy-action="equipment-open-linked">Открыть в EnergyLab</button>${snapshot ? '<button class="button button-primary" type="button" data-energy-action="equipment-save-simulation">Сохранить текущее состояние как измерение</button>' : ''}</div></section>`;
}

function renderEquipmentNotes(equipment) {
  const editing = equipment.notes.find((note) => note.id === state.energyLab.equipmentEditingNoteId);
  return `<section class="panel equipment-notes"><div class="equipment-section-heading"><div><p class="eyebrow">Наблюдения</p><h3>Заметки</h3></div></div><form id="equipmentNoteForm" class="equipment-inline-form" data-note-id="${escapeHtml(editing?.id || '')}"><textarea name="text" rows="2" maxlength="2000" placeholder="Например: наблюдается нагрев клеммы L1">${escapeHtml(editing?.text || '')}</textarea><div class="equipment-inline-actions"><button class="button button-secondary" type="submit">${editing ? 'Сохранить' : 'Добавить заметку'}</button>${editing ? '<button class="text-button" type="button" data-energy-action="equipment-cancel-note-edit">Отмена</button>' : ''}</div><p class="field-error" data-form-error></p></form><div class="equipment-note-list">${equipment.notes.length ? equipment.notes.map((note) => `<article><div class="equipment-note-head"><time>${formatEquipmentDate(note.createdAt, true)}</time><div><button class="text-button" type="button" data-energy-action="equipment-edit-note" data-note-id="${escapeHtml(note.id)}">Редактировать</button><button class="text-button is-danger" type="button" data-energy-action="equipment-request-note-delete" data-note-id="${escapeHtml(note.id)}">Удалить</button></div></div><p>${escapeHtml(note.text)}</p>${state.energyLab.equipmentNoteDeleteId === note.id ? `<div class="equipment-inline-confirm"><span>Удалить заметку?</span><button class="text-button" type="button" data-energy-action="equipment-cancel-note-delete">Отмена</button><button class="text-button is-danger" type="button" data-energy-action="equipment-confirm-note-delete" data-note-id="${escapeHtml(note.id)}">Удалить</button></div>` : ''}</article>`).join('') : '<p class="equipment-empty-inline">Заметок пока нет.</p>'}</div></section>`;
}

function renderEquipmentOverview(equipment) {
  const latest = getLatestEquipmentMeasurement(equipment);
  const calendar = getMaintenanceCalendarState(equipment);
  const hasCompatibleCurrent = Number.isFinite(latest?.currentA) && Number.isFinite(equipment.ratings.currentA) && equipment.ratings.currentA > 0;
  const loadPercent = hasCompatibleCurrent ? latest.currentA / equipment.ratings.currentA * 100 : null;
  const loadFormula = hasCompatibleCurrent ? `${latest.currentA} / ${equipment.ratings.currentA} × 100 = ${loadPercent.toFixed(1)} %` : null;
  return `<div class="equipment-overview-grid"><section class="panel equipment-detail-block"><div class="equipment-section-heading"><h3>Основная информация</h3></div>${renderEquipmentDefinitionList([['Тип', EQUIPMENT_TYPES[equipment.type]], ['Производитель', equipment.manufacturer], ['Модель', equipment.model], ['Номинальный ток', equipment.ratings.currentA, 'А'], ['Номинальное напряжение', equipment.ratings.voltageV, 'В'], ['Загрузка', loadPercent === null ? null : `${loadPercent.toFixed(1)} %`]])}${loadFormula ? `<p class="equipment-calculation-note">${escapeHtml(loadFormula)}</p>` : '<p class="equipment-empty-inline">Для расчёта загрузки нужны номинальный и измеренный ток.</p>'}</section><section class="panel equipment-detail-block"><div class="equipment-section-heading"><h3>Последнее измерение</h3></div>${latest ? renderEquipmentDefinitionList([['Дата', formatEquipmentDate(latest.measuredAt, true)], ['U', latest.voltageV, 'В'], ['I', latest.currentA, 'А'], ['P', latest.activePowerKW, 'кВт'], ['S', latest.apparentPowerKVA, 'кВА'], ['cosφ', latest.powerFactor], ['Источник', measurementSourceLabel(latest.dataSource)]]) : '<p class="equipment-empty-inline">Нет данных.</p>'}</section><section class="panel equipment-detail-block"><div class="equipment-section-heading"><h3>Место установки</h3></div>${renderEquipmentDefinitionList([['Объект', equipment.location.object], ['Здание', equipment.location.building], ['Помещение', equipment.location.room], ['Щит', equipment.location.panel], ['Линия', equipment.location.line], ['Ячейка', equipment.location.cell]])}</section><section class="panel equipment-detail-block"><div class="equipment-section-heading"><h3>Состояние обслуживания</h3><span class="equipment-maintenance-state is-${calendar.state}">${calendar.label}</span></div>${calendar.next ? renderEquipmentDefinitionList([['Следующая дата', formatEquipmentDate(calendar.next.nextDate)], ['Тип работы', calendar.next.workType], ['Исполнитель', calendar.next.performer]]) : ''}<p class="equipment-form-hint">${escapeHtml(calendar.description)} Период задаёт пользователь.</p></section></div>${renderEquipmentEnergyLabLink(equipment)}${renderEquipmentNotes(equipment)}<section class="panel equipment-qr-placeholder"><div><p class="eyebrow">Будущая маршрутизация</p><h3>QR-код оборудования</h3><p>Уникальный ID: <code>${escapeHtml(equipment.id)}</code></p><p>Подготовленная ссылка: <code>?equipment=${encodeURIComponent(equipment.id)}#energy-lab</code>. Внешний QR не имитируется без маршрута и генератора.</p></div><button class="button button-secondary" type="button" disabled>QR-код</button></section>`;
}

function renderEquipmentPassport(equipment) {
  const dynamicRows = (EQUIPMENT_DYNAMIC_FIELDS[equipment.type] || []).map((field) => [field.label, equipment.specs[field.key], field.unit || '']);
  return `<div class="equipment-passport"><section class="panel equipment-detail-block"><h3>Паспортные данные</h3>${renderEquipmentDefinitionList([['Обозначение', equipment.designation], ['Название', equipment.name], ['Тип оборудования', EQUIPMENT_TYPES[equipment.type]], ['Производитель', equipment.manufacturer], ['Модель', equipment.model], ['Серийный номер', equipment.serialNumber], ['Инвентарный номер', equipment.inventoryNumber], ['Год выпуска', equipment.year], ['Дата установки', equipment.installationDate ? formatEquipmentDate(equipment.installationDate) : null], ['Статус', EQUIPMENT_STATUSES[equipment.status]], ['Количество', equipment.quantity]])}</section><section class="panel equipment-detail-block"><h3>Электрические характеристики</h3>${renderEquipmentDefinitionList([['Номинальное напряжение', equipment.ratings.voltageV, 'В'], ['Номинальный ток', equipment.ratings.currentA, 'А'], ['Активная мощность', equipment.ratings.powerKW, 'кВт'], ['Полная мощность', equipment.ratings.powerKVA, 'кВА'], ['Частота', equipment.ratings.frequencyHz, 'Гц'], ['Количество фаз', equipment.ratings.phases], ['cosφ', equipment.ratings.powerFactor], ['КПД', equipment.ratings.efficiencyPercent, '%'], ...dynamicRows])}</section><section class="panel equipment-detail-block"><h3>Место установки</h3>${renderEquipmentDefinitionList([['Объект', equipment.location.object], ['Здание', equipment.location.building], ['Помещение', equipment.location.room], ['Щит', equipment.location.panel], ['Ячейка', equipment.location.cell], ['Линия', equipment.location.line], ['Описание', equipment.location.description]])}</section><section class="panel equipment-detail-block"><h3>Архитектура объектов</h3>${renderEquipmentDefinitionList([['ID объекта', equipment.location.objectId], ['ID здания', equipment.location.buildingId], ['ID помещения', equipment.location.roomId], ['ID щита', equipment.location.panelId], ['ID ячейки', equipment.location.cellId], ['ID линии', equipment.location.lineId]])}<p class="equipment-form-hint">ID-поля подготовлены для будущей иерархии Объект → ТП → РУ → Щит → Ячейка → Оборудование. Модуль объектов не создаётся на этом этапе.</p></section></div>`;
}

function renderMeasurementForm(equipment) {
  const existing = equipment.measurements.find((item) => item.id === state.energyLab.equipmentEditingMeasurementId) || null;
  const measuredAt = existing ? new Date(existing.measuredAt) : new Date();
  const input = (name, label, unit = '', value = '', attrs = '') => `<label><span>${label}${unit ? `, ${unit}` : ''}</span><input name="${name}" type="number" step="any" inputmode="decimal" value="${escapeHtml(value ?? '')}" ${attrs}></label>`;
  const source = existing?.dataSource || 'manual';
  return `<form id="equipmentMeasurementForm" class="panel equipment-entry-form" data-measurement-id="${escapeHtml(existing?.id || '')}" novalidate><div class="equipment-section-heading"><h3>${existing ? 'Редактировать измерение' : 'Новое измерение'}</h3><button class="text-button" type="button" data-energy-action="equipment-cancel-measurement">Закрыть</button></div><div class="equipment-form-grid"><label><span>Дата</span><input name="date" type="date" value="${localDateValue(measuredAt)}" required></label><label><span>Время</span><input name="time" type="time" value="${localTimeValue(measuredAt)}" required></label><label><span>Источник данных</span><select name="dataSource"><option value="manual" ${source === 'manual' ? 'selected' : ''}>Ручной ввод</option><option value="simulation" ${source === 'simulation' ? 'selected' : ''}>Симулятор</option><option value="real_device" ${source === 'real_device' ? 'selected' : ''}>Реальное устройство (архитектура)</option></select></label>${input('voltageV', 'Напряжение U', 'В', existing?.voltageV, 'min="0"')}${input('currentA', 'Ток I', 'А', existing?.currentA, 'min="0"')}${input('activePowerKW', 'Активная мощность P', 'кВт', existing?.activePowerKW, 'min="0"')}${input('reactivePowerKvar', 'Реактивная мощность Q', 'квар', existing?.reactivePowerKvar)}${input('apparentPowerKVA', 'Полная мощность S', 'кВА', existing?.apparentPowerKVA, 'min="0"')}${input('powerFactor', 'cosφ', '', existing?.powerFactor, 'min="0.000001" max="1"')}${input('frequencyHz', 'Частота f', 'Гц', existing?.frequencyHz, 'min="0"')}${input('temperatureC', 'Температура', '°C', existing?.temperatureC, 'min="-273.15"')}${input('insulationMOhm', 'Сопротивление изоляции', 'МОм', existing?.insulationMOhm, 'min="0"')}<label class="equipment-field-wide"><span>Комментарий</span><textarea name="note" rows="3" maxlength="1000">${escapeHtml(existing?.note || '')}</textarea></label></div><p class="equipment-form-hint">Заполняйте только фактически измеренные параметры. Источник «Реальное устройство» подготовлен структурно; подключение не имитируется.</p><p class="field-error" data-form-error></p><button class="button button-primary" type="submit">${existing ? 'Сохранить изменения' : 'Сохранить измерение'}</button></form>`;
}

function renderEquipmentMeasurements(equipment) {
  const metrics = [['voltageV', 'U — напряжение'], ['currentA', 'I — ток'], ['activePowerKW', 'P — активная мощность'], ['reactivePowerKvar', 'Q — реактивная мощность'], ['apparentPowerKVA', 'S — полная мощность'], ['powerFactor', 'cosφ'], ['frequencyHz', 'f — частота'], ['temperatureC', 'Температура']];
  return `<div class="equipment-tab-toolbar"><label class="equipment-chart-select"><span>Показатель графика</span><select id="equipmentMeasurementMetric">${metrics.map(([id, label]) => `<option value="${id}" ${state.energyLab.equipmentMeasurementMetric === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button class="button button-primary" type="button" data-energy-action="equipment-show-measurement">+ Добавить измерение</button></div>${state.energyLab.equipmentShowMeasurementForm ? renderMeasurementForm(equipment) : ''}<article class="panel equipment-measurement-chart"><div class="chart-container"><canvas id="equipmentMeasurementChart" aria-label="График истории измерений"></canvas></div><p class="equipment-form-hint">Ось X — дата и время. Пропуски не заполняются и случайные точки не создаются.</p></article><div class="equipment-record-list">${equipment.measurements.length ? [...equipment.measurements].sort((a, b) => new Date(b.measuredAt) - new Date(a.measuredAt)).map((item) => `<article class="panel equipment-record"><header><div><strong>${formatEquipmentDate(item.measuredAt, true)}</strong><span>${escapeHtml(measurementSourceLabel(item.dataSource))}</span></div><div class="equipment-record-actions"><button class="text-button" type="button" data-energy-action="equipment-edit-measurement" data-measurement-id="${escapeHtml(item.id)}">Редактировать</button><button class="text-button is-danger" type="button" data-energy-action="equipment-request-measurement-delete" data-measurement-id="${escapeHtml(item.id)}">Удалить</button></div></header>${renderEquipmentDefinitionList([['U', item.voltageV, 'В'], ['I', item.currentA, 'А'], ['P', item.activePowerKW, 'кВт'], ['Q', item.reactivePowerKvar, 'квар'], ['S', item.apparentPowerKVA, 'кВА'], ['cosφ', item.powerFactor], ['f', item.frequencyHz, 'Гц'], ['Температура', item.temperatureC, '°C'], ['Rиз', item.insulationMOhm, 'МОм']])}${item.note ? `<p class="equipment-record-note">${escapeHtml(item.note)}</p>` : ''}${state.energyLab.equipmentMeasurementDeleteId === item.id ? `<div class="equipment-inline-confirm"><span>Удалить это измерение?</span><button class="text-button" type="button" data-energy-action="equipment-cancel-measurement-delete">Отмена</button><button class="text-button is-danger" type="button" data-energy-action="equipment-confirm-measurement-delete" data-measurement-id="${escapeHtml(item.id)}">Удалить</button></div>` : ''}</article>`).join('') : '<div class="equipment-empty"><strong>История измерений пуста</strong><span>Добавьте только те значения, которые действительно измерены.</span></div>'}</div>`;
}

function renderEquipmentMaintenance(equipment) {
  const calendar = getMaintenanceCalendarState(equipment);
  const groups = groupMaintenanceByNextDate(equipment.maintenance);
  const record = (item) => `<article class="panel equipment-record"><header><strong>${item.nextDate ? `Следующая дата: ${formatEquipmentDate(item.nextDate)}` : `Выполнено: ${formatEquipmentDate(item.date)}`}</strong><span>${escapeHtml(item.workType)}</span></header>${renderEquipmentDefinitionList([['Дата выполнения', formatEquipmentDate(item.date)], ['Исполнитель', item.performer], ['Работы', item.work], ['Результат', item.result], ['Следующая проверка', item.nextDate ? formatEquipmentDate(item.nextDate) : null], ['Комментарий', item.comment]])}</article>`;
  const section = (title, items, emptyText) => `<section class="equipment-maintenance-group"><h3>${title}</h3>${items.length ? items.map(record).join('') : `<p class="equipment-empty-inline">${emptyText}</p>`}</section>`;
  const schedule = equipment.maintenance.length
    ? `${section('Просроченные работы', groups.overdue, 'Просроченных работ нет.')}${section('Будущие работы', groups.upcoming, 'Будущие даты не запланированы.')}${section('Без следующей даты', groups.unscheduled, 'Все записи имеют следующую дату.')}`
    : '<div class="equipment-empty"><strong>Обслуживание не записано</strong><span>Добавьте выполненную работу и при необходимости следующую дату.</span></div>';
  return `<section class="equipment-maintenance-summary panel"><div><p class="eyebrow">Календарное состояние</p><h3>${calendar.label}</h3><p>${escapeHtml(calendar.description)}</p></div><span class="equipment-maintenance-state is-${calendar.state}">${calendar.label}</span></section><div class="equipment-tab-toolbar"><p class="equipment-form-hint">Списки отсортированы по следующей дате обслуживания. Просроченные и будущие работы показаны отдельно.</p><button class="button button-primary" type="button" data-energy-action="equipment-show-maintenance">+ Добавить работу</button></div>${state.energyLab.equipmentShowMaintenanceForm ? renderMaintenanceForm() : ''}<div class="equipment-record-list">${schedule}</div>`;
}

function renderEquipmentDetailBase(equipment) {
  const tabs = [['overview', 'Обзор'], ['passport', 'Паспорт'], ['measurements', 'Измерения'], ['maintenance', 'Обслуживание'], ['documents', 'Документы'], ['history', 'История']];
  const renderers = { overview: renderEquipmentOverview, passport: renderEquipmentPassport, measurements: renderEquipmentMeasurements, maintenance: renderEquipmentMaintenance, documents: renderEquipmentDocuments, history: renderEquipmentHistory };
  const tab = renderers[state.energyLab.equipmentTab] ? state.energyLab.equipmentTab : 'overview';
  const deleteConfirm = state.energyLab.equipmentDeleteId === equipment.id ? `<div class="equipment-delete-confirm" role="alert"><div><strong>Удалить ${escapeHtml(equipment.designation)}?</strong><span>История измерений и обслуживания также будет удалена.</span></div><div><button class="button button-secondary" type="button" data-energy-action="equipment-cancel-delete">Отмена</button><button class="button button-danger" type="button" data-energy-action="equipment-confirm-delete" data-equipment-id="${escapeHtml(equipment.id)}">Удалить</button></div></div>` : '';
  return `<div class="equipment-module equipment-detail"><div class="equipment-subnav"><button class="text-button" type="button" data-energy-action="equipment-back">← К списку оборудования</button></div><header class="equipment-detail-header"><div><span>${escapeHtml(EQUIPMENT_TYPES[equipment.type])}</span><h3>${escapeHtml(equipment.designation)}</h3><p>${escapeHtml(equipment.name)}</p><strong>${escapeHtml([equipment.manufacturer, equipment.model].filter(Boolean).join(' ') || 'Производитель и модель не указаны')}</strong></div><i class="equipment-status ${equipmentStatusClass(equipment.status)}">● ${escapeHtml(EQUIPMENT_STATUSES[equipment.status])}</i><div class="equipment-detail-actions"><button class="button button-primary" type="button" data-energy-action="equipment-edit" data-equipment-id="${escapeHtml(equipment.id)}">Редактировать</button><button class="button button-secondary" type="button" data-energy-action="equipment-duplicate" data-equipment-id="${escapeHtml(equipment.id)}">Дублировать</button><button class="text-button is-danger" type="button" data-energy-action="equipment-request-delete" data-equipment-id="${escapeHtml(equipment.id)}">Удалить</button></div></header>${deleteConfirm}<div class="equipment-tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" role="tab" class="${tab === id ? 'active' : ''}" aria-selected="${tab === id}" data-energy-action="equipment-tab" data-tab="${id}">${label}</button>`).join('')}</div><div class="equipment-tab-content">${renderers[tab](equipment)}</div></div>`;
}

function renderEquipmentDetail(equipment) {
  const html = renderEquipmentDetailBase(equipment);
  const location = `<dl class="equipment-detail-location"><div><dt>Щит</dt><dd>${escapeHtml(equipment.location.panel || '—')}</dd></div><div><dt>Линия</dt><dd>${escapeHtml(equipment.location.line || '—')}</dd></div></dl>`;
  return html.replace('</strong></div><i class="equipment-status', `</strong>${location}</div><i class="equipment-status`);
}

function renderEquipmentTool() {
  if (state.energyLab.equipmentView === 'form') return renderEquipmentForm(equipmentRepository.find(state.energyLab.equipmentId));
  if (state.energyLab.equipmentView === 'detail') {
    const equipment = equipmentRepository.find(state.energyLab.equipmentId);
    if (equipment) return renderEquipmentDetail(equipment);
    state.energyLab.equipmentView = 'list';
    state.energyLab.equipmentId = null;
  }
  return renderEquipmentList();
}

function equipmentFormNumber(data, name, label, errors, options = {}) {
  const raw = String(data.get(name) ?? '').trim();
  if (!raw) return null;
  const value = Number(raw.replace(',', '.'));
  const min = options.min ?? 0;
  const max = options.max ?? 1_000_000_000;
  if (!Number.isFinite(value) || value < min || value > max || (options.integer && !Number.isInteger(value))) {
    errors.push(`${label}: введите ${options.integer ? 'целое ' : ''}значение от ${min} до ${max}.`);
    return null;
  }
  return value;
}

function readEquipmentForm(form) {
  const data = new FormData(form);
  const errors = [];
  const designation = safeText(data.get('designation'), 80);
  const name = safeText(data.get('name'), 160);
  const type = String(data.get('type'));
  const status = String(data.get('status'));
  if (!designation) errors.push('Укажите обозначение оборудования.');
  if (!name) errors.push('Укажите название оборудования.');
  if (!Object.hasOwn(EQUIPMENT_TYPES, type)) errors.push('Выберите корректный тип оборудования.');
  if (!Object.hasOwn(EQUIPMENT_STATUSES, status)) errors.push('Выберите корректное состояние.');
  const quantity = equipmentFormNumber(data, 'quantity', 'Количество', errors, { min: 1, max: 100000, integer: true });
  const year = equipmentFormNumber(data, 'year', 'Год выпуска', errors, { min: 1800, max: 3000, integer: true });
  const installationDate = String(data.get('installationDate') || '');
  if (installationDate && !isValidDateInput(installationDate)) errors.push('Укажите корректную дату установки.');
  const ratings = {
    voltageV: equipmentFormNumber(data, 'voltageV', 'Напряжение', errors),
    currentA: equipmentFormNumber(data, 'currentA', 'Ток', errors),
    powerKW: equipmentFormNumber(data, 'powerKW', 'Активная мощность', errors),
    powerKVA: equipmentFormNumber(data, 'powerKVA', 'Полная мощность', errors),
    frequencyHz: equipmentFormNumber(data, 'frequencyHz', 'Частота', errors),
    phases: equipmentFormNumber(data, 'phases', 'Количество фаз', errors, { min: 1, max: 3, integer: true }),
    powerFactor: equipmentFormNumber(data, 'powerFactor', 'cosφ', errors, { min: 0.000001, max: 1 }),
    efficiencyPercent: equipmentFormNumber(data, 'efficiencyPercent', 'КПД', errors, { min: 0, max: 100 })
  };
  const specs = {};
  (EQUIPMENT_DYNAMIC_FIELDS[type] || []).forEach((field) => {
    const raw = String(data.get(`spec_${field.key}`) ?? '').trim();
    if (!raw) return;
    if (field.number) {
      const value = Number(raw.replace(',', '.'));
      if (!Number.isFinite(value) || value < 0) errors.push(`${field.label}: введите неотрицательное число.`);
      else specs[field.key] = value;
    } else specs[field.key] = safeText(raw, 300);
  });
  return {
    valid: errors.length === 0,
    errors,
    value: {
      designation, name, type, status, quantity: quantity || 1,
      manufacturer: safeText(data.get('manufacturer'), 120), model: safeText(data.get('model'), 120), serialNumber: safeText(data.get('serialNumber'), 120), inventoryNumber: safeText(data.get('inventoryNumber'), 120), year, installationDate, ratings, specs,
      location: { object: safeText(data.get('locationObject'), 160), building: safeText(data.get('locationBuilding'), 160), room: safeText(data.get('locationRoom'), 160), panel: safeText(data.get('locationPanel'), 120), line: safeText(data.get('locationLine'), 160), cell: safeText(data.get('locationCell'), 80), description: safeText(data.get('locationDescription'), 1000) },
      linkedLineId: safeText(data.get('linkedLineId'), 100) || null, linkedBreakerId: safeText(data.get('linkedBreakerId'), 100) || null, linkedNodeId: safeText(data.get('linkedNodeId'), 100) || null,
      dataSource: ['manual', 'simulation', 'api', 'modbus', 'mqtt'].includes(data.get('dataSource')) ? String(data.get('dataSource')) : 'manual'
    }
  };
}

function handleEquipmentFormSubmit(form) {
  const parsed = readEquipmentForm(form);
  const error = form.querySelector('#equipmentFormError');
  if (!parsed.valid) { error.textContent = parsed.errors[0]; return; }
  const now = new Date().toISOString();
  const existing = equipmentRepository.find(form.dataset.equipmentId);
  if (existing) {
    const previousStatus = existing.status;
    const previousDesignation = existing.designation;
    const next = { ...existing, ...parsed.value, location: { ...existing.location, ...parsed.value.location }, id: existing.id, measurements: existing.measurements, maintenance: existing.maintenance, notes: existing.notes, history: existing.history, documents: existing.documents || [], createdAt: existing.createdAt, updatedAt: now };
    addEquipmentHistory(next, previousStatus !== next.status ? 'status' : 'passport', previousStatus !== next.status ? `Статус изменён: ${EQUIPMENT_STATUSES[previousStatus]} → ${EQUIPMENT_STATUSES[next.status]}` : 'Изменены паспортные данные');
    equipmentRepository.update(existing.id, next);
    addEvent(previousStatus !== next.status ? `${next.designation} — изменён статус` : `${previousDesignation} — изменены паспортные данные`, previousStatus !== next.status ? 'warning' : 'info', { equipmentId: next.id, eventType: previousStatus !== next.status ? 'status_changed' : 'passport_updated' });
    state.energyLab.equipmentId = next.id;
  } else {
    const next = { id: createEquipmentId(), ...parsed.value, measurements: [], maintenance: [], notes: [], history: [], documents: [], createdAt: now, updatedAt: now };
    addEquipmentHistory(next, 'created', 'Оборудование добавлено');
    equipmentRepository.insert(next);
    addEvent(`${next.designation} добавлен в оборудование`, 'success', { equipmentId: next.id, eventType: 'equipment_added' });
    state.energyLab.equipmentId = next.id;
  }
  state.energyLab.equipmentView = 'detail';
  state.energyLab.equipmentTab = 'overview';
  updateHomeScreen();
  renderEnergyLabTool('equipment');
}

function duplicateEquipment(id) {
  const source = equipmentRepository.find(id);
  if (!source) return;
  const now = new Date().toISOString();
  const copy = JSON.parse(JSON.stringify(source));
  Object.assign(copy, { id: createEquipmentId(), designation: `${source.designation}-COPY`.slice(0, 80), name: `${source.name} — копия`.slice(0, 160), measurements: [], maintenance: [], notes: [], history: [], createdAt: now, updatedAt: now });
  addEquipmentHistory(copy, 'created', `Создано дублированием ${source.designation}`);
  equipmentRepository.insert(copy);
  addEvent(`${source.designation} продублирован как ${copy.designation}`, 'success', { equipmentId: copy.id, eventType: 'equipment_duplicated' });
  state.energyLab.equipmentId = copy.id;
  state.energyLab.equipmentView = 'form';
  renderEnergyLabTool('equipment');
}

function readMeasurementForm(form) {
  const data = new FormData(form);
  const errors = [];
  const date = String(data.get('date') || '');
  const time = String(data.get('time') || '');
  const measuredDate = new Date(`${date}T${time || '00:00'}:00`);
  if (!isValidDateInput(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !Number.isFinite(measuredDate.getTime())) errors.push('Укажите корректные дату и время.');
  const value = {
    id: createEquipmentId(), measuredAt: Number.isFinite(measuredDate.getTime()) ? measuredDate.toISOString() : new Date().toISOString(), dataSource: ['manual', 'simulation', 'real_device'].includes(data.get('dataSource')) ? String(data.get('dataSource')) : 'manual',
    voltageV: equipmentFormNumber(data, 'voltageV', 'Напряжение', errors), currentA: equipmentFormNumber(data, 'currentA', 'Ток', errors), activePowerKW: equipmentFormNumber(data, 'activePowerKW', 'Активная мощность', errors), reactivePowerKvar: equipmentFormNumber(data, 'reactivePowerKvar', 'Реактивная мощность', errors, { min: -1_000_000, max: 1_000_000 }), apparentPowerKVA: equipmentFormNumber(data, 'apparentPowerKVA', 'Полная мощность', errors), powerFactor: equipmentFormNumber(data, 'powerFactor', 'cosφ', errors, { min: 0.000001, max: 1 }), frequencyHz: equipmentFormNumber(data, 'frequencyHz', 'Частота', errors), temperatureC: equipmentFormNumber(data, 'temperatureC', 'Температура', errors, { min: -273.15, max: 10000 }), insulationMOhm: equipmentFormNumber(data, 'insulationMOhm', 'Сопротивление изоляции', errors), note: safeText(data.get('note'), 1000), createdAt: new Date().toISOString()
  };
  const hasContent = ['voltageV', 'currentA', 'activePowerKW', 'reactivePowerKvar', 'apparentPowerKVA', 'powerFactor', 'frequencyHz', 'temperatureC', 'insulationMOhm'].some((key) => value[key] !== null) || value.note;
  if (!hasContent) errors.push('Введите хотя бы одно измеренное значение или примечание.');
  return { valid: errors.length === 0, errors, value };
}

function handleEquipmentMeasurementSubmit(form) {
  const equipment = equipmentRepository.find(state.energyLab.equipmentId);
  if (!equipment) return;
  const parsed = readMeasurementForm(form);
  const error = form.querySelector('[data-form-error]');
  if (!parsed.valid) { error.textContent = parsed.errors[0]; return; }
  const editId = form.dataset.measurementId;
  const editIndex = editId ? equipment.measurements.findIndex((item) => item.id === editId) : -1;
  if (editIndex >= 0) {
    const previous = equipment.measurements[editIndex];
    equipment.measurements[editIndex] = { ...parsed.value, id: previous.id, createdAt: previous.createdAt };
    addEquipmentHistory(equipment, 'measurement_updated', 'Изменено измерение');
  } else {
    equipment.measurements.unshift(parsed.value);
    addEquipmentHistory(equipment, 'measurement_added', 'Добавлено измерение');
  }
  equipmentRepository.update(equipment.id, equipment);
  addEvent(`${equipment.designation} — ${editIndex >= 0 ? 'изменено' : 'добавлено'} измерение`, 'info', { equipmentId: equipment.id, eventType: editIndex >= 0 ? 'measurement_updated' : 'measurement_added' });
  state.energyLab.equipmentShowMeasurementForm = false;
  state.energyLab.equipmentEditingMeasurementId = null;
  renderEnergyLabTool('equipment');
}

function handleEquipmentMaintenanceSubmit(form) {
  const equipment = equipmentRepository.find(state.energyLab.equipmentId);
  if (!equipment) return;
  const data = new FormData(form);
  const date = String(data.get('date') || '');
  const workType = String(data.get('workType') || '');
  const error = form.querySelector('[data-form-error]');
  if (!isValidDateInput(date) || !MAINTENANCE_TYPES.includes(workType)) { error.textContent = 'Укажите корректную дату и тип выполненной работы.'; return; }
  const nextDate = String(data.get('nextDate') || '');
  if (nextDate && !isValidDateInput(nextDate)) { error.textContent = 'Проверьте следующую дату обслуживания.'; return; }
  equipment.maintenance.unshift({ id: createEquipmentId(), date, workType, performer: safeText(data.get('performer'), 160), work: safeText(data.get('work'), 1000), result: safeText(data.get('result'), 1000), comment: safeText(data.get('comment'), 1000), nextDate, createdAt: new Date().toISOString() });
  addEquipmentHistory(equipment, 'maintenance_added', `Выполнено обслуживание: ${workType}`);
  equipmentRepository.update(equipment.id, equipment);
  addEvent(`${equipment.designation} — выполнено обслуживание`, 'success', { equipmentId: equipment.id, eventType: 'maintenance_added' });
  state.energyLab.equipmentShowMaintenanceForm = false;
  updateHomeScreen();
  renderEnergyLabTool('equipment');
}

function handleEquipmentNoteSubmit(form) {
  const equipment = equipmentRepository.find(state.energyLab.equipmentId);
  if (!equipment) return;
  const text = safeText(new FormData(form).get('text'), 2000);
  const error = form.querySelector('[data-form-error]');
  if (!text) { error.textContent = 'Введите текст заметки.'; return; }
  const editId = form.dataset.noteId;
  const existing = editId ? equipment.notes.find((note) => note.id === editId) : null;
  if (existing) existing.text = text;
  else equipment.notes.unshift({ id: createEquipmentId(), text, createdAt: new Date().toISOString() });
  addEquipmentHistory(equipment, existing ? 'note_updated' : 'note_added', existing ? 'Изменена заметка' : 'Добавлена заметка');
  equipmentRepository.update(equipment.id, equipment);
  addEvent(`${equipment.designation} — ${existing ? 'изменена' : 'добавлена'} заметка`, 'info', { equipmentId: equipment.id, eventType: existing ? 'note_updated' : 'note_added' });
  state.energyLab.equipmentEditingNoteId = null;
  renderEnergyLabTool('equipment');
}

function deleteEquipmentMeasurement(measurementId) {
  const equipment = equipmentRepository.find(state.energyLab.equipmentId);
  if (!equipment) return;
  const index = equipment.measurements.findIndex((item) => item.id === measurementId);
  if (index < 0) return;
  equipment.measurements.splice(index, 1);
  addEquipmentHistory(equipment, 'measurement_deleted', 'Удалено измерение');
  equipmentRepository.update(equipment.id, equipment);
  addEvent(`${equipment.designation} — удалено измерение`, 'warning', { equipmentId: equipment.id, eventType: 'measurement_deleted' });
  state.energyLab.equipmentMeasurementDeleteId = null;
  state.energyLab.equipmentEditingMeasurementId = null;
  renderEnergyLabTool('equipment');
}

function deleteEquipmentNote(noteId) {
  const equipment = equipmentRepository.find(state.energyLab.equipmentId);
  if (!equipment) return;
  const index = equipment.notes.findIndex((note) => note.id === noteId);
  if (index < 0) return;
  equipment.notes.splice(index, 1);
  addEquipmentHistory(equipment, 'note_deleted', 'Удалена заметка');
  equipmentRepository.update(equipment.id, equipment);
  addEvent(`${equipment.designation} — удалена заметка`, 'warning', { equipmentId: equipment.id, eventType: 'note_deleted' });
  state.energyLab.equipmentNoteDeleteId = null;
  state.energyLab.equipmentEditingNoteId = null;
  renderEnergyLabTool('equipment');
}

function saveEquipmentSimulationMeasurement() {
  const equipment = equipmentRepository.find(state.energyLab.equipmentId);
  const snapshot = equipment ? getEquipmentSimulationSnapshot(equipment) : null;
  if (!equipment || !snapshot) return;
  const now = new Date().toISOString();
  equipment.measurements.unshift({
    id: createEquipmentId(),
    measuredAt: now,
    dataSource: 'simulation',
    voltageV: snapshot.voltageV,
    currentA: snapshot.currentA,
    activePowerKW: snapshot.activePowerKW,
    reactivePowerKvar: snapshot.reactivePowerKvar,
    apparentPowerKVA: snapshot.apparentPowerKVA,
    powerFactor: snapshot.powerFactor,
    frequencyHz: snapshot.frequencyHz,
    temperatureC: null,
    insulationMOhm: null,
    note: 'Состояние сохранено пользователем из EnergyLab Simulator.',
    createdAt: now
  });
  addEquipmentHistory(equipment, 'measurement_added', 'Сохранено измерение из EnergyLab Simulator');
  equipmentRepository.update(equipment.id, equipment);
  addEvent(state.storagePersistenceFailed
    ? `${equipment.designation} — измерение осталось только в памяти текущей вкладки`
    : `${equipment.designation} — сохранено измерение из симулятора`, state.storagePersistenceFailed ? 'warning' : 'info', { equipmentId: equipment.id, eventType: 'simulation_measurement_saved' });
  renderEnergyLabTool('equipment');
}

function exportEquipmentJson() {
  const payload = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), equipment: equipmentRepository.all() }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `smart-energy-equipment-${localDateValue()}.json`; link.click();
  URL.revokeObjectURL(url);
  addEvent('Выполнен экспорт оборудования в JSON', 'info');
}

function importEquipmentJson(file) {
  const message = (text) => { const element = document.querySelector('.equipment-data-note'); if (element) element.textContent = text; };
  const resetInput = () => { const input = document.getElementById('equipmentImportFile'); if (input) input.value = ''; };
  if (!file) return;
  if (file.size > 2_000_000) { message('Импорт не выполнен: размер JSON-файла превышает 2 МБ.'); resetInput(); return; }
  if (file.type && !['application/json', 'text/json', 'text/plain'].includes(file.type) && !/\.json$/i.test(file.name || '')) { message('Импорт не выполнен: выбранный файл не является JSON.'); resetInput(); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const checked = validateEquipmentImportPayload(parsed);
      if (!checked.records.length) throw new Error('Файл не содержит записей оборудования.');
      const warningText = checked.warnings.length ? `\n${checked.warnings.join('\n')}` : '';
      if (!window.confirm(`Импортировать записей оборудования: ${checked.records.length}? Текущая база будет дополнена, существующие записи не удаляются.${warningText}`)) return;
      const sanitized = checked.records.map((item) => JSON.parse(JSON.stringify(item)));
      const used = new Set(equipmentRepository.all().map((item) => item.id));
      sanitized.forEach((item) => { if (used.has(item.id)) item.id = createEquipmentId(); used.add(item.id); });
      state.settings.equipment.push(...sanitized);
      const persisted = saveSettings();
      addEvent(persisted ? `Импортировано оборудования: ${sanitized.length}` : `Импортировано в память вкладки: ${sanitized.length}; localStorage недоступен`, persisted ? 'success' : 'warning');
      renderEnergyLabTool('equipment');
      updateHomeScreen();
      message(`Импортировано записей: ${sanitized.length}.${checked.warnings.length ? ` ${checked.warnings.join(' ')}` : ''}`);
    } catch (error) {
      message(`Импорт не выполнен: ${error.message}`);
    } finally {
      resetInput();
    }
  };
  reader.onerror = () => { message('Импорт не выполнен: не удалось прочитать JSON-файл.'); resetInput(); };
  reader.onabort = reader.onerror;
  reader.readAsText(file, 'utf-8');
}

function drawEquipmentMeasurementChart() {
  const canvas = document.getElementById('equipmentMeasurementChart');
  const equipment = equipmentRepository.find(state.energyLab.equipmentId);
  if (!canvas || !equipment) return;
  const metric = state.energyLab.equipmentMeasurementMetric;
  const points = [...equipment.measurements].sort((a, b) => new Date(a.measuredAt) - new Date(b.measuredAt)).filter((item) => Number.isFinite(item[metric])).slice(-30);
  const container = canvas.parentElement;
  const width = Math.max(container.clientWidth, 260); const height = Math.max(container.clientHeight, 220); const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
  const styles = getComputedStyle(document.body); context.font = '12px system-ui'; context.fillStyle = styles.getPropertyValue('--muted').trim();
  if (!points.length) { context.textAlign = 'center'; context.fillText('Нет сохранённых значений выбранного параметра', width / 2, height / 2); return; }
  const values = points.map((point) => point[metric]); const spread = Math.max(Math.max(...values) - Math.min(...values), Math.abs(values[0]) * 0.05, 0.1); const min = Math.min(...values) - spread * 0.2; const max = Math.max(...values) + spread * 0.2; const pad = { top: 20, right: 18, bottom: 28, left: 52 };
  for (let index = 0; index <= 4; index += 1) { const y = pad.top + (height - pad.top - pad.bottom) * index / 4; context.strokeStyle = styles.getPropertyValue('--border').trim(); context.beginPath(); context.moveTo(pad.left, y); context.lineTo(width - pad.right, y); context.stroke(); context.fillStyle = styles.getPropertyValue('--muted').trim(); context.textAlign = 'left'; context.fillText((max - (max - min) * index / 4).toFixed(2), 4, y + 4); }
  context.strokeStyle = styles.getPropertyValue('--primary').trim(); context.lineWidth = 2.5; context.beginPath();
  points.forEach((point, index) => { const x = pad.left + (width - pad.left - pad.right) * index / Math.max(points.length - 1, 1); const y = pad.top + (max - point[metric]) / Math.max(max - min, 0.0001) * (height - pad.top - pad.bottom); if (index === 0) context.moveTo(x, y); else context.lineTo(x, y); }); context.stroke();
  const labelDate = (point) => new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(point.measuredAt));
  context.fillStyle = styles.getPropertyValue('--muted').trim();
  context.font = '10px system-ui';
  context.textAlign = 'left';
  context.fillText(labelDate(points[0]), pad.left, height - 7);
  if (points.length > 1) {
    context.textAlign = 'right';
    context.fillText(labelDate(points[points.length - 1]), width - pad.right, height - 7);
  }
}

function renderEnergyLabTool(toolId) {
  if (!ENERGY_LAB_TOOL_TITLES[toolId]) return;
  elements.energyLabToolTitle.textContent = ENERGY_LAB_TOOL_TITLES[toolId];
  const renderers = {
    'single-line': renderSingleLineTool,
    home: renderHomeTool,
    breakers: renderBreakersTool,
    loads: renderLoadsTool,
    'three-phase': renderThreePhaseTool,
    'phase-balance': renderPhaseBalanceTool,
    emergency: renderEmergencyTool,
    analysis: renderAnalysisTool,
    line: renderLineTool,
    events: renderEventsTool,
    equipment: renderEquipmentTool
  };
  elements.energyLabToolContent.innerHTML = renderers[toolId]();
  if (toolId === 'analysis') window.requestAnimationFrame(drawEnergyLabAnalysisChart);
  if (toolId === 'equipment' && state.energyLab.equipmentView === 'list') renderEquipmentResults();
  if (toolId === 'equipment' && state.energyLab.equipmentView === 'detail' && state.energyLab.equipmentTab === 'measurements') window.requestAnimationFrame(drawEquipmentMeasurementChart);
}

function openEnergyLabTool(toolId) {
  if (!ENERGY_LAB_TOOL_TITLES[toolId]) return;
  state.energyLab.activeTool = toolId;
  elements.energyLabHome.hidden = true;
  elements.energyLabTool.hidden = false;
  renderEnergyLabTool(toolId);
  document.getElementById('energy-lab').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEnergyLabTool() {
  state.energyLab.activeTool = null;
  state.energyLab.showLoadForm = false;
  state.energyLab.editingLoadId = null;
  state.energyLab.breakerView = 'list';
  state.energyLab.breakerId = null;
  state.energyLab.breakerDeleteId = null;
  elements.energyLabTool.hidden = true;
  elements.energyLabHome.hidden = false;
  updateEnergyLabSummary();
  document.getElementById('energy-lab').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateEnergyLabSummary() {
  const m = state.lastMeasurements;
  if (!elements.energyLabVoltage) return;
  elements.energyLabVoltage.textContent = m.voltage.toFixed(1);
  elements.energyLabCurrent.textContent = m.current.toFixed(2);
  elements.energyLabPower.textContent = m.activePower.toFixed(2);
  elements.energyLabPowerFactor.textContent = m.powerFactor.toFixed(2);
  elements.energyLabFrequency.textContent = m.frequency.toFixed(2);
  const status = state.energyLab.emergencyMode ? 'emergency' : getCurrentStatus(m.current);
  const labels = { normal: '🟢 СИСТЕМА В НОРМЕ', warning: '🟡 ТРЕБУЕТСЯ ВНИМАНИЕ', emergency: '🔴 ПЕРЕГРУЗКА' };
  elements.energyLabSummaryStatus.textContent = labels[status];
  elements.energyLabSummaryStatus.dataset.status = status;
}

function updateEnergyLabLiveTool() {
  const toolId = state.energyLab.activeTool;
  if (!toolId) return;
  if (toolId === 'analysis') {
    renderEnergyLabTool(toolId);
    return;
  }
  if (toolId === 'breakers') {
    if (state.energyLab.breakerView !== 'form') renderEnergyLabTool(toolId);
    return;
  }
  if (!['loads', 'line', 'events', 'equipment'].includes(toolId)) renderEnergyLabTool(toolId);
  if (toolId === 'events') renderEnergyLabTool(toolId);
}

function drawEnergyLabAnalysisChart() {
  const canvas = document.getElementById('energyLabAnalysisChart');
  if (!canvas) return;
  const values = state.chartHistory[state.energyLab.analysisMetric] || [];
  const container = canvas.parentElement;
  const width = Math.max(container.clientWidth, 280);
  const height = Math.max(container.clientHeight, 220);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!values.length) return;
  const padding = { top: 20, right: 18, bottom: 25, left: 48 };
  const minData = Math.min(...values);
  const maxData = Math.max(...values);
  const spread = Math.max(maxData - minData, state.energyLab.analysisMetric === 'voltage' ? 2 : 0.2);
  const min = Math.max(0, minData - spread * 0.25);
  const max = maxData + spread * 0.25;
  const styles = getComputedStyle(document.body);
  const primary = styles.getPropertyValue('--primary').trim();
  const border = styles.getPropertyValue('--border').trim();
  const muted = styles.getPropertyValue('--muted').trim();
  context.font = '11px system-ui';
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + (height - padding.top - padding.bottom) * index / 4;
    context.strokeStyle = border;
    context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke();
    context.fillStyle = muted;
    context.fillText((max - (max - min) * index / 4).toFixed(2), 4, y + 4);
  }
  context.strokeStyle = primary;
  context.lineWidth = 2.5;
  context.beginPath();
  values.forEach((value, index) => {
    const x = padding.left + (width - padding.left - padding.right) * index / Math.max(values.length - 1, 1);
    const y = padding.top + (max - value) / Math.max(max - min, 0.0001) * (height - padding.top - padding.bottom);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.stroke();
}

function refreshAfterEnergyLabChange() {
  updateLoadControls();
  updateDiagram();
  updateMeasurements(false);
  saveSettings();
  if (state.energyLab.activeTool) renderEnergyLabTool(state.energyLab.activeTool);
}

function setEmergencyMode(mode) {
  state.energyLab.emergencyMode = mode;
  const labels = { undervoltage: 'Пониженное напряжение', overvoltage: 'Повышенное напряжение', overload: 'Перегрузка', 'low-power-factor': 'Низкий cosφ', 'line-outage': 'Отключение линии' };
  addEvent(`Запущен учебный сценарий: ${labels[mode]}`, 'emergency');
  refreshAfterEnergyLabChange();
}

function restoreNormalMode() {
  if (!state.energyLab.emergencyMode) return;
  state.energyLab.emergencyMode = null;
  addEvent('Нормальный режим восстановлен', 'success');
  refreshAfterEnergyLabChange();
}

function handleEnergyLabLineSubmit(form) {
  const data = new FormData(form);
  const lineId = String(data.get('lineId'));
  const length = Number(data.get('length'));
  const material = String(data.get('material'));
  const section = Number(data.get('section'));
  const breakerRating = Number(data.get('breakerRating'));
  const error = form.querySelector('#energyLabLineError');
  if (!state.settings.energyLab.lines[lineId] || !Number.isFinite(length) || length < 0 || !Number.isFinite(section) || section <= 0 || !Number.isFinite(breakerRating) || breakerRating <= 0 || !['copper', 'aluminum'].includes(material)) {
    error.textContent = 'Проверьте: длина ≥ 0, сечение > 0, номинал автомата > 0.';
    return;
  }
  const loads = getLineLoads(lineId);
  const phaseVoltage = state.settings.energyLab.networkType === 'three' ? state.lastMeasurements.voltage / Math.sqrt(3) : state.lastMeasurements.voltage;
  const totals = calculateLoadTotals(loads, phaseVoltage, 'single');
  const result = window.Calculations.calculateVoltageDrop({ network: 'one', voltage: phaseVoltage, current: totals.currentA, length, section, material, powerFactor: totals.powerFactor });
  state.settings.energyLab.lines[lineId] = { ...state.settings.energyLab.lines[lineId], length, material, section, breakerRating };
  state.energyLab.selectedLine = lineId;
  state.energyLab.lineResult = { ...result, current: totals.currentA };
  saveSettings();
  renderEnergyLabTool('line');
}

function handleEnergyLabLoadSubmit(form) {
  const data = new FormData(form);
  const values = {
    name: String(data.get('name') || '').trim().slice(0, 80),
    powerW: Number(data.get('powerW')),
    powerFactor: Number(data.get('powerFactor')),
    quantity: Number(data.get('quantity'))
  };
  const validation = validateCustomLoadValues(values);
  const error = form.querySelector('#energyLabLoadFormError');
  if (!validation.valid) {
    error.textContent = Object.values(validation.errors)[0];
    return;
  }
  accumulateCurrentEnergyUntilNow();
  const editId = form.dataset.editId;
  if (editId) {
    const load = state.settings.customLoads.find((item) => item.id === editId);
    if (!load) return;
    const previousPower = load.powerW;
    Object.assign(load, values);
    addEvent(previousPower !== load.powerW ? `${load.name} изменён: ${formatLoadNumber(previousPower, 2, false)} → ${formatLoadNumber(load.powerW, 2, false)} Вт` : `${load.name} изменён`, 'success');
  } else {
    const load = { id: createCustomLoadId(), ...values, enabled: false };
    state.settings.customLoads.push(load);
    ensurePhaseAssignments();
    addEvent(`Добавлена нагрузка «${load.name}», ${formatLoadNumber(load.powerW, 2, false)} Вт`, 'success');
  }
  state.energyLab.showLoadForm = false;
  state.energyLab.editingLoadId = null;
  refreshAfterEnergyLabChange();
}

function readBreakerForm(form) {
  const data = new FormData(form); const catalog = getBreakerLoadCatalog();
  const linkedLoadIds = [...new Set(data.getAll('linkedLoadIds').map(String))].filter((id) => catalog.some((load) => load.id === id));
  let powerW = Number(data.get('powerW')); let powerFactor = Number(data.get('powerFactor'));
  if (linkedLoadIds.length) {
    const totals = calculateLoadTotals(catalog.filter((load) => linkedLoadIds.includes(load.id)).map((load) => ({ ...load, efficiency: 1 })), Number(data.get('voltageV')) || 230);
    powerW = totals.activePowerW; powerFactor = totals.powerFactor;
  }
  const values = {
    name: String(data.get('name') || '').trim().slice(0, 100), designation: String(data.get('designation') || '').trim().slice(0, 20),
    networkType: data.get('networkType') === 'three' ? 'three' : 'single', voltageV: Number(data.get('voltageV')),
    powerW, powerFactor, efficiency: Number(data.get('efficiency')), currentMode: data.get('currentMode') === 'manual' ? 'manual' : 'auto',
    manualCurrentA: Number(data.get('manualCurrentA')), characteristic: String(data.get('characteristic')),
    ratingA: Number(data.get('ratingA')), phase: String(data.get('phase')),
    cable: { material: data.get('cableMaterial') === 'aluminum' ? 'aluminum' : 'copper', sectionMM2: Number(data.get('cableSection')), ampacityA: null },
    linkedLoadIds
  };
  const calculation = calculateBreakerValues(values);
  if (!values.name) return { error: 'Введите название линии.' };
  if (!/^QF[\w-]*$/i.test(values.designation)) return { error: 'Обозначение должно начинаться с QF и не содержать пробелов.' };
  if (!Number.isFinite(values.voltageV) || values.voltageV <= 0 || !Number.isFinite(values.powerW) || values.powerW <= 0) return { error: 'Напряжение и мощность должны быть больше нуля.' };
  if (!calculation) return { error: 'Проверьте cosφ и КПД: допустимо 0 < значение ≤ 1.' };
  if (values.currentMode === 'manual' && (!Number.isFinite(values.manualCurrentA) || values.manualCurrentA <= 0)) return { error: 'Введите положительный максимальный рабочий ток.' };
  if (!BREAKER_CHARACTERISTICS.includes(values.characteristic)) return { error: 'Выберите характеристику B, C или D.' };
  if (!Number.isFinite(values.cable.sectionMM2) || values.cable.sectionMM2 <= 0) return { error: 'Сечение кабеля должно быть больше нуля.' };
  values.phase = values.networkType === 'three' ? '3~' : ['L1', 'L2', 'L3'].includes(values.phase) ? values.phase : 'L1';
  const workingCurrentA = values.currentMode === 'manual' ? values.manualCurrentA : calculation.calculatedCurrentA;
  values.ratingA = BREAKER_RATINGS_A.includes(values.ratingA) ? values.ratingA : suggestBreakerRating(workingCurrentA);
  return { values, calculation, workingCurrentA };
}

function updateBreakerFormPreview(form, applySuggestion = false) {
  if (!form) return;
  const result = readBreakerForm(form); const preview = form.querySelector('#breakerFormPreview'); const error = form.querySelector('#energyLabBreakerError');
  if (result.error) { if (preview) preview.innerHTML = '<strong>Недостаточно данных для расчёта</strong>'; if (error) error.textContent = result.error; return; }
  if (error) error.textContent = '';
  const powerInput = form.elements.powerW; const factorInput = form.elements.powerFactor;
  if (result.values.linkedLoadIds.length) { powerInput.value = result.values.powerW.toFixed(2); factorInput.value = result.values.powerFactor.toFixed(3); }
  const currentInput = form.elements.manualCurrentA;
  if (result.values.currentMode === 'auto') { currentInput.readOnly = true; currentInput.value = result.calculation.calculatedCurrentA.toFixed(3); } else currentInput.readOnly = false;
  const suggestion = suggestBreakerRating(result.workingCurrentA);
  if (applySuggestion) form.elements.ratingA.value = String(suggestion);
  const selectedRating = Number(form.elements.ratingA.value) || suggestion;
  const check = getCableCheck({ ratingA: selectedRating, cable: result.values.cable }, result.workingCurrentA);
  if (preview) preview.innerHTML = `<strong>Расчётный ток: ${result.calculation.calculatedCurrentA.toFixed(2)} А</strong><span>Рабочий ток Ib: ${result.workingCurrentA.toFixed(2)} А · Предлагаемый номинал: ${suggestion} А</span><small class="is-${check.status}">${check.status === 'ok' ? '✓' : '⚠'} ${escapeHtml(check.text)}</small>`;
}

function handleEnergyLabBreakerSubmit(form) {
  const result = readBreakerForm(form); const error = form.querySelector('#energyLabBreakerError');
  if (result.error) { error.textContent = result.error; return; }
  const editId = form.dataset.breakerId; const duplicate = getAllBreakerDefinitions().find((breaker) => breaker.designation.toLowerCase() === result.values.designation.toLowerCase() && breaker.id !== editId);
  if (duplicate) { error.textContent = `Обозначение ${result.values.designation} уже используется.`; return; }
  state.settings.energyLab.customBreakers.forEach((breaker) => {
    if (breaker.id !== editId) breaker.linkedLoadIds = breaker.linkedLoadIds.filter((id) => !result.values.linkedLoadIds.includes(id));
  });
  const now = new Date().toISOString(); const existing = getCustomBreakerById(editId);
  if (existing) {
    Object.assign(existing, result.values, { snapshotPowerW: result.values.powerW, updatedAt: now });
    addEvent(`${existing.designation} (${existing.name}) изменён`, 'success');
  } else {
    const breaker = { id: createCustomBreakerId(), ...result.values, enabled: true, snapshotPowerW: result.values.powerW, createdAt: now, updatedAt: now };
    state.settings.energyLab.customBreakers.push(breaker); state.settings.energyLab.breakerTrips[breaker.id] = false;
    addEvent(`${breaker.designation} добавлен: ${breaker.name}, ${breaker.characteristic}${breaker.ratingA}`, 'success');
  }
  state.energyLab.breakerView = 'list'; state.energyLab.breakerId = null; state.energyLab.breakerDeleteId = null;
  refreshAfterEnergyLabChange();
}

function deleteCustomBreaker(breakerId) {
  const index = state.settings.energyLab.customBreakers.findIndex((breaker) => breaker.id === breakerId);
  if (index < 0) return null;
  const [removed] = state.settings.energyLab.customBreakers.splice(index, 1);
  delete state.settings.energyLab.breakerTrips[breakerId];
  return removed;
}

function toggleEnergyLabBreaker(breakerId, tripped = false) {
  const breaker = getBreakerDefinition(breakerId); if (!breaker) return;
  const custom = getCustomBreakerById(breakerId);
  const ownEnabled = custom ? custom.enabled : state.settings.energyLab.breakers[breakerId] !== false;
  const nextEnabled = tripped ? false : !ownEnabled;
  if (custom) custom.enabled = nextEnabled; else state.settings.energyLab.breakers[breakerId] = nextEnabled;
  state.settings.energyLab.breakerTrips[breakerId] = tripped;
  addEvent(`${breaker.designation} (${breaker.description}) ${nextEnabled ? 'включён' : tripped ? 'учебно отключился' : 'отключён'}`, tripped ? 'emergency' : nextEnabled ? 'success' : 'warning');
  refreshAfterEnergyLabChange();
}

function handleEnergyLabAction(button) {
  const action = button.dataset.energyAction;
  if (action === 'toggle-breaker') toggleEnergyLabBreaker(button.dataset.breakerId);
  if (action === 'trip-breaker') toggleEnergyLabBreaker(button.dataset.breakerId, true);
  if (action === 'breaker-add') { state.energyLab.breakerView = 'form'; state.energyLab.breakerId = null; state.energyLab.breakerDeleteId = null; renderEnergyLabTool('breakers'); }
  if (action === 'breaker-cancel' || action === 'breaker-back') { state.energyLab.breakerView = 'list'; state.energyLab.breakerId = null; state.energyLab.breakerDeleteId = null; renderEnergyLabTool('breakers'); }
  if (action === 'breaker-open') { state.energyLab.breakerView = 'detail'; state.energyLab.breakerId = button.dataset.breakerId; state.energyLab.breakerDeleteId = null; renderEnergyLabTool('breakers'); }
  if (action === 'breaker-edit') { state.energyLab.breakerView = 'form'; state.energyLab.breakerId = button.dataset.breakerId; state.energyLab.breakerDeleteId = null; renderEnergyLabTool('breakers'); }
  if (action === 'breaker-auto-calculate') updateBreakerFormPreview(button.closest('#energyLabBreakerForm'), true);
  if (action === 'breaker-recalculate') {
    const breaker = getCustomBreakerById(button.dataset.breakerId); const values = breaker && getConfiguredBreakerValues(breaker);
    if (breaker && values) { breaker.powerW = values.powerW; breaker.powerFactor = values.powerFactor; breaker.snapshotPowerW = values.powerW; breaker.updatedAt = new Date().toISOString(); addEvent(`${breaker.designation}: нагрузка пересчитана, номинал ${breaker.ratingA} А сохранён`, 'info'); saveSettings(); renderEnergyLabTool('breakers'); }
  }
  if (action === 'breaker-delete') {
    const id = button.dataset.breakerId; const breaker = getCustomBreakerById(id);
    if (!breaker) return;
    if (state.energyLab.breakerDeleteId !== id) { state.energyLab.breakerDeleteId = id; renderEnergyLabTool('breakers'); return; }
    deleteCustomBreaker(id); state.energyLab.breakerDeleteId = null;
    addEvent(`${breaker.designation} удалён. Связанные нагрузки сохранены и отвязаны от линии.`, 'warning'); refreshAfterEnergyLabChange();
  }
  if (action === 'show-add-load') {
    state.energyLab.showLoadForm = true;
    state.energyLab.editingLoadId = null;
    renderEnergyLabTool('loads');
  }
  if (action === 'cancel-load-form') {
    state.energyLab.showLoadForm = false;
    state.energyLab.editingLoadId = null;
    renderEnergyLabTool('loads');
  }
  if (action === 'toggle-energy-load') {
    if (button.dataset.custom === 'true') toggleCustomLoad(button.dataset.loadId);
    else toggleLoad(button.dataset.loadId);
    renderEnergyLabTool('loads');
  }
  if (action === 'edit-energy-load') {
    state.energyLab.showLoadForm = true;
    state.energyLab.editingLoadId = button.dataset.loadId;
    renderEnergyLabTool('loads');
  }
  if (action === 'delete-energy-load') {
    deleteCustomLoad(button.dataset.loadId);
    renderEnergyLabTool('loads');
  }
  if (action === 'set-network-type') {
    state.settings.energyLab.networkType = button.dataset.networkType === 'three' ? 'three' : 'single';
    addEvent(`Выбран ${state.settings.energyLab.networkType === 'three' ? 'трёхфазный' : 'однофазный'} учебный режим`, 'info');
    updateMeasurements(false);
    saveSettings();
    renderEnergyLabTool('three-phase');
  }
  if (action === 'suggest-balance') {
    state.energyLab.balanceSuggestion = getBalanceSuggestion();
    if (!state.energyLab.balanceSuggestion) addEvent('Фазы не требуют переноса активной нагрузки', 'info');
    renderEnergyLabTool('phase-balance');
  }
  if (action === 'apply-balance' && state.energyLab.balanceSuggestion) {
    const suggestion = state.energyLab.balanceSuggestion;
    const breaker = suggestion.breakerId ? getCustomBreakerById(suggestion.breakerId) : null;
    if (breaker) breaker.phase = suggestion.to;
    else state.settings.energyLab.phaseAssignments[suggestion.loadId] = suggestion.to;
    addEvent(`Нагрузка «${suggestion.loadName}» перенесена ${suggestion.from} → ${suggestion.to}`, 'success');
    state.energyLab.balanceSuggestion = null;
    saveSettings();
    renderEnergyLabTool('phase-balance');
  }
  if (action === 'cancel-balance') {
    state.energyLab.balanceSuggestion = null;
    renderEnergyLabTool('phase-balance');
  }
  if (action === 'set-emergency') setEmergencyMode(button.dataset.emergency);
  if (action === 'restore-normal') restoreNormalMode();
  if (action === 'analysis-metric') {
    state.energyLab.analysisMetric = button.dataset.metric;
    renderEnergyLabTool('analysis');
  }
  if (action === 'event-filter') {
    state.energyLab.eventFilter = button.dataset.filter;
    renderEnergyLabTool('events');
  }
  if (action === 'equipment-add') {
    state.energyLab.equipmentView = 'form'; state.energyLab.equipmentId = null; renderEnergyLabTool('equipment');
  }
  if (action === 'equipment-open') {
    state.energyLab.equipmentView = 'detail'; state.energyLab.equipmentId = button.dataset.equipmentId; state.energyLab.equipmentTab = 'overview'; state.energyLab.equipmentDeleteId = null; renderEnergyLabTool('equipment');
  }
  if (action === 'equipment-back' || action === 'equipment-cancel-form') {
    state.energyLab.equipmentView = 'list'; state.energyLab.equipmentId = null; state.energyLab.equipmentDeleteId = null; state.energyLab.equipmentShowMeasurementForm = false; state.energyLab.equipmentShowMaintenanceForm = false; state.energyLab.equipmentEditingMeasurementId = null; state.energyLab.equipmentMeasurementDeleteId = null; state.energyLab.equipmentEditingNoteId = null; state.energyLab.equipmentNoteDeleteId = null; renderEnergyLabTool('equipment');
  }
  if (action === 'equipment-edit') {
    state.energyLab.equipmentView = 'form'; state.energyLab.equipmentId = button.dataset.equipmentId; renderEnergyLabTool('equipment');
  }
  if (action === 'equipment-duplicate') duplicateEquipment(button.dataset.equipmentId);
  if (action === 'equipment-request-delete') {
    state.energyLab.equipmentDeleteId = button.dataset.equipmentId; renderEnergyLabTool('equipment');
  }
  if (action === 'equipment-cancel-delete') {
    state.energyLab.equipmentDeleteId = null; renderEnergyLabTool('equipment');
  }
  if (action === 'equipment-confirm-delete') {
    const removed = equipmentRepository.remove(button.dataset.equipmentId);
    if (removed) addEvent(`${removed.designation} удалён из оборудования`, 'warning', { equipmentId: removed.id, eventType: 'equipment_deleted' });
    state.energyLab.equipmentView = 'list'; state.energyLab.equipmentId = null; state.energyLab.equipmentDeleteId = null; updateHomeScreen(); renderEnergyLabTool('equipment');
  }
  if (action === 'equipment-tab') {
    state.energyLab.equipmentTab = button.dataset.tab; state.energyLab.equipmentShowMeasurementForm = false; state.energyLab.equipmentShowMaintenanceForm = false; state.energyLab.equipmentEditingMeasurementId = null; state.energyLab.equipmentMeasurementDeleteId = null; state.energyLab.equipmentEditingNoteId = null; state.energyLab.equipmentNoteDeleteId = null; renderEnergyLabTool('equipment');
  }
  if (action === 'equipment-show-measurement') { state.energyLab.equipmentEditingMeasurementId = null; state.energyLab.equipmentShowMeasurementForm = true; renderEnergyLabTool('equipment'); }
  if (action === 'equipment-cancel-measurement') { state.energyLab.equipmentShowMeasurementForm = false; state.energyLab.equipmentEditingMeasurementId = null; renderEnergyLabTool('equipment'); }
  if (action === 'equipment-edit-measurement') { state.energyLab.equipmentEditingMeasurementId = button.dataset.measurementId; state.energyLab.equipmentShowMeasurementForm = true; renderEnergyLabTool('equipment'); }
  if (action === 'equipment-request-measurement-delete') { state.energyLab.equipmentMeasurementDeleteId = button.dataset.measurementId; renderEnergyLabTool('equipment'); }
  if (action === 'equipment-cancel-measurement-delete') { state.energyLab.equipmentMeasurementDeleteId = null; renderEnergyLabTool('equipment'); }
  if (action === 'equipment-confirm-measurement-delete') deleteEquipmentMeasurement(button.dataset.measurementId);
  if (action === 'equipment-show-maintenance') { state.energyLab.equipmentShowMaintenanceForm = true; renderEnergyLabTool('equipment'); }
  if (action === 'equipment-cancel-maintenance') { state.energyLab.equipmentShowMaintenanceForm = false; renderEnergyLabTool('equipment'); }
  if (action === 'equipment-measurement-metric') { state.energyLab.equipmentMeasurementMetric = button.dataset.metric; renderEnergyLabTool('equipment'); }
  if (action === 'equipment-edit-note') { state.energyLab.equipmentEditingNoteId = button.dataset.noteId; renderEnergyLabTool('equipment'); }
  if (action === 'equipment-cancel-note-edit') { state.energyLab.equipmentEditingNoteId = null; renderEnergyLabTool('equipment'); }
  if (action === 'equipment-request-note-delete') { state.energyLab.equipmentNoteDeleteId = button.dataset.noteId; renderEnergyLabTool('equipment'); }
  if (action === 'equipment-cancel-note-delete') { state.energyLab.equipmentNoteDeleteId = null; renderEnergyLabTool('equipment'); }
  if (action === 'equipment-confirm-note-delete') deleteEquipmentNote(button.dataset.noteId);
  if (action === 'equipment-save-simulation') saveEquipmentSimulationMeasurement();
  if (action === 'equipment-open-linked') {
    const linked = equipmentRepository.find(state.energyLab.equipmentId);
    openEnergyLabTool(linked?.linkedBreakerId ? 'breakers' : linked?.linkedLineId ? 'line' : 'single-line');
  }
  if (action === 'equipment-export') exportEquipmentJson();
  if (action === 'equipment-import') document.getElementById('equipmentImportFile')?.click();
  if (action === 'equipment-reset-filters') {
    state.energyLab.equipmentSearch = ''; state.energyLab.equipmentFilters = { type: '', manufacturer: '', status: '', object: '', panel: '', line: '' }; state.energyLab.equipmentAttentionOnly = false; renderEnergyLabTool('equipment');
  }
  if (action === 'equipment-clear-attention') { state.energyLab.equipmentAttentionOnly = false; renderEnergyLabTool('equipment'); }
}

function initializeEnergyLab() {
  ensurePhaseAssignments();
  updateEnergyLabSummary();
  document.querySelectorAll('[data-energy-tool]').forEach((button) => {
    button.addEventListener('click', () => openEnergyLabTool(button.dataset.energyTool));
  });
  document.querySelectorAll('[data-energy-quick]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.energyQuick;
      if (action === 'add-load') {
        openEnergyLabTool('loads');
        state.energyLab.showLoadForm = true;
        renderEnergyLabTool('loads');
      }
      if (action === 'emergency') openEnergyLabTool('emergency');
      if (action === 'three-phase') {
        state.settings.energyLab.networkType = 'three';
        updateMeasurements(false);
        saveSettings();
        openEnergyLabTool('three-phase');
      }
      if (action === 'analysis') openEnergyLabTool('analysis');
    });
  });
  elements.energyLabBack.addEventListener('click', closeEnergyLabTool);
  elements.energyLabToolContent.addEventListener('click', (event) => {
    const button = event.target.closest('[data-energy-action]');
    if (button) handleEnergyLabAction(button);
  });
  elements.energyLabToolContent.addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.target.id === 'energyLabBreakerForm') handleEnergyLabBreakerSubmit(event.target);
    if (event.target.id === 'energyLabLoadForm') handleEnergyLabLoadSubmit(event.target);
    if (event.target.id === 'energyLabLineForm') handleEnergyLabLineSubmit(event.target);
    if (event.target.id === 'equipmentForm') handleEquipmentFormSubmit(event.target);
    if (event.target.id === 'equipmentMeasurementForm') handleEquipmentMeasurementSubmit(event.target);
    if (event.target.id === 'equipmentMaintenanceForm') handleEquipmentMaintenanceSubmit(event.target);
    if (event.target.id === 'equipmentNoteForm') handleEquipmentNoteSubmit(event.target);
  });
  elements.energyLabToolContent.addEventListener('input', (event) => {
    const breakerForm = event.target.closest('#energyLabBreakerForm');
    if (breakerForm) { updateBreakerFormPreview(breakerForm, false); return; }
    if (event.target.id !== 'equipmentSearch') return;
    state.energyLab.equipmentSearch = event.target.value;
    renderEquipmentResults();
  });
  elements.energyLabToolContent.addEventListener('change', (event) => {
    const breakerForm = event.target.closest('#energyLabBreakerForm');
    if (breakerForm) {
      if (event.target.id === 'breakerNetworkType') {
        breakerForm.elements.voltageV.value = event.target.value === 'three' ? '400' : '230';
        breakerForm.elements.phase.value = event.target.value === 'three' ? '3~' : 'L1';
      }
      updateBreakerFormPreview(breakerForm, false);
      return;
    }
    if (event.target.name === 'lineId' && event.target.closest('#energyLabLineForm')) {
      state.energyLab.selectedLine = event.target.value;
      state.energyLab.lineResult = null;
      renderEnergyLabTool('line');
      return;
    }
    if (event.target.dataset.equipmentFilter) {
      state.energyLab.equipmentFilters[event.target.dataset.equipmentFilter] = event.target.value;
      state.energyLab.equipmentAttentionOnly = false;
      renderEnergyLabTool('equipment');
      return;
    }
    if (event.target.id === 'equipmentSort') {
      state.energyLab.equipmentSort = event.target.value;
      renderEnergyLabTool('equipment');
      return;
    }
    if (event.target.id === 'equipmentMeasurementMetric') {
      state.energyLab.equipmentMeasurementMetric = event.target.value;
      window.requestAnimationFrame(drawEquipmentMeasurementChart);
      return;
    }
    if (event.target.id === 'equipmentType') {
      const dynamic = document.getElementById('equipmentDynamicFields');
      if (dynamic) dynamic.innerHTML = renderEquipmentDynamicFields(event.target.value);
      return;
    }
    if (event.target.id === 'equipmentImportFile') importEquipmentJson(event.target.files?.[0]);
  });
}

function applyTheme(theme) {
  const isLight = theme === 'light';
  document.body.classList.toggle('light-theme', isLight);
  elements.themeToggle.textContent = isLight ? '☀️' : '🌙';
  elements.themeToggle.setAttribute('aria-label', isLight ? 'Включить тёмную тему' : 'Включить светлую тему');
  state.settings.theme = isLight ? 'light' : 'dark';
  saveSettings();
  window.requestAnimationFrame(() => {
    drawMeasurementChart();
    drawEnergyLabAnalysisChart();
    drawEquipmentMeasurementChart();
  });
}

function toggleTheme() {
  applyTheme(state.settings.theme === 'light' ? 'dark' : 'light');
}

// ---------- Умный решатель: безопасная математика без eval ----------

function tokenizeExpression(expression) {
  const normalized = expression
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/√/g, 'sqrt')
    .replace(/π/g, 'pi');
  const tokens = [];
  let position = 0;

  while (position < normalized.length) {
    const rest = normalized.slice(position);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      position += whitespace[0].length;
      continue;
    }

    const numberToken = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (numberToken) {
      tokens.push({ type: 'number', value: Number(numberToken[0]) });
      position += numberToken[0].length;
      continue;
    }

    const identifier = rest.match(/^(sqrt|sin|cos|tan|log|ln|pi|e)/);
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0] });
      position += identifier[0].length;
      continue;
    }

    const symbol = normalized[position];
    if ('+-*/^()'.includes(symbol)) {
      tokens.push({ type: 'symbol', value: symbol });
      position += 1;
      continue;
    }
    throw new Error(`Недопустимый символ: ${symbol}`);
  }
  return tokens;
}

function evaluateExpression(expression) {
  const tokens = tokenizeExpression(expression);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const consume = (value) => {
    const token = tokens[cursor];
    if (!token || (value && token.value !== value)) throw new Error('Проверьте скобки и операторы.');
    cursor += 1;
    return token;
  };

  function parsePrimary() {
    const token = peek();
    if (!token) throw new Error('Выражение не завершено.');
    if (token.type === 'number') {
      cursor += 1;
      return token.value;
    }
    if (token.value === 'pi' || token.value === 'e') {
      cursor += 1;
      return token.value === 'pi' ? Math.PI : Math.E;
    }
    if (token.value === '(') {
      consume('(');
      const value = parseAddition();
      consume(')');
      return value;
    }
    if (token.type === 'identifier') {
      const functionName = token.value;
      cursor += 1;
      consume('(');
      const argument = parseAddition();
      consume(')');
      const radians = argument * Math.PI / 180;
      const functions = {
        sqrt: () => {
          if (argument < 0) throw new Error('Корень из отрицательного числа не является действительным.');
          return Math.sqrt(argument);
        },
        sin: () => Math.sin(radians),
        cos: () => Math.cos(radians),
        tan: () => Math.tan(radians),
        log: () => Math.log10(argument),
        ln: () => Math.log(argument)
      };
      const result = functions[functionName]();
      if (!Number.isFinite(result)) throw new Error('Функция не определена для этого значения.');
      return result;
    }
    throw new Error('Ожидалось число, функция или скобка.');
  }

  function parsePower() {
    const base = parsePrimary();
    if (peek()?.value === '^') {
      consume('^');
      return base ** parseUnary();
    }
    return base;
  }

  function parseUnary() {
    if (peek()?.value === '+') {
      consume('+');
      return parseUnary();
    }
    if (peek()?.value === '-') {
      consume('-');
      return -parseUnary();
    }
    return parsePower();
  }

  function parseMultiplication() {
    let value = parseUnary();
    while (peek()?.value === '*' || peek()?.value === '/') {
      const operator = consume().value;
      const right = parseUnary();
      if (operator === '/' && right === 0) throw new Error('Деление на ноль невозможно.');
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }

  function parseAddition() {
    let value = parseMultiplication();
    while (peek()?.value === '+' || peek()?.value === '-') {
      const operator = consume().value;
      const right = parseMultiplication();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  if (!tokens.length) throw new Error('Введите выражение.');
  const result = parseAddition();
  if (cursor !== tokens.length) throw new Error('Не удалось разобрать выражение полностью.');
  if (!Number.isFinite(result)) throw new Error('Результат не является конечным числом.');
  return result;
}

function normalizeVariableName(rawName) {
  const name = rawName.toLowerCase().replace(/\s+/g, '');
  if (name.startsWith('cos')) return 'cos';
  if (name === 'η' || name === 'eta') return 'eta';
  if (name === 'p1' || name === 'p2') return name.toUpperCase();
  if (name === 'δu' || name === '∆u' || name === 'Δu' || name === 'deltau') return 'deltaU';
  if (name === 'δp' || name === '∆p' || name === 'Δp' || name === 'deltap') return 'deltaP';
  return rawName.trim().toUpperCase();
}

function normalizeEngineeringUnit(rawUnit) {
  return rawUnit.toLowerCase().replace(/[\s.]/g, '').replace('ω', 'ом').replace('Ω', 'ом');
}

function convertEngineeringInput(variable, numericValue, rawUnit) {
  const unit = normalizeEngineeringUnit(rawUnit);
  const factors = {
    U: { '': 1, 'в': 1, 'кв': 1_000 },
    I: { '': 1, 'а': 1, 'ка': 1_000 },
    P: { '': 1, 'вт': 1, 'квт': 1_000, 'мвт': 1_000_000 },
    P1: { '': 1, 'вт': 1, 'квт': 1_000, 'мвт': 1_000_000 },
    P2: { '': 1, 'вт': 1, 'квт': 1_000, 'мвт': 1_000_000 },
    Q: { '': 1, 'вар': 1, 'квар': 1_000, 'мвар': 1_000_000 },
    S: { '': 1, 'ва': 1, 'ква': 1_000, 'мва': 1_000_000 },
    R: { '': 1, 'ом': 1, 'ком': 1_000 },
    X: { '': 1, 'ом': 1, 'ком': 1_000 },
    Z: { '': 1, 'ом': 1, 'ком': 1_000 },
    F: { '': 1, 'гц': 1 }
  };
  if (variable === 'cos' || variable === 'eta' || variable.startsWith('delta')) return numericValue;
  const variableFactors = factors[variable];
  if (!variableFactors) return numericValue;
  if (!(unit in variableFactors)) throw new Error(`Единица «${rawUnit}» не подходит для ${variable}.`);
  return numericValue * variableFactors[unit];
}

function parseEngineeringValues(taskText) {
  const values = {};
  const entries = [];
  const valuePattern = /(cos\s*[φф]|cosphi|cosf|η|eta|p\s*[12]|delta\s*[up]|[Δ∆δ]\s*[up]|[uipqsrxzf])\s*=\s*(-?\d+(?:[.,]\d+)?)\s*([A-Za-zА-Яа-яЁёΩω%·²³/]*)/giu;
  let match;
  while ((match = valuePattern.exec(taskText)) !== null) {
    const variable = normalizeVariableName(match[1]);
    const originalValue = Number(match[2].replace(',', '.'));
    const rawUnit = match[3] || '';
    const value = convertEngineeringInput(variable, originalValue, rawUnit);
    values[variable] = value;
    entries.push({ variable, value, originalValue, rawUnit, display: `${variable === 'cos' ? 'cosφ' : variable === 'eta' ? 'η' : variable} = ${match[2]}${rawUnit ? ` ${rawUnit}` : ''}` });
  }
  return { values, entries };
}

function extractTargetVariable(taskText, knownValues) {
  const variableSource = '(cos\\s*[φф]|cosphi|cosf|η|eta|p\\s*[12]|delta\\s*[up]|[Δ∆δ]\\s*[up]|[uipqsrxzf])';
  const explicit = taskText.match(new RegExp(`(?:найти|определить|вычислить)\\s*[:—-]?\\s*${variableSource}`, 'iu'));
  if (explicit) return normalizeVariableName(explicit[1]);
  const question = taskText.match(new RegExp(`${variableSource}\\s*(?:=\\s*)?\\?`, 'iu'));
  if (question) return normalizeVariableName(question[1]);

  const formulaVariables = [];
  const formulaPattern = /cos\s*[φф]|η|p\s*[12]|[uipqsrxz]/giu;
  const formulaLines = taskText.split('\n').filter((line) => /[=×*\/√²^]/u.test(line) && !/=\s*-?\d/u.test(line));
  formulaLines.join(' ').match(formulaPattern)?.forEach((item) => {
    const variable = normalizeVariableName(item);
    if (!formulaVariables.includes(variable)) formulaVariables.push(variable);
  });
  const missing = formulaVariables.filter((variable) => !(variable in knownValues));
  return missing.length === 1 ? missing[0] : null;
}

function formatSolverNumber(value, maximumFractionDigits = 3) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(value);
}

function formatEngineeringResult(variable, baseValue) {
  const formatScaled = (value, units) => {
    const selected = units.find((item) => Math.abs(value) >= item.min) || units[units.length - 1];
    return `${formatSolverNumber(value / selected.factor)} ${selected.label}`;
  };
  if (variable === 'P') return formatScaled(baseValue, [{ min: 1_000_000, factor: 1_000_000, label: 'МВт' }, { min: 1_000, factor: 1_000, label: 'кВт' }, { min: 0, factor: 1, label: 'Вт' }]);
  if (variable === 'Q') return formatScaled(baseValue, [{ min: 1_000_000, factor: 1_000_000, label: 'Мвар' }, { min: 1_000, factor: 1_000, label: 'квар' }, { min: 0, factor: 1, label: 'вар' }]);
  if (variable === 'S') return formatScaled(baseValue, [{ min: 1_000_000, factor: 1_000_000, label: 'МВА' }, { min: 1_000, factor: 1_000, label: 'кВА' }, { min: 0, factor: 1, label: 'ВА' }]);
  if (variable === 'U') return Math.abs(baseValue) >= 1_000 ? `${formatSolverNumber(baseValue / 1_000)} кВ` : `${formatSolverNumber(baseValue)} В`;
  if (variable === 'I') return Math.abs(baseValue) >= 1_000 ? `${formatSolverNumber(baseValue / 1_000)} кА` : `${formatSolverNumber(baseValue)} А`;
  if (variable === 'R' || variable === 'X' || variable === 'Z') return Math.abs(baseValue) >= 1_000 ? `${formatSolverNumber(baseValue / 1_000)} кОм` : `${formatSolverNumber(baseValue)} Ом`;
  if (variable === 'cos') return formatSolverNumber(baseValue, 4);
  if (variable === 'eta') return `${formatSolverNumber(baseValue)} %`;
  return formatSolverNumber(baseValue);
}

function buildEngineeringSolution(taskText, category) {
  const parsed = parseEngineeringValues(taskText);
  const v = parsed.values;
  const target = extractTargetVariable(taskText, v);
  if (!target) throw new Error('Укажите неизвестную величину, например: «Найти I».');
  if (Object.prototype.hasOwnProperty.call(v, 'cos') && (v.cos < 0 || v.cos > 1)) {
    throw new Error('Коэффициент мощности cosφ должен находиться в диапазоне от 0 до 1.');
  }
  const threePhase = /√\s*3|sqrt\s*\(?\s*3|тр[её]хфаз|3\s*[-–]?\s*фаз/iu.test(taskText);
  const factor = threePhase ? Math.sqrt(3) : 1;
  const factorText = threePhase ? '√3 × ' : '';
  const factorNumber = threePhase ? '1,732 × ' : '';
  const has = (...variables) => variables.every((variable) => Number.isFinite(v[variable]));
  let solution;

  if (target === 'I' && has('P', 'U', 'cos')) {
    if (v.U <= 0 || v.cos <= 0) throw new Error('Для расчёта тока требуются U > 0 и cosφ > 0.');
    solution = { title: 'Расчёт тока', formula: `P = ${factorText}U × I × cosφ`, transform: `I = P / (${factorText}U × cosφ)`, substitution: `I = ${formatSolverNumber(v.P)} / (${factorNumber}${formatSolverNumber(v.U)} × ${formatSolverNumber(v.cos)})`, value: v.P / (factor * v.U * v.cos) };
  } else if (target === 'U' && has('P', 'I', 'cos')) {
    if (v.I <= 0 || v.cos <= 0) throw new Error('Для расчёта напряжения требуются I > 0 и cosφ > 0.');
    solution = { title: 'Расчёт напряжения', formula: `P = ${factorText}U × I × cosφ`, transform: `U = P / (${factorText}I × cosφ)`, substitution: `U = ${formatSolverNumber(v.P)} / (${factorNumber}${formatSolverNumber(v.I)} × ${formatSolverNumber(v.cos)})`, value: v.P / (factor * v.I * v.cos) };
  } else if (target === 'P' && has('U', 'I', 'cos')) {
    solution = { title: 'Расчёт активной мощности', formula: `P = ${factorText}U × I × cosφ`, transform: `P = ${factorText}U × I × cosφ`, substitution: `P = ${factorNumber}${formatSolverNumber(v.U)} × ${formatSolverNumber(v.I)} × ${formatSolverNumber(v.cos)}`, value: factor * v.U * v.I * v.cos };
  } else if (target === 'S' && has('P', 'Q')) {
    solution = { title: 'Расчёт полной мощности', formula: 'S = √(P² + Q²)', transform: 'S = √(P² + Q²)', substitution: `S = √(${formatSolverNumber(v.P)}² + ${formatSolverNumber(v.Q)}²)`, value: Math.sqrt(v.P ** 2 + v.Q ** 2) };
  } else if (target === 'Q' && has('S', 'P')) {
    if (v.S < Math.abs(v.P)) throw new Error('Полная мощность S не может быть меньше |P|.');
    solution = { title: 'Расчёт реактивной мощности', formula: 'S² = P² + Q²', transform: 'Q = √(S² − P²)', substitution: `Q = √(${formatSolverNumber(v.S)}² − ${formatSolverNumber(v.P)}²)`, value: Math.sqrt(v.S ** 2 - v.P ** 2) };
  } else if (target === 'P' && has('S', 'Q')) {
    if (v.S < Math.abs(v.Q)) throw new Error('Полная мощность S не может быть меньше |Q|.');
    solution = { title: 'Расчёт активной мощности', formula: 'S² = P² + Q²', transform: 'P = √(S² − Q²)', substitution: `P = √(${formatSolverNumber(v.S)}² − ${formatSolverNumber(v.Q)}²)`, value: Math.sqrt(v.S ** 2 - v.Q ** 2) };
  } else if (target === 'cos' && has('P', 'S')) {
    if (v.S === 0) throw new Error('S должна быть больше нуля.');
    solution = { title: 'Расчёт коэффициента мощности', formula: 'cosφ = P / S', transform: 'cosφ = P / S', substitution: `cosφ = ${formatSolverNumber(v.P)} / ${formatSolverNumber(v.S)}`, value: v.P / v.S };
  } else if (target === 'S' && has('U', 'I')) {
    solution = { title: 'Расчёт полной мощности', formula: `S = ${factorText}U × I`, transform: `S = ${factorText}U × I`, substitution: `S = ${factorNumber}${formatSolverNumber(v.U)} × ${formatSolverNumber(v.I)}`, value: factor * v.U * v.I };
  } else if (target === 'I' && has('S', 'U')) {
    solution = { title: 'Расчёт тока', formula: `S = ${factorText}U × I`, transform: `I = S / (${factorText}U)`, substitution: `I = ${formatSolverNumber(v.S)} / (${factorNumber}${formatSolverNumber(v.U)})`, value: v.S / (factor * v.U) };
  } else if (target === 'R' && has('U', 'I')) {
    if (v.I === 0) throw new Error('Ток I должен быть больше нуля.');
    solution = { title: 'Расчёт сопротивления', formula: 'R = U / I', transform: 'R = U / I', substitution: `R = ${formatSolverNumber(v.U)} / ${formatSolverNumber(v.I)}`, value: v.U / v.I };
  } else if (target === 'I' && has('U', 'R')) {
    if (v.R === 0) throw new Error('Сопротивление R должно быть больше нуля.');
    solution = { title: 'Расчёт тока по закону Ома', formula: 'R = U / I', transform: 'I = U / R', substitution: `I = ${formatSolverNumber(v.U)} / ${formatSolverNumber(v.R)}`, value: v.U / v.R };
  } else if (target === 'P' && has('I', 'R')) {
    solution = { title: 'Мощность на сопротивлении', formula: 'P = I²R', transform: 'P = I²R', substitution: `P = ${formatSolverNumber(v.I)}² × ${formatSolverNumber(v.R)}`, value: v.I ** 2 * v.R };
  } else if (target === 'I' && has('P', 'R')) {
    if (v.R <= 0 || v.P < 0) throw new Error('Для расчёта нужны P ≥ 0 и R > 0.');
    solution = { title: 'Ток по мощности и сопротивлению', formula: 'P = I²R', transform: 'I = √(P / R)', substitution: `I = √(${formatSolverNumber(v.P)} / ${formatSolverNumber(v.R)})`, value: Math.sqrt(v.P / v.R) };
  } else if (target === 'P' && has('U', 'R')) {
    if (v.R === 0) throw new Error('Сопротивление R должно быть больше нуля.');
    solution = { title: 'Мощность по напряжению и сопротивлению', formula: 'P = U² / R', transform: 'P = U² / R', substitution: `P = ${formatSolverNumber(v.U)}² / ${formatSolverNumber(v.R)}`, value: v.U ** 2 / v.R };
  } else if (target === 'U' && has('P', 'R')) {
    if (v.P < 0 || v.R < 0) throw new Error('Для расчёта нужны P ≥ 0 и R ≥ 0.');
    solution = { title: 'Напряжение по мощности', formula: 'P = U² / R', transform: 'U = √(P × R)', substitution: `U = √(${formatSolverNumber(v.P)} × ${formatSolverNumber(v.R)})`, value: Math.sqrt(v.P * v.R) };
  } else if (target === 'eta' && has('P1', 'P2')) {
    if (v.P1 === 0) throw new Error('Входная мощность P1 должна быть больше нуля.');
    solution = { title: 'Расчёт КПД', formula: 'η = P2 / P1 × 100%', transform: 'η = P2 / P1 × 100%', substitution: `η = ${formatSolverNumber(v.P2)} / ${formatSolverNumber(v.P1)} × 100%`, value: v.P2 / v.P1 * 100 };
  } else {
    throw new Error(`Недостаточно данных для вычисления ${target === 'cos' ? 'cosφ' : target}. Проверьте исходные значения и формулу.`);
  }

  if (!Number.isFinite(solution.value)) throw new Error('Расчёт привёл к недопустимому числу.');
  if (target === 'cos' && (solution.value < 0 || solution.value > 1)) throw new Error('Полученный cosφ выходит за диапазон от 0 до 1.');
  solution.target = target;
  solution.result = `${target === 'cos' ? 'cosφ' : target === 'eta' ? 'η' : target} ≈ ${formatEngineeringResult(target, solution.value)}`;
  solution.condition = parsed.entries.length ? parsed.entries.map((entry) => entry.display).join('\n') : taskText.trim();
  solution.find = target === 'cos' ? 'cosφ' : target === 'eta' ? 'η' : target;
  solution.category = category;
  solution.note = 'Расчёт выполнен локально по указанной формуле. Промежуточные значения не округлялись.';
  return solution;
}

function solveTaskLocally(taskText, category) {
  const trimmed = taskText.trim();
  if (!trimmed) throw new Error('Введите текст задачи или математическое выражение.');

  const looksLikeExpression = !/[=]|найти|определить|вычислить|[А-Яа-яЁё]/u.test(trimmed.replace(/sqrt|sin|cos|tan|log|ln|pi/gi, ''));
  if (category === 'math' || looksLikeExpression) {
    const expression = trimmed.replace(/^(?:вычислить|решить)\s*:?\s*/iu, '');
    const value = evaluateExpression(expression);
    return {
      title: 'Вычисление выражения',
      category,
      condition: expression,
      find: 'Значение выражения',
      formula: expression,
      transform: 'Выполняем действия с учётом скобок и приоритета операторов.',
      substitution: expression,
      result: `Ответ ≈ ${formatSolverNumber(value, 8)}`,
      value,
      target: 'answer',
      note: 'Тригонометрические функции научного калькулятора вычисляются в градусах.'
    };
  }
  return buildEngineeringSolution(trimmed, category);
}

let currentSolverSolution = null;
let selectedSolverImage = null;
let solverImageUrl = null;

function renderSolverSolution(solution) {
  currentSolverSolution = solution;
  document.getElementById('solutionPlaceholder').hidden = true;
  document.getElementById('solutionContent').hidden = false;
  document.getElementById('solutionTitle').textContent = solution.title;
  document.getElementById('solutionCategoryLabel').textContent = SOLVER_CATEGORY_LABELS[solution.category];
  document.getElementById('solutionCondition').textContent = solution.condition;
  document.getElementById('solutionFind').textContent = solution.find;
  document.getElementById('solutionFormula').textContent = solution.formula;
  document.getElementById('solutionTransform').textContent = solution.transform;
  document.getElementById('solutionSubstitution').textContent = solution.substitution;
  document.getElementById('solutionResult').textContent = solution.result;
  const note = document.getElementById('solutionNote');
  note.textContent = solution.note;
  note.classList.remove('error');
  const details = document.getElementById('solutionDetails');
  details.classList.add('collapsed');
  document.getElementById('toggleSolutionDetails').textContent = 'Показать подробно';
  document.getElementById('saveSolution').disabled = false;
}

function renderSolverError(message) {
  const category = document.getElementById('solverCategory').value;
  currentSolverSolution = null;
  document.getElementById('solutionPlaceholder').hidden = true;
  document.getElementById('solutionContent').hidden = false;
  document.getElementById('solutionTitle').textContent = 'Нужно уточнить данные';
  document.getElementById('solutionCategoryLabel').textContent = SOLVER_CATEGORY_LABELS[category];
  document.getElementById('solutionCondition').textContent = document.getElementById('solverInput').value.trim() || 'Текст задачи не введён.';
  document.getElementById('solutionFind').textContent = 'Не определено';
  document.getElementById('solutionFormula').textContent = 'Формула не выбрана';
  document.getElementById('solutionTransform').textContent = 'Добавьте известные величины и явно укажите, что требуется найти.';
  document.getElementById('solutionSubstitution').textContent = 'Пример: P = 15 кВт, U = 380 В, cosφ = 0.85, найти I.';
  document.getElementById('solutionResult').textContent = 'Решение не выполнено';
  const note = document.getElementById('solutionNote');
  note.textContent = message;
  note.classList.add('error');
  document.getElementById('saveSolution').disabled = true;
}

function handleSolverSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('solverInput');
  const message = document.getElementById('solverInputMessage');
  const category = document.getElementById('solverCategory').value;
  message.textContent = '';

  if (!input.value.trim()) {
    message.textContent = selectedSolverImage
      ? 'Введите условие вручную: OCR/AI API в локальной версии не подключён.'
      : 'Введите условие задачи или выражение.';
    renderSolverError(message.textContent);
    return;
  }

  try {
    const solution = solveTaskLocally(input.value, category);
    solution.sourceText = input.value.trim();
    renderSolverSolution(solution);
    addEvent(`Умный решатель: ${solution.title}`, 'success');
    document.getElementById('solutionPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    renderSolverError(error.message);
  }
}

function buildSolutionText(solution) {
  return [
    solution.title.toUpperCase(),
    '',
    'УСЛОВИЕ',
    solution.condition,
    '',
    'НАЙТИ',
    solution.find,
    '',
    'ФОРМУЛА',
    solution.formula,
    '',
    'ПРЕОБРАЗОВАНИЕ',
    solution.transform,
    '',
    'ПОДСТАНОВКА',
    solution.substitution,
    '',
    'РЕЗУЛЬТАТ',
    solution.result
  ].join('\n');
}

async function copyCurrentSolution() {
  if (!currentSolverSolution) return;
  const button = document.getElementById('copySolution');
  const text = buildSolutionText(currentSolverSolution);
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
  }
  const previousLabel = button.textContent;
  button.textContent = 'Скопировано';
  window.setTimeout(() => { button.textContent = previousLabel; }, 1500);
}

function readSolverHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(SOLVER_HISTORY_KEY));
    return Array.isArray(history) ? history : [];
  } catch (error) {
    return [];
  }
}

function writeSolverHistory(history) {
  try {
    localStorage.setItem(SOLVER_HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
    return true;
  } catch (error) {
    document.getElementById('solutionNote').textContent = 'Браузер не разрешил сохранить историю в localStorage.';
    return false;
  }
}

function getHistoryGroup(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startYesterday = new Date(startToday.getTime() - 86_400_000);
  if (date >= startToday) return 'Сегодня';
  if (date >= startYesterday) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function renderSolverHistory() {
  const container = document.getElementById('solverHistory');
  const history = readSolverHistory();
  container.innerHTML = '';
  if (!history.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = 'Сохранённых решений пока нет.';
    container.appendChild(empty);
    return;
  }

  const groups = new Map();
  history.forEach((item) => {
    const label = getHistoryGroup(item.timestamp);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  });

  groups.forEach((items, label) => {
    const group = document.createElement('section');
    group.className = 'history-group';
    const heading = document.createElement('h4');
    heading.textContent = label;
    group.appendChild(heading);
    items.forEach((item) => {
      const row = document.createElement('article');
      row.className = 'history-item';
      row.innerHTML = '<time class="history-time"></time><div class="history-content"><strong></strong><span></span></div><button class="history-use" type="button">Открыть</button>';
      row.querySelector('time').textContent = new Date(item.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      row.querySelector('strong').textContent = item.formula;
      row.querySelector('.history-content span').textContent = item.result;
      row.querySelector('button').addEventListener('click', () => {
        document.getElementById('solverInput').value = item.sourceText;
        document.getElementById('solverCategory').value = item.category;
        document.getElementById('smart-solver').scrollIntoView({ behavior: 'smooth' });
      });
      group.appendChild(row);
    });
    container.appendChild(group);
  });
}

function saveCurrentSolution() {
  if (!currentSolverSolution) return;
  const history = readSolverHistory();
  history.unshift({
    timestamp: Date.now(),
    title: currentSolverSolution.title,
    formula: currentSolverSolution.formula,
    result: currentSolverSolution.result,
    sourceText: currentSolverSolution.sourceText,
    category: currentSolverSolution.category
  });
  if (!writeSolverHistory(history)) return;
  renderSolverHistory();
  document.getElementById('saveSolution').textContent = 'Сохранено';
  window.setTimeout(() => { document.getElementById('saveSolution').textContent = 'Сохранить в историю'; }, 1500);
  addEvent('Решение сохранено в локальную историю', 'success');
}

function resetSolverTask() {
  document.getElementById('solverForm').reset();
  document.getElementById('solutionContent').hidden = true;
  document.getElementById('solutionPlaceholder').hidden = false;
  document.getElementById('solverInputMessage').textContent = '';
  currentSolverSolution = null;
  removeSolverImage();
  document.getElementById('solverInput').focus();
}

function toggleSolutionDetails() {
  const details = document.getElementById('solutionDetails');
  const collapsed = details.classList.toggle('collapsed');
  document.getElementById('toggleSolutionDetails').textContent = collapsed ? 'Показать подробно' : 'Скрыть подробности';
}

function handleSolverImage(file) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!file || !allowedTypes.includes(file.type)) {
    document.getElementById('solverInputMessage').textContent = 'Поддерживаются только JPG, JPEG, PNG и WEBP.';
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    document.getElementById('solverInputMessage').textContent = 'Размер изображения не должен превышать 8 МБ.';
    return;
  }
  if (solverImageUrl) URL.revokeObjectURL(solverImageUrl);
  selectedSolverImage = file;
  solverImageUrl = URL.createObjectURL(file);
  document.getElementById('solverImagePreview').src = solverImageUrl;
  document.getElementById('solverImageName').textContent = file.name;
  document.getElementById('uploadPlaceholder').hidden = true;
  document.getElementById('imagePreviewWrap').hidden = false;
  document.getElementById('ocrMessage').hidden = false;
  document.getElementById('solverInputMessage').textContent = '';
}

function removeSolverImage() {
  if (solverImageUrl) URL.revokeObjectURL(solverImageUrl);
  solverImageUrl = null;
  selectedSolverImage = null;
  document.getElementById('solverImage').value = '';
  document.getElementById('solverImagePreview').removeAttribute('src');
  document.getElementById('uploadPlaceholder').hidden = false;
  document.getElementById('imagePreviewWrap').hidden = true;
  document.getElementById('ocrMessage').hidden = true;
}

// Будущий OCR должен вызываться только через защищённый backend/API route.
// API-ключ нельзя добавлять в frontend-код.
async function recognizeImageWithBackend() {
  throw new Error('Для распознавания фотографии необходимо подключить AI/OCR API.');
}

function populateUnitSelectors() {
  const selectors = [document.getElementById('unitFrom'), document.getElementById('unitTo')];
  selectors.forEach((select) => {
    UNIT_DEFINITIONS.forEach((unit) => {
      const option = document.createElement('option');
      option.value = unit.key;
      option.textContent = unit.label;
      select.appendChild(option);
    });
  });
  selectors[0].value = 'V';
  selectors[1].value = 'kV';
}

function convertScientificUnit() {
  const display = document.getElementById('scientificDisplay');
  const message = document.getElementById('unitConversionMessage');
  const numericValue = Number(display.value.replace(',', '.'));
  const from = UNIT_DEFINITIONS.find((unit) => unit.key === document.getElementById('unitFrom').value);
  const to = UNIT_DEFINITIONS.find((unit) => unit.key === document.getElementById('unitTo').value);
  if (!Number.isFinite(numericValue)) {
    message.textContent = 'Сначала получите или введите одно числовое значение.';
    message.classList.add('error');
    return;
  }
  if (from.dimension !== to.dimension) {
    message.textContent = `Нельзя напрямую переводить ${from.label} в ${to.label}: это разные физические величины.`;
    message.classList.add('error');
    return;
  }
  const converted = numericValue * from.factor / to.factor;
  display.value = formatSolverNumber(converted, 10).replace(/\s/g, '');
  message.textContent = `${formatSolverNumber(numericValue)} ${from.label} = ${formatSolverNumber(converted, 10)} ${to.label}`;
  message.classList.remove('error');
}

function evaluateScientificCalculator() {
  const display = document.getElementById('scientificDisplay');
  const message = document.getElementById('calculatorMessage');
  try {
    const result = evaluateExpression(display.value);
    display.value = formatSolverNumber(result, 10).replace(/\s/g, '');
    message.textContent = 'Вычислено локально · тригонометрия в градусах';
    message.classList.remove('error');
  } catch (error) {
    message.textContent = error.message;
    message.classList.add('error');
  }
}

function initializeScientificCalculator() {
  const display = document.getElementById('scientificDisplay');
  document.getElementById('scientificKeypad').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.calcValue) {
      display.value += button.dataset.calcValue;
      document.getElementById('calculatorMessage').textContent = '';
    } else if (button.dataset.calcAction === 'clear') {
      display.value = '';
    } else if (button.dataset.calcAction === 'backspace') {
      display.value = display.value.slice(0, -1);
    } else if (button.dataset.calcAction === 'evaluate') {
      evaluateScientificCalculator();
    }
    display.focus();
  });
  display.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      evaluateScientificCalculator();
    }
  });
  populateUnitSelectors();
  document.getElementById('convertUnit').addEventListener('click', convertScientificUnit);
}

function initializeSmartSolver() {
  const form = document.getElementById('solverForm');
  // Legacy user data and solver functions remain intact, but the old interface
  // is no longer mounted on the Smart Energy home page.
  if (!form) return;
  const fileInput = document.getElementById('solverImage');
  const dropZone = document.getElementById('solverDropZone');
  form.addEventListener('submit', handleSolverSubmit);
  document.getElementById('chooseImageButton').addEventListener('click', () => fileInput.click());
  document.getElementById('removeImageButton').addEventListener('click', removeSolverImage);
  fileInput.addEventListener('change', () => handleSolverImage(fileInput.files[0]));
  document.getElementById('toggleSolutionDetails').addEventListener('click', toggleSolutionDetails);
  document.getElementById('copySolution').addEventListener('click', copyCurrentSolution);
  document.getElementById('newSolverTask').addEventListener('click', resetSolverTask);
  document.getElementById('saveSolution').addEventListener('click', saveCurrentSolution);
  document.getElementById('clearSolverHistory').addEventListener('click', () => {
    writeSolverHistory([]);
    renderSolverHistory();
  });

  document.querySelectorAll('[data-solver-example]').forEach((button) => {
    button.addEventListener('click', () => {
      document.getElementById('solverInput').value = SOLVER_EXAMPLES[button.dataset.solverExample];
      document.getElementById('solverInputMessage').textContent = '';
    });
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('dragging');
    });
  });
  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragging');
    });
  });
  dropZone.addEventListener('drop', (event) => handleSolverImage(event.dataTransfer.files[0]));

  renderSolverHistory();
  initializeScientificCalculator();
}

function initializeDashboard() {
  applyTheme(state.settings.theme);
  document.body.dataset.activeSource = state.settings.dataSource;
  updateModePresentation(state.settings.dataSource);
  initializeSmartSolver();
  initializeEnergyLab();
  initializeAppNavigation();
  updateChartMetricControls();
  document.querySelectorAll('input[name="dataSource"]').forEach((radio) => {
    radio.checked = radio.value === state.settings.dataSource;
  });
  updateLoadControls();
  updateDiagram();
  selectConsumptionPeriod(state.settings.selectedPeriod);
  renderMeasurements(state.lastMeasurements);
  updateSystemStatus(state.lastMeasurements.current);
  drawMeasurementChart();

  if (state.settings.dataSource === 'simulator') {
    elements.sourceMessage.textContent = 'Источник: Симуляция. Значения рассчитываются по включённым учебным нагрузкам.';
    updateMeasurements(false);
    addEvent('Система готова. Выбран учебный симулятор');
  } else {
    const message = 'Источник REAL: backend не получает данные устройства. Значения не генерируются.';
    elements.sourceMessage.textContent = message;
    elements.updateState.textContent = '🔴 Устройство не подключено';
    elements.startButton.disabled = !getConfiguredRealDeviceId();
    document.querySelectorAll('[data-load]').forEach((button) => { button.disabled = true; });
    elements.addCustomLoadButton.disabled = true;
    renderRealMeasurement(emptyRealMeasurement({ deviceId: getConfiguredRealDeviceId() }));
    addEvent(message, 'warning');
  }

  elements.startButton.addEventListener('click', startMonitoring);
  elements.stopButton.addEventListener('click', stopMonitoring);
  elements.themeToggle.addEventListener('click', toggleTheme);
  document.getElementById('clearEvents').addEventListener('click', clearEvents);

  document.querySelectorAll('[data-load]').forEach((button) => {
    button.addEventListener('click', () => toggleLoad(button.dataset.load));
  });

  document.querySelectorAll('input[name="dataSource"]').forEach((radio) => {
    radio.addEventListener('change', () => setDataSource(radio.value));
  });

  elements.addCustomLoadButton.addEventListener('click', () => {
    if (elements.customLoadForm.hidden) openCustomLoadForm();
    else resetCustomLoadForm();
  });
  elements.customLoadForm.addEventListener('submit', addCustomLoad);
  document.getElementById('cancelCustomLoad').addEventListener('click', resetCustomLoadForm);
  elements.customLoadsList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-custom-action]');
    if (!button) return;
    const card = button.closest('[data-custom-load-id]');
    if (!card) return;
    if (button.dataset.customAction === 'toggle') toggleCustomLoad(card.dataset.customLoadId);
    if (button.dataset.customAction === 'edit') openCustomLoadForm(card.dataset.customLoadId);
    if (button.dataset.customAction === 'delete') deleteCustomLoad(card.dataset.customLoadId);
  });

  elements.chartMetric.addEventListener('click', (event) => {
    const button = event.target.closest('[data-chart-metric]');
    if (button) selectChartMetric(button.dataset.chartMetric);
  });

  document.querySelectorAll('[data-period]').forEach((button) => {
    button.addEventListener('click', () => selectConsumptionPeriod(button.dataset.period));
  });

  let resizeFrame = null;
  window.addEventListener('resize', () => {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(() => {
      drawMeasurementChart();
      drawEnergyLabAnalysisChart();
      drawEquipmentMeasurementChart();
    });
  });
}

if (window.__SMART_ENERGY_TEST__) {
  window.__SmartEnergyTest = {
    state,
    loadSettings,
    saveSettings,
    buildEngineeringSolution,
    solveTaskLocally,
    calculateSimulatorMeasurements,
    calculateLoadTotals,
    collectLoadModels,
    calculatePhaseData,
    getBreakerMeasurements,
    calculateBreakerValues,
    suggestBreakerRating,
    getCableCheck,
    getConfiguredBreakerValues,
    sanitizeEnergyLabSettings,
    nextBreakerDesignation,
    handleEnergyLabBreakerSubmit,
    deleteCustomBreaker,
    renderSingleLineTool,
    renderBreakersTool,
    handleEnergyLabLineSubmit,
    sanitizeEquipmentList,
    validateEquipmentImportPayload,
    getEquipmentCounters,
    getFilteredEquipment,
    equipmentRepository,
    duplicateEquipment,
    getEquipmentNextMaintenance,
    groupMaintenanceByNextDate,
    getLatestEquipmentMeasurement,
    getMaintenanceCalendarState,
    getEquipmentSimulationSnapshot,
    renderEquipmentDetail,
    readEquipmentForm,
    readMeasurementForm,
    saveEquipmentSimulationMeasurement,
    deleteEquipmentMeasurement,
    deleteEquipmentNote,
    updateHomeScreen,
    getCurrentStatus,
    emptyRealMeasurement,
    renderMeasurementCards,
    getRealMeasurements,
    updateModePresentation
  };
} else {
  initializeDashboard();
}
