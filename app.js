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

    handle.addEventListener('pointerdown', event => {
        if (!event.isPrimary || (event.button !== undefined && event.button !== 0)) return;
        event.preventDefault();
        activePointerId = event.pointerId;
        holdTimer = window.setTimeout(() => {
            dragging = true;
            row.classList.add('is-dragging');
        }, 350);
    });

    document.addEventListener('pointermove', event => {
        if (event.pointerId !== activePointerId) return;
        if (!dragging) return;
        event.preventDefault();
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
    const text = row.querySelector('.item-text');
    text.replaceWith(input);
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
        renderList();
    };
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); finish(true); }
        if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true), { once: true });
    input.focus();
    input.select();
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
document.querySelectorAll('[data-open-settings]').forEach(button => button.addEventListener('click', () => {
    window.alert('設定功能尚未加入。');
}));

document.querySelector('[data-nav-toggle]').addEventListener('click', () => {
    document.getElementById('pc-nav').classList.toggle('expanded');
});

const dateText = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
document.querySelectorAll('.date-string').forEach(element => { element.textContent = dateText; });
renderList();
updateHistoryButtons();
