/**
 * PDF2IMG - 100% Client-Side Local PDF Image Extractor & ZIP Packager
 * 
 * 모든 연산은 사용자의 웹 브라우저 메모리(RAM) 상에서만 안전하게 실행되며,
 * 외부 서버나 제3자 서비스로 파일이 전혀 전송되지 않습니다.
 */

// PDF.js 워커 설정 (Worker CDN)
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ==========================================================================
   State Management
   ========================================================================== */
const state = {
  tasks: new Map(), // id -> TaskObject
  queue: [],        // task id queue
  activeRunning: 0,
  maxConcurrency: 3,
  extractMode: 'embedded', // 'embedded' | 'pages'
  imageFormat: 'image/png',
  totalExtractedCount: 0
};

/* ==========================================================================
   DOM Elements
   ========================================================================== */
const DOM = {
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  browseBtn: document.getElementById('browseBtn'),
  batchBar: document.getElementById('batchBar'),
  taskList: document.getElementById('taskList'),
  totalFilesCount: document.getElementById('totalFilesCount'),
  totalExtractedImages: document.getElementById('totalExtractedImages'),
  batchProgressPercent: document.getElementById('batchProgressPercent'),
  startBatchBtn: document.getElementById('startBatchBtn'),
  downloadAllZipBtn: document.getElementById('downloadAllZipBtn'),
  clearAllBtn: document.getElementById('clearAllBtn'),
  modeEmbeddedBtn: document.getElementById('modeEmbeddedBtn'),
  modePagesBtn: document.getElementById('modePagesBtn'),
  imageFormatSelect: document.getElementById('imageFormatSelect'),
  concurrencySelect: document.getElementById('concurrencySelect'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  // Modal
  previewModal: document.getElementById('previewModal'),
  modalImageTitle: document.getElementById('modalImageTitle'),
  modalImageMeta: document.getElementById('modalImageMeta'),
  modalPreviewImg: document.getElementById('modalPreviewImg'),
  modalCloseBtn: document.getElementById('modalCloseBtn'),
  modalDownloadSingleBtn: document.getElementById('modalDownloadSingleBtn')
};

/* ==========================================================================
   Initialization & Event Listeners
   ========================================================================== */
function init() {
  setupTheme();
  setupEventListeners();
}

function setupTheme() {
  const savedTheme = localStorage.getItem('pdf2img_theme') || 'theme-dark';
  document.body.className = savedTheme;
  
  DOM.themeToggleBtn.addEventListener('click', () => {
    const isDark = document.body.classList.contains('theme-dark');
    const newTheme = isDark ? 'theme-light' : 'theme-dark';
    document.body.className = newTheme;
    localStorage.setItem('pdf2img_theme', newTheme);
  });
}

function setupEventListeners() {
  // 모드 변경 (내장 이미지 vs 페이지 렌더링)
  DOM.modeEmbeddedBtn.addEventListener('click', () => setExtractMode('embedded'));
  DOM.modePagesBtn.addEventListener('click', () => setExtractMode('pages'));

  // 포맷 & 동시성 변경
  DOM.imageFormatSelect.addEventListener('change', (e) => {
    state.imageFormat = e.target.value;
  });

  DOM.concurrencySelect.addEventListener('change', (e) => {
    state.maxConcurrency = parseInt(e.target.value, 10);
  });

  // 파일 업로드 관련
  DOM.browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    DOM.fileInput.click();
  });

  DOM.dropZone.addEventListener('click', () => DOM.fileInput.click());

  DOM.fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    DOM.fileInput.value = ''; // 동일 파일 재선택 허용
  });

  // Drag & Drop
  ['dragenter', 'dragover'].forEach(name => {
    DOM.dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      DOM.dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    DOM.dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      DOM.dropZone.classList.remove('dragover');
    });
  });

  DOM.dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      handleFiles(dt.files);
    }
  });

  // 전체 제어 버튼
  DOM.startBatchBtn.addEventListener('click', () => startAllTasks());
  DOM.downloadAllZipBtn.addEventListener('click', () => downloadMasterZip());
  DOM.clearAllBtn.addEventListener('click', () => clearAllTasks());

  // 모달 닫기
  DOM.modalCloseBtn.addEventListener('click', closeModal);
  DOM.previewModal.addEventListener('click', (e) => {
    if (e.target === DOM.previewModal) closeModal();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && DOM.previewModal.style.display !== 'none') {
      closeModal();
    }
  });
}

function setExtractMode(mode) {
  state.extractMode = mode;
  if (mode === 'embedded') {
    DOM.modeEmbeddedBtn.classList.add('active');
    DOM.modePagesBtn.classList.remove('active');
  } else {
    DOM.modePagesBtn.classList.add('active');
    DOM.modeEmbeddedBtn.classList.remove('active');
  }
}

/* ==========================================================================
   File Handling & Task Creation
   ========================================================================== */
function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;

  const validFiles = Array.from(fileList).filter(file => {
    return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  });

  if (validFiles.length === 0) {
    alert('PDF 파일만 업로드할 수 있습니다.');
    return;
  }

  validFiles.forEach(file => {
    const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const task = {
      id: taskId,
      file: file,
      name: file.name,
      size: formatFileSize(file.size),
      status: 'ready', // 'ready' | 'processing' | 'completed' | 'error'
      progress: 0,
      progressText: '대기 중',
      extractedImages: [], // { name, blob, url, width, height }
      zipBlob: null,
      errorMsg: null
    };

    state.tasks.set(taskId, task);
    renderTaskCard(task);
  });

  updateBatchStats();
  DOM.batchBar.style.display = 'flex';
  
  // 자동 시작 (사용자 편의성 극대화)
  processNextInQueue();
}

/* ==========================================================================
   Task Card DOM Rendering
   ========================================================================== */
function renderTaskCard(task) {
  const card = document.createElement('div');
  card.className = 'task-card glass-card';
  card.id = task.id;

  card.innerHTML = `
    <div class="task-card-header">
      <div class="file-info">
        <div class="file-type-icon">PDF</div>
        <div class="file-text-meta">
          <div class="file-name" title="${escapeHtml(task.name)}">${escapeHtml(task.name)}</div>
          <div class="file-size-pages">
            <span>${task.size}</span>
            <span class="page-count-badge" id="${task.id}_pageCount">페이지 확인 중...</span>
          </div>
        </div>
      </div>

      <div class="task-actions">
        <span class="status-pill ready" id="${task.id}_statusPill">
          대기 중
        </span>
        <button class="btn btn-secondary btn-sm" id="${task.id}_actionBtn" onclick="toggleTaskAction('${task.id}')">
          시작
        </button>
        <button class="icon-btn" style="width: 32px; height: 32px;" onclick="removeTask('${task.id}')" title="제거">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </div>

    <div class="progress-container" id="${task.id}_progressContainer">
      <div class="progress-info">
        <span id="${task.id}_progressText">${task.progressText}</span>
        <span id="${task.id}_progressPercent">0%</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" id="${task.id}_progressFill" style="width: 0%"></div>
      </div>
    </div>

    <div class="extracted-results" id="${task.id}_resultsArea" style="display: none;">
      <div class="results-header">
        <span id="${task.id}_resultsTitle">추출된 이미지 (0장)</span>
        <button class="btn btn-accent btn-sm" id="${task.id}_downloadZipBtn" onclick="downloadSingleZip('${task.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          .ZIP 다운로드
        </button>
      </div>
      <div class="thumbnails-grid" id="${task.id}_thumbsGrid"></div>
    </div>

    <div id="${task.id}_emptyNotice" style="display: none;"></div>
  `;

  DOM.taskList.prepend(card);
}

function updateTaskCardStatus(task) {
  const card = document.getElementById(task.id);
  if (!card) return;

  const pill = document.getElementById(`${task.id}_statusPill`);
  const actionBtn = document.getElementById(`${task.id}_actionBtn`);
  const progressText = document.getElementById(`${task.id}_progressText`);
  const progressPercent = document.getElementById(`${task.id}_progressPercent`);
  const progressFill = document.getElementById(`${task.id}_progressFill`);
  const resultsArea = document.getElementById(`${task.id}_resultsArea`);
  const resultsTitle = document.getElementById(`${task.id}_resultsTitle`);
  const thumbsGrid = document.getElementById(`${task.id}_thumbsGrid`);
  const emptyNotice = document.getElementById(`${task.id}_emptyNotice`);

  card.className = `task-card glass-card status-${task.status}`;

  if (pill) {
    pill.className = `status-pill ${task.status}`;
    if (task.status === 'ready') pill.textContent = '대기 중';
    else if (task.status === 'processing') pill.innerHTML = `<span class="pulse-dot"></span> 처리 중`;
    else if (task.status === 'completed') pill.textContent = '완료됨';
    else if (task.status === 'error') pill.textContent = '실패';
  }

  if (actionBtn) {
    if (task.status === 'processing') {
      actionBtn.textContent = '처리 중...';
      actionBtn.disabled = true;
    } else if (task.status === 'completed') {
      actionBtn.textContent = '재추출';
      actionBtn.disabled = false;
    } else if (task.status === 'ready') {
      actionBtn.textContent = '시작';
      actionBtn.disabled = false;
    }
  }

  if (progressText) progressText.textContent = task.progressText;
  if (progressPercent) progressPercent.textContent = `${Math.round(task.progress)}%`;
  if (progressFill) progressFill.style.width = `${task.progress}%`;

  // 완료 후 썸네일 그리드 갱신
  if (task.status === 'completed') {
    if (task.extractedImages.length > 0) {
      resultsArea.style.display = 'flex';
      emptyNotice.style.display = 'none';
      resultsTitle.textContent = `추출된 이미지 (${task.extractedImages.length}장)`;
      
      // 썸네일 렌더링
      thumbsGrid.innerHTML = '';
      task.extractedImages.forEach((img, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'thumb-card';
        thumb.title = `${img.name} (${img.width}x${img.height})`;
        thumb.innerHTML = `
          <img src="${img.url}" alt="${img.name}" loading="lazy" />
          <span class="thumb-badge">#${index + 1}</span>
        `;
        thumb.addEventListener('click', () => openPreviewModal(img));
        thumbsGrid.appendChild(thumb);
      });
    } else {
      resultsArea.style.display = 'none';
      emptyNotice.style.display = 'block';
      emptyNotice.innerHTML = `
        <div class="empty-images-note">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <span>문서 내에 추출 가능한 이미지 객체가 없습니다. (텍스트 또는 벡터 전용 문서)</span>
          <button class="retry-page-mode-btn" onclick="retryWithPageRender('${task.id}')">
            페이지 렌더링 모드로 변환
          </button>
        </div>
      `;
    }
  }

  updateBatchStats();
}

/* ==========================================================================
   Queue & Concurrency Management
   ========================================================================== */
function processNextInQueue() {
  while (state.activeRunning < state.maxConcurrency) {
    // 대기 중인 첫 번째 태스크 찾기
    const nextTask = Array.from(state.tasks.values()).find(t => t.status === 'ready');
    if (!nextTask) break;

    state.activeRunning++;
    runTask(nextTask);
  }
  updateBatchStats();
}

function startAllTasks() {
  state.tasks.forEach(task => {
    if (task.status === 'ready' || task.status === 'error') {
      task.status = 'ready';
      updateTaskCardStatus(task);
    }
  });
  processNextInQueue();
}

window.toggleTaskAction = function(taskId) {
  const task = state.tasks.get(taskId);
  if (!task) return;
  if (task.status === 'ready' || task.status === 'completed' || task.status === 'error') {
    task.status = 'ready';
    updateTaskCardStatus(task);
    processNextInQueue();
  }
};

window.removeTask = function(taskId) {
  const task = state.tasks.get(taskId);
  if (task) {
    // 메모리 해제
    task.extractedImages.forEach(img => URL.revokeObjectURL(img.url));
    state.tasks.delete(taskId);
    const card = document.getElementById(taskId);
    if (card) card.remove();
  }
  updateBatchStats();
  if (state.tasks.size === 0) {
    DOM.batchBar.style.display = 'none';
  }
  processNextInQueue();
};

function clearAllTasks() {
  if (state.tasks.size === 0) return;
  if (!confirm('목록의 모든 작업을 삭제하시겠습니까?')) return;

  state.tasks.forEach(task => {
    task.extractedImages.forEach(img => URL.revokeObjectURL(img.url));
  });
  state.tasks.clear();
  DOM.taskList.innerHTML = '';
  DOM.batchBar.style.display = 'none';
  state.activeRunning = 0;
  updateBatchStats();
}

/* ==========================================================================
   Core Extraction Logic (100% In-Memory Processing)
   ========================================================================== */
async function runTask(task) {
  task.status = 'processing';
  task.progress = 5;
  task.progressText = 'PDF 분석 및 메모리 로드 중...';
  // 기존 추출 이미지 메모리 정리
  task.extractedImages.forEach(img => URL.revokeObjectURL(img.url));
  task.extractedImages = [];
  task.zipBlob = null;
  updateTaskCardStatus(task);

  try {
    const arrayBuffer = await task.file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
      cMapPacked: true
    });

    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;

    const pageCountBadge = document.getElementById(`${task.id}_pageCount`);
    if (pageCountBadge) {
      pageCountBadge.textContent = `총 ${numPages}페이지`;
    }

    if (state.extractMode === 'embedded') {
      await extractEmbeddedImages(task, pdfDoc, numPages);
    } else {
      await extractPagesAsImages(task, pdfDoc, numPages);
    }

    // ZIP 자동 패키징 (메모리에서 바로 생성)
    if (task.extractedImages.length > 0) {
      task.progressText = '결과물 .zip 압축 패키징 중...';
      task.progress = 92;
      updateTaskCardStatus(task);
      task.zipBlob = await createZipBlob(task.extractedImages, task.name);
    }

    task.status = 'completed';
    task.progress = 100;
    task.progressText = `완료됨 (${task.extractedImages.length}개 이미지)`;
  } catch (err) {
    console.error('PDF 처리 오류:', err);
    task.status = 'error';
    task.progressText = `오류: ${err.message || '파일 처리 실패'}`;
    task.errorMsg = err.message;
  } finally {
    state.activeRunning--;
    updateTaskCardStatus(task);
    processNextInQueue();
  }
}

/**
 * 모드 1: PDF 내장 원본 이미지 객체 추출 (Embedded Images)
 */
async function extractEmbeddedImages(task, pdfDoc, numPages) {
  let imgIndex = 1;
  const mimeType = state.imageFormat;
  const ext = getExtensionByMime(mimeType);

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    task.progress = 10 + ((pageNum / numPages) * 75);
    task.progressText = `페이지 ${pageNum}/${numPages} 내 이미지 탐색 중...`;
    updateTaskCardStatus(task);

    const page = await pdfDoc.getPage(pageNum);
    const operatorList = await page.getOperatorList();
    const processedImgKeys = new Set();

    for (let i = 0; i < operatorList.fnArray.length; i++) {
      const fn = operatorList.fnArray[i];

      if (
        fn === pdfjsLib.OPS.paintImageXObject ||
        fn === pdfjsLib.OPS.paintInlineImageXObject
      ) {
        const imgKey = operatorList.argsArray[i][0];
        if (processedImgKeys.has(imgKey)) continue;
        processedImgKeys.add(imgKey);

        try {
          const imgObj = await new Promise((resolve) => {
            page.objs.get(imgKey, (obj) => resolve(obj));
          });

          if (!imgObj) continue;

          const imageBlob = await convertPdfImageObjToBlob(imgObj, mimeType);
          if (imageBlob) {
            const url = URL.createObjectURL(imageBlob);
            const baseFileName = task.name.replace(/\.[^/.]+$/, '');
            const imageName = `${baseFileName}_p${pageNum}_img${imgIndex}.${ext}`;

            task.extractedImages.push({
              name: imageName,
              blob: imageBlob,
              url: url,
              width: imgObj.width || 0,
              height: imgObj.height || 0
            });
            imgIndex++;
          }
        } catch (e) {
          console.warn(`이미지 객체 [${imgKey}] 변환 중 건너뜀:`, e);
        }
      }
    }
  }
}

/**
 * 모드 2: 전체 페이지 고화질 렌더링 (Page-by-page rendering)
 */
async function extractPagesAsImages(task, pdfDoc, numPages) {
  const mimeType = state.imageFormat;
  const ext = getExtensionByMime(mimeType);
  const baseFileName = task.name.replace(/\.[^/.]+$/, '');

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    task.progress = 10 + ((pageNum / numPages) * 75);
    task.progressText = `페이지 ${pageNum}/${numPages} 고화질 렌더링 중...`;
    updateTaskCardStatus(task);

    const page = await pdfDoc.getPage(pageNum);
    // 2.0 스케일 (고해상도 선명도 유지)
    const viewport = page.getViewport({ scale: 2.0 });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };

    await page.render(renderContext).promise;

    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, mimeType, 0.92);
    });

    const url = URL.createObjectURL(blob);
    const imageName = `${baseFileName}_page_${String(pageNum).padStart(3, '0')}.${ext}`;

    task.extractedImages.push({
      name: imageName,
      blob: blob,
      url: url,
      width: viewport.width,
      height: viewport.height
    });
  }
}

/**
 * PDF.js ImageObject -> Canvas -> Blob 변환
 */
async function convertPdfImageObjToBlob(imgObj, mimeType) {
  const width = imgObj.width;
  const height = imgObj.height;

  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (imgObj.bitmap) {
    // ImageBitmap 직접 드로우
    ctx.drawImage(imgObj.bitmap, 0, 0);
  } else if (imgObj.data) {
    const rawData = imgObj.data;
    const imgData = ctx.createImageData(width, height);
    const rgba = imgData.data;

    if (rawData.length === width * height * 4) {
      // RGBA 형식
      rgba.set(rawData);
    } else if (rawData.length === width * height * 3) {
      // RGB 형식 -> RGBA 확장
      let srcIdx = 0;
      let dstIdx = 0;
      const totalPixels = width * height;
      for (let i = 0; i < totalPixels; i++) {
        rgba[dstIdx] = rawData[srcIdx];
        rgba[dstIdx + 1] = rawData[srcIdx + 1];
        rgba[dstIdx + 2] = rawData[srcIdx + 2];
        rgba[dstIdx + 3] = 255;
        srcIdx += 3;
        dstIdx += 4;
      }
    } else if (rawData.length === width * height) {
      // Grayscale 형식 -> RGBA 확장
      let dstIdx = 0;
      const totalPixels = width * height;
      for (let i = 0; i < totalPixels; i++) {
        const val = rawData[i];
        rgba[dstIdx] = val;
        rgba[dstIdx + 1] = val;
        rgba[dstIdx + 2] = val;
        rgba[dstIdx + 3] = 255;
        dstIdx += 4;
      }
    } else {
      // 그 외 특수 포맷의 경우 가능한 만큼 복사
      for (let i = 0; i < rawData.length && i < rgba.length; i++) {
        rgba[i] = rawData[i];
      }
    }

    ctx.putImageData(imgData, 0, 0);
  } else if (imgObj instanceof HTMLImageElement || imgObj instanceof SVGImageElement) {
    ctx.drawImage(imgObj, 0, 0);
  } else {
    return null;
  }

  return new Promise((resolve) => {
    canvas.toBlob(resolve, mimeType, 0.92);
  });
}

window.retryWithPageRender = function(taskId) {
  const task = state.tasks.get(taskId);
  if (!task) return;
  // 임시로 페이지 렌더링 모드로 즉시 실행
  const prevMode = state.extractMode;
  state.extractMode = 'pages';
  task.status = 'ready';
  updateTaskCardStatus(task);
  processNextInQueue();
  // 원래 모드 복귀
  setTimeout(() => {
    state.extractMode = prevMode;
  }, 100);
};

/* ==========================================================================
   ZIP Creation & Download Functions
   ========================================================================== */
async function createZipBlob(images, pdfName) {
  const zip = new JSZip();
  const folderName = pdfName.replace(/\.[^/.]+$/, '') + '_images';
  const folder = zip.folder(folderName);

  images.forEach(img => {
    folder.file(img.name, img.blob);
  });

  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}

window.downloadSingleZip = function(taskId) {
  const task = state.tasks.get(taskId);
  if (!task || !task.zipBlob) return;

  const fileName = `${task.name.replace(/\.[^/.]+$/, '')}_images.zip`;
  triggerDownload(task.zipBlob, fileName);
};

async function downloadMasterZip() {
  const completedTasksWithImages = Array.from(state.tasks.values()).filter(
    t => t.status === 'completed' && t.extractedImages.length > 0
  );

  if (completedTasksWithImages.length === 0) {
    alert('추출 완료된 이미지가 없습니다.');
    return;
  }

  DOM.downloadAllZipBtn.disabled = true;
  DOM.downloadAllZipBtn.innerHTML = `
    <svg class="spin-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a10 10 0 0 1 10 10"></path></svg>
    통합 압축 생성 중...
  `;

  try {
    const masterZip = new JSZip();
    
    completedTasksWithImages.forEach(task => {
      const folderName = task.name.replace(/\.[^/.]+$/, '');
      const taskFolder = masterZip.folder(folderName);
      task.extractedImages.forEach(img => {
        taskFolder.file(img.name, img.blob);
      });
    });

    const masterBlob = await masterZip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const masterFileName = `PDF2IMG_Archive_${dateStr}.zip`;
    triggerDownload(masterBlob, masterFileName);
  } catch (err) {
    alert('통합 ZIP 파일 생성 중 오류가 발생했습니다: ' + err.message);
  } finally {
    DOM.downloadAllZipBtn.disabled = false;
    DOM.downloadAllZipBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      모든 결과물 통합 ZIP 다운로드
    `;
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

/* ==========================================================================
   Image Preview Modal
   ========================================================================== */
function openPreviewModal(img) {
  DOM.modalImageTitle.textContent = img.name;
  DOM.modalImageMeta.textContent = `${img.width} × ${img.height} px (${formatFileSize(img.blob.size)})`;
  DOM.modalPreviewImg.src = img.url;
  DOM.modalDownloadSingleBtn.href = img.url;
  DOM.modalDownloadSingleBtn.download = img.name;
  DOM.previewModal.style.display = 'flex';
}

function closeModal() {
  DOM.previewModal.style.display = 'none';
  DOM.modalPreviewImg.src = '';
}

/* ==========================================================================
   Helpers & Statistics
   ========================================================================== */
function updateBatchStats() {
  const total = state.tasks.size;
  DOM.totalFilesCount.textContent = total;

  let totalExtracted = 0;
  let completedCount = 0;

  state.tasks.forEach(task => {
    totalExtracted += task.extractedImages.length;
    if (task.status === 'completed' || task.status === 'error') {
      completedCount++;
    }
  });

  DOM.totalExtractedImages.textContent = totalExtracted;

  const percent = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  DOM.batchProgressPercent.textContent = `${percent}%`;

  // 통합 다운로드 버튼 활성화 여부
  DOM.downloadAllZipBtn.disabled = totalExtracted === 0;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getExtensionByMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// 애플리케이션 시작
document.addEventListener('DOMContentLoaded', init);
