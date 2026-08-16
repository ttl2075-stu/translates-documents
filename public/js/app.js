// Academic & Scientific Research Sample Document with Math, Images & Citations
const SAMPLE_RESEARCH_PAPER = `---
title: "Self-Supervised Contrastive Learning in Deep Neural Networks: An Empirical Study"
authors: ["Alex Morgan", "Elena Vance", "David Chen"]
conference: "IEEE Transactions on Pattern Analysis and Machine Intelligence (TPAMI)"
year: 2026
doi: "10.1109/TPAMI.2026.884120"
---

# Abstract

Self-supervised representation learning has emerged as a cornerstone in modern computer vision and natural language processing. In this paper, we propose a novel contrastive loss formulation termed **Adaptive InfoNCE**, which dynamically scales the temperature parameter based on sample difficulty. Our empirical evaluations across ImageNet-1K and GLUE benchmarks show statistically significant improvements ($p < 0.001$) over standard baseline architectures.

## 1. Mathematical Formulation & Optimization

Given an augmented pair of positive sample representations $(z_i, z_j)$ and a set of negative keys $\{z_k\}_{k=1}^{K}$, the Adaptive InfoNCE loss is formulated as:

$$\\mathcal{L}_{\\text{Adaptive}} = -\\log \\frac{\\exp\\left(\\frac{\\text{sim}(z_i, z_j)}{\\tau_i}\\right)}{\\exp\\left(\\frac{\\text{sim}(z_i, z_j)}{\\tau_i}\\right) + \\sum_{k=1}^{K} \\exp\\left(\\frac{\\text{sim}(z_i, z_k)}{\\tau_i}\\right)}$$

Where the sample-dependent temperature factor satisfies:

$$\\tau_i = \\tau_0 \\cdot \\left(1 + \\alpha \\cdot \\|z_i - \\bar{z}\\|_2^2\\right)$$

Với đạo hàm tương ứng: $\\frac{\\partial \\mathcal{L}}{\\partial z_i} = \\frac{1}{\\tau_i} \\sum_{k=1}^{K} P(k) (z_k - z_j)$.

## 2. Model Architecture & Pipeline Overview

Dưới đây là sơ đồ tổng quan quy trình huấn luyện học tự giám sát:

![Kiến Trúc Mô Hình Adaptive Contrastive Learning](https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1000&q=80 "Sơ đồ kiến trúc học tăng cường tương phản")

*Hình 1: Luồng xử lý biểu diễn không gian đặc trưng giữa các cặp dữ liệu tương đồng.*

## 3. Experimental Benchmark Results (Ablation Study)

Bảng so sánh hiệu năng trên tập kiểm thử ImageNet-1K:

| Model Architecture | Top-1 Accuracy (%) | Top-5 Accuracy (%) | Training Latency (ms/step) | $p$-value |
| :--- | :--- | :--- | :--- | :--- |
| **SimCLR v2 (Baseline)** | $76.8 \\pm 0.2$ | $93.4 \\pm 0.1$ | $142.5$ | - |
| **MoCo v3** | $78.1 \\pm 0.3$ | $94.1 \\pm 0.2$ | $138.0$ | $0.024$ |
| **Adaptive InfoNCE (Ours)** | $\\mathbf{80.4} \\pm 0.2$ | $\\mathbf{95.7} \\pm 0.1$ | $\\mathbf{126.4}$ | $< 0.001$ |

## 4. PyTorch Implementation Snippet

\`\`\`python
import torch
import torch.nn as nn
import torch.nn.functional as F

class AdaptiveInfoNCELoss(nn.Module):
    def __init__(self, tau_0: float = 0.07, alpha: float = 0.5):
        super().__init__()
        self.tau_0 = tau_0
        self.alpha = alpha

    def forward(self, q: torch.Tensor, k: torch.Tensor, queue: torch.Tensor) -> torch.Tensor:
        pos_sim = torch.sum(q * k, dim=-1, keepdim=True)
        neg_sim = torch.matmul(q, queue.T)
        logits = torch.cat([pos_sim, neg_sim], dim=-1)
        
        norm_diff = torch.norm(q - q.mean(dim=0), p=2, dim=-1, keepdim=True)
        tau = self.tau_0 * (1.0 + self.alpha * torch.square(norm_diff))
        
        labels = torch.zeros(q.size(0), dtype=torch.long, device=q.device)
        return F.cross_entropy(logits / tau, labels)
\`\`\`

> **Định lý 1 (Hội tụ tiệm cận)**: Dưới các giả định về độ trơn Lipschitz trên bộ mã hóa $f_\\theta$, phương sai của gradient giảm với tốc độ tiệm cận $\\mathcal{O}(1/\\sqrt{N})$.

Tham khảo mã nguồn tại [Kho lưu trữ dự án GitHub](https://github.com/ai-research/adaptive-infonce "Adaptive InfoNCE GitHub").

## 5. References & Citations
- [1] K. He et al., "Momentum Contrast for Unsupervised Visual Representation Learning," in *Proc. CVPR*, 2020.
- [2] T. Chen et al., "A Simple Framework for Contrastive Learning of Visual Representations," in *Proc. ICML*, 2020.
`;

// App State
let currentSourceFilename = 'adaptive_infonce_paper.md';
let currentTranslatedText = '';
let liveChunkBuffers = {};
let liveTotalChunks = 0;
let isTranslating = false;
let currentViewMode = 'rendered'; // 'rendered' | 'raw' | 'diff'
let isFullscreen = false;
let isTocOpen = false;
let isInputSectionVisible = true;
let liveStreamedText = '';
let activeAbortController = null;

// Typography formatting state
const typographySettings = {
  fontSize: 16,
  lineHeight: 1.75,
  paraSpacing: '0.9rem',
  fontFamily: 'font-sans',
};

// DOM Elements
const sourceInputSection = document.getElementById('source-input-section');
const btnToggleInput = document.getElementById('btn-toggle-input');
const inputToggleLabel = document.getElementById('input-toggle-label');

const sourceEditor = document.getElementById('source-editor');
const targetEditor = document.getElementById('target-editor');
const targetPreview = document.getElementById('target-preview');
const targetDiff = document.getElementById('target-diff');
const targetPanel = document.getElementById('target-panel');
const sourceStatsEl = document.getElementById('source-stats');
const targetStatsEl = document.getElementById('target-stats');

const selectSourceLang = document.getElementById('select-source-lang');
const selectTargetLang = document.getElementById('select-target-lang');
const selectStyle = document.getElementById('select-style');
const inputGlossary = document.getElementById('input-glossary');
const inputCustomInstruction = document.getElementById('input-custom-instruction');
const cacheBadge = document.getElementById('cache-badge');
const cacheStatsText = document.getElementById('cache-stats-text');
const btnClearCache = document.getElementById('btn-clear-cache');

const btnStartTranslate = document.getElementById('btn-start-translate');
const translateBtnText = document.getElementById('translate-btn-text');
const translateIcon = document.getElementById('translate-icon');
const btnLoadSample = document.getElementById('btn-load-sample');
const btnClearSource = document.getElementById('btn-clear-source');
const btnCopyTarget = document.getElementById('btn-copy-target');
const btnDownloadTarget = document.getElementById('btn-download-target');
const btnPrintPreview = document.getElementById('btn-print-preview');
const btnFullscreenTarget = document.getElementById('btn-fullscreen-target');
const fullscreenIcon = document.getElementById('fullscreen-icon');
const btnToggleToc = document.getElementById('btn-toggle-toc');
const btnCloseToc = document.getElementById('btn-close-toc');
const tocSidebar = document.getElementById('toc-sidebar');
const tocContainer = document.getElementById('toc-container');

// Format Menu Popover Elements
const btnToggleFormatMenu = document.getElementById('btn-toggle-format-menu');
const formatMenuPopover = document.getElementById('format-menu-popover');
const sliderFontSize = document.getElementById('slider-font-size');
const lblFontSize = document.getElementById('lbl-font-size');
const selectFontFamily = document.getElementById('select-font-family');
const btnResetFormat = document.getElementById('btn-reset-format');

const fileUploadInput = document.getElementById('file-upload-input');
const fileOpenMarkdown = document.getElementById('file-open-markdown');
const dropzone = document.getElementById('dropzone');

const progressContainer = document.getElementById('progress-container');
const progressStatusText = document.getElementById('progress-status-text');
const progressPercentage = document.getElementById('progress-percentage');
const progressBarFill = document.getElementById('progress-bar-fill');

const tabRendered = document.getElementById('tab-rendered');
const tabRaw = document.getElementById('tab-raw');
const tabDiff = document.getElementById('tab-diff');
const toastEl = document.getElementById('toast');

// AI Refine Modal & Floating Selection Elements
const btnOpenRefineModal = document.getElementById('btn-open-refine-modal');
const floatingRefineBtn = document.getElementById('floating-refine-btn');
const refineModal = document.getElementById('refine-modal');
const btnCloseRefineModal = document.getElementById('btn-close-refine-modal');
const btnCancelRefine = document.getElementById('btn-cancel-refine');
const btnExecuteRefine = document.getElementById('btn-execute-refine');
const refineSelectionPreview = document.getElementById('refine-selection-preview');
const refineSelectionLength = document.getElementById('refine-selection-length');
const refinePromptInput = document.getElementById('refine-prompt-input');
const lblExecuteRefine = document.getElementById('lbl-execute-refine');

// Background Jobs & SMTP Elements
const btnOpenJobsModal = document.getElementById('btn-open-jobs-modal');
const btnCloseJobsModal = document.getElementById('btn-close-jobs-modal');
const btnCloseJobsModalFooter = document.getElementById('btn-close-jobs-modal-footer');
const jobsModal = document.getElementById('jobs-modal');
const btnRefreshJobs = document.getElementById('btn-refresh-jobs');
const jobsListContainer = document.getElementById('jobs-list-container');
const jobsEmptyState = document.getElementById('jobs-empty-state');
const jobsLoadingState = document.getElementById('jobs-loading-state');
const activeJobsBadge = document.getElementById('active-jobs-badge');

const chkRunBackground = document.getElementById('chk-run-background');
const chkEnableFormatReview = document.getElementById('chk-enable-format-review');
const chkEnableEmail = document.getElementById('chk-enable-email');
const inputRecipientEmail = document.getElementById('input-recipient-email');
const emailRecipientWrapper = document.getElementById('email-recipient-wrapper');

const btnReviewFormat = document.getElementById('btn-review-format');
const lblReviewFormat = document.getElementById('lbl-review-format');

let jobsRefreshInterval = null;

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  loadTypographySettings();
  setupEventListeners();
  setupJobsListeners();
  await refreshCacheStats();
  await refreshActiveJobsCount();
  checkActiveJobOnLoad();
  updateSourceStats();

  // Polling active jobs count periodically
  setInterval(refreshActiveJobsCount, 8000);
});

// -------------------------------------------------------------
// Event Listeners & Shortcuts
// -------------------------------------------------------------
function setupEventListeners() {
  // Source text changes
  sourceEditor.addEventListener('input', updateSourceStats);

  // Target / Translated text live editing by user
  targetEditor.addEventListener('input', () => {
    currentTranslatedText = targetEditor.value;
    updateTargetStats(currentTranslatedText.length, 'Đã chỉnh sửa ✏️');
    renderTargetMarkdown(currentTranslatedText, true);
    renderDiffView(sourceEditor.value, currentTranslatedText);
  });

  // Track selection in targetEditor
  targetEditor.addEventListener('select', handleEditorSelection);
  targetEditor.addEventListener('mouseup', handleEditorSelection);
  targetEditor.addEventListener('keyup', handleEditorSelection);

  // Track selection in targetPreview
  targetPreview.addEventListener('mouseup', handlePreviewSelection);

  // AI Refine Modal Triggers
  btnOpenRefineModal.addEventListener('click', () => {
    if (tabRaw.classList.contains('text-slate-500')) {
      // If currently in preview mode, switch to raw or keep selection
      openRefineModal();
    } else {
      openRefineModal();
    }
  });

  if (floatingRefineBtn) {
    floatingRefineBtn.addEventListener('click', openRefineModal);
  }

  btnCloseRefineModal.addEventListener('click', closeRefineModal);
  btnCancelRefine.addEventListener('click', closeRefineModal);
  btnExecuteRefine.addEventListener('click', executeRefine);

  if (btnReviewFormat) {
    btnReviewFormat.addEventListener('click', handleFormatReview);
  }

  // Quick Preset Prompt Chips
  document.querySelectorAll('.btn-refine-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      refinePromptInput.value = btn.dataset.prompt;
      refinePromptInput.focus();
    });
  });

  // Close modals on clicking outside
  refineModal.addEventListener('click', (e) => {
    if (e.target === refineModal) closeRefineModal();
  });

  // Toggle Input Section
  btnToggleInput.addEventListener('click', toggleInputSection);

  // Format Settings Popover
  btnToggleFormatMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    formatMenuPopover.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!formatMenuPopover.contains(e.target) && e.target !== btnToggleFormatMenu) {
      formatMenuPopover.classList.add('hidden');
    }
  });

  // Typography Controls
  sliderFontSize.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    lblFontSize.textContent = `${val}px`;
    typographySettings.fontSize = val;
    applyTypographySettings();
  });

  document.querySelectorAll('.btn-line-height').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-line-height').forEach((b) => {
        b.classList.remove('border-blue-500', 'bg-blue-50', 'text-blue-700', 'font-medium');
      });
      btn.classList.add('border-blue-500', 'bg-blue-50', 'text-blue-700', 'font-medium');
      typographySettings.lineHeight = parseFloat(btn.dataset.val);
      applyTypographySettings();
    });
  });

  document.querySelectorAll('.btn-para-spacing').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-para-spacing').forEach((b) => {
        b.classList.remove('border-blue-500', 'bg-blue-50', 'text-blue-700', 'font-medium');
      });
      btn.classList.add('border-blue-500', 'bg-blue-50', 'text-blue-700', 'font-medium');
      typographySettings.paraSpacing = btn.dataset.val;
      applyTypographySettings();
    });
  });

  selectFontFamily.addEventListener('change', (e) => {
    typographySettings.fontFamily = e.target.value;
    applyTypographySettings();
  });

  btnResetFormat.addEventListener('click', () => {
    typographySettings.fontSize = 16;
    typographySettings.lineHeight = 1.75;
    typographySettings.paraSpacing = '0.9rem';
    typographySettings.fontFamily = 'font-sans';
    sliderFontSize.value = 16;
    lblFontSize.textContent = '16px';
    selectFontFamily.value = 'font-sans';
    applyTypographySettings();
    showToast('Đã khôi phục cài đặt hiển thị mặc định!');
  });

  // Print Preview / PDF
  btnPrintPreview.addEventListener('click', () => {
    if (!currentTranslatedText) {
      showToast('Chưa có nội dung để in!', true);
      return;
    }
    window.print();
  });

  // Open existing Markdown file to view/preview directly
  fileOpenMarkdown.addEventListener('change', handleOpenMarkdownFile);

  // Fullscreen toggle
  btnFullscreenTarget.addEventListener('click', toggleFullscreen);

  // Table of Contents toggle
  btnToggleToc.addEventListener('click', toggleToc);
  btnCloseToc.addEventListener('click', () => setTocState(false));

  // Keyboard Shortcuts: Ctrl+Enter to translate or refine, Ctrl+K for AI Refine, Escape to exit
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openRefineModal();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (refineModal && !refineModal.classList.contains('hidden')) {
        executeRefine();
      } else {
        startTranslation();
      }
    } else if (e.key === 'Escape') {
      if (refineModal && !refineModal.classList.contains('hidden')) closeRefineModal();
      if (isFullscreen) toggleFullscreen();
      if (isTocOpen) setTocState(false);
      formatMenuPopover.classList.add('hidden');
      if (floatingRefineBtn) floatingRefineBtn.classList.add('hidden');
    }
  });

  // Sample and Clear buttons
  btnLoadSample.addEventListener('click', () => {
    sourceEditor.value = SAMPLE_RESEARCH_PAPER;
    currentSourceFilename = 'adaptive_infonce_paper.md';
    updateSourceStats();
    showToast('Đã nạp bài báo khoa học mẫu (LaTeX & Ảnh)!');
  });

  btnClearSource.addEventListener('click', () => {
    sourceEditor.value = '';
    targetEditor.value = '';
    currentTranslatedText = '';
    renderTargetMarkdown('');
    updateSourceStats();
    updateTargetStats(0, 'Đã xóa');
    generateTableOfContents('');
  });

  // View Switch Tabs (Rendered vs Raw vs Diff)
  tabRendered.addEventListener('click', () => setTargetViewMode('rendered'));
  tabRaw.addEventListener('click', () => setTargetViewMode('raw'));
  tabDiff.addEventListener('click', () => setTargetViewMode('diff'));

  // Copy & Download
  btnCopyTarget.addEventListener('click', copyTranslatedText);
  btnDownloadTarget.addEventListener('click', downloadTranslatedFile);

  // File Upload & Drag-and-Drop
  fileUploadInput.addEventListener('change', handleFileInput);
  setupDragAndDrop();

  // Translation Start
  btnStartTranslate.addEventListener('click', startTranslation);

  // Clear Cache
  btnClearCache.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/cache/clear', { method: 'POST' });
      const data = await res.json();
      showToast(data.message);
      await refreshCacheStats();
    } catch (e) {
      showToast('Lỗi xóa cache: ' + e.message, true);
    }
  });
}

// -------------------------------------------------------------
// Typography & Layout Controls
// -------------------------------------------------------------
function toggleInputSection() {
  isInputSectionVisible = !isInputSectionVisible;
  sourceInputSection.classList.toggle('hidden', !isInputSectionVisible);
  inputToggleLabel.textContent = isInputSectionVisible ? 'Ẩn tài liệu nguồn' : 'Nhập tài liệu nguồn';
  btnToggleInput.classList.toggle('bg-blue-50', isInputSectionVisible);
  btnToggleInput.classList.toggle('text-blue-700', isInputSectionVisible);
}

function loadTypographySettings() {
  try {
    const saved = localStorage.getItem('md-typography-settings');
    if (saved) {
      Object.assign(typographySettings, JSON.parse(saved));
      sliderFontSize.value = typographySettings.fontSize;
      lblFontSize.textContent = `${typographySettings.fontSize}px`;
      selectFontFamily.value = typographySettings.fontFamily;
    }
  } catch (_) {}
  applyTypographySettings();
}

function applyTypographySettings() {
  document.documentElement.style.setProperty('--md-font-size', `${typographySettings.fontSize}px`);
  document.documentElement.style.setProperty('--md-line-height', typographySettings.lineHeight);
  document.documentElement.style.setProperty('--md-para-spacing', typographySettings.paraSpacing);

  targetPreview.classList.remove('font-sans', 'font-serif', 'font-mono');
  targetPreview.classList.add(typographySettings.fontFamily);

  try {
    localStorage.setItem('md-typography-settings', JSON.stringify(typographySettings));
  } catch (_) {}
}

// -------------------------------------------------------------
// Open Existing Markdown File Directly
// -------------------------------------------------------------
function handleOpenMarkdownFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const content = event.target?.result;
    if (typeof content === 'string') {
      currentTranslatedText = content;
      currentSourceFilename = file.name;
      targetEditor.value = content;
      
      // Ensure we switch to rendered view mode and render
      setTargetViewMode('rendered');
      renderTargetMarkdown(content, true);
      
      updateTargetStats(content.length, `Đã mở file: ${file.name}`);
      showToast(`Đã mở tài liệu: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
      
      // Auto collapse source input to maximize preview
      if (isInputSectionVisible) toggleInputSection();
    }
  };
  reader.readAsText(file);
  e.target.value = ''; // Reset input
}

// -------------------------------------------------------------
// Fullscreen & Table of Contents (TOC) Handlers
// -------------------------------------------------------------
function toggleFullscreen() {
  isFullscreen = !isFullscreen;
  targetPanel.classList.toggle('is-fullscreen', isFullscreen);

  if (isFullscreen) {
    fullscreenIcon.className = 'fa-solid fa-compress text-blue-600';
    btnFullscreenTarget.classList.add('bg-blue-50', 'text-blue-700');
    showToast('Đã mở chế độ toàn màn hình (Fullwidth) - Nhấn Esc để thoát');
  } else {
    fullscreenIcon.className = 'fa-solid fa-expand text-slate-500';
    btnFullscreenTarget.classList.remove('bg-blue-50', 'text-blue-700');
  }
}

function toggleToc() {
  setTocState(!isTocOpen);
}

function setTocState(open) {
  isTocOpen = open;
  if (open) {
    tocSidebar.classList.remove('hidden');
    btnToggleToc.classList.add('bg-blue-50', 'text-blue-700');
  } else {
    tocSidebar.classList.add('hidden');
    btnToggleToc.classList.remove('bg-blue-50', 'text-blue-700');
  }
}

function generateTableOfContents(markdownContent) {
  if (!tocContainer) return;

  const headings = targetPreview.querySelectorAll('h1, h2, h3');
  if (!headings || headings.length === 0) {
    tocContainer.innerHTML = `<p class="text-slate-400 text-xs italic">Không tìm thấy tiêu đề trong tài liệu.</p>`;
    return;
  }

  let tocHtml = '<nav class="space-y-1">';
  headings.forEach((heading, index) => {
    const text = heading.textContent.trim();
    const id = `heading-toc-${index}`;
    heading.id = id;

    const level = heading.tagName.toLowerCase() === 'h1' ? '1' : heading.tagName.toLowerCase() === 'h2' ? '2' : '3';
    tocHtml += `<a href="#${id}" class="toc-item level-${level}" data-target="${id}">${escapeHtml(text)}</a>`;
  });
  tocHtml += '</nav>';

  tocContainer.innerHTML = tocHtml;

  // Attach smooth scroll click handlers
  tocContainer.querySelectorAll('.toc-item').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('data-target');
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        targetEl.classList.add('bg-blue-50/80');
        setTimeout(() => targetEl.classList.remove('bg-blue-50/80'), 1500);
      }
    });
  });
}

// -------------------------------------------------------------
// File Handling & Drag-and-Drop
// -------------------------------------------------------------
function setupDragAndDrop() {
  const container = document.getElementById('source-input-section') || document.body;

  ['dragenter', 'dragover'].forEach((eventName) => {
    container.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('hidden');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    container.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('hidden');
    });
  });

  container.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      uploadFile(files[0]);
    }
  });
}

function handleFileInput(e) {
  const files = e.target.files;
  if (files && files.length > 0) {
    uploadFile(files[0]);
  }
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  try {
    showToast(`Đang tải file ${file.name}...`);
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Lỗi tải file');
    }

    const data = await res.json();
    sourceEditor.value = data.content;
    currentSourceFilename = data.filename;
    updateSourceStats();
    showToast(`Đã nạp file: ${data.filename} (${(data.size / 1024).toFixed(1)} KB)`);
  } catch (error) {
    showToast(`Không thể tải file: ${error.message}`, true);
  }
}

async function refreshCacheStats() {
  try {
    const res = await fetch('/api/cache/stats');
    const data = await res.json();
    if (cacheBadge) {
      cacheBadge.innerHTML = `<i class="fa-solid fa-bolt text-[9px] mr-1"></i> Cache: ${data.totalHits} Hits (${data.hitRate})`;
    }
    if (cacheStatsText) {
      cacheStatsText.textContent = `Tiết kiệm: ~${data.estimatedSavedTokens.toLocaleString()} tokens (${data.totalHits} hits)`;
    }
  } catch (_) {}
}

// -------------------------------------------------------------
// Translation Execution (SSE Streaming)
// -------------------------------------------------------------
async function startTranslation() {
  const content = sourceEditor.value.trim();
  if (!content) {
    showToast('Vui lòng nhập hoặc tải file tài liệu cần dịch!', true);
    return;
  }

  if (isTranslating) return;

  const recipientEmail = chkEnableEmail && chkEnableEmail.checked ? inputRecipientEmail.value.trim() : undefined;
  if (chkEnableEmail && chkEnableEmail.checked && (!recipientEmail || !recipientEmail.includes('@'))) {
    showToast('Vui lòng nhập địa chỉ email hợp lệ để nhận file!', true);
    inputRecipientEmail.focus();
    return;
  }

  const glossary = parseGlossary(inputGlossary.value);
  const customInstructions = inputCustomInstruction.value.trim();

  const isBackground = chkRunBackground && chkRunBackground.checked;

  const payload = {
    content,
    filename: currentSourceFilename,
    recipientEmail,
    options: {
      sourceLang: selectSourceLang.value,
      targetLang: selectTargetLang.value,
      style: selectStyle.value,
      enableCache: true,
      enableFormatReview: chkEnableFormatReview ? chkEnableFormatReview.checked : true,
      customGlossary: Object.keys(glossary).length > 0 ? glossary : undefined,
      customInstructions: customInstructions.length > 0 ? customInstructions : undefined,
    },
  };

  liveChunkBuffers = {};
  liveTotalChunks = 0;
  setTranslatingState(true);
  showProgressBar(true);
  showSkeletonLoading();
  
  let elapsedSec = 0;
  const statusPrefix = isBackground ? 'Đang chạy nền trên máy chủ & kết nối AI...' : 'Đang phân tích cấu trúc cú pháp & kết nối AI...';
  updateProgress(5, `${statusPrefix} (0s)`);
  const progressTimer = setInterval(() => {
    elapsedSec++;
    const currentText = progressStatusText.textContent.replace(/\s*\(\d+s\)$/, '');
    progressStatusText.textContent = `${currentText} (${elapsedSec}s)`;
  }, 1000);

  activeAbortController = new AbortController();

  try {
    let streamUrl = '/api/translate-stream';
    let requestOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: activeAbortController.signal,
    };

    if (isBackground) {
      // 1. Register background job on server
      const jobRes = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!jobRes.ok) {
        throw new Error(`Không thể khởi tạo tiến trình nền (${jobRes.status})`);
      }

      const jobData = await jobRes.json();
      const jobId = jobData.job?.id;
      if (jobId) {
        localStorage.setItem('active_translation_job', jobId);
        refreshActiveJobsCount();
        showToast('🚀 Tiến trình nền đã bắt đầu! Bạn có thể tắt máy bất cứ lúc nào.');
      }

      // Stream from job endpoint
      streamUrl = `/api/jobs/${jobId}/stream`;
      requestOptions = {
        method: 'GET',
        headers: { 'Accept': 'text/event-stream' },
        signal: activeAbortController.signal,
      };
    }

    const response = await fetch(streamUrl, requestOptions);

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const block of lines) {
        if (!block.trim() || block.startsWith(':keepalive')) continue;

        let eventType = 'message';
        let eventData = '';

        const eventMatch = block.match(/^event:\s*(.+)$/m);
        if (eventMatch) eventType = eventMatch[1].trim();

        const dataMatch = block.match(/^data:\s*(.+)$/m);
        if (dataMatch) eventData = dataMatch[1].trim();

        if (eventData) {
          try {
            const parsed = JSON.parse(eventData);
            handleTranslationEvent(eventType, parsed);
          } catch (e) {
            console.error('Lỗi phân tích SSE data:', e);
          }
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      showToast(`Lỗi dịch: ${error.message}`, true);
      updateProgress(0, `Lỗi: ${error.message}`);
    }
  } finally {
    clearInterval(progressTimer);
    setTranslatingState(false);
    activeAbortController = null;
    localStorage.removeItem('active_translation_job');
    refreshActiveJobsCount();
  }
}

function stripThinkingTags(text) {
  if (!text) return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/^<\/think>/gi, '')
    .trim();
}

function handleTranslationEvent(type, data) {
  if (type === 'progress') {
    if (data.totalChunks) liveTotalChunks = data.totalChunks;
    updateProgress(data.percent, data.message);
  } else if (type === 'token') {
    const chunkId = data.chunkId !== undefined ? data.chunkId : 0;
    liveChunkBuffers[chunkId] = (liveChunkBuffers[chunkId] || '') + data.token;

    // Compose ordered live markdown across distinct chunk slots (never reorder out of sequence)
    const activeIndices = Object.keys(liveChunkBuffers).map(Number);
    const maxActiveIdx = activeIndices.length > 0 ? Math.max(...activeIndices) : 0;
    const totalSlots = Math.max(liveTotalChunks, maxActiveIdx + 1, 1);
    const parts = [];

    for (let i = 0; i < totalSlots; i++) {
      if (liveChunkBuffers[i] !== undefined && liveChunkBuffers[i].length > 0) {
        const cleanChunk = stripThinkingTags(liveChunkBuffers[i]);
        if (cleanChunk.length > 0) {
          parts.push(cleanChunk);
        }
      } else if (i < maxActiveIdx) {
        // Placeholder for earlier chunks still in-flight so later chunks do not jump to top
        parts.push(`<!-- [Đang dịch đoạn ${i + 1}...] -->`);
      }
    }

    const liveMarkdown = parts.join('\n\n');
    targetEditor.value = liveMarkdown;

    // Live update preview
    if (currentViewMode === 'rendered') {
      renderTargetMarkdown(liveMarkdown, false);
    }
  } else if (type === 'complete') {
    liveChunkBuffers = {};
    liveTotalChunks = 0;
    currentTranslatedText = stripThinkingTags(data.translatedContent);
    targetEditor.value = currentTranslatedText;
    renderTargetMarkdown(currentTranslatedText, true);
    renderDiffView(sourceEditor.value, currentTranslatedText);

    const cachedNote = data.cachedChunks ? ` (${data.cachedChunks}/${data.totalChunks} từ Cache ⚡)` : '';
    updateProgress(100, `Hoàn thành (${(data.durationMs / 1000).toFixed(1)}s - ${data.totalChunks} phần${cachedNote})!`);
    updateTargetStats(currentTranslatedText.length, `Hoàn tất (${(data.durationMs / 1000).toFixed(1)}s${cachedNote})`);
    showToast('Tài liệu đã được dịch thành công!');
    refreshCacheStats();
  } else if (type === 'error') {
    showToast(`Lỗi: ${data.message}`, true);
    updateProgress(0, `Lỗi: ${data.message}`);
  }
}

function showSkeletonLoading() {
  targetPreview.innerHTML = `
    <div class="py-4 space-y-3">
      <div class="skeleton-line" style="width: 45%;"></div>
      <div class="skeleton-line" style="width: 95%;"></div>
      <div class="skeleton-line" style="width: 88%;"></div>
      <div class="skeleton-line" style="width: 65%;"></div>
      <div class="pt-4 space-y-3">
        <div class="skeleton-line" style="width: 38%;"></div>
        <div class="skeleton-line" style="width: 92%;"></div>
        <div class="skeleton-line" style="width: 85%;"></div>
      </div>
    </div>
  `;
}

function parseGlossary(text) {
  const glossary = {};
  if (!text) return glossary;

  const lines = text.split('\n');
  for (const line of lines) {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const k = parts[0].trim();
      const v = parts.slice(1).join('=').trim();
      if (k && v) glossary[k] = v;
    }
  }
  return glossary;
}

// -------------------------------------------------------------
// UI Utilities & View Modes
// -------------------------------------------------------------
function setTranslatingState(loading) {
  isTranslating = loading;
  if (loading) {
    btnStartTranslate.classList.add('opacity-75', 'cursor-not-allowed', 'pointer-events-none');
    translateIcon.className = 'fa-solid fa-circle-notch fa-spin text-[10px]';
    translateBtnText.textContent = 'Đang dịch...';
  } else {
    btnStartTranslate.classList.remove('opacity-75', 'cursor-not-allowed', 'pointer-events-none');
    translateIcon.className = 'fa-solid fa-play text-[10px]';
    translateBtnText.textContent = 'Bắt đầu dịch AI';
  }
}

function showProgressBar(show) {
  if (show) {
    progressContainer.classList.remove('hidden');
  } else {
    progressContainer.classList.add('hidden');
  }
}

function updateProgress(percent, msg) {
  progressBarFill.style.width = `${percent}%`;
  progressPercentage.textContent = `${percent}%`;
  if (msg) progressStatusText.textContent = msg;
}

function setTargetViewMode(mode) {
  currentViewMode = mode;
  [tabRendered, tabRaw, tabDiff].forEach(t => {
    t.classList.remove('bg-white', 'text-slate-800', 'shadow-xs');
    t.classList.add('text-slate-500');
  });
  [targetPreview, targetEditor, targetDiff].forEach(e => e.classList.add('hidden'));

  if (mode === 'rendered') {
    tabRendered.classList.add('bg-white', 'text-slate-800', 'shadow-xs');
    tabRendered.classList.remove('text-slate-500');
    targetPreview.classList.remove('hidden');
    renderTargetMarkdown(currentTranslatedText, true);
  } else if (mode === 'raw') {
    tabRaw.classList.add('bg-white', 'text-slate-800', 'shadow-xs');
    tabRaw.classList.remove('text-slate-500');
    targetEditor.classList.remove('hidden');
    targetEditor.focus();
  } else if (mode === 'diff') {
    tabDiff.classList.add('bg-white', 'text-slate-800', 'shadow-xs');
    tabDiff.classList.remove('text-slate-500');
    targetDiff.classList.remove('hidden');
    renderDiffView(sourceEditor.value, currentTranslatedText);
  }
}

function renderTargetMarkdown(content, isFinal = false) {
  if (!content) {
    targetPreview.innerHTML = `
      <div class="h-full flex flex-col items-center justify-center text-center text-slate-400 p-8">
        <div class="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
          <i class="fa-regular fa-file-lines text-2xl text-slate-400"></i>
        </div>
        <p class="text-sm font-semibold text-slate-700">Chưa có nội dung xem trước</p>
        <p class="text-xs text-slate-400 mt-1 max-w-sm">Dán tài liệu và bấm <strong>Bắt đầu dịch AI</strong> hoặc bấm <strong>Mở file Markdown</strong> ở góc trên để xem trực tiếp.</p>
      </div>`;
    return;
  }

  // If JSON, render formatted code
  if (currentSourceFilename.endsWith('.json')) {
    try {
      const parsed = JSON.parse(content);
      targetPreview.innerHTML = `<pre><code>${escapeHtml(JSON.stringify(parsed, null, 2))}</code></pre>`;
      return;
    } catch (_) {}
  }

  // Markdown + KaTeX Rendering
  if (window.marked && window.DOMPurify) {
    const mathEntries = [];
    const codeEntries = [];
    let codeCounter = 0;

    let processed = content;

    // 1. Bảo vệ Code Blocks trước tiên
    processed = processed.replace(/(```[\s\S]*?```|````[\s\S]*?````|`[^`\n]+?`)/g, (match) => {
      const id = `CODEBLOCKPH${codeCounter++}XYZ`;
      codeEntries.push({ id, code: match });
      return id;
    });

    // 2. Trích xuất LaTeX Environments: \begin{...} ... \end{...}
    processed = processed.replace(/\\begin\{(equation\*?|align\*?|gather\*?|matrix|pmatrix|bmatrix|vmatrix|cases)\}([\s\S]+?)\\end\{\1\}/g, (match) => {
      const idx = mathEntries.length;
      mathEntries.push({ formula: match.trim(), display: true });
      return `\n\n<div class="katex-block-target" data-math-idx="${idx}"></div>\n\n`;
    });

    // 3. Trích xuất Display Math: $$ ... $$ và \[ ... \]
    processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (match, formula) => {
      const idx = mathEntries.length;
      mathEntries.push({ formula: formula.trim(), display: true });
      return `\n\n<div class="katex-block-target" data-math-idx="${idx}"></div>\n\n`;
    });

    processed = processed.replace(/\\\[([\s\S]+?)\\\]/g, (match, formula) => {
      const idx = mathEntries.length;
      mathEntries.push({ formula: formula.trim(), display: true });
      return `\n\n<div class="katex-block-target" data-math-idx="${idx}"></div>\n\n`;
    });

    // 4. Trích xuất Inline Math: \( ... \) và $ ... $
    processed = processed.replace(/\\\(([\s\S]+?)\\\)/g, (match, formula) => {
      const idx = mathEntries.length;
      mathEntries.push({ formula: formula.trim(), display: false });
      return `<span class="katex-inline-target" data-math-idx="${idx}"></span>`;
    });

    processed = processed.replace(/(?<!\\)\$([^\$\n\r]+?)(?<!\\)\$/g, (match, formula) => {
      const idx = mathEntries.length;
      mathEntries.push({ formula: formula.trim(), display: false });
      return `<span class="katex-inline-target" data-math-idx="${idx}"></span>`;
    });

    // 5. Khôi phục Code Blocks trước khi Marked parse
    codeEntries.forEach((entry) => {
      processed = processed.split(entry.id).join(entry.code);
    });

    // 6. Parse Markdown bằng Marked
    marked.setOptions({
      gfm: true,
      breaks: true,
    });
    const rawHtml = window.marked.parse(processed);

    // 7. Sanitize với DOMPurify
    const cleanHtml = window.DOMPurify.sanitize(rawHtml, {
      ADD_TAGS: ['iframe', 'math', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'msup', 'msub', 'mfrac', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'span', 'svg', 'path', 'annotation', 'div'],
      ADD_ATTR: ['class', 'data-math-idx', 'target', 'allowfullscreen', 'frameborder', 'xmlns', 'viewBox', 'd', 'aria-hidden', 'display'],
    });

    targetPreview.innerHTML = cleanHtml;

    // 8. Render KaTeX trực tiếp vào các DOM target nodes
    targetPreview.querySelectorAll('.katex-block-target, .katex-inline-target').forEach((el) => {
      const idx = parseInt(el.getAttribute('data-math-idx'), 10);
      const entry = mathEntries[idx];
      if (entry) {
        if (window.katex) {
          try {
            window.katex.render(entry.formula, el, {
              displayMode: entry.display,
              throwOnError: false,
            });
          } catch (e) {
            console.warn('KaTeX render error:', entry.formula, e);
            el.innerHTML = `<span class="text-red-500 font-mono text-xs">[Lỗi công thức: ${escapeHtml(entry.formula)}]</span>`;
          }
        } else {
          el.textContent = entry.display ? `$$${entry.formula}$$` : `$${entry.formula}$`;
        }
      }
    });

    attachCodeCopyButtons();

    // Build Table of Contents when translation completes or on edit
    if (isFinal) {
      generateTableOfContents(content);
    }
  } else {
    targetPreview.textContent = content;
  }
}

function attachCodeCopyButtons() {
  const preElements = targetPreview.querySelectorAll('pre');
  preElements.forEach((pre) => {
    if (pre.parentElement.classList.contains('code-block-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';

    const header = document.createElement('div');
    header.className = 'code-block-header';
    header.innerHTML = `
      <span class="flex items-center gap-1.5"><i class="fa-solid fa-code text-[10px]"></i> Code Snippet</span>
      <button class="btn-code-copy"><i class="fa-regular fa-copy mr-1"></i> Sao chép</button>
    `;

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);

    const btnCopy = header.querySelector('.btn-code-copy');
    btnCopy.addEventListener('click', async () => {
      const codeText = pre.querySelector('code')?.innerText || pre.innerText;
      await navigator.clipboard.writeText(codeText);
      btnCopy.innerHTML = `<i class="fa-solid fa-check mr-1 text-emerald-400"></i> Đã chép!`;
      setTimeout(() => { btnCopy.innerHTML = `<i class="fa-regular fa-copy mr-1"></i> Sao chép`; }, 2000);
    });
  });
}

function renderDiffView(original, translated) {
  if (!targetDiff) return;
  if (!translated) {
    targetDiff.innerHTML = `<p class="text-slate-400 p-4">Chưa có bản dịch để so sánh khác biệt.</p>`;
    return;
  }

  if (window.Diff) {
    const diff = window.Diff.diffLines(original, translated);
    let html = '';
    diff.forEach((part) => {
      const className = part.added ? 'diff-line added' : part.removed ? 'diff-line removed' : 'diff-line unchanged';
      const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';
      const escaped = escapeHtml(part.value);
      html += `<div class="${className}">${prefix}${escaped}</div>`;
    });
    targetDiff.innerHTML = html;
  } else {
    targetDiff.innerHTML = `<pre><code>${escapeHtml(translated)}</code></pre>`;
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updateSourceStats() {
  const text = sourceEditor.value;
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  sourceStatsEl.textContent = `${chars.toLocaleString()} ký tự | ${words.toLocaleString()} từ`;
}

function updateTargetStats(chars, note) {
  targetStatsEl.textContent = `${chars.toLocaleString()} ký tự | ${note}`;
}

async function copyTranslatedText() {
  if (!currentTranslatedText) {
    showToast('Chưa có nội dung bản dịch để sao chép!', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(currentTranslatedText);
    showToast('Đã sao chép toàn bộ bản dịch vào clipboard!');
  } catch (err) {
    showToast('Không thể sao chép: ' + err.message, true);
  }
}

function downloadTranslatedFile() {
  if (!currentTranslatedText) {
    showToast('Chưa có bản dịch để tải về!', true);
    return;
  }

  const targetLang = selectTargetLang.value;
  const lastDot = currentSourceFilename.lastIndexOf('.');
  let outName = '';

  if (lastDot !== -1) {
    const base = currentSourceFilename.substring(0, lastDot);
    const ext = currentSourceFilename.substring(lastDot);
    outName = `${base}_${targetLang}${ext}`;
  } else {
    outName = `${currentSourceFilename}_${targetLang}.md`;
  }

  const blob = new Blob([currentTranslatedText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = outName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`Đã tải file ${outName} về máy!`);
}

function showToast(message, isError = false) {
  toastEl.innerHTML = `<i class="fa-solid ${isError ? 'fa-circle-exclamation text-red-400' : 'fa-circle-check text-emerald-400'}"></i> <span>${message}</span>`;
  toastEl.className = `fixed bottom-6 right-6 ${isError ? 'bg-red-900' : 'bg-slate-900'} text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-xl z-50 transition-all flex items-center gap-2 animate-fade-in`;
  toastEl.classList.remove('hidden');

  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 3500);
}

// -------------------------------------------------------------
// AI Prompt Edit & Refine Selection Logic
// -------------------------------------------------------------
function handleEditorSelection(e) {
  const start = targetEditor.selectionStart;
  const end = targetEditor.selectionEnd;
  const selectedText = targetEditor.value.substring(start, end);

  if (selectedText && selectedText.trim().length > 0) {
    currentSelection = {
      text: selectedText,
      start,
      end,
    };
    positionFloatingButton(e);
  } else {
    if (floatingRefineBtn) floatingRefineBtn.classList.add('hidden');
  }
}

function handlePreviewSelection(e) {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';

  if (text.length > 0) {
    const fullText = targetEditor.value;
    const idx = fullText.indexOf(text);
    if (idx !== -1) {
      currentSelection = {
        text,
        start: idx,
        end: idx + text.length,
      };
    } else {
      currentSelection = {
        text,
        start: 0,
        end: 0,
      };
    }
    positionFloatingButton(e);
  } else {
    if (floatingRefineBtn) floatingRefineBtn.classList.add('hidden');
  }
}

function positionFloatingButton(e) {
  if (!floatingRefineBtn) return;
  const x = e && e.clientX ? e.clientX : window.innerWidth / 2;
  const y = e && e.clientY ? e.clientY : window.innerHeight / 2;

  const posX = Math.min(window.innerWidth - 150, Math.max(20, x + 10));
  const posY = Math.min(window.innerHeight - 50, Math.max(20, y - 45));

  floatingRefineBtn.style.left = `${posX}px`;
  floatingRefineBtn.style.top = `${posY}px`;
  floatingRefineBtn.classList.remove('hidden');
}

function openRefineModal() {
  // Check if text is currently highlighted in targetEditor
  const start = targetEditor.selectionStart;
  const end = targetEditor.selectionEnd;
  const activeSelection = targetEditor.value.substring(start, end);

  if (activeSelection && activeSelection.trim().length > 0) {
    currentSelection = {
      text: activeSelection,
      start,
      end,
    };
  }

  // Fallback to existing selection or whole content
  if (!currentSelection.text || currentSelection.text.trim().length === 0) {
    if (targetEditor.value && targetEditor.value.trim().length > 0) {
      currentSelection = {
        text: targetEditor.value,
        start: 0,
        end: targetEditor.value.length,
      };
    } else {
      showToast('Vui lòng bôi chọn đoạn văn bản cần chỉnh sửa!', true);
      return;
    }
  }

  refineSelectionPreview.textContent = currentSelection.text;
  refineSelectionLength.textContent = `${currentSelection.text.length.toLocaleString()} ký tự`;
  refineModal.classList.remove('hidden');
  if (floatingRefineBtn) floatingRefineBtn.classList.add('hidden');
  refinePromptInput.focus();
}

function closeRefineModal() {
  refineModal.classList.add('hidden');
}

async function executeRefine() {
  const instruction = refinePromptInput.value.trim();
  if (!instruction) {
    showToast('Vui lòng nhập yêu cầu chỉnh sửa hoặc chọn gợi ý nhanh!', true);
    refinePromptInput.focus();
    return;
  }

  if (!currentSelection.text) {
    showToast('Không tìm thấy nội dung đã chọn!', true);
    return;
  }

  // Set loading state
  btnExecuteRefine.disabled = true;
  lblExecuteRefine.textContent = 'Đang sửa bằng AI...';
  btnExecuteRefine.classList.add('opacity-75', 'cursor-not-allowed');

  try {
    const fullContent = targetEditor.value;
    const contextBefore = fullContent.slice(Math.max(0, currentSelection.start - 400), currentSelection.start);
    const contextAfter = fullContent.slice(currentSelection.end, currentSelection.end + 400);

    const response = await fetch('/api/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedText: currentSelection.text,
        instruction,
        contextBefore,
        contextAfter,
        options: {
          sourceLang: selectSourceLang.value,
          targetLang: selectTargetLang.value,
          style: selectStyle.value,
        },
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Lỗi khi gọi API chỉnh sửa.');
    }

    const replacement = data.refinedText;

    // Apply replacement to editor content
    const beforeText = fullContent.substring(0, currentSelection.start);
    const afterText = fullContent.substring(currentSelection.end);
    const updatedFullText = beforeText + replacement + afterText;

    targetEditor.value = updatedFullText;
    currentTranslatedText = updatedFullText;

    // Update target stats & re-render preview/diff
    updateTargetStats(currentTranslatedText.length, 'Đã sửa bằng AI ✨');
    renderTargetMarkdown(currentTranslatedText, true);
    renderDiffView(sourceEditor.value, currentTranslatedText);

    closeRefineModal();
    setTargetViewMode('raw'); // Switch to raw editor to highlight the change
    targetEditor.focus();
    targetEditor.setSelectionRange(currentSelection.start, currentSelection.start + replacement.length);

    showToast('✨ Đã sửa đoạn chọn bằng AI thành công!');
  } catch (err) {
    showToast('Lỗi chỉnh sửa: ' + err.message, true);
  } finally {
    btnExecuteRefine.disabled = false;
    lblExecuteRefine.textContent = 'Áp dụng chỉnh sửa';
    btnExecuteRefine.classList.remove('opacity-75', 'cursor-not-allowed');
  }
}

async function handleFormatReview() {
  const content = targetEditor.value;
  if (!content || content.trim().length === 0) {
    showToast('Chưa có nội dung bản dịch để rà soát định dạng!', true);
    return;
  }

  btnReviewFormat.disabled = true;
  lblReviewFormat.textContent = 'Đang rà soát...';
  btnReviewFormat.classList.add('opacity-75', 'cursor-not-allowed');

  try {
    const res = await fetch('/api/review-format', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        options: {
          sourceLang: selectSourceLang.value,
          targetLang: selectTargetLang.value,
          style: selectStyle.value,
        },
        useAIAgent: true,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Lỗi khi gọi API rà soát định dạng.');
    }

    currentTranslatedText = data.formattedText;
    targetEditor.value = currentTranslatedText;
    updateTargetStats(currentTranslatedText.length, 'Đã chuẩn hóa định dạng ✨');
    renderTargetMarkdown(currentTranslatedText, true);
    renderDiffView(sourceEditor.value, currentTranslatedText);

    showToast(`✨ ${data.message || 'Đã chuẩn hóa và sửa lỗi định dạng thành công!'}`);
  } catch (err) {
    showToast('Lỗi rà soát định dạng: ' + err.message, true);
  } finally {
    btnReviewFormat.disabled = false;
    lblReviewFormat.textContent = 'Rà soát định dạng';
    btnReviewFormat.classList.remove('opacity-75', 'cursor-not-allowed');
  }
}

// -------------------------------------------------------------
// Background Jobs Management
// -------------------------------------------------------------

function setupJobsListeners() {
  // Toggle email recipient input
  if (chkEnableEmail) {
    chkEnableEmail.addEventListener('change', () => {
      if (chkEnableEmail.checked) {
        emailRecipientWrapper.classList.remove('hidden');
        inputRecipientEmail.focus();
      } else {
        emailRecipientWrapper.classList.add('hidden');
      }
    });
  }

  // Jobs Modal
  if (btnOpenJobsModal) btnOpenJobsModal.addEventListener('click', openJobsModal);
  if (btnCloseJobsModal) btnCloseJobsModal.addEventListener('click', closeJobsModal);
  if (btnCloseJobsModalFooter) btnCloseJobsModalFooter.addEventListener('click', closeJobsModal);
  if (btnRefreshJobs) btnRefreshJobs.addEventListener('click', loadJobsList);
}

async function refreshActiveJobsCount() {
  try {
    const res = await fetch('/api/jobs');
    if (!res.ok) return;
    const data = await res.json();
    const activeJobs = (data.jobs || []).filter((j) => j.status === 'running' || j.status === 'pending');
    if (activeJobs.length > 0) {
      activeJobsBadge.textContent = activeJobs.length;
      activeJobsBadge.classList.remove('hidden');
    } else {
      activeJobsBadge.classList.add('hidden');
    }
  } catch (_) {}
}

async function checkActiveJobOnLoad() {
  const savedJobId = localStorage.getItem('active_translation_job');
  if (!savedJobId) return;

  try {
    const res = await fetch(`/api/jobs/${savedJobId}`);
    if (!res.ok) {
      localStorage.removeItem('active_translation_job');
      return;
    }
    const data = await res.json();
    const job = data.job;
    if (!job) return;

    if (job.status === 'completed') {
      showToast(`🎉 Tiến trình "${job.filename}" đã hoàn thành trong nền! Bấm vào Tiến trình nền để nạp kết quả.`);
    } else if (job.status === 'running') {
      showToast(`⏳ Tiến trình "${job.filename}" đang tiếp tục chạy trên máy chủ.`);
    }
  } catch (_) {}
}

function openJobsModal() {
  const modal = jobsModal || document.getElementById('jobs-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  loadJobsList();
  if (jobsRefreshInterval) clearInterval(jobsRefreshInterval);
  jobsRefreshInterval = setInterval(loadJobsList, 4000);
}

function closeJobsModal() {
  const modal = jobsModal || document.getElementById('jobs-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
  if (jobsRefreshInterval) {
    clearInterval(jobsRefreshInterval);
    jobsRefreshInterval = null;
  }
}

// Expose globally for inline onclick fallback
window.openJobsModal = openJobsModal;
window.closeJobsModal = closeJobsModal;

// Document-level delegated click listener for maximum reliability
document.addEventListener('click', (e) => {
  const target = e.target;
  if (target && target.closest('#btn-open-jobs-modal')) {
    e.preventDefault();
    openJobsModal();
  } else if (target && (target.id === 'jobs-modal' || target.closest('#btn-close-jobs-modal') || target.closest('#btn-close-jobs-modal-footer'))) {
    closeJobsModal();
  }
});

async function loadJobsList() {
  jobsLoadingState.classList.remove('hidden');
  jobsEmptyState.classList.add('hidden');

  try {
    const res = await fetch('/api/jobs');
    const data = await res.json();
    const jobs = data.jobs || [];

    jobsLoadingState.classList.add('hidden');
    if (jobs.length === 0) {
      jobsEmptyState.classList.remove('hidden');
      jobsListContainer.innerHTML = '';
      return;
    }

    renderJobsList(jobs);
  } catch (err) {
    jobsLoadingState.classList.add('hidden');
    showToast('Lỗi khi tải danh sách tiến trình: ' + err.message, true);
  }
}

function renderJobsList(jobs) {
  jobsListContainer.innerHTML = '';

  jobs.forEach((job) => {
    const card = document.createElement('div');
    card.className = 'p-4 bg-slate-50 border border-slate-200 rounded-xl transition-all hover:border-slate-300 flex flex-col gap-3';

    let statusPill = '';
    if (job.status === 'running') {
      statusPill = `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 rounded-full animate-pulse">
        <i class="fa-solid fa-circle-notch fa-spin text-[10px]"></i> Đang chạy (${job.progress?.percent || 0}%)
      </span>`;
    } else if (job.status === 'completed') {
      statusPill = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-700 rounded-full">
        <i class="fa-solid fa-circle-check text-[10px]"></i> Hoàn tất (${(job.durationMs / 1000).toFixed(1)}s)
      </span>`;
    } else if (job.status === 'aborted') {
      statusPill = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700 rounded-full">
        <i class="fa-solid fa-stop text-[10px]"></i> Đã ngắt / Hủy
      </span>`;
    } else {
      statusPill = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold bg-red-100 text-red-700 rounded-full">
        <i class="fa-solid fa-circle-exclamation text-[10px]"></i> Lỗi
      </span>`;
    }

    const createdTime = new Date(job.createdAt).toLocaleTimeString();
    const emailInfo = job.recipientEmail
      ? `<span class="text-[11px] text-slate-500 flex items-center gap-1">
          <i class="fa-regular fa-envelope text-emerald-600"></i> ${job.recipientEmail} ${job.emailSent ? '✅ (Đã gửi mail)' : ''}
        </span>`
      : '';

    card.innerHTML = `
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2">
          <span class="font-bold text-xs text-slate-800">${escapeHtml(job.filename)}</span>
          <span class="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.2 rounded font-mono">${job.adapterName}</span>
          <span class="text-[11px] text-slate-400">&bull; ${createdTime}</span>
        </div>
        <div>${statusPill}</div>
      </div>

      <!-- Progress bar -->
      <div>
        <div class="flex items-center justify-between text-[11px] text-slate-500 mb-1">
          <span>${escapeHtml(job.progress?.message || 'Đang xử lý...')}</span>
          <span class="font-mono font-bold text-slate-700">${job.progress?.percent || 0}%</span>
        </div>
        <div class="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
          <div class="bg-blue-600 h-full rounded-full transition-all duration-300" style="width: ${job.progress?.percent || 0}%"></div>
        </div>
      </div>

      <!-- Footer action bar -->
      <div class="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/60 text-xs flex-wrap">
        <div>${emailInfo}</div>
        <div class="flex items-center gap-1.5 ml-auto">
          ${job.status === 'completed' ? `
            <button class="btn-load-job px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors" data-id="${job.id}">
              <i class="fa-solid fa-arrow-right-to-bracket mr-1"></i> Nạp vào Editor
            </button>
            <a href="/api/jobs/${job.id}/download" class="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors" target="_blank" download>
              <i class="fa-solid fa-download mr-1"></i> Tải file
            </a>
          ` : ''}
          ${job.status === 'running' || job.status === 'pending' ? `
            <button class="btn-abort-job px-2.5 py-1 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors" data-id="${job.id}">
              <i class="fa-solid fa-stop mr-1"></i> Hủy tiến trình
            </button>
          ` : ''}
          <button class="btn-delete-job text-slate-400 hover:text-red-600 p-1 rounded hover:bg-slate-200 transition-colors" data-id="${job.id}" title="Xóa tiến trình này">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;

    // Bind event actions
    const btnLoad = card.querySelector('.btn-load-job');
    if (btnLoad) {
      btnLoad.addEventListener('click', () => loadJobIntoEditor(job.id));
    }

    const btnAbort = card.querySelector('.btn-abort-job');
    if (btnAbort) {
      btnAbort.addEventListener('click', () => abortJob(job.id));
    }

    const btnDelete = card.querySelector('.btn-delete-job');
    if (btnDelete) {
      btnDelete.addEventListener('click', () => deleteJob(job.id));
    }

    jobsListContainer.appendChild(card);
  });
}

async function abortJob(jobId) {
  if (!confirm('Bạn có chắc chắn muốn ngắt và hủy tiến trình dịch này?')) return;

  try {
    const res = await fetch(`/api/jobs/${jobId}/abort`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Đã hủy tiến trình thành công!');
      loadJobsList();
      refreshActiveJobsCount();
    } else {
      showToast(data.message || 'Không thể hủy tiến trình', true);
    }
  } catch (err) {
    showToast('Lỗi khi hủy tiến trình: ' + err.message, true);
  }
}

async function deleteJob(jobId) {
  try {
    const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Đã xóa tiến trình khỏi danh sách');
      loadJobsList();
      refreshActiveJobsCount();
    }
  } catch (err) {
    showToast('Lỗi khi xóa tiến trình: ' + err.message, true);
  }
}

async function loadJobIntoEditor(jobId) {
  try {
    const res = await fetch(`/api/jobs/${jobId}`);
    const data = await res.json();
    const job = data.job;

    if (!job || !job.translatedContent) {
      showToast('Tiến trình chưa có kết quả để nạp!', true);
      return;
    }

    sourceEditor.value = job.rawContent;
    currentSourceFilename = job.filename;
    currentTranslatedText = stripThinkingTags(job.translatedContent);
    targetEditor.value = currentTranslatedText;

    updateSourceStats();
    updateTargetStats(currentTranslatedText.length, `Nạp từ Tiến trình nền (${(job.durationMs / 1000).toFixed(1)}s)`);
    renderTargetMarkdown(currentTranslatedText, true);
    renderDiffView(sourceEditor.value, currentTranslatedText);

    closeJobsModal();
    showToast(`✅ Đã nạp thành công bản dịch của "${job.filename}"!`);
  } catch (err) {
    showToast('Lỗi khi nạp bản dịch: ' + err.message, true);
  }
}

