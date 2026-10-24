(function initializeRastrGraph(global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WIDTH = 1200;
  const HEIGHT = 560;

  const escapeXml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function autoLayout(nodes, branches) {
    if (!nodes.length) return;
    const root = nodes.find((node) => node.type === 'slack') || nodes[0];
    const adjacency = new Map(nodes.map((node) => [node.id, []]));
    branches.forEach((branch) => {
      if (!adjacency.has(branch.from) || !adjacency.has(branch.to)) return;
      adjacency.get(branch.from).push(branch.to);
      adjacency.get(branch.to).push(branch.from);
    });
    const levels = [];
    const visited = new Set([root.id]);
    let queue = [{ id: root.id, depth: 0 }];
    while (queue.length) {
      const current = queue.shift();
      (levels[current.depth] ||= []).push(current.id);
      adjacency.get(current.id).forEach((next) => {
        if (visited.has(next)) return;
        visited.add(next);
        queue.push({ id: next, depth: current.depth + 1 });
      });
    }
    nodes.filter((node) => !visited.has(node.id)).forEach((node) => (levels[levels.length] ||= []).push(node.id));
    const xStep = Math.min(250, 930 / Math.max(1, levels.length - 1));
    levels.forEach((ids, depth) => {
      const yStep = Math.min(150, 430 / Math.max(1, ids.length - 1));
      ids.forEach((id, index) => {
        const node = nodes.find((item) => item.id === id);
        if (!node || (Number.isFinite(node.x) && Number.isFinite(node.y))) return;
        node.x = 135 + depth * xStep;
        node.y = ids.length === 1 ? HEIGHT / 2 : 65 + index * yStep;
      });
    });
  }

  function nodeStatus(node, result, settings) {
    if (!result || !node.nominalKV) return 'neutral';
    const ratioPU = Number.isFinite(result.voltagePU) ? result.voltagePU : result.voltageKV / node.nominalKV;
    const limits = settings?.voltageLimits;
    if (limits && (ratioPU < limits.uMinPU || ratioPU > limits.uMaxPU)) return 'critical';
    const thresholds = settings?.thresholds;
    if (thresholds && (ratioPU * 100 < thresholds.criticalLow || ratioPU * 100 > thresholds.criticalHigh)) return 'critical';
    if (thresholds && (ratioPU * 100 < thresholds.warningLow || ratioPU * 100 > thresholds.warningHigh)) return 'warning';
    return 'normal';
  }

  function branchPath(branch, from, to) {
    if (branch.type !== 'transformer') return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const gap = 23;
    return `M ${from.x} ${from.y} L ${from.x + ux * (length / 2 - gap)} ${from.y + uy * (length / 2 - gap)} M ${from.x + ux * (length / 2 + gap)} ${from.y + uy * (length / 2 + gap)} L ${to.x} ${to.y}`;
  }

  const isFiniteValue = (value) => typeof value === 'number' && Number.isFinite(value);
  const formatNumber = (value, digits = 2) => isFiniteValue(value) ? value.toFixed(digits) : '—';
  const formatComplex = (p, q, digits = 2, absoluteP = false) => {
    if (!isFiniteValue(p) || !isFiniteValue(q)) return '—';
    const active = absoluteP ? Math.abs(p) : p;
    return `${active.toFixed(digits)} ${q < 0 ? '−' : '+'} j${Math.abs(q).toFixed(digits)}`;
  };

  function branchLabelPosition(from, to, ratio, offset) {
    const dx = to.x - from.x; const dy = to.y - from.y; const length = Math.max(1, Math.hypot(dx, dy));
    return { x: from.x + dx * ratio - dy / length * offset, y: from.y + dy * ratio + dx / length * offset };
  }

  function branchLabelMarkup(className, text, from, to, ratio, offset) {
    const point = branchLabelPosition(from, to, ratio, offset);
    return `<g class="rastr-branch-label-group ${className}" data-branch-label="true" data-ratio="${ratio}" data-offset="${offset}" transform="translate(${point.x} ${point.y})"><text>${escapeXml(text)}</text></g>`;
  }

  function branchMarkup(branch, from, to, result, selected, resultMode, display, regionClass = '') {
    const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const activeFromOriginal = result?.pFromMW;
    const forward = !result || activeFromOriginal >= 0;
    const marker = resultMode && result && Math.abs(activeFromOriginal) > 0.000001
      ? forward ? ' marker-end="url(#flow-forward)"' : ' marker-start="url(#flow-reverse)"'
      : '';
    const angle = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
    const transformer = branch.type === 'transformer'
      ? `<g class="rastr-transformer-symbol" transform="translate(${midpoint.x} ${midpoint.y}) rotate(${angle})"><circle cx="-12" cy="0" r="15"></circle><circle cx="12" cy="0" r="15"></circle></g>`
      : '';
    const labels = [];
    if (!resultMode) {
      labels.push(branchLabelMarkup('branch-name-label', branch.name, from, to, 0.5, -25));
    } else if (display.flows) {
      if (display.bothEnds) {
        labels.push(branchLabelMarkup('flow-label flow-from-label', `${branch.name} · Sнач ${result ? (result.pFromMW >= 0 ? '→ ' : '← ') + formatComplex(result.pFromMW, result.qFromMvar, 2, true) : '—'}`, from, to, 0.3, -30));
        labels.push(branchLabelMarkup('flow-label flow-to-label', `Sкон ${result ? (result.pToMW >= 0 ? '→ ' : '← ') + formatComplex(result.pToMW, result.qToMvar, 2, true) : '—'}`, from, to, 0.7, -30));
      } else {
        labels.push(branchLabelMarkup('flow-label', `${branch.name} · ${result ? (forward ? '→ ' : '← ') + formatComplex(result.pFromMW, result.qFromMvar, 2, true) : '—'}`, from, to, 0.5, -28));
      }
    } else {
      labels.push(branchLabelMarkup('branch-name-label', branch.name, from, to, 0.5, -24));
    }
    let metricOffset = 25;
    if (resultMode && display.current) { labels.push(branchLabelMarkup('result-metric-label', `Iнач/Iкон = ${result ? `${formatNumber(result.currentFromA, 2)} / ${formatNumber(result.currentToA, 2)}` : '—'} А`, from, to, 0.5, metricOffset)); metricOffset += 17; }
    if (resultMode && display.losses) { labels.push(branchLabelMarkup('result-metric-label', `ΔP = ${result ? formatNumber(result.activeLossMW, 4) : '—'} МВт · ΔQ = ${result ? formatNumber(result.reactiveLossMvar, 4) : '—'} Мвар`, from, to, 0.5, metricOffset)); metricOffset += 17; }
    if (resultMode && display.loading) { labels.push(branchLabelMarkup('result-metric-label', `Загрузка = ${result?.loadingPercent == null ? '—' : `${formatNumber(result.loadingPercent, 1)} %`}`, from, to, 0.5, metricOffset)); metricOffset += 17; }
    if (display.equipment) {
      const equipment = `R ${branch.rOhm} Ом · X ${branch.xOhm} Ом · B ${branch.bMicroS} мкСм${branch.type === 'transformer' ? ` · Kт ${branch.ratio}` : ''} · Imax нач/кон ${branch.iMaxFromA ?? '—'} / ${branch.iMaxToA ?? '—'} А${branch.ratioWarning ? ' · ⚠ Kт' : ''}`;
      labels.push(branchLabelMarkup('equipment-label', equipment, from, to, 0.5, resultMode ? metricOffset : 25));
    }
    const title = result
      ? `${branch.name}\nR = ${branch.rOhm} Ом\nX = ${branch.xOhm} Ом\nB = ${branch.bMicroS} мкСм\nKт = ${branch.ratio}\nPнач = ${formatNumber(result.pFromMW, 3)} МВт\nQнач = ${formatNumber(result.qFromMvar, 3)} Мвар\nPкон = ${formatNumber(result.pToMW, 3)} МВт\nQкон = ${formatNumber(result.qToMvar, 3)} Мвар\nIнач = ${formatNumber(result.currentFromA ?? result.currentA, 2)} А / Imax ${branch.iMaxFromA ?? '—'} А / ${result.loadingFromPercent == null ? '—' : `${formatNumber(result.loadingFromPercent, 1)} %`}\nIкон = ${formatNumber(result.currentToA ?? result.currentA, 2)} А / Imax ${branch.iMaxToA ?? '—'} А / ${result.loadingToPercent == null ? '—' : `${formatNumber(result.loadingToPercent, 1)} %`}\nΔP = ${formatNumber(result.activeLossMW, 4)} МВт\nΔQ = ${formatNumber(result.reactiveLossMvar, 4)} Мвар${branch.ratioWarning ? `\n${branch.ratioWarning.message}` : ''}`
      : `${branch.name}\nR = ${branch.rOhm} Ом\nX = ${branch.xOhm} Ом\nB = ${branch.bMicroS} мкСм\nKт = ${branch.ratio}\nImax начала = ${branch.iMaxFromA ?? '—'} А\nImax конца = ${branch.iMaxToA ?? '—'} А${branch.ratioWarning ? `\n${branch.ratioWarning.message}` : ''}`;
    const disabled = branch.enabled === false;
    const overloaded = !disabled && result?.loadingPercent != null && result.loadingPercent > 100;
    return `<g class="rastr-branch ${selected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''} ${overloaded ? 'is-overloaded' : ''} ${branch.ratioWarning ? 'has-ratio-warning' : ''} ${regionClass}" data-branch-id="${escapeXml(branch.id)}" tabindex="0" role="button" aria-label="Ветвь ${escapeXml(branch.name)}">
      <title>${escapeXml(title)}</title>
      <path class="rastr-branch-hit" d="${branchPath(branch, from, to)}"></path>
      <path class="rastr-branch-line" d="${branchPath(branch, from, to)}"${marker}></path>
      ${transformer}
      ${labels.join('')}
    </g>`;
  }

  function nodeMarkup(node, result, selected, settings, resultMode, display, regionClass = '') {
    const status = nodeStatus(node, result, settings);
    const loadP = Number.isFinite(node.loadMW) ? node.loadMW : null;
    const loadQ = Number.isFinite(node.loadMvar) ? node.loadMvar : null;
    const load = Math.abs(loadP || 0) > 0.000001 || Math.abs(loadQ || 0) > 0.000001;
    const generationP = resultMode ? result?.calculatedGenerationP_MW : node.generationPMode === 'manual' ? node.generationP_MW : null;
    const generationQ = resultMode ? result?.calculatedGenerationQ_Mvar : node.generationQMode === 'manual' ? node.generationQ_Mvar : null;
    const generation = node.type === 'slack' || node.type === 'generator' || Math.abs(generationP || 0) > 0.000001 || Math.abs(generationQ || 0) > 0.000001;
    const nodeTop = resultMode && display.angle ? `${node.number}   ${result ? `${formatNumber(result.angleDeg, 2)}°` : '—°'}` : `${node.number}`;
    const voltageLabel = display.voltage ? (resultMode ? `Uрасч ${result ? formatNumber(result.voltageKV, 2) : '—'} кВ` : `Uном ${formatNumber(node.nominalKV, 1)} кВ`) : '';
    const sourceP = node.generationPMode === 'auto' ? 'авто' : formatNumber(generationP, 2);
    const sourceQ = node.generationQMode === 'auto' ? '+ jавто' : isFiniteValue(generationQ) ? `${generationQ < 0 ? '−' : '+'} j${formatNumber(Math.abs(generationQ), 2)}` : '+ j—';
    const generationLabel = resultMode
      ? `↑ ${result ? formatComplex(generationP, generationQ, 2) : '—'} МВА`
      : `↑ ${sourceP} ${sourceQ} МВА`;
    return `<g class="rastr-node status-${status} ${selected ? 'is-selected' : ''} ${regionClass}" data-node-id="${escapeXml(node.id)}" transform="translate(${node.x} ${node.y})" tabindex="0" role="button" aria-label="Узел ${escapeXml(node.number)}">
      <title>Узел ${escapeXml(node.number)} — ${escapeXml(node.name)}\nUном = ${escapeXml(node.nominalKV)} кВ${result ? `\nUрасч = ${result.voltageKV.toFixed(3)} кВ\nδ = ${result.angleDeg.toFixed(3)}°` : ''}\nPн = ${loadP === null ? '—' : escapeXml(loadP)} МВт\nQн = ${loadQ === null ? '—' : escapeXml(loadQ)} Мвар</title>
      <line class="rastr-bus" x1="-42" y1="0" x2="42" y2="0"></line>
      <line class="rastr-bus-stem" x1="0" y1="-16" x2="0" y2="16"></line>
      <circle class="rastr-node-point" cx="0" cy="0" r="8"></circle>
      <g class="rastr-node-result-label"><text class="rastr-node-number" x="0" y="-25">${escapeXml(nodeTop)}</text>${voltageLabel ? `<text class="rastr-node-voltage" x="0" y="31">${escapeXml(voltageLabel)}</text>` : ''}</g>
      <text class="rastr-node-name" x="0" y="-47">${escapeXml(node.name)}</text>
      ${display.loads && load ? `<g class="rastr-node-load"><line class="rastr-load-stem" x1="0" y1="12" x2="0" y2="55"></line><path class="rastr-load-arrow" d="M -6 48 L 0 57 L 6 48"></path><text class="rastr-load-label" x="0" y="76">↓ ${escapeXml(formatComplex(loadP, loadQ, 2))} МВА</text></g>` : ''}
      ${display.generation && generation ? `<g class="rastr-node-generation"><circle cx="57" cy="-2" r="12"></circle><text class="rastr-generator-symbol" x="57" y="2">G</text><line x1="45" y1="-2" x2="39" y2="-2"></line><text class="rastr-generation-label" x="57" y="-23">${escapeXml(generationLabel)}</text></g>` : ''}
    </g>`;
  }

  function regionBounds(regionId, nodes) {
    const members = nodes.filter((node) => node.regionId === regionId && Number.isFinite(node.x) && Number.isFinite(node.y));
    if (!members.length) return null;
    const xs = members.map((node) => node.x);
    const ys = members.map((node) => node.y);
    const left = Math.max(14, Math.min(...xs) - 74);
    const top = Math.max(14, Math.min(...ys) - 68);
    const right = Math.min(WIDTH - 14, Math.max(...xs) + 74);
    const bottom = Math.min(HEIGHT - 14, Math.max(...ys) + 96);
    return { x: left, y: top, width: Math.max(148, right - left), height: Math.max(164, bottom - top) };
  }

  function regionOverlayMarkup(model) {
    if (!model.regionDisplay?.show) return '';
    const filterId = model.regionDisplay.filterRegionId;
    return (model.regions || []).map((region) => {
      const bounds = regionBounds(region.id, model.nodes);
      if (!bounds) return '';
      const muted = filterId && filterId !== region.id ? 'is-region-muted' : '';
      const selected = filterId === region.id ? 'is-region-focused' : '';
      return `<g class="rastr-region-overlay ${muted} ${selected}" data-region-id="${escapeXml(region.id)}">
        <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="20"></rect>
        <text x="${bounds.x + 14}" y="${bounds.y + 24}">${escapeXml(region.code)} · ${escapeXml(region.name)}</text>
      </g>`;
    }).join('');
  }

  function render(container, model, callbacks = {}) {
    autoLayout(model.nodes, model.branches);
    const nodeMap = new Map(model.nodes.map((node) => [node.id, node]));
    const nodeResults = new Map((model.results?.nodes || []).map((item) => [item.id, item]));
    const branchResults = new Map((model.results?.branches || []).map((item) => [item.id, item]));
    const display = { voltage: true, angle: true, flows: true, bothEnds: false, current: false, losses: false, loading: false, loads: true, generation: true, equipment: false, ...(model.graphDisplay || {}) };
    const filterRegionId = model.regionDisplay?.filterRegionId || null;
    const branches = model.branches.map((branch) => {
      const from = nodeMap.get(branch.from);
      const to = nodeMap.get(branch.to);
      if (!from || !to) return '';
      const touchesFilter = !filterRegionId || from.regionId === filterRegionId || to.regionId === filterRegionId;
      const boundary = filterRegionId && touchesFilter && from.regionId !== to.regionId;
      const regionClass = `${touchesFilter ? 'is-region-focused' : 'is-region-muted'} ${boundary ? 'is-region-boundary' : ''}`;
      return branchMarkup(branch, from, to, branchResults.get(branch.id), model.selection?.type === 'branch' && model.selection.id === branch.id, model.viewMode === 'results', display, filterRegionId ? regionClass : '');
    }).join('');
    const nodes = model.nodes.map((node) => {
      const regionClass = filterRegionId ? (node.regionId === filterRegionId ? 'is-region-focused' : 'is-region-muted') : '';
      return nodeMarkup(node, nodeResults.get(node.id), model.selection?.type === 'node' && model.selection.id === node.id, model.settings, model.viewMode === 'results', display, regionClass);
    }).join('');
    const regionOverlays = regionOverlayMarkup(model);
    const zoom = finite(model.viewport.zoom, 1);
    const panX = finite(model.viewport.panX);
    const panY = finite(model.viewport.panY);
    container.innerHTML = `<svg class="rastr-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-label="Однолинейная схема сети">
      <defs>
        <marker id="flow-forward" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
        <marker id="flow-reverse" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
        <pattern id="rastr-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none"></path></pattern>
      </defs>
      <rect class="rastr-grid" width="100%" height="100%" fill="url(#rastr-grid)"></rect>
      <g class="rastr-viewport" transform="translate(${panX} ${panY}) scale(${zoom})">${regionOverlays}${branches}${nodes}</g>
      ${model.calculationFailed ? '<g class="rastr-calculation-failed"><rect x="470" y="18" width="260" height="38" rx="10"></rect><text x="600" y="42">Режим не сошёлся</text></g>' : ''}
      ${model.nodes.length ? '' : '<text class="rastr-empty-label" x="600" y="280">Добавьте узлы и ветви или загрузите учебный пример</text>'}
    </svg>`;

    const svg = container.querySelector('svg');
    const viewport = svg.querySelector('.rastr-viewport');
    let drag = null;
    const updateRegionOverlays = () => {
      if (!model.regionDisplay?.show) return;
      (model.regions || []).forEach((region) => {
        const bounds = regionBounds(region.id, model.nodes);
        const group = svg.querySelector(`[data-region-id="${CSS.escape(region.id)}"]`);
        if (!group || !bounds) return;
        const rect = group.querySelector('rect');
        const label = group.querySelector('text');
        rect?.setAttribute('x', bounds.x);
        rect?.setAttribute('y', bounds.y);
        rect?.setAttribute('width', bounds.width);
        rect?.setAttribute('height', bounds.height);
        label?.setAttribute('x', bounds.x + 14);
        label?.setAttribute('y', bounds.y + 24);
      });
    };
    const updateBranchGeometry = (branch) => {
      const from = nodeMap.get(branch.from);
      const to = nodeMap.get(branch.to);
      const group = svg.querySelector(`[data-branch-id="${CSS.escape(branch.id)}"]`);
      if (!from || !to || !group) return;
      const path = branchPath(branch, from, to);
      group.querySelectorAll('path.rastr-branch-hit, path.rastr-branch-line').forEach((element) => element.setAttribute('d', path));
      const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      const transformer = group.querySelector('.rastr-transformer-symbol');
      if (transformer) transformer.setAttribute('transform', `translate(${midpoint.x} ${midpoint.y}) rotate(${Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI})`);
      group.querySelectorAll('[data-branch-label]').forEach((label) => {
        const point = branchLabelPosition(from, to, Number(label.dataset.ratio), Number(label.dataset.offset));
        label.setAttribute('transform', `translate(${point.x} ${point.y})`);
      });
    };
    const updateNodeGeometry = (id, x, y) => {
      const node = nodeMap.get(id);
      if (!node) return;
      node.x = Math.max(55, Math.min(WIDTH - 55, x));
      node.y = Math.max(55, Math.min(HEIGHT - 85, y));
      svg.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.setAttribute('transform', `translate(${node.x} ${node.y})`);
      model.branches.filter((branch) => branch.from === id || branch.to === id).forEach(updateBranchGeometry);
      updateRegionOverlays();
    };
    const pointFromEvent = (event) => {
      const rect = svg.getBoundingClientRect();
      return { x: (event.clientX - rect.left) / rect.width * WIDTH, y: (event.clientY - rect.top) / rect.height * HEIGHT };
    };
    svg.addEventListener('click', (event) => {
      const node = event.target.closest('[data-node-id]');
      const branch = event.target.closest('[data-branch-id]');
      if (node) callbacks.onSelect?.('node', node.dataset.nodeId);
      else if (branch) callbacks.onSelect?.('branch', branch.dataset.branchId);
    });
    svg.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      const node = event.target.closest('[data-node-id]');
      const branch = event.target.closest('[data-branch-id]');
      if (node || branch) {
        event.preventDefault();
        callbacks.onSelect?.(node ? 'node' : 'branch', node?.dataset.nodeId || branch.dataset.branchId);
      }
    });
    svg.addEventListener('pointerdown', (event) => {
      const nodeElement = event.target.closest('[data-node-id]');
      const start = pointFromEvent(event);
      if (nodeElement) {
        const node = nodeMap.get(nodeElement.dataset.nodeId);
        drag = { type: 'node', id: node.id, start, x: node.x, y: node.y };
      } else {
        drag = { type: 'pan', start, x: model.viewport.panX, y: model.viewport.panY };
      }
      svg.setPointerCapture(event.pointerId);
      svg.classList.add('is-dragging');
    });
    svg.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const point = pointFromEvent(event);
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      if (drag.type === 'node') {
        const x = drag.x + dx / zoom;
        const y = drag.y + dy / zoom;
        updateNodeGeometry(drag.id, x, y);
        callbacks.onNodeMove?.(drag.id, x, y, false);
      } else {
        const x = drag.x + dx;
        const y = drag.y + dy;
        viewport.setAttribute('transform', `translate(${x} ${y}) scale(${zoom})`);
        callbacks.onPan?.(x, y, false);
      }
    });
    const finish = (event) => {
      if (!drag) return;
      const point = pointFromEvent(event);
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      if (drag.type === 'node') callbacks.onNodeMove?.(drag.id, drag.x + dx / zoom, drag.y + dy / zoom, true);
      else callbacks.onPan?.(drag.x + dx, drag.y + dy, true);
      drag = null;
      svg.classList.remove('is-dragging');
    };
    svg.addEventListener('pointerup', finish);
    svg.addEventListener('pointercancel', finish);
    svg.addEventListener('wheel', (event) => {
      if (!event.ctrlKey && Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
      event.preventDefault();
      callbacks.onZoom?.(event.deltaY < 0 ? 0.1 : -0.1);
    }, { passive: false });
  }

  global.RastrGraph = Object.freeze({ render, autoLayout, regionOverlayMarkup, WIDTH, HEIGHT });
})(window);
