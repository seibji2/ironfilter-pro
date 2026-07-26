/**
 * IRONFILTER PRO — history.js
 * Undo/redo with snapshot deduplication.
 */
export class History {
  /**
   * @param {Function} onCapture  - () => state
   * @param {Function} onRestore  - (state) => void
   * @param {Function} onUpdate   - ({ canUndo, canRedo }) => void
   */
  constructor(onCapture, onRestore, onUpdate) {
    this._capture  = onCapture;
    this._restore  = onRestore;
    this._onUpdate = onUpdate;
    this._stack    = [];
    this._cursor   = -1;
    this._locked   = false;
    this._debounceTimer = null;
  }

  push(label = 'Edit') {
    if (this._locked) return;

    const state = this._capture();
    if (!state) return;

    // Skip if identical to current
    if (this._cursor >= 0) {
      const cur = JSON.stringify(this._stack[this._cursor].state);
      const nxt = JSON.stringify(state);
      if (cur === nxt) return;
    }

    // Drop redo history
    this._stack = this._stack.slice(0, this._cursor + 1);
    this._stack.push({ label, state: JSON.parse(JSON.stringify(state)) });

    // Max 150 snapshots
    if (this._stack.length > 150) this._stack.shift();
    this._cursor = this._stack.length - 1;

    this._notify();
  }

  pushDebounced(label, delay = 500) {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.push(label), delay);
  }

  undo() {
    if (!this.canUndo) return;
    this._cursor--;
    this._locked = true;
    this._restore(JSON.parse(JSON.stringify(this._stack[this._cursor].state)));
    this._locked = false;
    this._notify();
  }

  redo() {
    if (!this.canRedo) return;
    this._cursor++;
    this._locked = true;
    this._restore(JSON.parse(JSON.stringify(this._stack[this._cursor].state)));
    this._locked = false;
    this._notify();
  }

  get canUndo() { return this._cursor > 0; }
  get canRedo()  { return this._cursor < this._stack.length - 1; }
  get size()     { return this._stack.length; }

  _notify() {
    this._onUpdate({ canUndo: this.canUndo, canRedo: this.canRedo, size: this.size });
  }
}
