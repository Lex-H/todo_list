const STORAGE_KEY = 'starwish_todos';
const starterTodos = [
    { id: 1, text: '歡迎使用星願清單', completed: false },
    { id: 2, text: '點擊核取方塊完成任務', completed: true }
];

function loadTodos() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        const parsed = saved ? JSON.parse(saved) : starterTodos;
        return Array.isArray(parsed)
            ? parsed.filter(item => item && (typeof item.id === 'string' || typeof item.id === 'number') && typeof item.text === 'string')
                .map(item => ({ id: item.id, text: item.text, completed: Boolean(item.completed) }))
            : starterTodos;
    } catch {
        return starterTodos;
    }
}

let todos = loadTodos();
let undoStack = [];
let redoStack = [];
let activeEditInput = null;
const listContainers = [...document.querySelectorAll('[data-todo-list]')];

function recordUndo() {
    undoStack.push(JSON.stringify(todos));
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
}

function updateHistoryButtons() {
    document.querySelector('[data-undo]').disabled = undoStack.length === 0;
    document.querySelector('[data-redo]').disabled = redoStack.length === 0;
}

function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(todos));
    todos = JSON.parse(undoStack.pop());
    persistTodos(); renderList(); updateHistoryButtons();
}

function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(todos));
    todos = JSON.parse(redoStack.pop());
    persistTodos(); renderList(); updateHistoryButtons();
}

function persistTodos() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    } catch {
        // The list remains usable for this page session if browser storage is unavailable.
    }
}

function makeButton(className, label, symbol) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.setAttribute('aria-label', label);
    button.textContent = symbol;
    return button;
}

function renderList() {
    const sorted = [...todos].sort((a, b) => Number(a.completed) - Number(b.completed));
    listContainers.forEach(container => {
        container.replaceChildren();
        if (!sorted.length) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = '清單目前是空的，新增一個任務開始吧。';
            container.append(empty);
            return;
        }

        sorted.forEach(todo => {
            const row = document.createElement('article');
            row.className = `todo-item${todo.completed ? ' completed' : ''}`;
            row.dataset.id = String(todo.id);
            // A blank item's text span has no visible width, so allow the row itself
            // to open the editor when the user clicks its otherwise-empty area.
            row.addEventListener('click', event => {
                if (!todo.text.trim() && !event.target.closest('button')) beginEdit(row, todo);
            });

            const checkbox = makeButton('check-box', todo.completed ? `標記「${todo.text}」為未完成` : `完成「${todo.text}」`, '');
            checkbox.setAttribute('aria-pressed', String(todo.completed));
            checkbox.addEventListener('click', () => toggleTodo(todo.id));

            const handle = makeButton('drag-handle', `長按拖曳「${todo.text}」調整順序`, '⠿');
            enableReordering(handle, row, todo);

            const text = document.createElement('span');
            text.className = 'item-text';
            text.textContent = todo.text;
            text.title = '點擊編輯任務';
            text.addEventListener('click', () => beginEdit(row, todo));

            const deleteButton = makeButton('task-action delete-action', `刪除「${todo.text}」`, '×');
            deleteButton.addEventListener('click', () => deleteTodo(row, todo.id));

            row.append(handle, checkbox, text, deleteButton);
            container.append(row);
        });
    });
}

function enableReordering(handle, row, todo) {
    let holdTimer;
    let dragging = false;
    let activePointerId = null;
    let grabOffsetY = 0;

    handle.addEventListener('pointerdown', event => {
        if (!event.isPrimary || (event.button !== undefined && event.button !== 0)) return;
        event.preventDefault();
        activePointerId = event.pointerId;
        holdTimer = window.setTimeout(() => {
            dragging = true;
            grabOffsetY = event.clientY - row.getBoundingClientRect().top;
            row.classList.add('is-dragging');
        }, 350);
    });

    document.addEventListener('pointermove', event => {
        if (event.pointerId !== activePointerId) return;
        if (!dragging) return;
        event.preventDefault();
        const desiredTop = event.clientY - grabOffsetY;
        const currentTransform = row.style.transform;
        row.style.transform = 'none';
        const naturalTop = row.getBoundingClientRect().top;
        row.style.transform = currentTransform;
        row.style.setProperty('--drag-offset-y', `${desiredTop - naturalTop}px`);
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.todo-item');
        if (!target || target === row || target.classList.contains('completed') !== todo.completed) return;
        const bounds = target.getBoundingClientRect();
        const after = event.clientY > bounds.top + bounds.height / 2;
        target.parentElement.insertBefore(row, after ? target.nextSibling : target);
    });

    const finishDrag = event => {
        if (event && event.pointerId !== activePointerId) return;
        window.clearTimeout(holdTimer);
        activePointerId = null;
        if (!dragging) return;
        dragging = false;
        row.classList.remove('is-dragging');
        row.style.removeProperty('--drag-offset-y');
        const orderedIds = [...row.parentElement.querySelectorAll('.todo-item')].map(item => item.dataset.id);
        const group = todos.filter(item => item.completed === todo.completed);
        const reorderedGroup = orderedIds
            .map(id => group.find(item => String(item.id) === id))
            .filter(Boolean);
        let groupIndex = 0;
        const changed = group.some((item, index) => item.id !== reorderedGroup[index]?.id);
        if (changed) recordUndo();
        todos = todos.map(item => item.completed === todo.completed ? reorderedGroup[groupIndex++] : item);
        persistTodos();
        renderList();
    };
    document.addEventListener('pointerup', finishDrag);
    document.addEventListener('pointercancel', finishDrag);
}

function beginEdit(row, todo) {
    if (row.querySelector('.edit-input')) return;
    const input = document.createElement('input');
    input.className = 'edit-input';
    input.type = 'text';
    input.value = todo.text;
    input.setAttribute('aria-label', `編輯任務：${todo.text}`);
    activeEditInput = input;
    const text = row.querySelector('.item-text');
    text.replaceWith(input);
    let enterTimer = null;
    const finish = save => {
        if (!input.isConnected) return;
        const value = input.value.trim();
        if (save && value) {
            if (value !== todo.text) {
                recordUndo();
                todos = todos.map(item => item.id === todo.id ? { ...item, text: value } : item);
                persistTodos();
            }
        }
        if (activeEditInput === input) {
            activeEditInput = null;
            renderList();
            return;
        }

        // A click may have opened another editor while this input was blurring.
        // Update this row in place so the new editor keeps focus.
        const updatedText = document.createElement('span');
        updatedText.className = 'item-text';
        updatedText.textContent = todos.find(item => item.id === todo.id)?.text ?? todo.text;
        updatedText.title = '點擊編輯任務';
        updatedText.addEventListener('click', () => beginEdit(row, todo));
        input.replaceWith(updatedText);
    };
    input.addEventListener('keydown', event => {
        // Ignore held-key repeats and Enter used by an IME to confirm a candidate.
        if (event.repeat || event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            if (enterTimer !== null) {
                window.clearTimeout(enterTimer);
                enterTimer = null;
                const listContainer = row.parentElement;
                const orderedTodos = [...todos].sort((a, b) => Number(a.completed) - Number(b.completed));
                const currentIndex = orderedTodos.findIndex(item => String(item.id) === String(todo.id));
                // Move to the very next row, including an empty task row.
                const nextTodoId = orderedTodos[currentIndex + 1]?.id;
                finish(true);
                if (nextTodoId !== undefined) {
                    const nextId = String(nextTodoId);
                    const target = listContainer.querySelector(`.todo-item[data-id="${CSS.escape(nextId)}"]`);
                    const targetTodo = todos.find(item => String(item.id) === nextId);
                    if (target && targetTodo) beginEdit(target, targetTodo);
                }
            } else {
                // Give a second quick Enter a chance to move two rows down.
                enterTimer = window.setTimeout(() => {
                    enterTimer = null;
                    finish(true);
                }, 500);
            }
        }
        if (event.key === 'Escape') {
            if (enterTimer !== null) window.clearTimeout(enterTimer);
            enterTimer = null;
            finish(false);
        }
    });
    // Let the click on another item's text run before rerendering the list.
    // Otherwise blur replaces the clicked element before its click handler can
    // open that item's editor.
    input.addEventListener('blur', () => {
        if (enterTimer !== null) window.clearTimeout(enterTimer);
        enterTimer = null;
        window.setTimeout(() => finish(true), 0);
    }, { once: true });
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
}

function addBlankTodo() {
    const todo = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: '', completed: false };
    recordUndo();
    todos.unshift(todo);
    persistTodos();
    renderList();
    const row = document.querySelector(`#mobile-ui [data-id="${CSS.escape(String(todo.id))}"]`);
    if (row) beginEdit(row, todo);
}

function addTodo(text) {
    recordUndo();
    todos.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, completed: false });
    persistTodos();
    renderList();
}

function toggleTodo(id) {
    recordUndo();
    todos = todos.map(todo => todo.id === id ? { ...todo, completed: !todo.completed } : todo);
    persistTodos();
    renderList();
}

function deleteTodo(row, id) {
    row.classList.add('is-removing');
    window.setTimeout(() => {
        recordUndo();
        todos = todos.filter(todo => todo.id !== id);
        persistTodos();
        renderList();
    }, 160);
}

document.querySelectorAll('[data-add-form]').forEach(form => {
    form.addEventListener('submit', event => {
        event.preventDefault();
        const input = form.elements.task;
        const text = input.value.trim();
        if (!text) return;
        addTodo(text);
        input.value = '';
        input.focus();
    });
});

document.querySelector('[data-add-blank]').addEventListener('click', addBlankTodo);
document.querySelector('[data-undo]').addEventListener('click', undo);
document.querySelector('[data-redo]').addEventListener('click', redo);
const API_KEY_STORAGE = 'starwish_gemini_api_key';
const settingsDialog = document.querySelector('[data-settings-dialog]');
const chatDialog = document.querySelector('[data-chat-dialog]');
const keyInput = document.querySelector('#api-key-input');
const chatMessages = document.querySelector('[data-chat-messages]');
const chatStatus = document.querySelector('[data-chat-status]');
const recordButton = document.querySelector('[data-record]');
const retryVoiceButton = document.querySelector('[data-retry-voice]');
const stopVoiceButton = document.querySelector('[data-stop-voice]');
let mediaRecorder = null;
let recordingStream = null;
let recordingChunks = [];
let lastReplyText = '';
let currentAudioUrl = null;
let currentAudio = null;
let chatBusy = false;

function showSettings() {
    keyInput.value = localStorage.getItem(API_KEY_STORAGE) || '';
    document.querySelector('[data-settings-status]').textContent = keyInput.value ? 'API Key 已儲存在本機。' : '';
    settingsDialog.showModal();
}

document.querySelectorAll('[data-open-settings]').forEach(button => button.addEventListener('click', showSettings));
document.querySelector('[data-nav-toggle]').addEventListener('click', () => {
    document.getElementById('pc-nav').classList.toggle('expanded');
    showSettings();
});
document.querySelector('[data-save-key]').addEventListener('click', () => {
    const value = keyInput.value.trim();
    if (!value) {
        document.querySelector('[data-settings-status]').textContent = '請先輸入 API Key。';
        keyInput.focus();
        return;
    }
    localStorage.setItem(API_KEY_STORAGE, value);
    document.querySelector('[data-settings-status]').textContent = '已自動儲存在這台裝置。';
});
keyInput.addEventListener('input', () => {
    if (keyInput.value.trim()) {
        localStorage.setItem(API_KEY_STORAGE, keyInput.value.trim());
        document.querySelector('[data-settings-status]').textContent = '輸入內容已自動儲存在這台裝置。';
    }
});
document.querySelector('[data-clear-key]').addEventListener('click', () => {
    localStorage.removeItem(API_KEY_STORAGE);
    keyInput.value = '';
    document.querySelector('[data-settings-status]').textContent = '已清除本機 API Key。';
});
document.querySelector('[data-toggle-key]').addEventListener('click', event => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    event.currentTarget.textContent = keyInput.type === 'password' ? '顯示' : '隱藏';
});

function setChatStatus(message) { chatStatus.textContent = message; }
function addChatMessage(kind, text) {
    chatMessages.querySelector('.chat-empty')?.remove();
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${kind}`;
    bubble.textContent = text;
    chatMessages.append(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return bubble;
}
function base64FromBlob(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('無法讀取錄音檔。'));
        reader.readAsDataURL(blob);
    });
}
async function geminiRequest(url, key, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || `Gemini API 請求失敗（${response.status}）。`);
    return data;
}
async function askGemini(blob) {
    const key = localStorage.getItem(API_KEY_STORAGE);
    if (!key) {
        showSettings();
        throw new Error('請先在設定填入 Gemini API Key。');
    }
    const todosSnapshot = todos.map(todo => ({ text: todo.text, completed: todo.completed }));
    const prompt = `你是星願清單裡親切、可愛又有幫助的女生夥伴。請用使用者說話的語言，簡潔自然地回答錄音中的問題。以下是使用者目前全部代辦事項（completed=true 代表已完成）：\n${JSON.stringify(todosSnapshot)}\n把清單當作回答背景，不要自行聲稱已修改事項。`;
    const audioBase64 = await base64FromBlob(blob);
    const recordedMime = (blob.type || 'audio/webm').split(';')[0].toLowerCase();
    const audioMime = recordedMime === 'audio/mp4' ? 'audio/aac' : recordedMime;
    const result = await geminiRequest('https://generativelanguage.googleapis.com/v1beta/interactions', key, {
        model: 'gemini-3.5-flash-lite',
        input: [
            { type: 'text', text: prompt },
            { type: 'audio', data: audioBase64, mime_type: audioMime }
        ]
    });
    const reply = result.output_text || result.steps?.flatMap(step => step.content || [])
        .filter(item => item.type === 'text').map(item => item.text || '').join('').trim();
    if (!reply) throw new Error('Gemini 沒有回傳文字，請再試一次。');
    return reply;
}
async function speakReply(text) {
    currentAudio?.pause();
    currentAudio = null;
    stopVoiceButton.hidden = true;
    const key = localStorage.getItem(API_KEY_STORAGE);
    setChatStatus('正在準備語音…');
    retryVoiceButton.hidden = true;
    try {
        const result = await geminiRequest('https://generativelanguage.googleapis.com/v1beta/interactions', key, {
            model: 'gemini-3.8-flash-tts',
            input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: 'cute, warm, gentle, cheerful female voice; speak naturally in Traditional Chinese' }] }] }],
            response_format: { type: 'audio' },
            generation_config: { speech_config: [{ voice: 'Kore' }] }
        });
        const audioData = result.output_audio?.data || result.steps?.flatMap(step => step.content || []).find(item => item.type === 'audio')?.data;
        if (!audioData) throw new Error('沒有收到語音資料。');
        if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
        const audioBytes = Uint8Array.from(atob(audioData), char => char.charCodeAt(0));
        currentAudioUrl = URL.createObjectURL(new Blob([audioBytes], { type: 'audio/wav' }));
        const audio = new Audio(currentAudioUrl);
        currentAudio = audio;
        audio.addEventListener('ended', () => {
            if (currentAudio !== audio) return;
            currentAudio = null;
            stopVoiceButton.hidden = true;
            setChatStatus('語音播放完成。');
        }, { once: true });
        await audio.play();
        stopVoiceButton.hidden = false;
        setChatStatus('正在播放語音…');
    } catch (error) {
        setChatStatus(`文字已保留；語音生成失敗：${error.message}`);
        retryVoiceButton.hidden = false;
    }
}
async function submitRecording(blob) {
    if (chatBusy) return;
    chatBusy = true;
    recordButton.disabled = true;
    addChatMessage('user', '🎙️ 已送出錄音');
    setChatStatus('正在聆聽並思考…');
    try {
        const reply = await askGemini(blob);
        lastReplyText = reply;
        addChatMessage('assistant', reply);
        setChatStatus('文字回覆已送達。');
        // Start TTS only after showing the text response.
        speakReply(reply);
    } catch (error) {
        setChatStatus(error.message);
        addChatMessage('assistant', `發生問題：${error.message}`);
        recordButton.disabled = false;
    } finally {
        chatBusy = false;
        if (mediaRecorder?.state !== 'recording') recordButton.disabled = false;
    }
}
async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        setChatStatus('此瀏覽器不支援錄音，或頁面未使用 HTTPS。');
        return;
    }
    try {
        recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
        mediaRecorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
        recordingChunks = [];
        mediaRecorder.addEventListener('dataavailable', event => { if (event.data.size) recordingChunks.push(event.data); });
        mediaRecorder.addEventListener('stop', () => {
            const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            recordingStream?.getTracks().forEach(track => track.stop());
            recordingStream = null;
            recordButton.querySelector('span').textContent = '點擊頭像開始錄音';
            recordButton.setAttribute('aria-label', '開始錄音');
            recordButton.classList.remove('recording');
            if (blob.size) submitRecording(blob);
        }, { once: true });
        mediaRecorder.start();
        recordButton.querySelector('span').textContent = '錄音中，再點頭像送出';
        recordButton.setAttribute('aria-label', '停止錄音並送出');
        recordButton.classList.add('recording');
        setChatStatus('正在錄音，再點一次即可送出。');
    } catch (error) {
        setChatStatus(error.name === 'NotAllowedError' ? '需要允許麥克風權限才能錄音。' : `無法開始錄音：${error.message}`);
    }
}
document.querySelectorAll('[data-voice-chat]').forEach(button => button.addEventListener('click', () => {
    if (!chatDialog.open) {
        chatDialog.showModal();
        startRecording();
    }
}));
recordButton.addEventListener('click', () => {
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    else startRecording();
});
document.querySelector('[data-close-chat]').addEventListener('click', () => {
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    chatDialog.close();
});
retryVoiceButton.addEventListener('click', () => { if (lastReplyText) speakReply(lastReplyText); });
stopVoiceButton.addEventListener('click', () => {
    if (!currentAudio) return;
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
    stopVoiceButton.hidden = true;
    setChatStatus('已停止語音播放。');
});

const dateText = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
document.querySelectorAll('.date-string').forEach(element => { element.textContent = dateText; });
renderList();
updateHistoryButtons();
