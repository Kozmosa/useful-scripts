// ==UserScript==
// @name         知乎回答内容提取（可视化选取 + 选择器输入 + 清洗 + JSON导出/剪贴板 + 问题回退）
// @namespace    https://github.com/Kozmosa
// @version      0.6.2
// @description  可视化点击或手动选择回答容器；问题智能获取（若局部未含问号则回退至全局 QuestionHeader）；清洗段落；可选 JSON 导出与自动复制；设置持久化；alert+console 输出
// @author       Kozmosa
// @match        https://www.zhihu.com/*
// @match        https://zhihu.com/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  /******************** 持久化 Keys ********************/
  const KEY_EXPORT_JSON = 'ZH_EXPORT_JSON_ENABLED';
  const KEY_AUTO_COPY   = 'ZH_AUTO_COPY_ENABLED';

  /******************** 状态变量 ********************/
  let exportJSONEnabled = getPersist(KEY_EXPORT_JSON, false);
  let autoCopyEnabled   = getPersist(KEY_AUTO_COPY, false);

  // 可视化选取状态
  let isPicking = false;
  let hoverOverlay = null;
  let selectOverlay = null;
  let pickInstruction = null;
  let currentHoverEl = null;
  let selectedEl = null;
  let confirmPanel = null;

  /******************** 初始化 ********************/
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('打开设置', openSettingsPanel);
    GM_registerMenuCommand('选择器提取回答', manualSelectorFlow);
    GM_registerMenuCommand('可视化点击提取', startVisualPick);
  }

  /******************** UI 搭建 ********************/
  function initUI() {
    if (document.getElementById('__zhihu_extract_wrap__')) return;

    const wrap = document.createElement('div');
    wrap.id = '__zhihu_extract_wrap__';
    Object.assign(wrap.style, {
      position: 'fixed',
      top: '80px',
      right: '16px',
      zIndex: 99999,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    });

    const btnVisual = createBtn('点击提取回答', '#0a7d34', startVisualPick);
    const btnManual = createBtn('选择器提取回答', '#056de8', manualSelectorFlow);
    const btnSettings = createBtn('设置', '#5c6b7a', openSettingsPanel);

    wrap.appendChild(btnVisual);
    wrap.appendChild(btnManual);
    wrap.appendChild(btnSettings);
    document.body.appendChild(wrap);
  }

  function createBtn(text, color, handler) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, {
      background: color,
      color: '#fff',
      border: 'none',
      padding: '8px 14px',
      borderRadius: '6px',
      fontSize: '14px',
      fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto',
      cursor: 'pointer',
      boxShadow: '0 2px 6px rgba(0,0,0,0.25)'
    });
    btn.addEventListener('mouseenter', () => (btn.style.filter = 'brightness(1.1)'));
    btn.addEventListener('mouseleave', () => (btn.style.filter = ''));
    btn.addEventListener('click', handler);
    return btn;
  }

  /******************** 设置面板 ********************/
  function openSettingsPanel() {
    if (document.getElementById('__zhihu_settings_mask__')) return;

    const mask = document.createElement('div');
    mask.id = '__zhihu_settings_mask__';
    Object.assign(mask.style, {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.45)',
      zIndex: 100000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: '380px',
      background: '#fff',
      borderRadius: '10px',
      padding: '18px 20px 20px',
      fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto',
      boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
      position: 'relative',
      maxHeight: '80vh',
      overflow: 'auto'
    });

    panel.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:18px;">设置</h3>
      <div style="display:flex;flex-direction:column;gap:14px;font-size:14px;line-height:1.5;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="__chk_export_json__" ${exportJSONEnabled ? 'checked' : ''} />
          <span>提取后导出 JSON 文件（自动下载）</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="__chk_auto_copy__" ${autoCopyEnabled ? 'checked' : ''} />
          <span>提取后自动复制到剪贴板</span>
        </label>
        <div style="padding:10px;background:#f5f7fa;border-radius:6px;font-size:12px;color:#555;">
          复制逻辑：<br>
          ① 自动复制 + 导出 JSON => 复制 JSON 字符串<br>
          ② 仅自动复制 => 复制“问题 + 回答”纯文本<br>
          ③ 仅导出 JSON => 只下载文件
        </div>
      </div>
      <div style="margin-top:18px;display:flex;justify-content:flex-end;gap:10px;">
        <button id="__btn_close_settings__" style="${inlineBtnStyle('#5c6b7a')}">关闭</button>
      </div>
    `;

    mask.appendChild(panel);
    document.body.appendChild(mask);

    panel.querySelector('#__chk_export_json__').addEventListener('change', e => {
      exportJSONEnabled = e.target.checked;
      setPersist(KEY_EXPORT_JSON, exportJSONEnabled);
    });
    panel.querySelector('#__chk_auto_copy__').addEventListener('change', e => {
      autoCopyEnabled = e.target.checked;
      setPersist(KEY_AUTO_COPY, autoCopyEnabled);
    });
    panel.querySelector('#__btn_close_settings__').addEventListener('click', () => mask.remove());
    mask.addEventListener('click', e => { if (e.target === mask) mask.remove(); });
  }

  function inlineBtnStyle(color) {
    return `
      background:${color};
      color:#fff;
      border:none;
      padding:8px 16px;
      border-radius:6px;
      font-size:14px;
      cursor:pointer;
      box-shadow:0 2px 6px rgba(0,0,0,.2);
    `;
  }

  /******************** 手动输入选择器 ********************/
  function manualSelectorFlow() {
    const selector = prompt('请输入回答容器的 CSS 选择器：', '');
    if (!selector || !selector.trim()) {
      alert('未输入选择器，已取消。');
      return;
    }
    const cleanSelector = selector.trim();
    const container = document.querySelector(cleanSelector);
    if (!container) {
      alert('未找到匹配元素，请确认页面已加载。');
      console.warn('[知乎提取脚本] 未找到元素：', cleanSelector);
      return;
    }
    processContainer(container, cleanSelector);
  }

  /******************** 可视化选取 ********************/
  function startVisualPick() {
    if (isPicking) return;
    isPicking = true;
    selectedEl = null;
    currentHoverEl = null;

    createHoverOverlay();
    createSelectOverlay();
    createInstructionOverlay();

    document.addEventListener('mousemove', onPickMouseMove, true);
    document.addEventListener('click', onPickClick, true);
    document.addEventListener('keydown', onPickKeyDown, true);
    document.addEventListener('contextmenu', onPickCancelContext, true);
  }

  function exitPickAfterSelection() {
    isPicking = false;
    removeElement(hoverOverlay);
    hoverOverlay = null;
    removeElement(pickInstruction);
    pickInstruction = null;

    document.removeEventListener('mousemove', onPickMouseMove, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKeyDown, true);
    document.removeEventListener('contextmenu', onPickCancelContext, true);
  }

  function stopVisualPick(clearSelection = true) {
    isPicking = false;
    removeElement(hoverOverlay);
    removeElement(pickInstruction);
    if (clearSelection) removeElement(selectOverlay);
    removeElement(confirmPanel);

    document.removeEventListener('mousemove', onPickMouseMove, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKeyDown, true);
    document.removeEventListener('contextmenu', onPickCancelContext, true);

    hoverOverlay = null;
    pickInstruction = null;
    confirmPanel = null;
    if (clearSelection) {
      selectOverlay = null;
      selectedEl = null;
    }
    currentHoverEl = null;
  }

  function onPickMouseMove(e) {
    if (!isPicking) return;
    if (confirmPanel && confirmPanel.contains(e.target)) return;
    const target = e.target;
    const container = findBestContainer(target);
    currentHoverEl = container || target;
    highlightElement(currentHoverEl, hoverOverlay, 'rgba(0,255,120,0.25)', '2px solid rgba(0,180,90,0.8)');
  }

  function onPickClick(e) {
    if (!isPicking) return;
    if (confirmPanel && confirmPanel.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!currentHoverEl) return;
    selectedEl = currentHoverEl;
    highlightElement(selectedEl, selectOverlay, 'rgba(255,120,120,0.28)', '2px solid rgba(200,40,40,0.85)');
    exitPickAfterSelection();
    showConfirmPanel(selectedEl, e.clientX, e.clientY);
  }

  function onPickKeyDown(e) {
    if (!isPicking) return;
    if (e.key === 'Escape') {
      stopVisualPick();
    }
  }

  function onPickCancelContext(e) {
    if (!isPicking) return;
    e.preventDefault();
    stopVisualPick();
  }

  function createHoverOverlay() {
    hoverOverlay = document.createElement('div');
    Object.assign(hoverOverlay.style, baseOverlayStyle());
    hoverOverlay.style.pointerEvents = 'none';
    document.body.appendChild(hoverOverlay);
  }

  function createSelectOverlay() {
    selectOverlay = document.createElement('div');
    Object.assign(selectOverlay.style, baseOverlayStyle());
    selectOverlay.style.pointerEvents = 'none';
    document.body.appendChild(selectOverlay);
  }

  function createInstructionOverlay() {
    pickInstruction = document.createElement('div');
    Object.assign(pickInstruction.style, {
      position: 'fixed',
      top: '10px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.75)',
      color: '#fff',
      padding: '6px 14px',
      borderRadius: '20px',
      fontSize: '13px',
      fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto',
      zIndex: 100000,
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)'
    });
    pickInstruction.textContent = '移动鼠标高亮元素，点击选择；Esc 或 右键 取消';
    document.body.appendChild(pickInstruction);
  }

  function baseOverlayStyle() {
    return {
      position: 'fixed',
      top: 0,
      left: 0,
      width: '0px',
      height: '0px',
      background: 'rgba(0,255,120,0.25)',
      border: '2px solid rgba(0,180,90,0.8)',
      boxSizing: 'border-box',
      zIndex: 99998,
      transition: 'all 0.06s ease'
    };
  }

  function highlightElement(el, overlay, bg, border) {
    if (!el || !overlay) return;
    const rect = el.getBoundingClientRect();
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    if (bg) overlay.style.background = bg;
    if (border) overlay.style.border = border;
  }

  function showConfirmPanel(el, x, y) {
    removeElement(confirmPanel);
    confirmPanel = document.createElement('div');
    confirmPanel.dataset.lock = '1';
    Object.assign(confirmPanel.style, {
      position: 'fixed',
      zIndex: 100001,
      background: '#fff',
      border: '1px solid #ccc',
      borderRadius: '8px',
      padding: '12px 14px',
      fontSize: '13px',
      fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto',
      maxWidth: '320px',
      boxShadow: '0 4px 18px rgba(0,0,0,0.25)',
      pointerEvents: 'auto'
    });

    const container = ensureAnswerContainer(el);
    // 使用增强后的逻辑生成预览
    const questionForPreview = maybeEnhanceQuestion(extractQuestion(container));
    const { questionPreview, answerPreview } = buildPreviewWithGivenQuestion(container, questionForPreview);

    confirmPanel.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;">确认选择该元素？</div>
      <div style="color:#444;line-height:1.4;">
        <div><b>问题预览:</b> ${escapeHTML(questionPreview)}</div>
        <div style="margin-top:4px;"><b>回答预览:</b> ${escapeHTML(answerPreview)}</div>
      </div>
      <div style="margin-top:10px;display:flex;justify-content:flex-end;gap:8px;">
        <button id="__confirm_pick__" style="${miniBtn('#056de8')}">确定</button>
        <button id="__cancel_pick__" style="${miniBtn('#666')}">取消</button>
      </div>
    `;
    document.body.appendChild(confirmPanel);

    const panelRect = confirmPanel.getBoundingClientRect();
    let left = x + 12;
    let top = y + 12;
    if (left + panelRect.width > window.innerWidth - 10) {
      left = window.innerWidth - panelRect.width - 10;
    }
    if (top + panelRect.height > window.innerHeight - 10) {
      top = window.innerHeight - panelRect.height - 10;
    }
    confirmPanel.style.left = left + 'px';
    confirmPanel.style.top = top + 'px';

    confirmPanel.querySelector('#__confirm_pick__').addEventListener('click', () => {
      const targetContainer = ensureAnswerContainer(selectedEl || el);
      const selector = buildUniqueSelector(targetContainer);
      stopVisualPick(true);
      processContainer(targetContainer, selector);
    });

    confirmPanel.querySelector('#__cancel_pick__').addEventListener('click', () => {
      stopVisualPick(true);
    });
  }

  function miniBtn(color) {
    return `
      background:${color};
      color:#fff;
      border:none;
      padding:6px 14px;
      border-radius:4px;
      cursor:pointer;
      font-size:12px;
    `;
  }

  /******************** 容器辅助 ********************/
  function findBestContainer(el) {
    if (!el) return null;
    return el.closest('.ContentItem') ||
           el.closest('.AnswerItem') ||
           el.closest('.RichContent') ||
           el;
  }

  function ensureAnswerContainer(el) {
    if (!el) return document.body;
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.querySelector('.RichText[itemprop="text"], .RichText [itemprop="text"], .RichText')) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return el;
  }

  function buildPreviewWithGivenQuestion(container, questionText) {
    let questionPreview = (questionText || '(未解析)').slice(0, 50);
    const answerNode = findAnswerNode(container);
    let answerPreview = '';
    if (answerNode) {
      answerPreview = answerNode.textContent.replace(/\s+/g, ' ').trim().slice(0, 50);
    } else {
      answerPreview = '(未找到回答节点)';
    }
    return { questionPreview, answerPreview };
  }

  /******************** 提取与清洗 ********************/
  function processContainer(container, selectorUsed) {
    try {
      const { questionText, answerNode } = extractRaw(container);
      const {
        cleanedParagraphs,
        cleanedText,
        removedCount,
        totalCount
      } = cleanAndFlatten(answerNode);

      handleOutputs({
        selector: selectorUsed,
        questionText,
        cleanedParagraphs,
        cleanedText,
        removedCount,
        totalCount
      });
    } catch (e) {
      alert('提取错误：' + e.message);
      console.error('[知乎提取脚本] 异常：', e);
    }
  }

  function extractRaw(container) {
    let questionText = extractQuestion(container);
    questionText = maybeEnhanceQuestion(questionText) || '(未能解析出问题文本)';
    const answerNode = findAnswerNode(container);
    if (!answerNode) throw new Error('未找到回答内容节点 (RichText)');
    return { questionText, answerNode };
  }

  function extractQuestion(container) {
    if (!container) return '';
    let questionText = '';
    const anchor = container.querySelector('h2 a[href*="/question/"]');
    if (anchor) questionText = anchor.textContent.trim();
    if (!questionText) {
      const metaName = container.querySelector('meta[itemprop="name"]');
      if (metaName?.content) questionText = metaName.content.trim();
    }
    if (!questionText) {
      const h2 = container.querySelector('h2');
      if (h2) questionText = h2.textContent.trim();
    }
    return (questionText || '').trim();
  }

  function findAnswerNode(container) {
    return container.querySelector('.RichContent-inner .RichText[itemprop="text"]') ||
           container.querySelector('.RichContent .RichText[itemprop="text"]') ||
           container.querySelector('.RichContent .RichText') ||
           container.querySelector('[itemprop="text"]');
  }

  // 新增：若局部问题不含问号，则回退到全局 <h1 class="QuestionHeader-title">
  function maybeEnhanceQuestion(questionText) {
    const text = (questionText || '').trim();
    if (text && /[?？]/.test(text)) {
      return text;
    }
    // 回退查找全局问题标题
    const globalH1 = document.querySelector('h1.QuestionHeader-title');
    if (globalH1) {
      const gText = globalH1.textContent.trim();
      if (gText) return gText;
    }
    return text; // 原样返回（可能为空或仍不含问号）
  }

  function isNonSemanticParagraph(p) {
    const raw = p.textContent.replace(/\u200B/g, '');
    const text = raw.trim();
    if (!text) return true;
    if (/^[\s\-\–\—=·•_*]+$/.test(text)) return true;
    if (text.length <= 2 && /^[\p{P}\p{S}]+$/u.test(text)) return true;
    return false;
  }

  function extractParagraphText(p) {
    const clone = p.cloneNode(true);
    clone.querySelectorAll('script,style,noscript').forEach(n => n.remove());
    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    let text = clone.textContent
      .replace(/\u200B/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return text;
  }

  function cleanAndFlatten(answerNode) {
    const clone = answerNode.cloneNode(true);
    const pList = Array.from(clone.querySelectorAll('p'));
    const totalCount = pList.length;
    const cleanedParagraphs = [];
    let removedCount = 0;

    for (const p of pList) {
      if (isNonSemanticParagraph(p)) {
        removedCount++;
        continue;
      }
      const t = extractParagraphText(p);
      if (t) cleanedParagraphs.push(t);
      else removedCount++;
    }

    const cleanedText = cleanedParagraphs.join('\n');
    return { cleanedParagraphs, cleanedText, removedCount, totalCount };
  }

  /******************** 输出 / 导出 / 复制 ********************/
  function handleOutputs(data) {
    const {
      selector,
      questionText,
      cleanedParagraphs,
      cleanedText,
      removedCount,
      totalCount
    } = data;

    const jsonObj = {
      question: questionText,
      answer_text: cleanedText,
      paragraphs: cleanedParagraphs,
      stats: {
        kept: cleanedParagraphs.length,
        removed: removedCount,
        total: totalCount,
        selector,
        timestamp: new Date().toISOString()
      }
    };
    const jsonStr = JSON.stringify(jsonObj, null, 2);
    const plainCopy = `问题：${questionText}\n回答：${cleanedText}`;

    if (exportJSONEnabled) {
      try { exportJSONFile(jsonStr, questionText); }
      catch (e) { console.error('导出 JSON 失败：', e); }
    }

    if (autoCopyEnabled) {
      const toCopy = exportJSONEnabled ? jsonStr : plainCopy;
      copyToClipboard(toCopy)
        .then(() => console.log('[知乎提取脚本] 已复制到剪贴板。'))
        .catch(err => console.warn('复制失败：', err));
    }

    const msg =
      '选择器:\n' + selector +
      '\n\n问题:\n' + questionText +
      '\n\n统计: 保留段落 ' + cleanedParagraphs.length +
      ' / 原始段落 ' + totalCount +
      ' (移除 ' + removedCount + ')' +
      '\n\n清洗后的回答文本:\n' + cleanedText +
      (exportJSONEnabled ? '\n\n[已导出JSON文件]' : '') +
      (autoCopyEnabled ? '\n[已复制到剪贴板]' : '');

    alert(msg);

    console.group('[知乎回答内容提取 | 清洗结果]');
    console.log('选择器:', selector);
    console.log('问题文本:', questionText);
    console.log(`段落统计: 保留 ${cleanedParagraphs.length} / 原始 ${totalCount} (移除 ${removedCount})`);
    console.log('保留段落数组:', cleanedParagraphs);
    console.log('合并文本:\n', cleanedText);
    console.log('JSON对象:', jsonObj);
    console.groupEnd();
  }

  function sanitizeFilename(str) {
    return str
      .replace(/[\/\\?%*:|"<>]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 60) || 'zhihu_answer';
  }

  function exportJSONFile(jsonStr, questionText) {
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `${sanitizeFilename(questionText)}_${ts}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '-2000px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (e) { reject(e); }
    });
  }

  /******************** 选择器生成 ********************/
  function buildUniqueSelector(el) {
    if (!el || el === document || el === document.documentElement) return 'html';
    if (el.id) {
      const idSel = `#${CSS.escape(el.id)}`;
      if (document.querySelectorAll(idSel).length === 1) return idSel;
    }

    const pathSegments = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement) {
      let segment = cur.nodeName.toLowerCase();
      const classList = Array.from(cur.classList || []);
      const stableClass = classList.find(c => !/^\d+$/.test(c) && c.length > 1 && !/[A-Z]/.test(c));
      if (stableClass) {
        segment += '.' + stableClass.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
      } else {
        const siblings = Array
          .from(cur.parentNode.children)
          .filter(ch => ch.nodeName === cur.nodeName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(cur) + 1;
          segment += `:nth-of-type(${index})`;
        }
      }
      pathSegments.unshift(segment);

      const candidate = pathSegments.join(' > ');
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch (_) {}
      cur = cur.parentElement;
      if (cur === document.body) {
        pathSegments.unshift('body');
        break;
      }
    }
    const full = pathSegments.join(' > ');
    return full || 'body';
  }

  /******************** 工具函数 ********************/
  function getPersist(key, def = false) {
    try {
      if (typeof GM_getValue === 'function') {
        const v = GM_getValue(key);
        return v === undefined ? def : v;
      }
    } catch {}
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return def;
      return raw === 'true';
    } catch {}
    return def;
  }

  function setPersist(key, val) {
    try { if (typeof GM_setValue === 'function') GM_setValue(key, val); } catch {}
    try { localStorage.setItem(key, val ? 'true' : 'false'); } catch {}
  }

  function removeElement(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

})();
