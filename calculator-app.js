const {
  calculatePower, calculateCurrent, calculateVoltageDrop, calculateCable,
  calculateTransformer, calculatePowerFactor, calculateTransmissionLine, calculateRastrwin
} = window.Calculations;

const number = (value) => Number(value);
const format = (value, digits = 2) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
const networkOptions = [{ value: 'one', label: 'Однофазная сеть' }, { value: 'three', label: 'Трёхфазная сеть' }];
const materialOptions = [{ value: 'copper', label: 'Медь' }, { value: 'aluminum', label: 'Алюминий' }];

const field = (name, label, unit, value, extra = {}) => ({ name, label, unit, value, type: 'number', step: 'any', ...extra });

const calculators = {
  power: {
    title: 'Расчёт мощности', description: 'Расчёт активной, реактивной и полной мощности для однофазной или трёхфазной нагрузки.',
    fields: [
      { name: 'network', label: 'Тип сети', type: 'select', value: 'three', options: networkOptions },
      field('voltage', 'Напряжение U', 'В', 380, { min: 0, requiredPositive: true }),
      field('current', 'Ток I', 'А', 10, { min: 0, requiredPositive: true }),
      field('powerFactor', 'cos φ', '', 0.9, { min: 0, max: 1, requiredPositive: true })
    ],
    calculate: calculatePower,
    render: (r, v) => ({
      items: [['Активная мощность P', `${format(r.activeKW)} кВт`], ['Реактивная мощность Q', `${format(r.reactiveKvar)} квар`], ['Полная мощность S', `${format(r.apparentKVA)} кВА`]],
      formula: `P = ${v.network === 'three' ? '√3 × U × I × cos φ' : 'U × I × cos φ'}; S = ${v.network === 'three' ? '√3 × U × I' : 'U × I'}; Q = √(S² − P²)`,
      substitution: `P = ${v.network === 'three' ? '1,732 × ' : ''}${format(v.voltage)} × ${format(v.current)} × ${format(v.powerFactor)} = ${format(r.activeKW)} кВт`,
      conclusion: `Для выбранной нагрузки полная мощность составляет ${format(r.apparentKVA)} кВА.`
    })
  },
  current: {
    title: 'Расчёт тока', description: 'Определение тока нагрузки по активной мощности, напряжению и коэффициенту мощности.',
    fields: [
      { name: 'network', label: 'Тип сети', type: 'select', value: 'three', options: networkOptions },
      field('powerKW', 'Мощность P', 'кВт', 15, { min: 0, requiredPositive: true }),
      field('voltage', 'Напряжение U', 'В', 380, { min: 0, requiredPositive: true }),
      field('powerFactor', 'cos φ', '', 0.9, { min: 0, max: 1, requiredPositive: true })
    ], calculate: calculateCurrent,
    render: (r, v) => ({
      items: [['Ток нагрузки I', `${format(r.current)} А`]],
      formula: `I = P / (${v.network === 'three' ? '√3 × ' : ''}U × cos φ)`,
      substitution: `I = ${format(r.powerW, 0)} / (${v.network === 'three' ? '1,732 × ' : ''}${format(v.voltage)} × ${format(v.powerFactor)}) = ${format(r.current)} А`,
      conclusion: `Мощность ${format(v.powerKW)} кВт внутри расчёта переведена в ${format(r.powerW, 0)} Вт.`
    })
  },
  'voltage-drop': {
    title: 'Падение напряжения', description: 'Учебная приближённая оценка падения напряжения с учётом активного сопротивления проводника.',
    fields: [
      { name: 'network', label: 'Тип сети', type: 'select', value: 'three', options: networkOptions },
      field('voltage', 'Напряжение U', 'В', 380, { min: 0, requiredPositive: true }),
      field('current', 'Ток I', 'А', 20, { min: 0, requiredPositive: true }),
      field('length', 'Длина линии L', 'м', 100, { min: 0 }),
      field('section', 'Сечение кабеля S', 'мм²', 10, { min: 0, requiredPositive: true }),
      { name: 'material', label: 'Материал', type: 'select', value: 'copper', options: materialOptions },
      field('powerFactor', 'cos φ', '', 0.9, { min: 0, max: 1, requiredPositive: true })
    ], calculate: calculateVoltageDrop,
    render: (r, v) => ({
      items: [['Сопротивление линии R', `${format(r.resistance, 4)} Ом`], ['Падение напряжения ΔU', `${format(r.voltageDrop)} В`], ['Падение напряжения', `${format(r.dropPercent)} %`], ['Напряжение в конце линии', `${format(r.endVoltage)} В`]],
      inputs: `Тип сети: ${v.network === 'three' ? 'трёхфазная' : 'однофазная'}; U = ${format(v.voltage)} В; I = ${format(v.current)} А; L = ${format(v.length)} м; S = ${format(v.section)} мм²; материал: ${v.material === 'copper' ? 'медь' : 'алюминий'}; cos φ = ${format(v.powerFactor)}.`,
      formula: `R = ${r.conductorFactor} × ρ × L / S; ΔU = ${v.network === 'three' ? '√3 × I × R × cos φ' : 'I × R × cos φ'}`,
      substitution: `R = ${r.conductorFactor} × ${format(r.resistivity, 4)} × ${format(v.length)} / ${format(v.section)} = ${format(r.resistance, 4)} Ом; ΔU = ${v.network === 'three' ? '1,732 × ' : ''}${format(v.current)} × ${format(r.resistance, 4)} × ${format(v.powerFactor)} = ${format(r.voltageDrop)} В; ΔU% = ${format(r.voltageDrop)} / ${format(v.voltage)} × 100 = ${format(r.dropPercent)} %.`,
      conclusion: `Напряжение в конце линии составляет ${format(r.endVoltage)} В. Используется приближённая учебная формула: индуктивное сопротивление и условия прокладки не учтены.`,
      status: voltageStatus(r.dropPercent)
    })
  },
  cable: {
    title: 'Подбор сечения кабеля', description: 'Ориентировочный подбор ближайшего стандартного сечения по расчётному току и оценка падения напряжения.',
    fields: [
      { name: 'network', label: 'Тип сети', type: 'select', value: 'three', options: networkOptions },
      field('powerKW', 'Мощность нагрузки', 'кВт', 15, { min: 0, requiredPositive: true }),
      field('voltage', 'Напряжение U', 'В', 380, { min: 0, requiredPositive: true }),
      field('powerFactor', 'cos φ', '', 0.9, { min: 0, max: 1, requiredPositive: true }),
      field('length', 'Длина линии L', 'м', 100, { min: 0 }),
      { name: 'material', label: 'Материал кабеля', type: 'select', value: 'copper', options: materialOptions }
    ], calculate: calculateCable,
    render: (r, v) => ({
      items: [['Расчётный ток I', `${format(r.current)} А`], ['Расчётное минимальное сечение', `${format(r.requiredSection)} мм²`], ['Выбранное стандартное сечение', `${format(r.section)} мм²`], ['Сопротивление линии R', `${format(r.voltageDrop.resistance, 4)} Ом`], ['Падение напряжения ΔU', `${format(r.voltageDrop.voltageDrop)} В`], ['Падение напряжения', `${format(r.voltageDrop.dropPercent)} %`], ['Напряжение в конце линии', `${format(r.voltageDrop.endVoltage)} В`]],
      inputs: `Тип сети: ${v.network === 'three' ? 'трёхфазная' : 'однофазная'}; P = ${format(v.powerKW)} кВт; U = ${format(v.voltage)} В; cos φ = ${format(v.powerFactor)}; L = ${format(v.length)} м; материал: ${v.material === 'copper' ? 'медь' : 'алюминий'}.`,
      formula: `I = P / (${v.network === 'three' ? '√3 × ' : ''}U × cos φ); Sориент. = I / ${format(r.currentDensity)} А/мм²`,
      substitution: `I = ${format(v.powerKW * 1000, 0)} / (${v.network === 'three' ? '1,732 × ' : ''}${format(v.voltage)} × ${format(v.powerFactor)}) = ${format(r.current)} А; Sориент. = ${format(r.current)} / ${format(r.currentDensity)} = ${format(r.requiredSection)} мм² → ${format(r.section)} мм²; ΔU = ${format(r.voltageDrop.voltageDrop)} В.`,
      conclusion: r.exceedsList ? 'Расчётное минимальное сечение превышает максимальное значение стандартного учебного ряда; выбранное 240 мм² недостаточно по принятому ориентиру.' : `Выбрано ближайшее большее стандартное сечение ${format(r.section)} мм². Напряжение в конце линии — ${format(r.voltageDrop.endVoltage)} В.`,
      status: voltageStatus(r.voltageDrop.dropPercent)
    }),
    notice: 'Подбор сечения является предварительным учебным расчётом. Для реального проектирования необходимо учитывать допустимый длительный ток, способ прокладки, температуру, группировку кабелей, защитный аппарат и действующие нормы.'
  },
  transformer: {
    title: 'Подбор трансформатора', description: 'Подбор ближайшей стандартной мощности трансформатора с учётом заданного коэффициента загрузки.',
    fields: [
      field('powerKW', 'Активная мощность P', 'кВт', 100, { min: 0, requiredPositive: true }),
      field('powerFactor', 'cos φ', '', 0.9, { min: 0, max: 1, requiredPositive: true }),
      field('loadingFactor', 'Коэффициент загрузки Kз', '', 0.8, { min: 0, max: 1, requiredPositive: true })
    ], calculate: calculateTransformer,
    render: (r, v) => ({
      items: [['Расчётная полная мощность S', `${format(r.apparentKVA)} кВА`], ['Требуемая мощность с учётом загрузки Sтр', `${format(r.requiredKVA)} кВА`], ['Предлагаемая стандартная мощность', `${format(r.transformerKVA)} кВА`]],
      formula: 'S = P / cos φ; Sтр = S / Kз',
      substitution: `S = ${format(v.powerKW)} / ${format(v.powerFactor)} = ${format(r.apparentKVA)} кВА; Sтр = ${format(r.apparentKVA)} / ${format(v.loadingFactor)} = ${format(r.requiredKVA)} кВА`,
      conclusion: r.exceedsList ? 'Требуемая мощность выше доступного диапазона учебного списка.' : `Выбрана ближайшая большая стандартная мощность — ${format(r.transformerKVA)} кВА.`
    })
  },
  'power-factor': {
    title: 'Компенсация реактивной мощности', description: 'Оценка требуемой мощности компенсации для повышения коэффициента мощности нагрузки.',
    fields: [
      field('powerKW', 'Активная мощность P', 'кВт', 100, { min: 0, requiredPositive: true }),
      field('currentPowerFactor', 'Текущий cos φ', '', 0.75, { min: 0, max: 1, requiredPositive: true }),
      field('targetPowerFactor', 'Желаемый cos φ', '', 0.95, { min: 0, max: 1, requiredPositive: true })
    ], calculate: calculatePowerFactor,
    validate: (values) => values.targetPowerFactor < values.currentPowerFactor ? { targetPowerFactor: 'Желаемый cos φ не может быть меньше исходного.' } : {},
    render: (r, v) => ({
      items: [['Необходимая мощность компенсации', `${format(r.compensationKvar)} квар`], ['Реактивная мощность до компенсации', `${format(r.beforeKvar)} квар`], ['Реактивная мощность после компенсации', `${format(r.afterKvar)} квар`], ['Снижение реактивной мощности', `${format(r.compensationKvar)} квар`]],
      formula: 'φ₁ = arccos(cos φ₁); φ₂ = arccos(cos φ₂); Qc = P × (tan φ₁ − tan φ₂)',
      substitution: `Qc = ${format(v.powerKW)} × (tan ${format(r.phi1, 4)} − tan ${format(r.phi2, 4)}) = ${format(r.compensationKvar)} квар`,
      conclusion: `Расчёт предполагает повышение cos φ с ${format(v.currentPowerFactor)} до ${format(v.targetPowerFactor)}.`
    })
  },
  'transmission-line': {
    title: 'Расчёт линии электропередачи', description: 'Расширенный учебный расчёт параметров, тока и активных потерь трёхфазной линии.',
    fields: [
      field('voltageKV', 'Напряжение линии U', 'кВ', 110, { min: 0, requiredPositive: true }),
      field('lengthKM', 'Длина линии L', 'км', 20, { min: 0 }),
      field('activeMW', 'Активная мощность P', 'МВт', 20, { min: 0, requiredPositive: true }),
      field('reactiveMvar', 'Реактивная мощность Q', 'Мвар', 8, { min: 0 }),
      field('resistancePerKM', 'Активное сопротивление R₀', 'Ом/км', 0.15, { min: 0 }),
      field('reactancePerKM', 'Реактивное сопротивление X₀', 'Ом/км', 0.4, { min: 0 })
    ], calculate: calculateTransmissionLine,
    render: (r, v) => ({
      items: [['Полная мощность S', `${format(r.apparentMVA)} МВА`], ['cos φ', format(r.powerFactor, 3)], ['Ток линии I', `${format(r.current)} А`], ['Сопротивление линии R', `${format(r.resistance)} Ом`], ['Реактивное сопротивление линии X', `${format(r.reactance)} Ом`], ['Потери активной мощности ΔP', `${format(r.lossesKW)} кВт`], ['Приближённое падение напряжения', `${format(r.voltageDropV)} В (${format(r.voltageDropPercent)} %)`]],
      formula: 'R = R₀ × L; X = X₀ × L; S = √(P² + Q²); I = S × 10⁶ / (√3 × U × 10³); ΔP = 3 × I² × R',
      substitution: `S = √(${format(v.activeMW)}² + ${format(v.reactiveMvar)}²) = ${format(r.apparentMVA)} МВА; I = ${format(r.current)} А; ΔP = ${format(r.lossesKW)} кВт`,
      conclusion: 'Падение напряжения приведено как приближённая оценка по продольным параметрам линии; ёмкостные и режимные эффекты не учитываются.',
      status: voltageStatus(r.voltageDropPercent)
    }),
    notice: 'Расчёт предназначен для учебной оценки. Для проектирования ЛЭП необходимы уточнённые параметры проводов, схема сети, режимы нагрузки и требования действующих норм.'
  },
  rastrwin: {
    title: 'Подготовка данных для RASTRWIN', description: 'Расчёт параметров одной трёхфазной ветви и нагрузки перед заполнением таблиц «Узлы» и «Ветви» в RASTRWIN.',
    fields: [
      field('voltageKV', 'Номинальное напряжение U', 'кВ', 110, { min: 0, requiredPositive: true }),
      field('activeMW', 'Активная нагрузка P', 'МВт', 20, { min: 0, requiredPositive: true }),
      field('reactiveMvar', 'Реактивная нагрузка Q', 'Мвар', 8, { min: 0 }),
      field('lengthKM', 'Длина ветви L', 'км', 20, { min: 0 }),
      field('resistancePerKM', 'Удельное сопротивление R₀', 'Ом/км', 0.15, { min: 0 }),
      field('reactancePerKM', 'Удельное сопротивление X₀', 'Ом/км', 0.4, { min: 0 }),
      field('susceptancePerKM', 'Удельная проводимость B₀', 'мкСм/км', 3, { min: 0 })
    ], calculate: calculateRastrwin,
    render: (r, v) => ({
      items: [
        ['Для таблицы «Узлы»: Pн', `${format(v.activeMW)} МВт`],
        ['Для таблицы «Узлы»: Qн', `${format(v.reactiveMvar)} Мвар`],
        ['Для таблицы «Ветви»: R', `${format(r.resistance, 4)} Ом`],
        ['Для таблицы «Ветви»: X', `${format(r.reactance, 4)} Ом`],
        ['Для таблицы «Ветви»: B', `${format(r.susceptanceMicroS, 4)} мкСм`],
        ['Полная мощность S', `${format(r.apparentMVA)} МВА`],
        ['cos φ нагрузки', format(r.powerFactor, 3)],
        ['Расчётный ток', `${format(r.current)} А`],
        ['Потери активной мощности', `${format(r.activeLossesKW)} кВт`],
        ['Потери реактивной мощности', `${format(r.reactiveLossesKvar)} квар`],
        ['Зарядная мощность линии', `${format(r.chargingMvar, 4)} Мвар`],
        ['Приближённое напряжение в конце', `${format(r.endVoltageKV)} кВ`],
        ['Приближённое падение напряжения', `${format(r.voltageDropPercent)} %`]
      ],
      formula: 'R = R₀ × L; X = X₀ × L; B = B₀ × L; S = √(P² + Q²); I = S × 10⁶ / (√3 × U × 10³); ΔP = 3I²R; ΔQ = 3I²X; ΔU ≈ (PR + QX) / U',
      substitution: `R = ${format(v.resistancePerKM, 4)} × ${format(v.lengthKM)} = ${format(r.resistance, 4)} Ом; X = ${format(v.reactancePerKM, 4)} × ${format(v.lengthKM)} = ${format(r.reactance, 4)} Ом; I = ${format(r.current)} А; ΔU ≈ ${format(r.voltageDropKV)} кВ`,
      conclusion: 'Полученные Pн и Qн относятся к нагрузочному узлу, а R, X и B — к одной ветви. Номера узлов, тип балансирующего узла и топологию необходимо задать по исходной схеме.',
      status: voltageStatus(r.voltageDropPercent)
    }),
    notice: 'Это подготовительный учебный расчёт одной ветви, а не замена расчёта установившегося режима в RASTRWIN. Для полной модели нужны схема сети, номера и типы узлов, все ветви, трансформаторы, генераторы, ограничения Q и балансирующий узел.'
  }
};

function voltageStatus(percent) {
  if (percent <= 3) return { type: 'ok', text: `Падение ${format(percent)} %: нейтральный положительный статус для учебной оценки.` };
  if (percent <= 5) return { type: 'warning', text: `Падение ${format(percent)} %: обратите внимание на результат.` };
  return { type: 'attention', text: `Падение ${format(percent)} %: стоит дополнительно проверить параметры линии.` };
}

function renderField(item) {
  const options = item.options?.map((option) => `<option value="${option.value}"${option.value === item.value ? ' selected' : ''}>${option.label}</option>`).join('') ?? '';
  const control = item.type === 'select'
    ? `<select id="${item.name}" name="${item.name}">${options}</select>`
    : `<div class="input-wrap"><input id="${item.name}" name="${item.name}" type="number" step="${item.step}" value="${item.value}" ${item.min !== undefined ? `min="${item.min}"` : ''} ${item.max !== undefined ? `max="${item.max}"` : ''}><span class="unit">${item.unit}</span></div>`;
  return `<div class="field ${item.fullWidth ? 'full-width' : ''}"><label for="${item.name}">${item.label}</label>${control}<small class="field-error" data-error="${item.name}"></small></div>`;
}

function valuesFrom(form, fields) {
  return Object.fromEntries(fields.map((item) => {
    const control = form?.elements?.namedItem?.(item.name);
    if (!control || typeof control.value !== 'string') {
      return [item.name, item.type === 'select' ? '' : Number.NaN];
    }
    if (item.type === 'select') return [item.name, control.value];
    const rawValue = control.value.trim();
    return [item.name, rawValue === '' ? Number.NaN : number(rawValue)];
  }));
}

function validate(fields, values, extraValidation) {
  const errors = {};
  fields.filter((item) => item.type === 'number').forEach((item) => {
    const value = values[item.name];
    if (!Number.isFinite(value)) errors[item.name] = 'Введите число.';
    else if (item.requiredPositive && value <= 0) errors[item.name] = 'Значение должно быть больше нуля.';
    else if (item.min !== undefined && value < item.min) errors[item.name] = `Значение не может быть меньше ${item.min}.`;
    else if (item.max !== undefined && value > item.max) errors[item.name] = `Значение не может быть больше ${item.max}.`;
  });
  return { ...errors, ...(extraValidation?.(values) ?? {}) };
}

function renderResult(data) {
  return `<h2>Результат</h2><div class="result-list">${data.items.map(([label, value]) => `<div class="result-item"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>${data.status ? `<p class="status ${data.status.type}">${data.status.text}</p>` : ''}<button class="details-toggle" type="button" aria-expanded="false">Показать подробнее</button>`;
}

function renderDetails(data) {
  return `<div class="formula-block">${data.inputs ? `<h2>1. Исходные данные</h2><p>${data.inputs}</p>` : ''}<h2>${data.inputs ? '2. Формула' : 'Формула'}</h2><p class="formula-expression">${data.formula}</p><h2>${data.inputs ? '3. Подстановка чисел' : 'Подстановка чисел'}</h2><p>${data.substitution}</p><h2>${data.inputs ? '4–5. Результат и пояснение' : 'Итог'}</h2><p><strong>Итог:</strong> ${data.conclusion}</p></div>`;
}

function hasOnlyFiniteNumbers(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(hasOnlyFiniteNumbers);
  if (value && typeof value === 'object') return Object.values(value).every(hasOnlyFiniteNumbers);
  return true;
}

function initCalculator() {
  const root = document.querySelector('[data-calculator]');
  if (!root) return;
  if (root.dataset.calculator === 'rastrwin' && window.RastrMode) {
    document.title = 'RASTR MODE | SMART ENERGY';
    window.RastrMode.init(root);
    return;
  }
  const config = calculators[root.dataset.calculator];
  if (!config) {
    document.title = 'Расчёт не найден | SCADA';
    root.innerHTML = `<a class="breadcrumb" href="../index.html">← Все расчёты</a><div class="calculator-header"><h1 class="calculator-page-title">Расчёт не найден</h1><p class="calculator-description">Для указанного адреса калькулятор не зарегистрирован. Вернитесь к списку инженерных расчётов и выберите нужный раздел.</p></div>`;
    return;
  }
  document.title = `${config.title} | SCADA`;
  root.innerHTML = `<a class="breadcrumb" href="../index.html">← Все расчёты</a><div class="calculator-header"><h1 class="calculator-page-title">${config.title}</h1><p class="calculator-description">${config.description}</p></div><div class="calculator-workspace"><section class="calculator-panel"><form class="calculator-form" novalidate>${config.fields.map(renderField).join('')}<div class="form-actions"><button class="primary-button" type="submit">Рассчитать</button><button class="secondary-button" type="reset">Сбросить</button></div></form></section><aside class="result-panel"><h2>Результат</h2><p class="result-placeholder">Заполните поля и нажмите «Рассчитать».</p></aside><section class="calculation-details"></section></div>${config.notice ? `<p class="notice">${config.notice}</p>` : ''}`;
  const form = root.querySelector('form');
  const resultPanel = root.querySelector('.result-panel');
  const details = root.querySelector('.calculation-details');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = valuesFrom(form, config.fields);
    const errors = validate(config.fields, values, config.validate);
    root.querySelectorAll('[data-error]').forEach((el) => { el.textContent = errors[el.dataset.error] ?? ''; });
    if (Object.keys(errors).length) return;
    let calculation;
    try {
      calculation = config.calculate(values);
      if (!hasOnlyFiniteNumbers(calculation)) throw new Error('Расчёт привёл к недопустимому числу. Проверьте исходные значения.');
    } catch (error) {
      resultPanel.innerHTML = `<h2>Результат</h2><p class="status attention">${error.message || 'Не удалось выполнить расчёт.'}</p>`;
      details.innerHTML = '';
      return;
    }
    const rendered = config.render(calculation, values);
    resultPanel.innerHTML = renderResult(rendered);
    details.innerHTML = renderDetails(rendered);
    details.classList.remove('open');
    resultPanel.querySelector('.details-toggle').addEventListener('click', (event) => {
      const isOpen = details.classList.toggle('open');
      event.currentTarget.textContent = isOpen ? 'Скрыть подробности' : 'Показать подробнее';
      event.currentTarget.setAttribute('aria-expanded', String(isOpen));
    });
  });
  form.addEventListener('reset', () => {
    window.setTimeout(() => {
      root.querySelectorAll('[data-error]').forEach((el) => { el.textContent = ''; });
      resultPanel.innerHTML = '<h2>Результат</h2><p class="result-placeholder">Заполните поля и нажмите «Рассчитать».</p>';
      details.innerHTML = '';
      details.classList.remove('open');
    });
  });
}

if (window.__SMART_ENERGY_TEST__) {
  window.__CalculatorAppTest = Object.freeze({ calculators, valuesFrom, validate, hasOnlyFiniteNumbers });
} else {
  initCalculator();
}
