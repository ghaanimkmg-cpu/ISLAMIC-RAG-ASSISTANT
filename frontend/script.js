'use strict';

/* ── BACKGROUND PARTICLE ANIMATION ── */
(function initParticles() {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        canvas.style.display = 'none';
        return;
    }

    const ctx = canvas.getContext('2d');
    let W, H;
    const GOLD   = [201, 168, 76];
    const SILVER = [210, 200, 185];
    const PARTICLE_COUNT = 80;
    let particles = [];

    function resize() {
        W = canvas.width  = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }

    function rand(min, max) { return Math.random() * (max - min) + min; }

    function makeParticle(startAtBottom = false) {
        const isGold = Math.random() < 0.45;
        const col = isGold ? GOLD : SILVER;
        return {
            x:     rand(0, W),
            y:     startAtBottom ? rand(H * 0.5, H + 10) : rand(0, H),
            r:     rand(0.8, 2.6),
            vy:    -rand(0.15, 0.45),
            phase: rand(0, Math.PI * 2),
            freq:  rand(0.003, 0.009),
            amp:   rand(12, 40),
            baseAlpha: rand(0.3, 0.65),
            pulse:      rand(0, Math.PI * 2),
            pulseSpeed: rand(0.004, 0.012),
            col,
        };
    }

    function init() {
        resize();
        particles = Array.from({ length: PARTICLE_COUNT }, () => makeParticle(false));
    }

    let frame = 0;
    function draw() {
        ctx.clearRect(0, 0, W, H);
        frame++;

        // Draw connecting lines between nearby particles
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 100) {
                    const lineAlpha = (1 - dist / 100) * 0.12;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(201,168,76,${lineAlpha.toFixed(3)})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }

        // Draw particles
        particles.forEach(p => {
            p.x += Math.sin(frame * p.freq + p.phase) * 0.3;
            p.y += p.vy;

            const pulse = Math.sin(frame * p.pulseSpeed + p.pulse) * 0.5 + 0.5;
            const alpha = p.baseAlpha * (0.55 + pulse * 0.45);

            if (p.y < -6) {
                Object.assign(p, makeParticle(true));
                p.y = H + 4;
            }

            // Glow halo
            const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.5);
            grad.addColorStop(0,   `rgba(${p.col},${(alpha * 0.9).toFixed(3)})`);
            grad.addColorStop(0.4, `rgba(${p.col},${(alpha * 0.4).toFixed(3)})`);
            grad.addColorStop(1,   `rgba(${p.col},0)`);
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * 3.5, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();

            // Solid core
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${p.col},${alpha.toFixed(3)})`;
            ctx.fill();
        });

        requestAnimationFrame(draw);
    }

    window.addEventListener('resize', init);
    init();
    draw();
})();


const BASE = 'http://127.0.0.1:8001';

/* ── DOM ── */
const fileInput     = document.getElementById('file-input');
const dropZone      = document.getElementById('drop-zone');
const dropContent   = document.getElementById('drop-content');
const fileSelected  = document.getElementById('file-selected');
const selectedName  = document.getElementById('selected-name');
const clearBtn      = document.getElementById('clear-btn');
const uploadBtn     = document.getElementById('upload-btn');
const uploadSpinner = document.getElementById('upload-spinner');
const uploadResult  = document.getElementById('upload-result');

const questionInput = document.getElementById('question-input');
const askBtn        = document.getElementById('ask-btn');
const askSpinner    = document.getElementById('ask-spinner');
const askError      = document.getElementById('ask-error');

const answerWrap    = document.getElementById('answer-wrap');
const answerBody    = document.getElementById('answer-body');
const sourcesWrap   = document.getElementById('sources-wrap');
const sourcesList   = document.getElementById('sources-list');

/* ── FILE SELECTION ── */
fileInput.addEventListener('change', () => onFileChange(fileInput.files[0]));

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('active');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('active'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('active');
    const f = e.dataTransfer.files[0];
    if (f) {
        const dt = new DataTransfer();
        dt.items.add(f);
        fileInput.files = dt.files;
        onFileChange(f);
    }
});

clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetFile();
});

function onFileChange(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.txt')) {
        showUploadResult('error', 'Only <strong>.txt</strong> files are accepted.');
        resetFile();
        return;
    }
    selectedName.textContent = file.name;
    dropContent.classList.add('hidden');
    fileSelected.classList.remove('hidden');
    uploadBtn.disabled = false;
    uploadResult.classList.add('hidden');
}

function resetFile() {
    fileInput.value = '';
    dropContent.classList.remove('hidden');
    fileSelected.classList.add('hidden');
    uploadBtn.disabled = true;
    uploadResult.classList.add('hidden');
    uploadResult.innerHTML = '';
}

/* ── UPLOAD ── */
uploadBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    setLoading(uploadBtn, uploadSpinner, true);
    uploadResult.classList.add('hidden');
    answerWrap.classList.add('hidden');

    const fd = new FormData();
    fd.append('file', file);

    try {
        const res  = await fetch(`${BASE}/upload`, { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Upload failed');

        showUploadResult('success',
            `<strong>Indexed successfully</strong>
             <span>${data.filename} &nbsp;·&nbsp; ${data.total_word_count.toLocaleString()} words &nbsp;·&nbsp; ${data.total_chunks_stored} chunks</span>`
        );

    } catch (err) {
        showUploadResult('error', err.message || 'Upload failed. Is the backend running?');
    } finally {
        setLoading(uploadBtn, uploadSpinner, false);
    }
});

/* ── QUERY ── */
askBtn.addEventListener('click', async () => {
    const question = questionInput.value.trim();
    hideError();

    if (!question) {
        showError('Please enter a question first.');
        return;
    }

    setLoading(askBtn, askSpinner, true);
    answerWrap.classList.add('hidden');
    sourcesList.innerHTML = '';
    sourcesWrap.classList.add('hidden');

    try {
        const res  = await fetch(`${BASE}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Query failed');

        // Display answer
        answerBody.textContent = data.answer || '—';
        answerWrap.classList.remove('hidden');

        // Check if the answer means "Not found"
        const isNotFound = data.answer && data.answer.includes("I could not find relevant information");

        // Display sources only if relevant
        if (!isNotFound && data.sources && data.sources.length > 0) {
            sourcesWrap.classList.remove('hidden');
            data.sources.forEach((s, i) => {
                const m = s.metadata || {};
                const card = document.createElement('div');
                card.className = 'source-card';
                card.style.animationDelay = `${i * 0.07}s`;
                card.innerHTML = `
                    <div class="source-tags">
                        <span class="tag tag-num">Source ${s.source_number}</span>
                        ${m.filename  ? `<span class="tag tag-file">${m.filename}</span>` : ''}
                        ${m.chunk_index !== undefined ? `<span class="tag tag-chunk">Chunk #${m.chunk_index}</span>` : ''}
                        ${s.distance  != null ? `<span class="tag tag-dist">Dist ${parseFloat(s.distance).toFixed(3)}</span>` : ''}
                    </div>
                    <div class="source-text">"${s.text}"</div>
                `;
                sourcesList.appendChild(card);
            });
        }

        answerWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (err) {
        showError(err.message || 'Query failed. Make sure a document is uploaded and the backend is running.');
    } finally {
        setLoading(askBtn, askSpinner, false);
    }
});

/* ── HELPERS ── */
function setLoading(btn, spinner, on) {
    const label = btn.querySelector('.btn-label');
    const statusText = document.querySelector('.raya-status-text');
    btn.disabled = on;
    if (on) {
        label.classList.add('hidden');
        spinner.classList.remove('hidden');
        if (btn.id === 'ask-btn' && statusText) statusText.textContent = "Raya is thinking...";
    } else {
        label.classList.remove('hidden');
        spinner.classList.add('hidden');
        if (btn.id === 'ask-btn' && statusText) statusText.textContent = "Ready to answer";
    }
}

function showUploadResult(type, html) {
    uploadResult.className = `result-area result-${type}`;
    uploadResult.innerHTML = html;
    uploadResult.classList.remove('hidden');
}

function showError(msg) {
    askError.textContent = msg;
    askError.classList.remove('hidden');
}

function hideError() {
    askError.classList.add('hidden');
    askError.textContent = '';
}
