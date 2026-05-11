// --- GLOBAL STATE ---
const state = {
    mediaPool: {}, // { id: { file, url, videoElement, name, duration } }
    clips: [],     // { id, mediaId, trackId, startTimeline, endTimeline, offsetSource }
    tracks: [],    // { id, name }
    playheadTime: 0,
    isPlaying: false,
    pixelsPerSecond: 20,
    selectedClipId: null,
    selectedClipIds: [] // For transitions between 2 clips
};

const APP_VERSION = "v1.4.1";

let device, pipeline, sampler, context, presentationFormat;
let isDraggingPlayhead = false;
let currentTransitionDetail = null; // null = list view, string = transition type ('crossfade' | 'mask')


// Effects state per clip (clipId -> { fadeIn, fadeOut })
const clipEffects = {};
// Transitions state (clip_combination_id -> { crossfadeDuration })
const clipTransitions = {};

// Active effects panel: 'effects' | 'transition' | null
let activeEffectsPanel = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initUI();
    initResizers();
    initWebGPU();
    updateAppVersion();
    initSampleVideos();
});

function updateAppVersion() {
    const el = document.getElementById('app-version');
    if (el) el.textContent = APP_VERSION;
}

async function initSampleVideos() {
    console.log("Loading samples (videos + audio)...");
    const v1 = await importVideoFromUrl("Sample Video 1", "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4", "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=160&h=90&fit=crop");
    const v2 = await importVideoFromUrl("Sample Video 2", "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4", "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?w=160&h=90&fit=crop");

    // Caricamento audio locale dalla cartella AUDIO
    const a1 = await importVideoFromUrl("Sample Audio", "AUDIO/Aetheric - Sacred Connection (freetouse.com).mp3", "https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?w=160&h=90&fit=crop");

    if (v1) {
        addClipToTimeline(v1.id, 0);
    }
    if (v2) {
        addClipToTimeline(v2.id, 6); // Offset by 6s
    }
    if (a1) {
        // Find or create an Audio track
        let aTrack = state.tracks.find(t => t.mode === 'audio');
        if (!aTrack) {
            addTrack(); // Creates V2 (or next video track)
            const newTrack = state.tracks[state.tracks.length - 1];
            // Simulate click to toggle to Audio
            const header = document.querySelector(`.track-header[data-track-id="${newTrack.id}"]`);
            if (header) {
                const trackNameEl = header.querySelector('.track-name');
                if (trackNameEl) trackNameEl.click();
            }
            aTrack = newTrack;
        }
        addClipToTimeline(a1.id, 0, aTrack.id);
    }

    renderMediaPool();
    renderTimeline();
}

// --- RESIZERS LOGIC ---
function initResizers() {
    const resizerLeft = document.getElementById('resizer-left');
    const resizerRight = document.getElementById('resizer-right');
    const resizerTimeline = document.getElementById('resizer-timeline');

    const leftPanel = document.getElementById('left-panel');
    const rightPanel = document.getElementById('right-panel');
    const timelineArea = document.getElementById('timeline-area');
    const workspace = document.querySelector('.workspace');

    if (resizerLeft && leftPanel) {
        let isResizing = false;
        resizerLeft.addEventListener('mousedown', () => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            resizerLeft.classList.add('dragging');
        });
        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = Math.max(200, Math.min(e.clientX, window.innerWidth - 600));
            leftPanel.style.width = newWidth + 'px';
            leftPanel.style.flexShrink = '0';
        });
        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                resizerLeft.classList.remove('dragging');
            }
        });
    }

    if (resizerRight && rightPanel) {
        let isResizing = false;
        resizerRight.addEventListener('mousedown', () => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            resizerRight.classList.add('dragging');
        });
        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            // right panel width = window.innerWidth - e.clientX
            const newWidth = Math.max(200, Math.min(window.innerWidth - e.clientX, window.innerWidth - 600));
            rightPanel.style.width = newWidth + 'px';
            rightPanel.style.flexShrink = '0';
        });
        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                resizerRight.classList.remove('dragging');
            }
        });
    }

    if (resizerTimeline && timelineArea && workspace) {
        let isResizing = false;
        let startY, startHeight;
        resizerTimeline.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'row-resize';
            resizerTimeline.classList.add('dragging');
            startY = e.clientY;
            startHeight = timelineArea.getBoundingClientRect().height;
        });
        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const dy = startY - e.clientY;
            const newHeight = Math.max(150, Math.min(startHeight + dy, window.innerHeight - 200));
            timelineArea.style.height = newHeight + 'px';
            timelineArea.style.flexShrink = '0';
        });
        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                resizerTimeline.classList.remove('dragging');
            }
        });
    }
}

function initUI() {
    // Left sidebar tool tabs
    const toolTabs = document.querySelectorAll('.tool-tabs .tab');
    toolTabs.forEach(tab => tab.addEventListener('click', async () => {
        toolTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const tabType = tab.dataset.leftTab;
        const grid = document.getElementById('media-grid');
        if (!grid) return;

        grid.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:20px;width:100%;">Caricamento...</div>';
        const subNav = document.querySelector('.sidebar-sub .sub-nav');

        if (tabType === 'import') {
            if (subNav) subNav.innerHTML = '<li class="active">Device Import</li>';
            renderMediaPool();
            const btnImport = document.getElementById('btn-import');
            if (btnImport) btnImport.style.display = 'flex';
            const actionTitle = document.getElementById('grid-source-title');
            if (actionTitle) actionTitle.style.display = 'none';
        } else if (tabType === 'video' || tabType === 'images') {
            const isVideo = tabType === 'video';
            if (subNav) subNav.innerHTML = `<li class="active">Pixabay Stock</li>`;
            const btnImport = document.getElementById('btn-import');
            if (btnImport) btnImport.style.display = 'none';
            const actionTitle = document.getElementById('grid-source-title');
            if (actionTitle) {
                actionTitle.style.display = 'block';
                actionTitle.innerHTML = `<span>${isVideo ? 'Videos' : 'Images'} by</span> <span>Pixabay</span>`;
            }

            const renderStock = async (query = 'nature') => {
                const apiKey = localStorage.getItem('pixabay_api_key');
                if (!apiKey) {
                    grid.innerHTML = `
                        <div style="padding:20px; text-align:center; display:flex; flex-direction:column; gap:10px;">
                            <p style="color:var(--text-muted);font-size:12px;">Inserisci la tua API Key di Pixabay per usufruire dei file multimediali gratuiti.</p>
                            <input type="text" id="pixabay-key-input" placeholder="Pixabay API Key..." style="padding:8px; border-radius:4px; border:1px solid #333; background:#111; color:#fff; font-size:12px;" />
                            <button id="save-pixabay-key" class="btn btn-primary" style="justify-content:center;">Salva e Cerca</button>
                        </div>
                    `;
                    document.getElementById('save-pixabay-key').addEventListener('click', () => {
                        const val = document.getElementById('pixabay-key-input').value.trim();
                        if (val) {
                            localStorage.setItem('pixabay_api_key', val);
                            renderStock(query);
                        }
                    });
                    return;
                }

                grid.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:20px;width:100%;text-align:center;">Ricerca in corso...</div>';

                try {
                    const endpoint = isVideo
                        ? `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=12`
                        : `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=12&image_type=photo`;

                    const res = await fetch(endpoint);
                    if (!res.ok) throw new Error("API Key non valida o errore di rete");
                    const data = await res.json();

                    const list = data.hits.map(h => ({
                        name: `${isVideo ? 'Video' : 'Img'}_${h.id}`,
                        url: isVideo ? h.videos.tiny.url : h.largeImageURL,
                        thumb: isVideo ? `https://i.vimeocdn.com/video/${h.picture_id}_295x166.jpg` : h.webformatURL,
                        duration: isVideo ? h.duration : 0
                    }));

                    if (list.length === 0) {
                        grid.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:20px;text-align:center;">Nessun risultato trovato.</div>';
                        return;
                    }

                    // Preload to mediapool if not exist
                    for (const item of list) {
                        if (!Object.values(state.mediaPool).find(m => m.url === item.url)) {
                            // If it's an image, create a mock video object with duration 5s for the timeline
                            if (!isVideo) {
                                const id = 'media_' + Date.now() + Math.random().toString(36).substr(2, 5);
                                state.mediaPool[id] = {
                                    id, file: null, url: item.url, videoElement: null,
                                    name: item.name,
                                    duration: 5.0, // Default duration for images on timeline
                                    thumbnailUrl: item.thumb,
                                    sourceType: 'stock',
                                    isImage: true
                                };
                            } else {
                                await importVideoFromUrl(item.name, item.url, item.thumb);
                            }
                        }
                    }

                    // Render the stock list
                    grid.innerHTML = '';
                    list.forEach(item => {
                        const media = Object.values(state.mediaPool).find(m => m.url === item.url);
                        if (!media) return;

                        const el = document.createElement('div');
                        el.className = 'media-item';
                        el.draggable = true;
                        el.innerHTML = `
                            <div class="media-item-thumb">
                                <img src="${media.thumbnailUrl}" alt="${media.name}">
                                ${isVideo ? `<span class="duration">${formatTime(media.duration).slice(3, 8)}</span>` : ''}
                            </div>
                            <div class="item-name">${media.name}</div>
                        `;
                        el.addEventListener('dragstart', e => {
                            e.dataTransfer.setData('text/plain', media.id);
                            e.dataTransfer.effectAllowed = 'copy';
                        });
                        grid.appendChild(el);
                    });
                } catch (e) {
                    grid.innerHTML = `<div style="color:var(--accent);font-size:12px;padding:20px;text-align:center;">Errore: ${e.message}</div>
                    <button id="reset-api-key" class="btn btn-secondary" style="margin:0 auto;">Reset API Key</button>`;
                    const resetBtn = document.getElementById('reset-api-key');
                    if (resetBtn) resetBtn.addEventListener('click', () => {
                        localStorage.removeItem('pixabay_api_key');
                        renderStock(query);
                    });
                }
            };

            renderStock();

            // Setup search listener for this tab
            const searchInput = document.querySelector('.search-bar input');
            if (searchInput) {
                // Remove old event listeners by replacing the text input element
                const newSearchInput = searchInput.cloneNode(true);
                searchInput.parentNode.replaceChild(newSearchInput, searchInput);

                newSearchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        renderStock(newSearchInput.value.trim() || 'beautiful');
                    }
                });
            }
        }
    }));

    // Accordions & Toggles
    const toggles = document.querySelectorAll('.toggle');
    toggles.forEach(toggle => toggle.addEventListener('click', () => toggle.classList.toggle('active')));

    const accordionHeaders = document.querySelectorAll('.toggle-section');
    accordionHeaders.forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.classList.contains('reset-icon') || e.target.closest('.pro-badge')) return;
            const section = header.parentElement;
            section.classList.toggle('expanded');
            const chevron = header.querySelector('.fa-chevron-up, .fa-chevron-down');
            if (chevron) {
                chevron.classList.replace('fa-chevron-down', 'fa-chevron-up') || chevron.classList.replace('fa-chevron-up', 'fa-chevron-down');
            }
        });
    });

    // Unselect clicking on empty track
    const tracksContainer = document.querySelector('.timeline-tracks');

    // Zoom on wheel over the timeline
    const timelineContainer = document.querySelector('.timeline-container');
    if (timelineContainer) {
        timelineContainer.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.altKey || !e.shiftKey) {
                e.preventDefault();
                let delta = e.deltaY > 0 ? -4 : 4;
                state.pixelsPerSecond = Math.max(5, Math.min(300, state.pixelsPerSecond + delta));
                const zoomSlider = document.querySelector('.zoom-slider .slider');
                if (zoomSlider) zoomSlider.value = state.pixelsPerSecond;
                renderTimeline();
                updatePlayheadUI();
            }
        }, { passive: false });
    }

    tracksContainer.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.clip') && !e.target.closest('.playhead-top')) {
            selectClip(null);
        }
    });

    // Playhead drag
    const playhead = document.querySelector('.playhead');
    const playheadTop = document.querySelector('.playhead-top');

    // isDraggingPlayhead is declared globally above

    playheadTop.addEventListener('mousedown', (e) => {
        isDraggingPlayhead = true;
        playheadTop.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
        if (isDraggingPlayhead) {
            updatePlayheadPositionFromMouse(e.clientX);
        } else if (draggedClipInfo) {
            handleClipDrag(e);
        }
    });

    tracksContainer.addEventListener('click', (e) => {
        if (e.target.closest('.clip') || e.target.closest('.playhead')) return;
        // Salto playhead al click sulla timeline ruler
        if (e.pageY < tracksContainer.getBoundingClientRect().top + 24) {
            updatePlayheadPositionFromMouse(e.clientX);
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDraggingPlayhead) {
            isDraggingPlayhead = false;
            playheadTop.style.cursor = 'grab';
        }
        if (draggedClipInfo) {
            endClipDrag();
        }
    });

    // DEL / Backspace → delete selected clip
    document.addEventListener('keydown', (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && e.target.tagName !== 'INPUT') {
            deleteSelectedClip();
        }
    });

    // --- IMPORT LOGIC ---
    // Try by ID first, then fall back to existing .btn-import in DOM (assign ID to avoid duplicates)
    let btnImport = document.getElementById('btn-import');
    if (!btnImport) {
        btnImport = document.querySelector('button.btn-import, .btn-import');
        if (btnImport) {
            btnImport.id = 'btn-import'; // assign ID to existing element
        } else {
            btnImport = document.createElement('button');
            btnImport.id = 'btn-import';
            btnImport.className = 'btn-import';
            btnImport.innerHTML = '<i class="fa-solid fa-plus"></i> Import';
            const actionsBar = document.querySelector('.actions-bar');
            if (actionsBar) actionsBar.prepend(btnImport);
        }
    }

    let fileInput = document.getElementById('import-file');
    if (!fileInput) {
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'import-file';
        fileInput.accept = 'video/*,audio/*';
        fileInput.multiple = true;
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
    }

    btnImport.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        for (let file of files) {
            await importMedia(file);
        }
        fileInput.value = ''; // Reset
    });

    // --- MULTI-TRACK SETUP ---
    // Clear static HTML tracks and build from state
    const lagPreview = document.querySelector('.lag-preview');
    if (lagPreview) lagPreview.remove();
    const textTrack = document.querySelector('.track.text-track');
    if (textTrack) textTrack.remove();
    // Clean out any old static video-track divs
    document.querySelectorAll('.timeline-tracks .track.video-track').forEach(t => t.remove());
    // Remove old static track headers (keep only the ruler-header row)
    const headersContainer = document.querySelector('.timeline-headers');
    if (headersContainer) headersContainer.innerHTML = '';

    // Reset playhead
    const playheadEl = document.querySelector('.playhead');
    if (playheadEl) playheadEl.style.left = '0px';

    // Add first default track
    addTrack();

    // Ensure media-grid has correct id
    if (!document.getElementById('media-grid')) {
        const grid = document.querySelector('.media-grid');
        if (grid) grid.id = 'media-grid';
    }

    // Ensure webgpu-canvas exists (Look inside .viewport-content)
    if (!document.getElementById('webgpu-canvas')) {
        const viewportContent = document.querySelector('.viewport-content');
        if (viewportContent) {
            const canvas = document.createElement('canvas');
            canvas.id = 'webgpu-canvas';
            canvas.className = 'preview-img';
            canvas.style.cssText = 'width:100%;height:100%;object-fit:contain;background:transparent;position:absolute;inset:0;';
            // Replace first child img if present
            const existingImg = viewportContent.querySelector('img.preview-img');
            if (existingImg) existingImg.replaceWith(canvas);
            else viewportContent.prepend(canvas);
        }
    }

    // --- ZOOM LOGIC (Preview Canvas) ---
    // User requested zoom on mouse wheel over the preview player
    const previewContainer = document.querySelector('.player-preview');
    let previewScale = 1.0;
    if (previewContainer) {
        previewContainer.addEventListener('wheel', (e) => {
            e.preventDefault();
            // Zoom speed
            const zoomSpeed = 0.1;
            const dir = Math.sign(e.deltaY) * -1; // scroll up = zoom in
            previewScale += dir * zoomSpeed;
            previewScale = Math.max(0.1, Math.min(previewScale, 10.0)); // Clamp between 0.1x and 10x

            const viewportContent = document.querySelector('.viewport-content');
            if (viewportContent) {
                viewportContent.style.transform = `scale(${previewScale})`;
                viewportContent.style.transformOrigin = 'center center';
                viewportContent.style.transition = 'transform 0.1s ease-out';
            }
        });
    }

    // --- AUDIO TAB UI LOGIC ---
    const audioTab = document.getElementById('tab-audio');
    if (audioTab) {
        const volSlider = audioTab.querySelector('.slider');
        const volBox = audioTab.querySelector('.value-box');
        const muteToggle = audioTab.querySelector('.toggle');

        const updateAudioState = () => {
            if (!state.selectedClipId) return;
            const isMuted = muteToggle.classList.contains('active');
            clipEffects[state.selectedClipId] = clipEffects[state.selectedClipId] || {};
            clipEffects[state.selectedClipId]['audio_cfg'] = {
                level: parseInt(volSlider.value, 10),
                mute: isMuted
            };
            syncVideoToPlayhead(); // Apply immediately
        };

        if (volSlider) {
            volSlider.addEventListener('input', (e) => {
                if (volBox) volBox.innerHTML = `${e.target.value}% <div><i class="fa-solid fa-sort"></i></div>`;
                updateAudioState();
            });
        }
        if (muteToggle) {
            muteToggle.addEventListener('click', () => {
                muteToggle.classList.toggle('active');
                updateAudioState();
            });
        }
    }

    // --- TOOLBAR LOGIC ---
    let btnPlay = document.getElementById('btn-play');
    if (!btnPlay) {
        btnPlay = document.querySelector('.play-actions');
        if (btnPlay) btnPlay.id = 'btn-play';
    }
    if (btnPlay) btnPlay.addEventListener('click', togglePlay);
    const btnFullscreen = document.getElementById('btn-fullscreen');
    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
            // Reset preview zoom to 1.0 (Fit)
            previewScale = 1.0;
            const viewportContent = document.querySelector('.viewport-content');
            if (viewportContent) {
                viewportContent.style.transform = `scale(${previewScale})`;
                viewportContent.style.transition = 'transform 0.3s ease-out';
            }
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
            e.preventDefault();
            togglePlay();
        }
    });

    let btnCut = document.getElementById('btn-cut');
    if (!btnCut) {
        btnCut = document.querySelector('.fa-scissors');
        if (btnCut) btnCut.id = 'btn-cut';
    }
    if (btnCut) btnCut.addEventListener('click', cutSelectedClip);

    let btnDelete = document.getElementById('btn-delete');
    if (!btnDelete) {
        btnDelete = document.querySelector('.fa-eraser, .fa-trash');
        if (btnDelete) btnDelete.id = 'btn-delete';
    }
    if (btnDelete) btnDelete.addEventListener('click', deleteSelectedClip);

    // --- ZOOM SLIDER ---
    const zoomSlider = document.querySelector('.zoom-slider input[type="range"]');
    if (zoomSlider) {
        // Map slider 0-100 to pixelsPerSecond range 5-100
        zoomSlider.min = 0;
        zoomSlider.max = 100;
        zoomSlider.value = 20; // default matching state.pixelsPerSecond = 20
        zoomSlider.addEventListener('input', () => {
            state.pixelsPerSecond = 5 + (zoomSlider.value / 100) * 95;
            updateRuler();
            renderTimeline();
            updatePlayheadUI();
        });
    }

    // --- TIMING LOOP (UI Update) ---
    updateRuler(); // Build ruler on startup
    initRightPanelTabs();
    initEffectsToolbar();
    requestAnimationFrame(updateLoop);
}

// --- RIGHT PANEL TAB SYSTEM ---
function initRightPanelTabs() {
    const tabs = document.querySelectorAll('#right-tabs .tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.classList.contains('tab-disabled')) return; // block disabled tabs
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const target = document.getElementById('tab-' + tab.dataset.tab);
            if (target) target.classList.add('active');
            if (tab.dataset.tab === 'effects') renderEffectsTab();
            if (tab.dataset.tab === 'transitions') renderTransitionsTab();
        });
    });
    updateTransitionsTabState();
}

// Enable/disable the Transizioni tab based on how many tracked clips are selected
function updateTransitionsTabState() {
    const btn = document.getElementById('tab-btn-transitions');
    if (!btn) return;
    const hasTwoSelected = state.selectedClipIds.length === 2;
    btn.classList.toggle('tab-disabled', !hasTwoSelected);
    btn.title = hasTwoSelected ? 'Transizioni tra le clip selezionate' : 'Seleziona esattamente 2 clip (con Ctrl/Cmd) per abilitare le transizioni';
}

// Renders the Transizioni tab content
function renderTransitionsTab() {
    const container = document.getElementById('tab-transitions');
    if (!container) return;

    const hasTwoSelected = state.selectedClipIds.length === 2;
    if (!hasTwoSelected) {
        currentTransitionDetail = null;
        container.innerHTML = `
            <div class="efx-header">
                <i class="fa-solid fa-right-left"></i>
                <span>Transizioni tra Clip</span>
            </div>
            <div class="efx-no-clip">
                <i class="fa-solid fa-check-double"></i>
                <span>Seleziona esattamente 2 clip nella timeline tenendo premuto Ctrl o Cmd.</span>
            </div>`;
        return;
    }

    let trKey = [...state.selectedClipIds].sort().join('||');
    let tr = clipTransitions[trKey] || {};

    // If we're in list view
    if (currentTransitionDetail === null) {
        let t1Name = '', t2Name = '';
        const c1 = state.clips.find(c => c.id === state.selectedClipIds[0]);
        const c2 = state.clips.find(c => c.id === state.selectedClipIds[1]);
        if (c1) t1Name = state.mediaPool[c1.mediaId].name;
        if (c2) t2Name = state.mediaPool[c2.mediaId].name;

        // Ensure default transition type is known if saved
        const activeType = tr.transitionType || (tr.crossfade ? 'crossfade' : null);

        container.innerHTML = `
            <div class="efx-header">
                <i class="fa-solid fa-right-left"></i>
                <span>Transizioni</span>
            </div>
            <div class="efx-applied-title">Tra le clip<br><span style="font-size:10px;font-weight:normal;opacity:0.8">${t1Name} <i class="fa-solid fa-arrow-right-arrow-left" style="font-size:10px;margin:0 4px;"></i> ${t2Name}</span></div>
            <div class="trans-list">
                <div class="trans-item" data-type="crossfade" style="${activeType === 'crossfade' ? 'border-color: var(--accent); background: rgba(32, 233, 218, 0.05);' : ''}">
                    <i class="fa-solid fa-sliders"></i>
                    <div class="trans-item-info">
                        <strong>Cross Fade</strong>
                        <span>Dissolvenza incrociata morbida</span>
                    </div>
                </div>
                <div class="trans-item" data-type="mask" style="${activeType === 'mask' ? 'border-color: var(--accent); background: rgba(32, 233, 218, 0.05);' : ''}">
                    <i class="fa-solid fa-circle-half-stroke"></i>
                    <div class="trans-item-info">
                        <strong>Maschera Luma</strong>
                        <span>Usa un video B&N come forma</span>
                    </div>
                </div>
            </div>
        `;

        container.querySelectorAll('.trans-item').forEach(item => {
            item.addEventListener('click', () => {
                currentTransitionDetail = item.dataset.type;
                if (!clipTransitions[trKey]) clipTransitions[trKey] = { crossfade: true, crossfadeDur: 0.5 };
                clipTransitions[trKey].transitionType = currentTransitionDetail;
                renderTransitionsTab();
            });
        });
        return;
    }

    // DETAIL VIEW
    const isTransActive = tr.crossfade === true;
    const transType = currentTransitionDetail;

    container.innerHTML = `
        <div class="efx-header">
            <div class="efx-back-btn"><i class="fa-solid fa-chevron-left"></i></div>
            <span>${transType === 'crossfade' ? 'Cross Fade' : 'Maschera Luma'}</span>
            <label class="efx-toggle-label" style="margin-left:auto;">
                <input type="checkbox" id="tr-main-toggle" ${isTransActive ? 'checked' : ''}>
                <span>${isTransActive ? 'ON' : 'OFF'}</span>
            </label>
        </div>
        <div style="padding:0 12px 16px;">

            ${transType === 'crossfade' ? `
            <div class="efx-param-section">
                <div class="efx-param-row">
                    <label>Durata (s)</label>
                    <input type="range" id="tr-xfade-dur" min="0.1" max="4" step="0.1" value="${tr && tr.crossfadeDur ? tr.crossfadeDur : 0.5}">
                    <span class="efx-val-display" id="tr-dur-val">${tr && tr.crossfadeDur ? tr.crossfadeDur.toFixed(1) : '0.5'}s</span>
                </div>
                <div class="efx-param-row">
                    <label>Curva</label>
                    <select id="tr-xfade-type">
                        <option value="linear" ${!tr || tr.crossfadeType === 'linear' ? 'selected' : ''}>Lineare</option>
                        <option value="smooth" ${tr && tr.crossfadeType === 'smooth' ? 'selected' : ''}>Smooth S-Curve</option>
                    </select>
                </div>
            </div>
            ` : ''}

            ${transType === 'mask' ? `
            <div class="efx-param-section">
                <p style="font-size:11px;color:var(--text-muted);line-height:1.5;margin-bottom:12px;">Importa un video <b>Bianco e Nero</b>. Man mano che scorre:<br>⚪ Bianco = Video A &nbsp;|&nbsp; ⚫ Nero = Video B</p>
                <button class="tr-mask-import-btn" id="tr-mask-import"><i class="fa-solid fa-file-video"></i> ${tr && tr.maskVideoEl ? '✅ Sostituisci Maschera' : 'Importa Maschera'}</button>
                ${tr && tr.maskVideoEl ? `
                <div style="margin-top:10px;font-size:11px;color:var(--accent);"><i class="fa-solid fa-check-circle"></i> ${tr.maskVideoEl._name || 'mask.mp4'}</div>
                ` : ''}
            </div>
            ` : ''}

            <p style="font-size:10px;color:var(--text-muted);margin-top:10px;line-height:1.4;">
                La transizione si innesca quando le due clip si sovrappongono sulla timeline.
            </p>
        </div>
    `;

    // Back button
    const backBtn = container.querySelector('.efx-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            currentTransitionDetail = null;
            renderTransitionsTab();
        });
    }

    const save = () => {
        if (!clipTransitions[trKey]) clipTransitions[trKey] = { transitionType: currentTransitionDetail };
        const mainToggle = container.querySelector('#tr-main-toggle');
        const xfadeDur = container.querySelector('#tr-xfade-dur');
        const xfadeType = container.querySelector('#tr-xfade-type');
        const durVal = container.querySelector('#tr-dur-val');

        if (mainToggle) clipTransitions[trKey].crossfade = mainToggle.checked;
        if (xfadeDur) {
            clipTransitions[trKey].crossfadeDur = parseFloat(xfadeDur.value);
            if (durVal) durVal.textContent = parseFloat(xfadeDur.value).toFixed(1) + 's';
        }
        if (xfadeType) clipTransitions[trKey].crossfadeType = xfadeType.value;
    };

    const saveInputs = ['#tr-main-toggle', '#tr-xfade-type'];
    saveInputs.forEach(sel => {
        const el = container.querySelector(sel);
        if (el) el.addEventListener('change', (e) => { save(); e.target.blur(); });
    });
    const durInput = container.querySelector('#tr-xfade-dur');
    if (durInput) durInput.addEventListener('input', save);

    // Mask import button
    const maskImportBtn = container.querySelector('#tr-mask-import');
    if (maskImportBtn) {
        maskImportBtn.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'video/*';
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const url = URL.createObjectURL(file);
                const vid = document.createElement('video');
                vid.src = url;
                vid.crossOrigin = 'anonymous';
                vid.loop = false;
                vid.muted = true;
                vid._name = file.name;

                // CRITICAL FIX: WebGPU needs readyState >= 2 (HAVE_CURRENT_DATA) 
                // We must actively load and play a tiny bit to get the first frame decoded into GPU memory
                vid.addEventListener('canplay', () => {
                    if (!clipTransitions[trKey]) clipTransitions[trKey] = {};
                    clipTransitions[trKey].maskVideoEl = vid;
                    clipTransitions[trKey].transitionType = 'mask';
                    clipTransitions[trKey].crossfade = true;
                    // Force a tiny play/pause to ensure GPU decode buffer is filled for WebGPU
                    vid.play().then(() => { vid.pause(); vid.currentTime = 0; }).catch(() => { });
                    renderTransitionsTab(); // re-render after load
                }, { once: true });

                vid.load();
            };
            fileInput.click();
        });
    }
}


// Open Effetti tab programmatically (e.g. from toolbar button)
// type: 'effects' | 'transition'
function openEffectsTab(type = 'effects') {
    const tabName = type === 'transition' ? 'transitions' : 'effects';
    const rightTabs = document.querySelectorAll('#right-tabs .tab');
    const contents = document.querySelectorAll('.tab-content');
    const targetTab = document.querySelector(`#right-tabs .tab[data-tab="${tabName}"]`);
    const targetContent = document.getElementById('tab-' + tabName);

    if (!targetTab || !targetContent) return;
    if (targetTab.classList.contains('tab-disabled')) return; // Transizioni: blocked if not unlocked

    rightTabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));
    targetTab.classList.add('active');
    targetContent.classList.add('active');
    currentEffectDetail = null;
    currentTransitionDetail = null;
    if (tabName === 'effects') renderEffectsTab();
    if (tabName === 'transitions') renderTransitionsTab();
}

// --- EFFECTS TOOLBAR BUTTONS (timeline toolbar) ---
function initEffectsToolbar() {
    const toolsLeft = document.querySelector('.tools-left');
    if (!toolsLeft) return;
    toolsLeft.querySelectorAll('.fx-btn').forEach(b => b.remove());

    const divider = document.createElement('div');
    divider.className = 'divider fx-btn';
    toolsLeft.appendChild(divider);

    const btnFx = document.createElement('button');
    btnFx.className = 'fx-btn';
    btnFx.title = 'Effetti sulla traccia';
    btnFx.innerHTML = '<i class="fa-solid fa-sliders"></i> Effetti';
    btnFx.addEventListener('click', () => openEffectsTab('effects'));
    toolsLeft.appendChild(btnFx);

    const btnTrans = document.createElement('button');
    btnTrans.className = 'fx-btn';
    btnTrans.title = 'Transizioni tra clip';
    btnTrans.innerHTML = '<i class="fa-solid fa-right-left"></i> Transizioni';
    btnTrans.addEventListener('click', () => openEffectsTab('transition'));
    toolsLeft.appendChild(btnTrans);
}

// --- EFFECTS CATALOGUE ---
const EFFECTS_CATALOGUE = [
    {
        id: 'fadein',
        name: 'Fade In',
        icon: 'fa-sun',
        description: 'Dissolvenza in apertura',
        defaults: { duration: 1.0, curve: 'linear' }
    },
    {
        id: 'fadeout',
        name: 'Fade Out',
        icon: 'fa-moon',
        description: 'Dissolvenza in chiusura',
        defaults: { duration: 1.0, curve: 'linear' }
    },
    {
        id: 'glitch',
        name: 'Glitch',
        icon: 'fa-bolt',
        description: 'Bordi glitch animati con separazione RGB',
        defaults: { enabled: true, intensity: 70, speed: 5, borderWidth: 6, colorSep: 4, rows: 30 },
        customDetail: true
    },
    {
        id: 'color_wheels',
        name: 'Ruote Colori',
        icon: 'fa-palette',
        description: 'Color Grading Primario (Lift, Gamma, Gain)',
        customDetail: true,
        defaults: {
            enabled: true,
            liftR: 0, liftG: 0, liftB: 0,
            gammaR: 0, gammaG: 0, gammaB: 0,
            gainR: 1, gainG: 1, gainB: 1,
            offsetR: 0, offsetG: 0, offsetB: 0,
            temp: 0, tint: 0, contrast: 1, sat: 1, hue: 0
        }
    },
    {
        id: 'hsl_curves',
        name: 'Regolazioni di base (HSL)',
        icon: 'fa-eye-dropper',
        description: 'Qualificatore HSL e curve di colore',
        customDetail: true,
        defaults: {
            enabled: true,
            hMin: 0, hMax: 1, hSoft: 0.1,
            sMin: 0, sMax: 1, sSoft: 0.1,
            lMin: 0, lMax: 1, lSoft: 0.1,
            hueShift: 0, satShift: 1, lumShift: 1
        }
    }
];

let currentEffectDetail = null; // id of currently viewed effect in detail view

// Renders the entire Effetti tab content
function renderEffectsTab() {
    const container = document.getElementById('tab-effects');
    if (!container) return;

    if (currentEffectDetail) {
        renderEffectDetail(container, currentEffectDetail);
    } else {
        renderEffectsList(container);
    }
}

// LIST VIEW: catalogue of available effects
function renderEffectsList(container) {
    const clip = state.clips.find(c => c.id === state.selectedClipId);
    const fx = clip ? (clipEffects[state.selectedClipId] || {}) : null;

    container.innerHTML = `
        <div class="efx-header">
            <i class="fa-solid fa-sliders"></i>
            <span>Effetti sulla Clip</span>
        </div>
        ${!clip ? `<div class="efx-no-clip"><i class="fa-solid fa-arrow-pointer"></i><span>Seleziona una clip nella timeline per aggiungere effetti.</span></div>` : ''}
        ${clip ? `
        <div class="efx-applied-title">Effetti disponibili</div>
        <div class="efx-list">
            ${EFFECTS_CATALOGUE.map(eff => {
        const isActive = fx && fx[eff.id] && fx[eff.id].enabled;
        return `
                <div class="efx-item ${isActive ? 'efx-active' : ''}" data-eff="${eff.id}">
                    <div class="efx-item-icon"><i class="fa-solid ${eff.icon}"></i></div>
                    <div class="efx-item-info">
                        <div class="efx-item-name">${eff.name}</div>
                        <div class="efx-item-desc">${eff.description}</div>
                    </div>
                    <div class="efx-item-status">
                        ${isActive ? '<span class="efx-badge-on">ON</span>' : '<i class="fa-solid fa-chevron-right"></i>'}
                    </div>
                </div>`;
    }).join('')}
        </div>` : ''}
    `;

    if (clip) {
        container.querySelectorAll('.efx-item').forEach(item => {
            item.addEventListener('click', () => {
                currentEffectDetail = item.dataset.eff;
                renderEffectsTab();
            });
        });
    }
}

// DETAIL VIEW: parameters for a specific effect
function renderEffectDetail(container, effectId) {
    const eff = EFFECTS_CATALOGUE.find(e => e.id === effectId);
    if (!eff) return;

    // Use custom detail for glitch
    if (eff.customDetail) {
        if (effectId === 'glitch') return renderGlitchDetail(container, eff);
        if (effectId === 'color_wheels') return renderColorWheelsDetail(container, eff);
        if (effectId === 'hsl_curves') return renderHSLDetail(container, eff);
    }

    const fx = (clipEffects[state.selectedClipId] || {})[effectId] || { ...eff.defaults };

    container.innerHTML = `
        <div class="efx-detail-header">
            <button class="efx-back-btn" id="efx-back">
                <i class="fa-solid fa-arrow-left"></i> Effetti
            </button>
            <div class="efx-detail-title"><i class="fa-solid ${eff.icon}"></i> ${eff.name}</div>
        </div>

        <div class="efx-detail-body">
            <div class="efx-enable-row">
                <label class="efx-toggle-label">
                    <input type="checkbox" id="efx-enabled" ${fx.enabled ? 'checked' : ''}>
                    <span>Abilita ${eff.name}</span>
                </label>
                <div class="efx-preview-badge">
                    <i class="fa-solid fa-circle-play"></i> Preview live
                </div>
            </div>

            <div class="efx-param-section">
                <div class="efx-param-row">
                    <label>Durata</label>
                    <input type="range" id="efx-duration" min="0.1" max="8" step="0.1" value="${fx.duration || 1}">
                    <span class="efx-val-display" id="efx-dur-val">${(fx.duration || 1).toFixed(1)}s</span>
                </div>
                <div class="efx-param-row">
                    <label>Curva</label>
                    <select id="efx-curve">
                        <option value="linear" ${fx.curve === 'linear' ? 'selected' : ''}>Lineare</option>
                        <option value="ease-in" ${fx.curve === 'ease-in' ? 'selected' : ''}>Ease In</option>
                        <option value="ease-out" ${fx.curve === 'ease-out' ? 'selected' : ''}>Ease Out</option>
                        <option value="smooth" ${fx.curve === 'smooth' ? 'selected' : ''}>Smooth</option>
                    </select>
                </div>
                <div class="efx-param-row">
                    <label>Intensità</label>
                    <input type="range" id="efx-intensity" min="0" max="100" value="${fx.intensity !== undefined ? fx.intensity : 100}">
                    <span class="efx-val-display" id="efx-int-val">${fx.intensity !== undefined ? fx.intensity : 100}%</span>
                </div>
            </div>

            <div class="efx-curve-preview" id="efx-curve-preview">
                <!-- SVG curve rendered by JS -->
            </div>

            <button class="efx-remove-btn" id="efx-remove">
                <i class="fa-solid fa-trash"></i> Rimuovi Effetto
            </button>
        </div>
    `;

    // Draw curve preview
    drawCurvePreview('efx-curve-preview', fx.curve || 'linear');

    // Back button
    container.querySelector('#efx-back').addEventListener('click', () => {
        currentEffectDetail = null;
        renderEffectsTab();
    });

    // Auto-save on any change
    const save = () => {
        const enabled = container.querySelector('#efx-enabled').checked;
        const duration = parseFloat(container.querySelector('#efx-duration').value);
        const curve = container.querySelector('#efx-curve').value;
        const intensity = parseInt(container.querySelector('#efx-intensity').value);
        if (!clipEffects[state.selectedClipId]) clipEffects[state.selectedClipId] = {};
        clipEffects[state.selectedClipId][effectId] = { enabled, duration, curve, intensity };
        container.querySelector('#efx-dur-val').textContent = duration.toFixed(1) + 's';
        container.querySelector('#efx-int-val').textContent = intensity + '%';
        drawCurvePreview('efx-curve-preview', curve);
        renderTimeline();
    };

    container.querySelector('#efx-enabled').addEventListener('change', (e) => { save(); e.target.blur(); });
    container.querySelector('#efx-duration').addEventListener('input', save);
    container.querySelector('#efx-curve').addEventListener('change', save);
    container.querySelector('#efx-intensity').addEventListener('input', save);

    container.querySelector('#efx-remove').addEventListener('click', () => {
        if (clipEffects[state.selectedClipId]) {
            delete clipEffects[state.selectedClipId][effectId];
        }
        currentEffectDetail = null;
        renderEffectsTab();
        renderTimeline();
    });
}

// --- GLITCH EFFECT CUSTOM DETAIL ---
function renderGlitchDetail(container, eff) {
    const fx = (clipEffects[state.selectedClipId] || {})['glitch'] || { ...eff.defaults };

    container.innerHTML = `
        <div class="efx-detail-header">
            <button class="efx-back-btn" id="efx-back">
                <i class="fa-solid fa-arrow-left"></i> Effetti
            </button>
            <div class="efx-detail-title"><i class="fa-solid fa-bolt"></i> Glitch</div>
        </div>

        <div class="efx-detail-body">
            <div class="efx-enable-row">
                <label class="efx-toggle-label">
                    <input type="checkbox" id="glitch-enabled" ${fx.enabled ? 'checked' : ''}>
                    <span>Abilita Glitch</span>
                </label>
                <div class="efx-preview-badge">
                    <i class="fa-solid fa-circle-play"></i> Preview live
                </div>
            </div>

            <div class="efx-param-section">
                <div class="efx-param-row">
                    <label>Intensità</label>
                    <input type="range" id="glitch-intensity" min="1" max="100" value="${fx.intensity || 70}">
                    <span class="efx-val-display" id="glitch-int-val">${fx.intensity || 70}%</span>
                </div>
                <div class="efx-param-row">
                    <label>Velocità</label>
                    <input type="range" id="glitch-speed" min="1" max="10" value="${fx.speed || 5}">
                    <span class="efx-val-display" id="glitch-speed-val">${fx.speed || 5}</span>
                </div>
                <div class="efx-param-row">
                    <label>Bordo</label>
                    <input type="range" id="glitch-border" min="2" max="20" value="${fx.borderWidth || 6}">
                    <span class="efx-val-display" id="glitch-border-val">${fx.borderWidth || 6}px</span>
                </div>
                <div class="efx-param-row">
                    <label>Separazione RGB</label>
                    <input type="range" id="glitch-colorsep" min="0" max="12" value="${fx.colorSep || 4}">
                    <span class="efx-val-display" id="glitch-sep-val">${fx.colorSep || 4}px</span>
                </div>
                <div class="efx-param-row">
                    <label>Numero Righe</label>
                    <input type="range" id="glitch-rows" min="2" max="120" value="${fx.rows || 30}">
                    <span class="efx-val-display" id="glitch-rows-val">${fx.rows || 30}</span>
                </div>
            </div>

            <button class="efx-remove-btn" id="efx-remove">
                <i class="fa-solid fa-trash"></i> Rimuovi Effetto
            </button>
        </div>
    `;

    container.querySelector('#efx-back').addEventListener('click', () => {
        currentEffectDetail = null;
        renderEffectsTab();
    });

    const saveGlitch = () => {
        if (!clipEffects[state.selectedClipId]) clipEffects[state.selectedClipId] = {};
        clipEffects[state.selectedClipId]['glitch'] = {
            enabled: container.querySelector('#glitch-enabled').checked,
            intensity: parseInt(container.querySelector('#glitch-intensity').value),
            speed: parseInt(container.querySelector('#glitch-speed').value),
            borderWidth: parseInt(container.querySelector('#glitch-border').value),
            colorSep: parseInt(container.querySelector('#glitch-colorsep').value),
            rows: parseInt(container.querySelector('#glitch-rows').value)
        };
        container.querySelector('#glitch-int-val').textContent = container.querySelector('#glitch-intensity').value + '%';
        container.querySelector('#glitch-speed-val').textContent = container.querySelector('#glitch-speed').value;
        container.querySelector('#glitch-border-val').textContent = container.querySelector('#glitch-border').value + 'px';
        container.querySelector('#glitch-sep-val').textContent = container.querySelector('#glitch-colorsep').value + 'px';
        container.querySelector('#glitch-rows-val').textContent = container.querySelector('#glitch-rows').value;
        renderTimeline();
    };

    container.querySelector('#glitch-enabled').addEventListener('change', (e) => { saveGlitch(); e.target.blur(); });
    container.querySelector('#glitch-intensity').addEventListener('input', saveGlitch);
    container.querySelector('#glitch-speed').addEventListener('input', saveGlitch);
    container.querySelector('#glitch-border').addEventListener('input', saveGlitch);
    container.querySelector('#glitch-colorsep').addEventListener('input', saveGlitch);
    container.querySelector('#glitch-rows').addEventListener('input', saveGlitch);

    container.querySelector('#efx-remove').addEventListener('click', () => {
        if (clipEffects[state.selectedClipId]) delete clipEffects[state.selectedClipId]['glitch'];
        currentEffectDetail = null;
        renderEffectsTab();
        renderTimeline();
    });
}

// --- COLOR WHEELS CUSTOM DETAIL ---
function renderColorWheelsDetail(container, eff) {
    const fx = (clipEffects[state.selectedClipId] || {})['color_wheels'] || { ...eff.defaults };

    container.innerHTML = `
        <div class="efx-detail-header cw-pro-header">
            <button class="efx-back-btn" id="efx-back">
                <i class="fa-solid fa-arrow-left"></i>
            </button>
            <div class="efx-detail-title">Primares - Color Wheels</div>
            <div class="cw-reset-all"><i class="fa-solid fa-rotate-left"></i></div>
        </div>

        <div class="efx-detail-body cw-pro-body">
            <!-- Top Slider Bar -->
            <div class="cw-top-bar">
                 <div class="cw-top-item"><span>Temp</span> <input type="number" id="num-cw-temp" step="0.1" value="${fx.temp || 0}"><div class="cw-underline blue-orange"></div></div>
                 <div class="cw-top-item"><span>Tint</span> <input type="number" id="num-cw-tint" step="0.1" value="${fx.tint || 0}"><div class="cw-underline green-magenta"></div></div>
                 <div class="cw-top-item"><span>Cont</span> <input type="number" id="num-cw-contrast" step="0.1" value="${fx.contrast ?? 1}"><div class="cw-underline grey"></div></div>
                 <div class="cw-top-item"><span>Pivot</span> <input type="number" id="num-cw-pivot" step="0.1" value="0.43"><div class="cw-underline grey"></div></div>
            </div>

            <div class="cw-wheels-container">
                <!-- LIFT -->
                <div class="cw-wheel-box">
                    <div class="cw-wheel-title">Lift <i class="fa-solid fa-rotate-left cw-reset" data-type="lift"></i></div>
                    <div class="cw-wheel-main">
                        <div class="cw-circle-outer">
                             <div class="cw-circle" id="cw-circle-lift">
                                <div class="cw-thumb" id="cw-thumb-lift"></div>
                                <div class="cw-crosshair-v"></div>
                                <div class="cw-crosshair-h"></div>
                             </div>
                        </div>
                        <div class="cw-wheel-values">
                            <div class="cw-val-input">0.00 <div class="cw-u-line white"></div></div>
                            <div class="cw-val-input">0.00 <div class="cw-u-line red"></div></div>
                            <div class="cw-val-input">0.00 <div class="cw-u-line green"></div></div>
                            <div class="cw-val-input">0.00 <div class="cw-u-line blue"></div></div>
                        </div>
                    </div>
                    <div class="cw-bottom-slider"><div class="cw-slider-track"></div></div>
                </div>
                <!-- GAMMA -->
                <div class="cw-wheel-box">
                    <div class="cw-wheel-title">Gamma <i class="fa-solid fa-rotate-left cw-reset" data-type="gamma"></i></div>
                    <div class="cw-wheel-main">
                        <div class="cw-circle-outer">
                            <div class="cw-circle" id="cw-circle-gamma">
                                <div class="cw-thumb" id="cw-thumb-gamma"></div>
                                <div class="cw-crosshair-v"></div>
                                <div class="cw-crosshair-h"></div>
                            </div>
                        </div>
                        <div class="cw-wheel-values">
                            <div class="cw-val-input">0.00 <div class="cw-u-line white"></div></div>
                            <div class="cw-val-input">0.00 <div class="cw-u-line red"></div></div>
                            <div class="cw-val-input">0.00 <div class="cw-u-line green"></div></div>
                            <div class="cw-val-input">0.00 <div class="cw-u-line blue"></div></div>
                        </div>
                    </div>
                    <div class="cw-bottom-slider"><div class="cw-slider-track"></div></div>
                </div>
                <!-- GAIN -->
                <div class="cw-wheel-box">
                    <div class="cw-wheel-title">Gain <i class="fa-solid fa-rotate-left cw-reset" data-type="gain"></i></div>
                    <div class="cw-wheel-main">
                        <div class="cw-circle-outer">
                            <div class="cw-circle" id="cw-circle-gain">
                                <div class="cw-thumb" id="cw-thumb-gain"></div>
                                <div class="cw-crosshair-v"></div>
                                <div class="cw-crosshair-h"></div>
                            </div>
                        </div>
                        <div class="cw-wheel-values">
                            <div class="cw-val-input">1.00 <div class="cw-u-line white"></div></div>
                            <div class="cw-val-input">1.00 <div class="cw-u-line red"></div></div>
                            <div class="cw-val-input">1.00 <div class="cw-u-line green"></div></div>
                            <div class="cw-val-input">1.00 <div class="cw-u-line blue"></div></div>
                        </div>
                    </div>
                    <div class="cw-bottom-slider"><div class="cw-slider-track"></div></div>
                </div>
                <!-- OFFSET -->
                <div class="cw-wheel-box">
                    <div class="cw-wheel-title">Offset <i class="fa-solid fa-rotate-left cw-reset" data-type="offset"></i></div>
                    <div class="cw-wheel-main">
                        <div class="cw-circle-outer">
                            <div class="cw-circle" id="cw-circle-offset">
                                <div class="cw-thumb" id="cw-thumb-offset"></div>
                                <div class="cw-crosshair-v"></div>
                                <div class="cw-crosshair-h"></div>
                            </div>
                        </div>
                        <div class="cw-wheel-values">
                            <div class="cw-val-input">25.0 <div class="cw-u-line white"></div></div>
                            <div class="cw-val-input">25.0 <div class="cw-u-line red"></div></div>
                            <div class="cw-val-input">25.0 <div class="cw-u-line green"></div></div>
                            <div class="cw-val-input">25.0 <div class="cw-u-line blue"></div></div>
                        </div>
                    </div>
                    <div class="cw-bottom-slider"><div class="cw-slider-track"></div></div>
                </div>
            </div>

            <!-- Bottom Slider Bar -->
            <div class="cw-bottom-bar">
                 <div class="cw-top-item"><span>Sat</span> <input type="number" id="num-cw-sat" step="0.5" value="${(fx.sat * 50 || 50).toFixed(1)}"><div class="cw-underline rainbow"></div></div>
                 <div class="cw-top-item"><span>Hue</span> <input type="number" id="num-cw-hue" step="0.5" value="${fx.hue || 0}"><div class="cw-underline rainbow"></div></div>
                 <div class="cw-top-item"><span>Lum Mix</span> <input type="number" value="100"><div class="cw-underline grey"></div></div>
            </div>

            <div class="efx-enable-row" style="margin-top:10px;">
                <label class="efx-toggle-label">
                    <input type="checkbox" id="cw-enabled" ${fx.enabled ? 'checked' : ''}>
                    <span>Abilita Color Grading</span>
                </label>
            </div>

            <button class="efx-remove-btn" id="efx-remove">
                <i class="fa-solid fa-trash"></i> Rimuovi Effetto
            </button>
        </div>
    `;

    container.querySelector('#efx-back').addEventListener('click', () => {
        currentEffectDetail = null;
        renderEffectsTab();
    });

    const initWheel = (type, stateX, stateY) => {
        const circle = container.querySelector('#cw-circle-' + type);
        const thumb = container.querySelector('#cw-thumb-' + type);
        if (!circle || !thumb) return;

        const updateThumbPos = (nx, ny) => {
            const rect = circle.getBoundingClientRect();
            if (rect.width > 0) {
                const r = rect.width / 2;
                thumb.style.left = (r + nx * r) + 'px';
                thumb.style.top = (r + ny * r) + 'px';
            }
            const dx = nx;
            const dy = -ny;
            fx[type + 'R'] = dx;
            fx[type + 'G'] = -dx * 0.5 + dy * 0.866;
            fx[type + 'B'] = -dx * 0.5 - dy * 0.866;
            saveCW();
        };

        const nx = fx[type + 'NX'] || 0;
        const ny = fx[type + 'NY'] || 0;
        const rect = circle.getBoundingClientRect();
        if (rect.width > 0) {
            thumb.style.left = (rect.width / 2 + nx * rect.width / 2) + 'px';
            thumb.style.top = (rect.width / 2 + ny * rect.width / 2) + 'px';
        }

        let isDragging = false;
        circle.addEventListener('mousedown', (e) => { isDragging = true; handleDrag(e); });
        window.addEventListener('mousemove', (e) => { if (isDragging) handleDrag(e); });
        window.addEventListener('mouseup', () => { isDragging = false; });

        function handleDrag(e) {
            const rct = circle.getBoundingClientRect();
            const r = rct.width / 2;
            const cx = rct.left + r;
            const cy = rct.top + r;
            let nx = (e.clientX - cx) / r;
            let ny = (e.clientY - cy) / r;
            const dist = Math.sqrt(nx * nx + ny * ny);
            if (dist > 1) { nx /= dist; ny /= dist; }
            fx[type + 'NX'] = nx;
            fx[type + 'NY'] = ny;
            updateThumbPos(nx, ny);
        }
    };

    setTimeout(() => {
        ['lift', 'gamma', 'gain', 'offset'].forEach(w => initWheel(w));
        // Force save to instantly apply defaults when panel is opened for the first time
        saveCW();
    }, 20);

    const saveCW = () => {
        if (!state.selectedClipId) return;
        if (!clipEffects[state.selectedClipId]) clipEffects[state.selectedClipId] = {};
        clipEffects[state.selectedClipId]['color_wheels'] = fx;

        const enabledEl = container.querySelector('#cw-enabled');
        if (enabledEl) fx.enabled = enabledEl.checked;

        const tempIn = container.querySelector('#num-cw-temp');
        if (tempIn) fx.temp = parseFloat(tempIn.value);
        const tintIn = container.querySelector('#num-cw-tint');
        if (tintIn) fx.tint = parseFloat(tintIn.value);
        const contIn = container.querySelector('#num-cw-contrast');
        if (contIn) fx.contrast = parseFloat(contIn.value);
        const satIn = container.querySelector('#num-cw-sat');
        if (satIn) fx.sat = parseFloat(satIn.value) / 50.0;
        const hueIn = container.querySelector('#num-cw-hue');
        if (hueIn) fx.hue = parseFloat(hueIn.value);

        renderTimeline();
        syncVideoToPlayhead();
    };

    const cwEnabled = container.querySelector('#cw-enabled');
    if (cwEnabled) cwEnabled.addEventListener('change', (e) => { saveCW(); e.target.blur(); });

    container.querySelectorAll('.cw-reset').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const type = btn.dataset.type;
            fx[type + 'NX'] = 0; fx[type + 'NY'] = 0;
            fx[type + 'R'] = 0; fx[type + 'G'] = 0; fx[type + 'B'] = (type === 'gain' ? 1 : 0);
            renderColorWheelsDetail(container, eff);
            saveCW();
        });
    });

    const resetAll = container.querySelector('.cw-reset-all');
    if (resetAll) resetAll.addEventListener('click', () => {
        clipEffects[state.selectedClipId]['color_wheels'] = null;
        renderColorWheelsDetail(container, eff);
        saveCW();
    });

    container.querySelectorAll('.cw-top-item input').forEach(inp => {
        inp.addEventListener('input', saveCW);
    });

    const btnRemove = container.querySelector('#efx-remove');
    if (btnRemove) btnRemove.addEventListener('click', () => {
        if (state.selectedClipId && clipEffects[state.selectedClipId]) delete clipEffects[state.selectedClipId]['color_wheels'];
        currentEffectDetail = null;
        renderEffectsTab();
        renderTimeline();
    });
}

// --- HSL QUALIFIER CUSTOM DETAIL ---
function renderHSLDetail(container, eff) {
    const fx = (clipEffects[state.selectedClipId] || {})['hsl_curves'] || { ...eff.defaults };

    container.innerHTML = `
        <div class="efx-detail-header">
            <button class="efx-back-btn" id="efx-back">
                <i class="fa-solid fa-arrow-left"></i> Effetti
            </button>
            <div class="efx-detail-title"><i class="fa-solid fa-eye-dropper"></i> Qualificatore HSL</div>
        </div>

        <div class="efx-detail-body">
            <div class="efx-enable-row">
                <label class="efx-toggle-label">
                    <input type="checkbox" id="hsl-enabled" ${fx.enabled ? 'checked' : ''}>
                    <span>Abilita HSL</span>
                </label>
                <div class="efx-preview-badge">
                    <i class="fa-solid fa-circle-play"></i> Preview live
                </div>
            </div>

            <div class="hsl-section">
                <div class="hsl-title">Selezione (Isolamento Tinta)</div>
                
                <div class="efx-param-row">
                    <label>Hue Min-Max</label>
                    <div style="display:flex; gap:10px;">
                        <input type="range" id="hsl-hmin" min="0" max="1" step="0.01" value="${fx.hMin || 0}" style="width:45%">
                        <input type="range" id="hsl-hmax" min="0" max="1" step="0.01" value="${fx.hMax ?? 1}" style="width:45%">
                    </div>
                </div>
                <div class="efx-param-row">
                    <label>Hue Softness</label>
                    <input type="range" id="hsl-hsoft" min="0" max="0.5" step="0.01" value="${fx.hSoft || 0.1}">
                </div>

                <div class="efx-param-row" style="margin-top:10px;">
                    <label>Sat Min-Max</label>
                    <div style="display:flex; gap:10px;">
                        <input type="range" id="hsl-smin" min="0" max="1" step="0.01" value="${fx.sMin || 0}" style="width:45%">
                        <input type="range" id="hsl-smax" min="0" max="1" step="0.01" value="${fx.sMax ?? 1}" style="width:45%">
                    </div>
                </div>
                <div class="efx-param-row">
                    <label>Sat Softness</label>
                    <input type="range" id="hsl-ssoft" min="0" max="0.5" step="0.01" value="${fx.sSoft || 0.1}">
                </div>

                <div class="efx-param-row" style="margin-top:10px;">
                    <label>Lum Min-Max</label>
                    <div style="display:flex; gap:10px;">
                        <input type="range" id="hsl-lmin" min="0" max="1" step="0.01" value="${fx.lMin || 0}" style="width:45%">
                        <input type="range" id="hsl-lmax" min="0" max="1" step="0.01" value="${fx.lMax ?? 1}" style="width:45%">
                    </div>
                </div>
                <div class="efx-param-row">
                    <label>Lum Softness</label>
                    <input type="range" id="hsl-lsoft" min="0" max="0.5" step="0.01" value="${fx.lSoft || 0.1}">
                </div>
            </div>

            <div class="hsl-section" style="margin-top:20px;">
                <div class="hsl-title">Regolazione Colori Isolati</div>
                
                <div class="efx-param-row">
                    <label>Hue Shift</label>
                    <input type="range" id="hsl-hshift" min="-0.5" max="0.5" step="0.01" value="${fx.hueShift || 0}">
                </div>
                <div class="efx-param-row">
                    <label>Saturation Mul</label>
                    <input type="range" id="hsl-sshift" min="0" max="3" step="0.01" value="${fx.satShift ?? 1}">
                </div>
                <div class="efx-param-row">
                    <label>Luminance Mul</label>
                    <input type="range" id="hsl-lshift" min="0.1" max="3" step="0.01" value="${fx.lumShift ?? 1}">
                </div>
            </div>

            <button class="efx-remove-btn" id="efx-remove" style="margin-top: 20px;">
                <i class="fa-solid fa-trash"></i> Rimuovi Effetto
            </button>
        </div>
    `;

    container.querySelector('#efx-back').addEventListener('click', () => {
        currentEffectDetail = null;
        renderEffectsTab();
    });

    const saveHSL = () => {
        if (!clipEffects[state.selectedClipId]) clipEffects[state.selectedClipId] = {};

        fx.enabled = container.querySelector('#hsl-enabled').checked;

        fx.hMin = parseFloat(container.querySelector('#hsl-hmin').value);
        fx.hMax = parseFloat(container.querySelector('#hsl-hmax').value);
        fx.hSoft = parseFloat(container.querySelector('#hsl-hsoft').value);

        fx.sMin = parseFloat(container.querySelector('#hsl-smin').value);
        fx.sMax = parseFloat(container.querySelector('#hsl-smax').value);
        fx.sSoft = parseFloat(container.querySelector('#hsl-ssoft').value);

        fx.lMin = parseFloat(container.querySelector('#hsl-lmin').value);
        fx.lMax = parseFloat(container.querySelector('#hsl-lmax').value);
        fx.lSoft = parseFloat(container.querySelector('#hsl-lsoft').value);

        fx.hueShift = parseFloat(container.querySelector('#hsl-hshift').value);
        fx.satShift = parseFloat(container.querySelector('#hsl-sshift').value);
        fx.lumShift = parseFloat(container.querySelector('#hsl-lshift').value);

        clipEffects[state.selectedClipId]['hsl_curves'] = fx;
        renderTimeline();
        syncVideoToPlayhead();
    };

    container.querySelector('#hsl-enabled').addEventListener('change', (e) => { saveHSL(); e.target.blur(); });

    ['hmin', 'hmax', 'hsoft', 'smin', 'smax', 'ssoft', 'lmin', 'lmax', 'lsoft', 'hshift', 'sshift', 'lshift'].forEach(sl => {
        const el = container.querySelector('#hsl-' + sl);
        if (el) el.addEventListener('input', saveHSL);
    });

    container.querySelector('#efx-remove').addEventListener('click', () => {
        if (clipEffects[state.selectedClipId]) delete clipEffects[state.selectedClipId]['hsl_curves'];
        currentEffectDetail = null;
        renderEffectsTab();
        renderTimeline();
    });
}

// Draw a simple SVG animation curve
function drawCurvePreview(containerId, curveType) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const points = { linear: 'M0,60 L120,0', 'ease-in': 'M0,60 C60,60 100,20 120,0', 'ease-out': 'M0,60 C20,40 60,0 120,0', smooth: 'M0,60 C40,60 80,0 120,0' };
    const d = points[curveType] || points.linear;
    el.innerHTML = `<svg viewBox="0 0 120 64" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,60 H120 V0" stroke="#2a2b33" stroke-width="1" fill="none"/>
        <path d="${d}" stroke="var(--accent)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <circle cx="0" cy="60" r="3" fill="var(--accent)"/>
        <circle cx="120" cy="0" r="3" fill="var(--accent)"/>
    </svg>`;
}

// --- FADE OVERLAY (real-time effect) ---
// --- FADE CURVE HELPER ---
function applyFadeCurve(t, curve) {
    // t = 0..1 → opacity factor 0..1
    switch (curve) {
        case 'ease-in': return t * t;
        case 'ease-out': return 1 - (1 - t) * (1 - t);
        case 'smooth': return t * t * (3 - 2 * t);
        default: return t; // linear
    }
}


// --- GLITCH OVERLAY ENGINE ---
let _glitchAnimId = null;
function updateGlitchOverlay(activeClip) {
    const preview = document.querySelector('.player-preview');
    if (!preview) return;
    let canvas = document.getElementById('glitch-overlay-canvas');
    const fx = (clipEffects[activeClip.id] || {})['glitch'];

    if (!fx || !fx.enabled) {
        // Destroy glitch canvas if effect disabled
        if (canvas) { canvas.remove(); }
        if (_glitchAnimId) { cancelAnimationFrame(_glitchAnimId); _glitchAnimId = null; }
        return;
    }

    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'glitch-overlay-canvas';
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:11;';
        preview.appendChild(canvas);
    }

    const intensity = (fx.intensity || 70) / 100;
    const speed = (fx.speed || 5);
    const borderW = fx.borderWidth || 6;
    const colorSep = fx.colorSep || 4;

    if (_glitchAnimId) cancelAnimationFrame(_glitchAnimId);

    function drawGlitch() {
        if (!document.getElementById('glitch-overlay-canvas')) { _glitchAnimId = null; return; }
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        const time = performance.now() * 0.001 * speed;
        const maxDisplace = 30 * intensity;

        // Draw distorted border edges
        // Helper: generate a jagged line with glitch displacements
        function drawGlitchEdge(x1, y1, x2, y2, isHorizontal) {
            const length = isHorizontal ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
            const steps = Math.max(10, Math.floor(length / 4));

            // 3 passes: cyan, magenta, white (RGB separation)
            const colors = [
                `rgba(0, 220, 255, ${0.7 * intensity})`,
                `rgba(255, 0, 180, ${0.6 * intensity})`,
                `rgba(255, 255, 255, ${0.9 * intensity})`
            ];
            const offsets = [colorSep, -colorSep, 0];

            for (let pass = 0; pass < 3; pass++) {
                ctx.strokeStyle = colors[pass];
                ctx.lineWidth = borderW * (pass === 2 ? 1 : 0.7);
                ctx.beginPath();

                for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    let px, py;

                    if (isHorizontal) {
                        px = x1 + (x2 - x1) * t;
                        // Glitch: random-looking noise from sin/cos
                        const noise = Math.sin(t * 47 + time * 3.1) * Math.cos(t * 23 + time * 1.7)
                            + Math.sin(t * 11 + time * 7.3) * 0.5;
                        const glitchBlock = (Math.sin(t * 5 + time * 2) > 0.3) ?
                            Math.sin(t * 90 + time * 10) * maxDisplace * 0.6 : 0;
                        py = y1 + noise * maxDisplace * 0.3 + glitchBlock + offsets[pass];
                    } else {
                        py = y1 + (y2 - y1) * t;
                        const noise = Math.sin(t * 47 + time * 2.9) * Math.cos(t * 37 + time * 1.3)
                            + Math.cos(t * 13 + time * 5.7) * 0.5;
                        const glitchBlock = (Math.cos(t * 7 + time * 3) > 0.3) ?
                            Math.cos(t * 80 + time * 8) * maxDisplace * 0.6 : 0;
                        px = x1 + noise * maxDisplace * 0.3 + glitchBlock + offsets[pass];
                    }

                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.stroke();
            }
        }

        const margin = borderW + 10;

        // Top edge
        drawGlitchEdge(margin, margin, w - margin, margin, true);
        // Bottom edge
        drawGlitchEdge(margin, h - margin, w - margin, h - margin, true);
        // Left edge
        drawGlitchEdge(margin, margin, margin, h - margin, false);
        // Right edge
        drawGlitchEdge(w - margin, margin, w - margin, h - margin, false);

        // Random horizontal glitch slices (the iconic glitch scan lines)
        const sliceCount = Math.floor(3 + 5 * intensity);
        for (let s = 0; s < sliceCount; s++) {
            const sliceSeed = Math.sin(s * 123.456 + time * speed * 0.7);
            if (sliceSeed < 0.2) continue; // Skip some frames for flicker

            const sliceY = margin + Math.abs(Math.sin(s * 77.7 + time * 1.3)) * (h - margin * 2);
            const sliceH = 1 + Math.floor(Math.random() * 3 * intensity);
            const sliceShift = Math.sin(s * 31 + time * speed) * maxDisplace * 0.8;

            ctx.fillStyle = `rgba(0, 220, 255, ${0.15 * intensity})`;
            ctx.fillRect(margin + sliceShift + colorSep, sliceY, w - margin * 2, sliceH);
            ctx.fillStyle = `rgba(255, 0, 180, ${0.12 * intensity})`;
            ctx.fillRect(margin + sliceShift - colorSep, sliceY + 1, w - margin * 2, sliceH);
        }

        // Corner glitch blocks
        const corners = [
            [margin, margin],
            [w - margin - 20, margin],
            [margin, h - margin - 20],
            [w - margin - 20, h - margin - 20]
        ];
        corners.forEach(([cx, cy], ci) => {
            const flicker = Math.sin(time * speed * 2 + ci * 99) > 0 ? 1 : 0;
            if (flicker) {
                const bw = 8 + Math.sin(time * 3 + ci) * 12;
                const bh = 8 + Math.cos(time * 4 + ci) * 12;
                ctx.fillStyle = `rgba(0, 220, 255, ${0.5 * intensity})`;
                ctx.fillRect(cx + colorSep, cy, bw, bh);
                ctx.fillStyle = `rgba(255, 0, 180, ${0.4 * intensity})`;
                ctx.fillRect(cx - colorSep, cy + 2, bw, bh);
                ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * intensity})`;
                ctx.fillRect(cx, cy + 1, bw * 0.6, bh * 0.6);
            }
        });

        _glitchAnimId = requestAnimationFrame(drawGlitch);
    }

    drawGlitch();
}



// --- RULER ---
function updateRuler() {
    const ruler = document.querySelector('.time-ruler');
    if (!ruler) return;
    ruler.innerHTML = '';
    // Total ruler width in pixels: represent 10 minutes worth of timeline
    const totalSeconds = 600;
    // Interval between ruler marks: adapt based on zoom
    let interval = 30; // seconds
    if (state.pixelsPerSecond >= 40) interval = 10;
    if (state.pixelsPerSecond >= 80) interval = 5;
    if (state.pixelsPerSecond < 10) interval = 60;

    ruler.style.width = (totalSeconds * state.pixelsPerSecond) + 'px';
    ruler.style.position = 'relative';
    ruler.style.whiteSpace = 'nowrap';

    for (let s = 0; s <= totalSeconds; s += interval) {
        const span = document.createElement('span');
        const min = Math.floor(s / 60).toString().padStart(2, '0');
        const sec = (s % 60).toString().padStart(2, '0');
        span.textContent = `| ${min}:${sec}`;
        span.style.position = 'absolute';
        span.style.left = (s * state.pixelsPerSecond) + 'px';
        ruler.appendChild(span);
    }
}

// --- MEDIA POOL & IMPORT ---

async function importMedia(file) {
    const id = 'media_' + Date.now() + Math.random().toString(36).substr(2, 5);
    const url = URL.createObjectURL(file);
    const isAudio = file.type.startsWith('audio/');

    if (isAudio) {
        const audioElement = document.createElement('audio');
        audioElement.src = url;
        audioElement.style.display = 'none';
        document.body.appendChild(audioElement);

        await new Promise((resolve) => {
            audioElement.addEventListener('loadedmetadata', () => {
                state.mediaPool[id] = {
                    id, file, url, videoElement: audioElement, // Treat as videoElement for simpler playback logic
                    name: file.name,
                    duration: audioElement.duration,
                    thumbnailUrl: null, // No thumb for audio
                    sourceType: 'local',
                    isAudio: true
                };
                const activeTab = document.querySelector('.tool-tabs .tab.active');
                if (activeTab && activeTab.dataset.leftTab === 'import') {
                    renderMediaPool();
                }
                resolve();
            }, { once: true });
            audioElement.load();
        });
    } else {
        const videoElement = document.createElement('video');
        videoElement.src = url;
        videoElement.muted = true;
        videoElement.crossOrigin = "anonymous";
        videoElement.style.display = 'none';
        document.body.appendChild(videoElement);

        await new Promise((resolve) => {
            videoElement.addEventListener('loadedmetadata', () => {
                videoElement.currentTime = 0;
            }, { once: true });

            videoElement.addEventListener('seeked', () => {
                const thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = 160;
                thumbCanvas.height = 90;
                const ctx = thumbCanvas.getContext('2d');
                ctx.drawImage(videoElement, 0, 0, 160, 90);
                const thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.7);

                state.mediaPool[id] = {
                    id, file, url, videoElement,
                    name: file.name,
                    duration: videoElement.duration,
                    thumbnailUrl,
                    sourceType: 'local'
                };
                const activeTab = document.querySelector('.tool-tabs .tab.active');
                if (activeTab && activeTab.dataset.leftTab === 'import') {
                    renderMediaPool();
                }
                resolve();
            }, { once: true });

            videoElement.load();
        });
    }
}

// Import stock media asynchronously
async function importVideoFromUrl(name, url, thumb) {
    const id = 'media_' + Date.now() + Math.floor(Math.random() * 10000).toString(16);
    if (Object.values(state.mediaPool).find(m => m.url === url)) return;

    return new Promise((resolve) => {
        const videoElement = document.createElement('video');
        videoElement.src = url;
        videoElement.crossOrigin = 'anonymous';
        videoElement.muted = true;

        videoElement.addEventListener('loadedmetadata', () => {
            state.mediaPool[id] = {
                id, file: null, url, videoElement,
                name: name,
                duration: videoElement.duration,
                thumbnailUrl: thumb,
                sourceType: 'stock'
            };
            resolve(state.mediaPool[id]);
        }, { once: true });

        videoElement.addEventListener('error', () => {
            resolve(null);
        });

        videoElement.load();
    });
}

function renderMediaPool() {
    const grid = document.getElementById('media-grid');
    if (!grid) return;
    grid.innerHTML = '';

    Object.values(state.mediaPool).filter(m => m.sourceType === 'local' || m.sourceType === 'stock').forEach(media => {
        const item = document.createElement('div');
        item.className = 'media-item';
        item.draggable = true;
        item.dataset.id = media.id;

        const thumbContent = media.thumbnailUrl
            ? `<img src="${media.thumbnailUrl}" alt="thumb">`
            : `<div style="width:100%;height:100%;background:#1a4040;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-film" style="color:#20e9da;font-size:22px;"></i></div>`;

        item.innerHTML = `
            <div class="media-item-thumb">
                ${thumbContent}
                <span class="duration">${formatTime(media.duration)}</span>
            </div>
            <div class="item-name">${media.name}</div>
        `;

        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', media.id);
        });

        grid.appendChild(item);
    });
}

// --- MULTI-TRACK SYSTEM ---

function addTrack() {
    const trackId = 'track_' + Date.now();
    const trackNum = state.tracks.length + 1;
    state.tracks.push({ id: trackId, name: 'Video ' + trackNum });
    updateTransitionsTabState();

    // --- Header (left column) ---
    const headersContainer = document.querySelector('.timeline-headers');
    if (headersContainer) {
        const header = document.createElement('div');
        const isAudio = state.tracks.find(t => t.id === trackId)?.mode === 'audio';
        header.className = `track-header ${isAudio ? 'track-header-audio' : 'track-header-video'}`;
        header.dataset.trackId = trackId;
        header.innerHTML = `
            <div class="track-label">
                <i class="fa-solid ${isAudio ? 'fa-music' : 'fa-video'}"></i> 
                <span class="track-name-text">${isAudio ? 'A' : 'V'}${trackNum}</span>
            </div>
            <div class="track-controls">
                <i class="fa-solid fa-eye" title="Visibilità"></i>
                <i class="fa-solid fa-lock" title="Blocca"></i>
                <i class="fa-solid fa-trash track-delete-btn" title="Elimina traccia" data-id="${trackId}"></i>
            </div>
        `;

        header.querySelector('.track-label').addEventListener('click', () => {
            const tr = state.tracks.find(t => t.id === trackId);
            if (!tr) return;
            tr.mode = (tr.mode === 'audio') ? 'video' : 'audio';
            renderTimeline();
            updateTrackHeaderMode(trackId, tr.mode);
        });

        // Track selection logic (removed as per instruction, now only clip selection matters for transitions)
        // header.addEventListener('click', (e) => {
        //     if (e.target.closest('.track-controls') || e.target.closest('.track-delete-btn')) return;
        //     const idx = state.selectedTrackIds.indexOf(trackId);
        //     if (idx > -1) {
        //         state.selectedTrackIds.splice(idx, 1);
        //     } else {
        //         if (state.selectedTrackIds.length >= 2) state.selectedTrackIds.shift();
        //         state.selectedTrackIds.push(trackId);
        //     }
        //     document.querySelectorAll('.track-header-video').forEach(el => {
        //         const id = el.dataset.trackId;
        //         if (state.selectedTrackIds.includes(id)) el.classList.add('selected');
        //         else el.classList.remove('selected');
        //     });
        //     updateTransitionsTabState();
        //     const effectsTab = document.getElementById('tab-effects');
        //     const transTab = document.getElementById('tab-transitions');
        //     if (transTab && transTab.classList.contains('active')) renderTransitionsTab();
        //     // Optional: visual feedback
        // });

        header.querySelector('.track-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTrack(trackId);
        });
        headersContainer.appendChild(header);

        // --- Add Track button (always last) ---
        let addBtn = headersContainer.querySelector('.add-track-btn');

        if (addBtn) addBtn.remove();
        addBtn = document.createElement('div');
        addBtn.className = 'add-track-btn';
        addBtn.innerHTML = `<i class="fa-solid fa-plus"></i> Track`;
        addBtn.addEventListener('click', addTrack);
        headersContainer.appendChild(addBtn);
    }

    // --- Track row (right scrollable area) ---
    const timelineTracks = document.querySelector('.timeline-tracks');
    if (timelineTracks) {
        const track = document.createElement('div');
        track.className = 'track video-track';
        track.id = trackId;
        const totalWidth = 600 * state.pixelsPerSecond;
        track.style.minWidth = totalWidth + 'px';

        track.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            track.classList.add('drag-over');
        });
        track.addEventListener('dragleave', () => track.classList.remove('drag-over'));
        track.addEventListener('drop', (e) => {
            e.preventDefault();
            track.classList.remove('drag-over');
            const mediaId = e.dataTransfer.getData('text/plain');
            if (!mediaId || !state.mediaPool[mediaId]) return;

            const media = state.mediaPool[mediaId];
            const targetTrack = state.tracks.find(t => t.id === trackId);
            if (targetTrack) {
                const isAudioClip = media.isAudio;
                if (isAudioClip && targetTrack.mode !== 'audio') {
                    targetTrack.mode = 'audio';
                    updateTrackHeaderMode(targetTrack.id, 'audio');
                } else if (!isAudioClip && targetTrack.mode === 'audio') {
                    targetTrack.mode = 'video';
                    updateTrackHeaderMode(targetTrack.id, 'video');
                }
            }

            const timelineTracksEl = document.querySelector('.timeline-tracks');
            const rect = track.getBoundingClientRect();
            const dropX = e.clientX - rect.left + (timelineTracksEl ? timelineTracksEl.scrollLeft : 0);
            const dropTime = Math.max(0, dropX / state.pixelsPerSecond);
            addClipToTimeline(mediaId, dropTime, trackId);
        });

        // Insert before playhead if present
        const playhead = timelineTracks.querySelector('.playhead');
        if (playhead) timelineTracks.insertBefore(track, playhead);
        else timelineTracks.appendChild(track);

        // -- Track Reordering Drag & Drop --
        const trackControls = track.querySelector('.track-controls');
        if (trackControls) {
            trackControls.draggable = true;
            trackControls.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/track-id', track.id);
                e.dataTransfer.effectAllowed = 'move';
                track.classList.add('dragging-track');
            });
            trackControls.addEventListener('dragend', () => {
                track.classList.remove('dragging-track');
            });
        }
        track.addEventListener('dragover', (e) => {
            if (e.dataTransfer.types.includes('text/track-id')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const bounding = track.getBoundingClientRect();
                const offset = e.clientY - bounding.top;
                if (offset > bounding.height / 2) {
                    track.style.borderBottom = '2px solid var(--accent)';
                    track.style.borderTop = '';
                } else {
                    track.style.borderTop = '2px solid var(--accent)';
                    track.style.borderBottom = '';
                }
            }
        });
        track.addEventListener('dragleave', (e) => {
            if (e.dataTransfer.types.includes('text/track-id')) {
                track.style.borderTop = '';
                track.style.borderBottom = '';
            }
        });
        track.addEventListener('drop', (e) => {
            track.style.borderTop = '';
            track.style.borderBottom = '';
            const draggedTrackId = e.dataTransfer.getData('text/track-id');
            if (draggedTrackId && draggedTrackId !== track.id) {
                e.preventDefault();
                const draggedIdx = state.tracks.findIndex(t => t.id === draggedTrackId);
                const targetIdx = state.tracks.findIndex(t => t.id === track.id);
                if (draggedIdx > -1 && targetIdx > -1) {
                    const bounding = track.getBoundingClientRect();
                    const offset = e.clientY - bounding.top;
                    const insertAfter = offset > bounding.height / 2;

                    const draggingTrackObj = state.tracks.splice(draggedIdx, 1)[0];
                    const finalTargetIdx = insertAfter ? (draggedIdx < targetIdx ? targetIdx : targetIdx + 1) : (draggedIdx < targetIdx ? targetIdx - 1 : targetIdx);
                    state.tracks.splice(finalTargetIdx, 0, draggingTrackObj);

                    // Re-render entirely to respect new track order visually
                    renderTimelineTracks();
                }
            }
        });
    }

    renderTimeline();
}

function deleteTrack(trackId) {
    if (state.tracks.length <= 1) return; // Mantieni almeno 1
    state.tracks = state.tracks.filter(t => t.id !== trackId);
    state.clips = state.clips.filter(c => c.trackId !== trackId);
    // Also remove any transitions associated with clips on this track
    for (const key in clipTransitions) {
        const [clipId1, clipId2] = key.split('_');
        const clip1 = state.clips.find(c => c.id === clipId1);
        const clip2 = state.clips.find(c => c.id === clipId2);
        if (!clip1 || !clip2) { // If one of the clips is gone
            delete clipTransitions[key];
        }
    }

    const header = document.querySelector(`.track-header[data-track-id="${trackId}"]`);
    if (header) header.remove();
    const trackEl = document.getElementById(trackId);
    if (trackEl) trackEl.remove();

    renderTimeline();
    updateTransitionsTabState();
}

function updateTrackHeaderMode(trackId, mode) {
    const isAudio = mode === 'audio';
    const trackNum = state.tracks.findIndex(t => t.id === trackId) + 1;
    const header = document.querySelector(`.track-header[data-track-id="${trackId}"]`);
    if (header) {
        header.className = `track-header ${isAudio ? 'track-header-audio' : 'track-header-video'}`;
        const label = header.querySelector('.track-label');
        if (label) {
            label.innerHTML = `
                <i class="fa-solid ${isAudio ? 'fa-music' : 'fa-video'}"></i> 
                <span class="track-name-text">${isAudio ? 'A' : 'V'}${trackNum}</span>
            `;
        }
    }
}

// --- TIMELINE LOGIC ---

function addClipToTimeline(mediaId, startTime, trackId) {
    // Default to first track if none specified
    if (!trackId) trackId = state.tracks.length > 0 ? state.tracks[0].id : null;
    if (!trackId) return;

    const media = state.mediaPool[mediaId];
    const clip = {
        id: 'clip_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        mediaId: mediaId,
        trackId: trackId,
        startTimeline: startTime,
        endTimeline: startTime + media.duration,
        offsetSource: 0
    };
    state.clips.push(clip);
    renderTimeline();
    selectClip(clip.id);
}


function selectClip(id, multi = false) {
    if (multi) {
        const idx = state.selectedClipIds.indexOf(id);
        if (idx > -1) {
            state.selectedClipIds.splice(idx, 1);
            if (state.selectedClipId === id) {
                state.selectedClipId = state.selectedClipIds.length > 0 ? state.selectedClipIds[state.selectedClipIds.length - 1] : null;
            }
        } else {
            if (state.selectedClipIds.length >= 2) state.selectedClipIds.shift();
            state.selectedClipIds.push(id);
            state.selectedClipId = id;
        }
    } else {
        if (state.selectedClipIds.length === 1 && state.selectedClipIds[0] === id) return;
        state.selectedClipIds = [id];
        state.selectedClipId = id;
    }

    currentEffectDetail = null;

    // --- Update Audio Tab UI with selected clip's audio settings ---
    if (state.selectedClipId) {
        const afx = (clipEffects[state.selectedClipId] || {})['audio_cfg'] || { level: 100, mute: false };
        const audioTab = document.getElementById('tab-audio');
        if (audioTab) {
            const volSlider = audioTab.querySelector('.slider');
            const volBox = audioTab.querySelector('.value-box');
            const muteToggle = audioTab.querySelector('.toggle');
            if (volSlider) volSlider.value = afx.level;
            if (volBox) volBox.innerHTML = `${afx.level}% <div><i class="fa-solid fa-sort"></i></div>`;
            if (muteToggle) {
                if (afx.mute) muteToggle.classList.add('active');
                else muteToggle.classList.remove('active');
            }
        }
    }

    renderTimeline();
    updateTransitionsTabState();

    const effectsTab = document.getElementById('tab-effects');
    if (effectsTab && effectsTab.classList.contains('active')) renderEffectsTab();
    const transTab = document.getElementById('tab-transitions');
    if (transTab && transTab.classList.contains('active')) renderTransitionsTab();
}

let draggedClipInfo = null;

function handleClipDragStart(e, clipId) {
    if (e.target.closest('.track-controls') || e.target.closest('.track-delete-btn')) return;
    e.stopPropagation();
    selectClip(clipId, e.ctrlKey || e.metaKey || e.shiftKey);
    const clip = state.clips.find(c => c.id === clipId);
    draggedClipInfo = { clipId, startX: e.clientX, originalStartTimeline: clip.startTimeline };
}

// Snap threshold in seconds (equivalent to ~8px at default zoom)
const SNAP_THRESHOLD_PX = 10;

function snapToEdge(clip, proposedStart) {
    const duration = clip.endTimeline - clip.startTimeline;
    const proposedEnd = proposedStart + duration;
    const threshold = SNAP_THRESHOLD_PX / state.pixelsPerSecond;

    // Collect all snap points: edges of other clips on any track + t=0
    const snapPoints = [0];
    state.clips.forEach(other => {
        if (other.id === clip.id) return;
        snapPoints.push(other.startTimeline);
        snapPoints.push(other.endTimeline);
    });

    let bestSnap = null;
    let bestDist = threshold;

    snapPoints.forEach(pt => {
        // Snap clip's START to this point
        const distStart = Math.abs(proposedStart - pt);
        if (distStart < bestDist) {
            bestDist = distStart;
            bestSnap = { time: pt, mode: 'start' };
        }
        // Snap clip's END to this point
        const distEnd = Math.abs(proposedEnd - pt);
        if (distEnd < bestDist) {
            bestDist = distEnd;
            bestSnap = { time: pt - duration, mode: 'end' };
        }
    });

    if (bestSnap) {
        showSnapIndicator(bestSnap.mode === 'start' ? bestSnap.time : bestSnap.time + duration);
        return Math.max(0, bestSnap.time);
    }

    hideSnapIndicator();
    return proposedStart;
}

function showSnapIndicator(timeSeconds) {
    let indicator = document.getElementById('snap-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'snap-indicator';
        indicator.style.cssText = [
            'position:absolute', 'top:0', 'bottom:0', 'width:2px',
            'background:var(--accent)', 'z-index:50',
            'pointer-events:none', 'opacity:0.85',
            'box-shadow:0 0 6px var(--accent)'
        ].join(';');
        const tracks = document.querySelector('.timeline-tracks');
        if (tracks) tracks.appendChild(indicator);
    }
    indicator.style.left = (timeSeconds * state.pixelsPerSecond) + 'px';
    indicator.style.display = 'block';
}

function hideSnapIndicator() {
    const indicator = document.getElementById('snap-indicator');
    if (indicator) indicator.style.display = 'none';
}

function handleClipDrag(e) {
    const dx = e.clientX - draggedClipInfo.startX;
    const dt = dx / state.pixelsPerSecond;
    const clip = state.clips.find(c => c.id === draggedClipInfo.clipId);
    let newStart = draggedClipInfo.originalStartTimeline + dt;
    if (newStart < 0) newStart = 0;

    // Detect if clip is being dragged vertically into another track
    const elementsUnderMouse = document.elementsFromPoint(e.clientX, e.clientY);
    const hoveredTrack = elementsUnderMouse.find(el => el.classList && el.classList.contains('track'));
    if (hoveredTrack && hoveredTrack.id && hoveredTrack.id !== clip.trackId) {
        const media = state.mediaPool[clip.mediaId];
        const targetTrack = state.tracks.find(t => t.id === hoveredTrack.id);
        if (targetTrack) {
            // Auto switch track mode based on dragged clip
            const isAudioClip = media && media.isAudio;
            if (isAudioClip && targetTrack.mode !== 'audio') {
                targetTrack.mode = 'audio';
                updateTrackHeaderMode(targetTrack.id, 'audio');
            } else if (!isAudioClip && targetTrack.mode === 'audio') {
                targetTrack.mode = 'video';
                updateTrackHeaderMode(targetTrack.id, 'video');
            }
        }
        clip.trackId = hoveredTrack.id; // Move clip to new track
    }


    // Apply magnetic snap
    newStart = snapToEdge(clip, newStart);

    const duration = clip.endTimeline - clip.startTimeline;
    clip.startTimeline = newStart;
    clip.endTimeline = newStart + duration;
    renderTimeline();
}

function endClipDrag() {
    hideSnapIndicator();
    draggedClipInfo = null;
}

function renderTimeline() {
    const totalWidth = 600 * state.pixelsPerSecond;
    state.tracks.forEach(t => {
        const trackEl = document.getElementById(t.id);
        if (!trackEl) return;
        trackEl.innerHTML = '';
        trackEl.style.minWidth = totalWidth + 'px';
        const isAudioTrack = t.mode === 'audio';
        if (isAudioTrack) trackEl.classList.add('audio-track-row');
        else trackEl.classList.remove('audio-track-row');

        state.clips.filter(c => c.trackId === t.id).forEach(clip => {
            const media = state.mediaPool[clip.mediaId];
            const clipEl = document.createElement('div');
            clipEl.className = 'clip ' + (isAudioTrack ? 'audio-clip' : 'video-clip') + (state.selectedClipIds.includes(clip.id) ? ' selected' : '');
            const leftPx = clip.startTimeline * state.pixelsPerSecond;
            const widthPx = (clip.endTimeline - clip.startTimeline) * state.pixelsPerSecond;
            clipEl.style.left = leftPx + 'px';
            clipEl.style.width = widthPx + 'px';
            clipEl.dataset.id = clip.id;

            // Build clip interior: repeated thumbnails + label
            let thumbsHtml = '';
            if (media.thumbnailUrl && !isAudioTrack) {
                // How many thumb tiles fit?
                const thumbW = 80;
                const tiles = Math.max(1, Math.ceil(widthPx / thumbW));
                for (let i = 0; i < tiles; i++) {
                    thumbsHtml += `<img src="${media.thumbnailUrl}" style="height:100%;width:${thumbW}px;object-fit:cover;opacity:0.6;flex-shrink:0;" draggable="false">`;
                }
            }
            clipEl.innerHTML = `
                <div class="clip-thumbs">${thumbsHtml}</div>
                <div class="clip-label"><i class="fa-solid fa-film"></i> ${media.name}</div>
            `;

            // Mousedown: start drag
            clipEl.addEventListener('mousedown', (e) => handleClipDragStart(e, clip.id));
            // Click: seek playhead to clip start and update preview
            clipEl.addEventListener('click', (e) => {
                e.stopPropagation();
                // selectClip is handled in mousedown
                state.playheadTime = clip.startTimeline;
                updatePlayheadUI();
                syncVideoToPlayhead();
            });

            trackEl.appendChild(clipEl);
        });
    });
}

function deleteSelectedClip() {
    if (!state.selectedClipId) return;
    state.clips = state.clips.filter(c => c.id !== state.selectedClipId);
    // Remove any transitions associated with this clip
    for (const key in clipTransitions) {
        const [clipId1, clipId2] = key.split('_');
        if (clipId1 === state.selectedClipId || clipId2 === state.selectedClipId) {
            delete clipTransitions[key];
        }
    }
    state.selectedClipId = null;
    state.selectedClipIds = []; // Clear multi-selection too
    renderTimeline();
    updateTransitionsTabState(); // Update transitions tab state after deletion
}

function cutSelectedClip() {
    if (!state.selectedClipId) return;

    const clipIndex = state.clips.findIndex(c => c.id === state.selectedClipId);
    const clip = state.clips[clipIndex];

    // Check if playhead is actually inside the clip
    if (state.playheadTime <= clip.startTimeline || state.playheadTime >= clip.endTimeline) {
        return;
    }

    const splitPointSource = clip.offsetSource + (state.playheadTime - clip.startTimeline);

    // Crea nuova clip (parte destra)
    const rightClip = {
        id: 'clip_' + Date.now() + 'R',
        mediaId: clip.mediaId,
        trackId: clip.trackId,
        startTimeline: state.playheadTime,
        endTimeline: clip.endTimeline,
        offsetSource: splitPointSource
    };

    // Aggiorna vecchia clip (parte sinistra)
    clip.endTimeline = state.playheadTime;

    state.clips.push(rightClip);
    selectClip(rightClip.id);
    renderTimeline();
}

// --- PLAYBACK ---

let lastTimeTime = performance.now();

function togglePlay() {
    state.isPlaying = !state.isPlaying;
    const icon = document.querySelector('.play-actions i');
    if (state.isPlaying) {
        if (icon) icon.classList.replace('fa-play', 'fa-pause');
        lastTimeTime = performance.now();
        if (typeof currentVideos !== 'undefined') currentVideos.forEach(v => { if (v) safePlay(v); });
    } else {
        if (icon) icon.classList.replace('fa-pause', 'fa-play');
        // Pause all videos safely
        Object.values(state.mediaPool).forEach(m => safePause(m.videoElement));
    }
}


function updatePlayheadPositionFromMouse(clientX) {
    const tracksContainer = document.querySelector('.timeline-tracks');
    const rect = tracksContainer.getBoundingClientRect();
    let x = clientX - rect.left + tracksContainer.scrollLeft;

    if (x < 0) x = 0;

    state.playheadTime = x / state.pixelsPerSecond;
    updatePlayheadUI();
    syncVideoToPlayhead();
}

function updatePlayheadUI() {
    const playhead = document.querySelector('.playhead');
    const px = state.playheadTime * state.pixelsPerSecond;
    playhead.style.left = px + 'px';

    const currentSpan = document.querySelector('.time-display .current');
    currentSpan.textContent = formatTime(state.playheadTime);
}

function getActiveRenderState() {
    // Filter ONLY clips on video tracks for WebGPU rendering to avoid crash
    let videoActives = state.clips.filter(c => {
        if (state.playheadTime < c.startTimeline || state.playheadTime >= c.endTimeline) return false;
        const track = state.tracks.find(t => t.id === c.trackId);
        const media = state.mediaPool[c.mediaId];
        return track && track.mode !== 'audio' && media && !media.isAudio;
    });

    if (videoActives.length === 0) return null;

    videoActives.sort((a, b) => state.tracks.findIndex(t => t.id === a.trackId) - state.tracks.findIndex(t => t.id === b.trackId));

    let topClip = videoActives[0];
    let bottomClip = videoActives.length > 1 ? videoActives[1] : null;

    let getClipAlpha = (clip) => {
        let alpha = 1.0;

        // 1. Handle Transitions (Cross Fade) between overlapping clips
        for (const key in clipTransitions) {
            if (!clipTransitions[key] || !clipTransitions[key].crossfade) continue;
            const [id1, id2] = key.split('||');
            if (clip.id === id1 || clip.id === id2) {
                const otherId = clip.id === id1 ? id2 : id1;
                const otherClip = state.clips.find(c => c.id === otherId);
                // Only consider the transition if we overlap with the other clip right now
                if (!otherClip || state.playheadTime < otherClip.startTimeline || state.playheadTime >= otherClip.endTimeline) continue;

                const dur = clipTransitions[key].crossfadeDur || 0.5;
                const topTrackIdx = state.tracks.findIndex(t => t.id === clip.trackId);
                const otherTrackIdx = state.tracks.findIndex(t => t.id === otherClip.trackId);
                const isTop = topTrackIdx < otherTrackIdx; // lower index = higher visual layer

                // Crossfade should ONLY manipulate the alpha of the TOP clip.
                // The bottom clip stays at 1.0. Mixing a fading top clip with a solid bottom clip
                // yields a perfect full-luminance transition.
                if (isTop) {
                    // Check if top clip is exiting earlier than bottom clip
                    if (clip.endTimeline <= otherClip.endTimeline) {
                        if (state.playheadTime > clip.endTimeline - dur) {
                            alpha = Math.max(0, (clip.endTimeline - state.playheadTime) / dur);
                        }
                    }
                    // Or if top clip is appearing after bottom clip started
                    if (clip.startTimeline >= otherClip.startTimeline) {
                        if (state.playheadTime < clip.startTimeline + dur) {
                            alpha = Math.min(1, (state.playheadTime - clip.startTimeline) / dur);
                        }
                    }

                    if (clipTransitions[key].crossfadeType === 'smooth') {
                        alpha = alpha * alpha * (3 - 2 * alpha);
                    }
                }
            }
        }

        // 2. Handle Fade In / Fade Out Effects (Alpha Transparency)
        const fx = clipEffects[clip.id] || {};
        const elapsed = state.playheadTime - clip.startTimeline;
        const remaining = clip.endTimeline - state.playheadTime;

        if (fx.fadein && fx.fadein.enabled && elapsed < fx.fadein.duration) {
            const t = elapsed / fx.fadein.duration;
            const intensity = (fx.fadein.intensity !== undefined ? fx.fadein.intensity : 100) / 100;
            const factor = applyFadeCurve(Math.min(t, 1), fx.fadein.curve || 'linear');
            // Resulting alpha is (1 - intensity) at start, 1.0 at end of fade
            alpha *= ((1.0 - intensity) + (factor * intensity));
        }

        if (fx.fadeout && fx.fadeout.enabled && remaining < fx.fadeout.duration) {
            const t = remaining / fx.fadeout.duration;
            const intensity = (fx.fadeout.intensity !== undefined ? fx.fadeout.intensity : 100) / 100;
            const factor = applyFadeCurve(Math.min(t, 1), fx.fadeout.curve || 'linear');
            // Resulting alpha is 1.0 at start of fade, (1 - intensity) at end
            alpha *= ((1.0 - intensity) + (factor * intensity));
        }

        return Math.max(0, Math.min(1, alpha));
    };

    let alphaTop = getClipAlpha(topClip);
    let alphaBottom = bottomClip ? getClipAlpha(bottomClip) : 1.0;

    // Find luma mask for the current overlapping pair
    let lumaMaskVideoEl = null;
    let maskProgress = 0;
    if (bottomClip) {
        const pairKey = [topClip.id, bottomClip.id].sort().join('||');
        const tr = clipTransitions[pairKey];
        if (tr && tr.transitionType === 'mask' && tr.maskVideoEl) {
            lumaMaskVideoEl = tr.maskVideoEl;
            // maskProgress: 0 = start of overlap, 1 = end
            const overlapStart = Math.max(topClip.startTimeline, bottomClip.startTimeline);
            const overlapEnd = Math.min(topClip.endTimeline, bottomClip.endTimeline);
            const overlapDur = overlapEnd - overlapStart;
            maskProgress = overlapDur > 0 ? Math.max(0, Math.min(1, (state.playheadTime - overlapStart) / overlapDur)) : 0;
        }
    }

    return {
        clip1: bottomClip || topClip,
        clip2: bottomClip ? topClip : null,
        alpha1: bottomClip ? alphaBottom : alphaTop,
        alpha2: bottomClip ? alphaTop : 0.0,
        lumaMaskVideoEl,
        maskProgress,
        maskOverlapDur: bottomClip ? Math.max(0.001, Math.min(topClip.endTimeline, bottomClip.endTimeline) - Math.max(topClip.startTimeline, bottomClip.startTimeline)) : 0
    };
}


// Per-video play-promise tracking to avoid AbortError races
let currentActiveVideo = null;
const _playingPromise = new WeakMap();


function safePlay(videoEl) {
    if (_playingPromise.get(videoEl)) return; // already playing, skip
    const p = videoEl.play();
    if (p && typeof p.then === 'function') {
        _playingPromise.set(videoEl, true);
        p.then(() => {
            _playingPromise.delete(videoEl);
        }).catch(err => {
            _playingPromise.delete(videoEl);
            if (err.name !== 'AbortError') console.warn('Play error:', err);
        });
    }
}

function safePause(videoEl) {
    if (!videoEl) return;
    const p = _playingPromise.get(videoEl);
    if (p) {
        // Wait until the existing play() resolves, then pause
        // We just mark it so the promise handler knows
        _playingPromise.set(videoEl, 'stopping');
    }
    // Direct pause — browser handles AbortError internally at this point
    try { videoEl.pause(); } catch (e) { /* ignore */ }
    _playingPromise.delete(videoEl);

    // Also hide any fallback canvas
    const fb = document.getElementById('canvas-2d-fallback');
    if (fb) fb.style.display = 'none';
}

let currentVideos = [null, null];
window.renderStateGlobals = { v1: null, v2: null, blend: 0 };

function syncVideoToPlayhead() {
    const actives = state.clips.filter(c => state.playheadTime >= c.startTimeline && state.playheadTime < c.endTimeline);
    const pState = getActiveRenderState();

    let v1 = null, v2 = null;
    let time1 = 0, time2 = 0;

    if (pState) {
        v1 = state.mediaPool[pState.clip1.mediaId].videoElement;
        time1 = pState.clip1.offsetSource + (state.playheadTime - pState.clip1.startTimeline);
        if (pState.clip2) {
            v2 = state.mediaPool[pState.clip2.mediaId].videoElement;
            time2 = pState.clip2.offsetSource + (state.playheadTime - pState.clip2.startTimeline);
        }

        // Standard Sync
        const syncOne = (v, time) => {
            if (!v) return;
            const threshold = state.isPlaying ? 0.3 : 0.04;
            if (Math.abs(v.currentTime - time) > threshold && !v.seeking) v.currentTime = time;
            if (state.isPlaying && v.paused) safePlay(v);
        };
        syncOne(v1, time1); syncOne(v2, time2);
        currentVideos = [v1, v2];
    }

    // 2. Comprehensive Sync for all active clips (Audio support)
    actives.forEach(clip => {
        const media = state.mediaPool[clip.mediaId];
        if (!media || !media.videoElement) return;
        const v = media.videoElement;

        // Sync time for all active clips if not already v1 or v2
        const time = clip.offsetSource + (state.playheadTime - clip.startTimeline);
        const threshold = state.isPlaying ? 0.3 : 0.05;
        if (pState && (v === v1 || v === v2)) {
            // Already synced time for v1/v2 above
        } else {
            if (Math.abs(v.currentTime - time) > threshold && !v.seeking) v.currentTime = time;
            if (state.isPlaying && v.paused) safePlay(v);
        }

        // Apply audio settings (to all active clips, audio and video)
        const afx = (clipEffects[clip.id] || {})['audio_cfg'] || { level: 100, mute: false };
        if (state.isPlaying) {
            v.muted = afx.mute;
            v.volume = Math.max(0.0, Math.min(1.0, afx.level / 100));
        } else {
            v.muted = true; // Force mute when not playing
        }
    });

    // 3. Render State Globals
    // Prioritize selected clip for effects if it's currently active on preview
    let primaryClip = null;
    if (pState) {
        const isSelActive = [pState.clip1, pState.clip2].find(c => c && c.id === state.selectedClipId);
        primaryClip = isSelActive || pState.clip2 || pState.clip1;
    }

    if (pState && primaryClip) {
        const gfxGlitch = (clipEffects[primaryClip.id] || {})['glitch'];
        const gfxWheels = (clipEffects[primaryClip.id] || {})['color_wheels'];
        const gfxHSL = (clipEffects[primaryClip.id] || {})['hsl_curves'];

        const v1El = state.mediaPool[pState.clip1.mediaId].videoElement;
        const v2El = pState.clip2 ? state.mediaPool[pState.clip2.mediaId].videoElement : null;

        // Strict readiness check for WebGPU (needs actual decoded frames, not just metadata/readyState)
        const isVideoReady = (v) => v && v.readyState >= 2 && v.getVideoPlaybackQuality && v.getVideoPlaybackQuality().totalVideoFrames > 0;

        window.renderStateGlobals = {
            v1: v1El,
            v2: v2El,
            v1Ready: isVideoReady(v1El),
            v2Ready: isVideoReady(v2El),
            alpha1: pState.alpha1, alpha2: pState.alpha2,
            primaryClipId: primaryClip.id,
            glitchEnabled: (gfxGlitch && gfxGlitch.enabled) ? 1.0 : 0.0,
            glitchIntensity: gfxGlitch ? (gfxGlitch.intensity || 70) / 100.0 : 0.0,
            glitchColorSep: gfxGlitch ? (gfxGlitch.colorSep || 4) / 500.0 : 0.0,
            glitchSpeed: gfxGlitch ? (gfxGlitch.speed || 5) : 0.0,
            glitchBorder: gfxGlitch ? (gfxGlitch.borderWidth || 6) : 0.0,
            glitchRows: gfxGlitch ? (gfxGlitch.rows || 30) : 30.0,
            colorEnabled: (gfxWheels && gfxWheels.enabled) ? 1.0 : 0.0,
            cw: gfxWheels || { liftR: 0, liftG: 0, liftB: 0, gammaR: 0, gammaG: 0, gammaB: 0, gainR: 1, gainG: 1, gainB: 1, offsetR: 0, offsetG: 0, offsetB: 0, temp: 0, tint: 0, contrast: 1, sat: 1, hue: 0 },
            hslEnabled: (gfxHSL && gfxHSL.enabled) ? 1.0 : 0.0,
            hsl: gfxHSL || { hMin: 0, hMax: 1, hSoft: 0.1, sMin: 0, sMax: 1, sSoft: 0.1, lMin: 0, lMax: 1, lSoft: 0.1, hueShift: 0, satShift: 1, lumShift: 1 },
            lumaMaskVideoEl: pState.lumaMaskVideoEl || null,
            maskProgress: pState.maskProgress || 0,
            maskOverlapDur: pState.maskOverlapDur || 1,
            maskDuration: pState.lumaMaskVideoEl ? pState.lumaMaskVideoEl.duration : 0
        };
    } else {
        window.renderStateGlobals = { v1: null, v2: null, v1Ready: false, v2Ready: false, alpha1: 0, alpha2: 0, glitchEnabled: 0, colorEnabled: 0, hslEnabled: 0, maskOverlapDur: 1 };
    }

    // 4. Final Cleanup
    Object.values(state.mediaPool).forEach(m => {
        if (!m.videoElement) return;
        const isActive = actives.some(c => c.mediaId === m.id);
        if (!isActive) safePause(m.videoElement);
    });
}

function _deleted_old_logic() { } // placeholder or just delete if used in multi_replace




function updateLoop() {
    if (state.isPlaying) {
        const now = performance.now();
        const dt = (now - lastTimeTime) / 1000;
        lastTimeTime = now;

        state.playheadTime += dt;
        updatePlayheadUI();
        syncVideoToPlayhead();
    } else if (!isDraggingPlayhead) {
        syncVideoToPlayhead();
    }

    requestAnimationFrame(updateLoop);
}

// --- WEBGPU RENDERER ---

let blendUniformBuffer;

async function initWebGPU() {
    if (!navigator.gpu) {
        console.error("WebGPU non supportato in questo browser.");
        return;
    }

    const canvas = document.getElementById('webgpu-canvas');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return;

    device = await adapter.requestDevice();
    context = canvas.getContext('webgpu');
    presentationFormat = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
        device,
        format: presentationFormat,
        alphaMode: 'premultiplied',
    });

    device.lost.then((info) => {
        console.error(`WebGPU device was lost: ${info.message}`);
        if (info.reason !== 'destroyed') {
            // Reload page to recover from crash
            location.reload();
        }
    });

    blendUniformBuffer = device.createBuffer({
        size: 256, // 64x f32 (padded to 256 bytes for alignment)
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const wgslCode = `
        struct VertexOutput {
            @builtin(position) Position : vec4<f32>,
            @location(0) fragUV : vec2<f32>,
        }

        @vertex
        fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
            var pos = array<vec2<f32>, 6>(
                vec2<f32>( 1.0,  1.0),
                vec2<f32>( 1.0, -1.0),
                vec2<f32>(-1.0, -1.0),
                vec2<f32>( 1.0,  1.0),
                vec2<f32>(-1.0, -1.0),
                vec2<f32>(-1.0,  1.0)
            );

            var uv = array<vec2<f32>, 6>(
                vec2<f32>(1.0, 0.0),
                vec2<f32>(1.0, 1.0),
                vec2<f32>(0.0, 1.0),
                vec2<f32>(1.0, 0.0),
                vec2<f32>(0.0, 1.0),
                vec2<f32>(0.0, 0.0)
            );

            var output : VertexOutput;
            output.Position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
            output.fragUV = uv[VertexIndex];
            return output;
        }

        @group(0) @binding(0) var mySampler: sampler;
        @group(0) @binding(1) var myTexture1: texture_external;
        @group(0) @binding(2) var myTexture2: texture_external;
        @group(0) @binding(4) var myMaskTexture: texture_external;
        
        struct Params { 
            // 16 floats (chunk 1-4)
            alpha1: f32, alpha2: f32, glitchEnabled: f32, glitchIntensity: f32,
            glitchColorSep: f32, glitchTime: f32, glitchBorder: f32, glitchRows: f32,
            lumaMaskEnabled: f32, colorEnabled: f32, hslEnabled: f32, _pad1: f32,
            _pad2: vec4<f32>,
            
            // Color Wheels: 16 floats (chunk 5-8)
            lg_lift: vec4<f32>,   
            lg_gamma: vec4<f32>,  
            lg_gain: vec4<f32>,   
            lg_offset: vec4<f32>, 
            
            // Color Sliders: 16 floats (chunk 9-12)
            c_temp: f32, c_tint: f32, c_contrast: f32, c_sat: f32,
            c_hue: f32, _pad3: f32, _pad4: f32, _pad5: f32,
            _pad6: vec4<f32>,
            _pad7: vec4<f32>,
            
            // HSL Qualifier: 16 floats (chunk 13-16)
            hsl_hue_min: f32, hsl_hue_max: f32, hsl_hue_soft: f32, hsl_hue_shift: f32,
            hsl_sat_min: f32, hsl_sat_max: f32, hsl_sat_soft: f32, hsl_sat_shift: f32,
            hsl_lum_min: f32, hsl_lum_max: f32, hsl_lum_soft: f32, hsl_lum_shift: f32,
            _pad8: vec4<f32>
        };
        @group(0) @binding(3) var<uniform> params: Params;

        fn hash(n: f32) -> f32 {
            return fract(sin(n) * 43758.5453123);
        }

        fn rgb2hsl(color: vec3<f32>) -> vec3<f32> {
            let cMin = min(min(color.r, color.g), color.b);
            let cMax = max(max(color.r, color.g), color.b);
            let delta = cMax - cMin;
            var h = 0.0; var s = 0.0; let l = (cMax + cMin) / 2.0;
            if (delta > 0.0) {
                s = select(delta / (2.0 - cMax - cMin), delta / (cMax + cMin), l < 0.5);
                if (cMax == color.r) { h = (color.g - color.b) / delta + select(0.0, 6.0, color.g < color.b); }
                else if (cMax == color.g) { h = (color.b - color.r) / delta + 2.0; }
                else { h = (color.r - color.g) / delta + 4.0; }
                h /= 6.0;
            }
            return vec3<f32>(h, s, l);
        }

        fn hue2rgb(p: f32, q: f32, tt: f32) -> f32 {
            var t = tt;
            if (t < 0.0) { t += 1.0; }
            if (t > 1.0) { t -= 1.0; }
            if (t < 1.0/6.0) { return p + (q - p) * 6.0 * t; }
            if (t < 1.0/2.0) { return q; }
            if (t < 2.0/3.0) { return p + (q - p) * (2.0/3.0 - t) * 6.0; }
            return p;
        }

        fn hsl2rgb(hsl: vec3<f32>) -> vec3<f32> {
            var r = hsl.z; var g = hsl.z; var b = hsl.z;
            if (hsl.y > 0.0) {
                let q = select(hsl.z + hsl.y - hsl.z * hsl.y, hsl.z * (1.0 + hsl.y), hsl.z < 0.5);
                let p = 2.0 * hsl.z - q;
                r = hue2rgb(p, q, hsl.x + 1.0/3.0);
                g = hue2rgb(p, q, hsl.x);
                b = hue2rgb(p, q, hsl.x - 1.0/3.0);
            }
            return vec3<f32>(r, g, b);
        }

        // Applies DaVinci style wheels: Lift, Gamma, Gain, Offset, Cont, Sat, Temp, Tint
        fn applyColorWheels(c_in: vec3<f32>) -> vec3<f32> {
            var c = c_in;
            // 1. Temp / Tint (simplified matrices)
            c.r += params.c_temp * 0.1;
            c.b -= params.c_temp * 0.1;
            c.g += params.c_tint * 0.1;

            // 2. Contrast
            c = (c - vec3<f32>(0.5)) * params.c_contrast + vec3<f32>(0.5);

            // 3. Lift, Gamma, Gain, Offset
            // Lift: modifies black point
            c = c + params.lg_lift.xyz * (1.0 - c);
            // Gain: modifies white point
            c = c * params.lg_gain.xyz;
            // Gamma: midtone power curve (clamp to avoid NaN on negative)
            c = pow(max(c, vec3<f32>(0.0)), max(vec3<f32>(0.01), 1.0 - params.lg_gamma.xyz));
            // Offset: global add
            c = c + params.lg_offset.xyz * 0.1;

            // 4. Saturation and Hue
            var hsl = rgb2hsl(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)));
            hsl.x = fract(hsl.x + params.c_hue);
            hsl.y = clamp(hsl.y * params.c_sat, 0.0, 1.0);
            return hsl2rgb(hsl);
        }

        // Applies HSL Qualifier Isolation & Adjustments
        fn applyHSLQualifier(c_in: vec3<f32>) -> vec3<f32> {
            let hsl = rgb2hsl(c_in);
            
            // Calculate mask based on ranges (with softness)
            // Hue wrap-around check
            var dh = hsl.x;
            var maskH = 0.0;
            if (params.hsl_hue_min > params.hsl_hue_max) {
                // cross zero
                let inRange = (dh >= params.hsl_hue_min) || (dh <= params.hsl_hue_max);
                // simplify softness for wrap-around (hard cut for now)
                maskH = select(0.0, 1.0, inRange);
            } else {
                maskH = smoothstep(params.hsl_hue_min - params.hsl_hue_soft, params.hsl_hue_min, dh) 
                          * (1.0 - smoothstep(params.hsl_hue_max, params.hsl_hue_max + params.hsl_hue_soft, dh));
            }
            
            let maskS = smoothstep(params.hsl_sat_min - params.hsl_sat_soft, params.hsl_sat_min, hsl.y) 
                      * (1.0 - smoothstep(params.hsl_sat_max, params.hsl_sat_max + params.hsl_sat_soft, hsl.y));
                      
            let maskL = smoothstep(params.hsl_lum_min - params.hsl_lum_soft, params.hsl_lum_min, hsl.z) 
                      * (1.0 - smoothstep(params.hsl_lum_max, params.hsl_lum_max + params.hsl_lum_soft, hsl.z));
            
            let finalMask = maskH * maskS * maskL;
            
            // Adjust isolated colors
            var adjHsl = hsl;
            adjHsl.x = fract(adjHsl.x + params.hsl_hue_shift);
            adjHsl.y = clamp(adjHsl.y * params.hsl_sat_shift, 0.0, 1.0);
            adjHsl.z = clamp(adjHsl.z * params.hsl_lum_shift, 0.0, 1.0);
            
            let c_adj = hsl2rgb(adjHsl);
            
            return mix(c_in, c_adj, finalMask);
        }

        @fragment
        fn frag_main(@location(0) fragUV : vec2<f32>) -> @location(0) vec4<f32> {
            var uv = fragUV;
            var displace = vec2<f32>(0.0);
            var color_sep = 0.0;
            var scan_mul = 1.0;

            if (params.glitchEnabled > 0.5) {
                let t = params.glitchTime;
                let intensity = params.glitchIntensity;
                
                color_sep = params.glitchColorSep * intensity;

                // Safe rows count
                let rows = max(2.0, params.glitchRows);
                let block_y = floor(uv.y * rows);
                let h = hash(block_y + floor(t * 12.0));
                
                if (h > (1.0 - 0.35 * intensity)) {
                    displace.x = (hash(h + t) - 0.5) * 0.12 * intensity;
                }
                
                // Fine noise and edge distortion
                displace.x += (hash(uv.y * 300.0 + t) - 0.5) * 0.003 * intensity;
                let edge_dist = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0; 
                let is_edge = step(0.95 - (params.glitchBorder * 0.004), edge_dist);
                displace.x *= (1.0 + is_edge * intensity * 4.0);

                let scanLine = sin(uv.y * 400.0 + t * 5.0) * 0.5 + 0.5;
                scan_mul = 1.0 - scanLine * 0.15 * intensity;
            }

            let uvBase = clamp(uv + displace, vec2<f32>(0.001), vec2<f32>(0.999));
            
            let c1G = textureSampleBaseClampToEdge(myTexture1, mySampler, uvBase);
            let c2G = textureSampleBaseClampToEdge(myTexture2, mySampler, uvBase);
            
            var r: f32; var g: f32; var b: f32; var out_a: f32;

            // LUMA MASK TRANSITION MODE
            if (params.lumaMaskEnabled > 1.5) {
                // Mask configured but not ready yet (buffering frame).
                // Freeze mix statically to avoid flashing back to crossfade or using base texture.
                let cMix = mix(c1G, c2G, 0.5);
                r = cMix.r;
                g = cMix.g;
                b = cMix.b;
                out_a = max(params.alpha1, params.alpha2);
            } else if (params.lumaMaskEnabled > 0.5) {
                let mask = textureSampleBaseClampToEdge(myMaskTexture, mySampler, uvBase);
                let luma = dot(mask.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
                // Inverted blend: User requests White (luma 1.0) = Video 2 (top clip), Black (luma 0.0) = Video 1 (base clip).
                // Wait! To get Video 2 when luma is 1.0, the mix order must be mix(Video1, Video2, luma).
                // Video1 is c1G (base clip). Video2 is c2G (top clip). 
                // But if they complain, maybe their base/top tracks aren't c1G/c2G in the way they expect. Let's swap the inputs to mix to invert the result.
                let cMix = mix(c2G, c1G, luma);
                r = cMix.r;
                g = cMix.g;
                b = cMix.b;
                out_a = max(params.alpha1, params.alpha2);
            } else if (color_sep > 0.0001) {
                // Glitch active: sample R and B channels with offset
                let uvR = clamp(uvBase + vec2<f32>(color_sep, 0.0), vec2<f32>(0.001), vec2<f32>(0.999));
                let uvB = clamp(uvBase - vec2<f32>(color_sep, 0.0), vec2<f32>(0.001), vec2<f32>(0.999));
                
                let c1R = textureSampleBaseClampToEdge(myTexture1, mySampler, uvR);
                let c1B = textureSampleBaseClampToEdge(myTexture1, mySampler, uvB);
                let c2R = textureSampleBaseClampToEdge(myTexture2, mySampler, uvR);
                let c2B = textureSampleBaseClampToEdge(myTexture2, mySampler, uvB);
                
                if (params.alpha2 > 0.01) {
                    r = c2R.r * params.alpha2 + c1R.r * params.alpha1 * (1.0 - params.alpha2);
                    g = c2G.g * params.alpha2 + c1G.g * params.alpha1 * (1.0 - params.alpha2);
                    b = c2B.b * params.alpha2 + c1B.b * params.alpha1 * (1.0 - params.alpha2);
                } else {
                    r = mix(c1R.r * params.alpha1, c2R.r, params.alpha2);
                    g = mix(c1G.g * params.alpha1, c2G.g, params.alpha2);
                    b = mix(c1B.b * params.alpha1, c2B.b, params.alpha2);
                }
                out_a = params.alpha2 + params.alpha1 * (1.0 - params.alpha2);
            } else {
                // No glitch: simple single sample mixing
                if (params.alpha2 > 0.01) {
                    r = c2G.r * params.alpha2 + c1G.r * params.alpha1 * (1.0 - params.alpha2);
                    g = c2G.g * params.alpha2 + c1G.g * params.alpha1 * (1.0 - params.alpha2);
                    b = c2G.b * params.alpha2 + c1G.b * params.alpha1 * (1.0 - params.alpha2);
                } else {
                    r = mix(c1G.r * params.alpha1, c2G.r, params.alpha2);
                    g = mix(c1G.g * params.alpha1, c2G.g, params.alpha2);
                    b = mix(c1G.b * params.alpha1, c2G.b, params.alpha2);
                }
                out_a = params.alpha2 + params.alpha1 * (1.0 - params.alpha2);
            }

            var finalColor = vec3<f32>(r, g, b);

            // Apply advanced color grading sequentially
            if (params.colorEnabled > 0.5) {
                finalColor = applyColorWheels(finalColor);
            }
            if (params.hslEnabled > 0.5) {
                finalColor = applyHSLQualifier(finalColor);
            }

            return vec4<f32>(finalColor * scan_mul, out_a);
        }
    `;

    const shaderModule = device.createShaderModule({ code: wgslCode });

    pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: shaderModule,
            entryPoint: 'vert_main',
        },
        fragment: {
            module: shaderModule,
            entryPoint: 'frag_main',
            targets: [{ format: presentationFormat }],
        },
        primitive: { topology: 'triangle-list' },
    });

    sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
    });

    requestAnimationFrame(renderPass);
}

function renderPass() {
    const s = window.renderStateGlobals;

    // Hide 2D fallback canvas if WebGPU is attempting to render
    const fb = document.getElementById('canvas-2d-fallback');
    if (fb) fb.style.display = 'none';

    if (s && s.v1) {
        const v1Ready = s.v1Ready;
        const v2Ready = s.v2Ready;

        // Determine primary representative video for dimensions
        const mainV = (s.alpha2 > 0.5 && v2Ready) ? s.v2 : s.v1;

        const canvas = document.getElementById('webgpu-canvas');
        if (canvas.width !== mainV.videoWidth || canvas.height !== mainV.videoHeight) {
            canvas.width = mainV.videoWidth || 1280;
            canvas.height = mainV.videoHeight || 720;
            // IMPORTANT: Re-configure context on resize or it may stop rendering
            context.configure({
                device,
                format: presentationFormat,
                alphaMode: 'premultiplied',
            });
        }

        try {
            const glTime = performance.now() * 0.001 * (s.glitchSpeed || 1);

            // Use strict, frame-verified ready states to dictate alpha rendering
            const v1Ready = s.v1Ready;
            const v2Ready = s.v2Ready;

            let finalAlpha1 = s.alpha1;
            let finalAlpha2 = s.alpha2;

            if (!v1Ready) finalAlpha1 = 0;
            if (s.v2 && !v2Ready) finalAlpha2 = 0;

            // Simple anti-flicker: only reduce V1 alpha if V2 is actually ready to take point
            if (s.alpha2 > 0.05 && !v2Ready) {
                // We keep background visible as fallback
            } else if (v2Ready) {
                finalAlpha1 *= (1.0 - (s.alpha2 * s.alpha2)); // quadratic curve for smoother alpha overlap
            }

            const lumaMaskEl = s.lumaMaskVideoEl;
            // 1.0 = Ready and masking. 2.0 = Configured but buffering. 0.0 = Off
            const lumaMaskEnabled = lumaMaskEl ? (lumaMaskEl.readyState >= 2 ? 1.0 : 2.0) : 0.0;

            // Sync mask video time to overlap progress position
            if (lumaMaskEl && s.maskDuration && lumaMaskEl.readyState >= 1) {
                const targetMaskTime = s.maskProgress * s.maskDuration;

                if (state.isPlaying) {
                    const targetPlaybackRate = s.maskDuration / s.maskOverlapDur;
                    if (Math.abs(lumaMaskEl.playbackRate - targetPlaybackRate) > 0.01) {
                        lumaMaskEl.playbackRate = targetPlaybackRate;
                    }
                    if (lumaMaskEl.paused) safePlay(lumaMaskEl);

                    // Only hard-seek if it goes badly out of sync while playing
                    if (Math.abs(lumaMaskEl.currentTime - targetMaskTime) > 0.3) {
                        lumaMaskEl.currentTime = targetMaskTime;
                    }
                } else {
                    if (!lumaMaskEl.paused) safePause(lumaMaskEl);
                    if (Math.abs(lumaMaskEl.currentTime - targetMaskTime) > 0.05) {
                        lumaMaskEl.currentTime = targetMaskTime;
                    }
                }
            }

            const cw = s.cw || {};
            const hsl = s.hsl || {};

            const uniformData = new Float32Array(64); // 256 bytes

            // Chunk 1-4
            uniformData[0] = finalAlpha1; uniformData[1] = finalAlpha2;
            uniformData[2] = s.glitchEnabled || 0; uniformData[3] = s.glitchIntensity || 0;
            uniformData[4] = s.glitchColorSep || 0; uniformData[5] = glTime;
            uniformData[6] = s.glitchBorder || 0; uniformData[7] = s.glitchRows || 30;
            uniformData[8] = lumaMaskEnabled; uniformData[9] = s.colorEnabled || 0;
            uniformData[10] = s.hslEnabled || 0; uniformData[11] = 0; // pad1
            uniformData[12] = 0; uniformData[13] = 0; uniformData[14] = 0; uniformData[15] = 0; // _pad2 vec4

            // Chunk 5-8 (Wheels)
            uniformData[16] = cw.liftR || 0; uniformData[17] = cw.liftG || 0; uniformData[18] = cw.liftB || 0; uniformData[19] = 0;
            uniformData[20] = cw.gammaR || 0; uniformData[21] = cw.gammaG || 0; uniformData[22] = cw.gammaB || 0; uniformData[23] = 0;
            uniformData[24] = cw.gainR ?? 1; uniformData[25] = cw.gainG ?? 1; uniformData[26] = cw.gainB ?? 1; uniformData[27] = 0;
            uniformData[28] = cw.offsetR || 0; uniformData[29] = cw.offsetG || 0; uniformData[30] = cw.offsetB || 0; uniformData[31] = 0;

            // Chunk 9-12 (Sliders)
            uniformData[32] = cw.temp || 0; uniformData[33] = cw.tint || 0;
            uniformData[34] = cw.contrast ?? 1; uniformData[35] = cw.sat ?? 1;
            uniformData[36] = cw.hue || 0; uniformData[37] = 0; uniformData[38] = 0; uniformData[39] = 0;
            uniformData[40] = 0; uniformData[41] = 0; uniformData[42] = 0; uniformData[43] = 0; // _pad6
            uniformData[44] = 0; uniformData[45] = 0; uniformData[46] = 0; uniformData[47] = 0; // _pad7

            // Chunk 13-16 (HSL)
            uniformData[48] = hsl.hMin || 0; uniformData[49] = hsl.hMax ?? 1; uniformData[50] = hsl.hSoft || 0.1; uniformData[51] = hsl.hueShift || 0;
            uniformData[52] = hsl.sMin || 0; uniformData[53] = hsl.sMax ?? 1; uniformData[54] = hsl.sSoft || 0.1; uniformData[55] = hsl.satShift ?? 1;
            uniformData[56] = hsl.lMin || 0; uniformData[57] = hsl.lMax ?? 1; uniformData[58] = hsl.lSoft || 0.1; uniformData[59] = hsl.lumShift ?? 1;
            uniformData[60] = 0; uniformData[61] = 0; uniformData[62] = 0; uniformData[63] = 0; // _pad8

            device.queue.writeBuffer(blendUniformBuffer, 0, uniformData);

            // Safely resolve sources to avoid InvalidStateError in importExternalTexture
            // We use the stricter v1Ready flag computed in getActiveRenderState to ensure frames exist
            const validV1 = s.v1Ready ? s.v1 : null;
            const validV2 = s.v2Ready ? s.v2 : null;
            const validMask = (lumaMaskEl && lumaMaskEl.readyState >= 2 && lumaMaskEl.getVideoPlaybackQuality && lumaMaskEl.getVideoPlaybackQuality().totalVideoFrames > 0) ? lumaMaskEl : null;

            // If absolutely nothing is ready, skip drawing this frame to avoid crashing WebGPU
            if (!validV1 && !validV2 && !validMask) {
                requestAnimationFrame(renderPass);
                return;
            }

            // Fallback to whichever video is valid if one is missing (alphas will hide the mismatch)
            const fallbackSrc = validV1 || validV2 || validMask;
            const texture1 = device.importExternalTexture({ source: validV1 || fallbackSrc });
            const texture2 = device.importExternalTexture({ source: validV2 || fallbackSrc });
            const textureMask = device.importExternalTexture({ source: validMask || fallbackSrc });

            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: sampler },
                    { binding: 1, resource: texture1 },
                    { binding: 2, resource: texture2 },
                    { binding: 3, resource: { buffer: blendUniformBuffer } },
                    { binding: 4, resource: textureMask }
                ],
            });
            const commandEncoder = device.createCommandEncoder();
            const textureView = context.getCurrentTexture().createView();
            const renderPassDescriptor = {
                colorAttachments: [{
                    view: textureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
            };
            const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
            passEncoder.setPipeline(pipeline);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.draw(6, 1, 0, 0);
            passEncoder.end();
            device.queue.submit([commandEncoder.finish()]);
        } catch (e) {
            console.error("WebGPU Render Error:", e);
            if (!state.isPlaying) draw2DFallback(mainV);
        }
    } else {
        // Safe clear to avoid GPU state issues when no video is active
        if (device && context) {
            try {
                const commandEncoder = device.createCommandEncoder();
                const textureView = context.getCurrentTexture().createView();
                const passEncoder = commandEncoder.beginRenderPass({
                    colorAttachments: [{
                        view: textureView,
                        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
                        loadOp: 'clear',
                        storeOp: 'store',
                    }],
                });
                passEncoder.end();
                device.queue.submit([commandEncoder.finish()]);
            } catch (e) { }
        }
    }
    requestAnimationFrame(renderPass);
}

// 2D canvas fallback: draws a single video frame onto a visible canvas overlay
function draw2DFallback(videoEl) {
    if (state.isPlaying) return; // Never show fallback while playing

    let fb = document.getElementById('canvas-2d-fallback');
    if (!fb) {
        fb = document.createElement('canvas');
        fb.id = 'canvas-2d-fallback';
        fb.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;z-index:1;display:block;pointer-events:none;';
        const viewportContent = document.querySelector('.viewport-content');
        if (viewportContent) viewportContent.appendChild(fb);
    }
    if (videoEl.videoWidth > 0) {
        fb.width = videoEl.videoWidth;
        fb.height = videoEl.videoHeight;
        const ctx = fb.getContext('2d');
        ctx.drawImage(videoEl, 0, 0);
    }
    fb.style.display = 'block';

    // Hide as soon as the video is playing or we scrub again
    // We don't use setTimeout here as it's a major source of flickering
}



// --- UTILITIES ---
function formatTime(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 30); // Simulated frames 30fps
    return `00:${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
}

// --- EXPORT LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    const exportTrigger = document.getElementById('btn-export-trigger');
    const exportModal = document.getElementById('export-modal');
    const closeModals = document.querySelectorAll('.close-modal');
    const startExportBtn = document.getElementById('start-export-btn');

    if (exportTrigger && exportModal) {
        exportTrigger.addEventListener('click', () => {
            exportModal.style.display = 'flex';
        });
    }

    if (closeModals) {
        closeModals.forEach(btn => btn.addEventListener('click', () => {
            if (exportModal) exportModal.style.display = 'none';
        }));
    }

    let mediaRecorder;
    let recordedChunks = [];
    let exportInterval;

    if (startExportBtn) {
        startExportBtn.addEventListener('click', () => {
            const format = document.getElementById('export-format').value; // e.g. video/webm; codecs=vp9
            const res = document.getElementById('export-resolution').value.split('x'); // e.g. 1920x1080
            const fps = parseInt(document.getElementById('export-fps').value, 10);

            const canvas = document.getElementById('webgpu-canvas');
            if (!canvas) return;

            // Forza temporaneamente il rendering alla risoluzione scelta
            const originalWidth = canvas.width;
            const originalHeight = canvas.height;
            canvas.width = parseInt(res[0], 10);
            canvas.height = parseInt(res[1], 10);

            if (context && device && presentationFormat) {
                context.configure({
                    device,
                    format: presentationFormat,
                    alphaMode: 'premultiplied'
                });
            }

            recordedChunks = [];
            const stream = canvas.captureStream(fps);

            try {
                // Tentativo con il codec selezionato
                mediaRecorder = new MediaRecorder(stream, { mimeType: format, videoBitsPerSecond: 8000000 });
            } catch (e) {
                console.warn("Codec non supportato nativamente per l'export. Uso i default.", e);
                mediaRecorder = new MediaRecorder(stream);
            }

            mediaRecorder.ondataavailable = function (e) {
                if (e.data.size > 0) {
                    recordedChunks.push(e.data);
                }
            };

            mediaRecorder.onstop = function () {
                const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                document.body.appendChild(a);
                a.style = 'display: none';
                a.href = url;

                // Mantiene il formato corretto (.webm di default)
                let ext = 'webm';
                if (mediaRecorder.mimeType && mediaRecorder.mimeType.includes('mp4')) ext = 'mp4';

                a.download = `WoxVideo_Export_${res[0]}x${res[1]}_${fps}fps.${ext}`;
                a.click();
                window.URL.revokeObjectURL(url);

                const statusEl = document.getElementById('export-status');
                if (statusEl) statusEl.textContent = "Esportazione completata!";

                // Ripristino canvas Originale
                canvas.width = originalWidth;
                canvas.height = originalHeight;
                if (context && device && presentationFormat) {
                    context.configure({
                        device,
                        format: presentationFormat,
                        alphaMode: 'premultiplied'
                    });
                }

                setTimeout(() => {
                    if (exportModal) exportModal.style.display = 'none';
                    if (statusEl) statusEl.textContent = '';
                }, 2000);
            };

            // Trova la durata totale della timeline
            let maxTime = 0;
            state.clips.forEach(c => maxTime = Math.max(maxTime, c.endTimeline));

            if (maxTime === 0) {
                alert("Niente da esportare!");
                return;
            }

            // Rewind
            state.playheadTime = 0;
            updatePlayheadUI();
            syncVideoToPlayhead();

            const statusEl = document.getElementById('export-status');
            if (statusEl) statusEl.textContent = "Esportazione in corso... Attendere il termine del playback.";
            startExportBtn.disabled = true;

            mediaRecorder.start();

            // Fai partire la riproduzione se non lo è
            if (!state.isPlaying) togglePlay();

            // Polling per controllare la fine del video
            exportInterval = setInterval(() => {
                if (state.playheadTime >= maxTime) {
                    clearInterval(exportInterval);
                    if (state.isPlaying) togglePlay(); // Mette in pausa
                    mediaRecorder.stop();
                    startExportBtn.disabled = false;
                }
            }, 500);
        });
    }
});
