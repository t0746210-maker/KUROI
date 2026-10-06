export interface Command {
  label: string;
  undo(): void;
  redo(): void;
}

/** シンプルなアンドゥ/リドゥ・スタック */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  limit = 200;
  onChange: () => void = () => {};

  /** 既に実行済みの変更を記録する */
  push(cmd: Command) {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange();
  }

  /** 実行して記録する */
  exec(cmd: Command) {
    cmd.redo();
    this.push(cmd);
  }

  undo() {
    const c = this.undoStack.pop();
    if (!c) return null;
    c.undo();
    this.redoStack.push(c);
    this.onChange();
    return c;
  }

  redo() {
    const c = this.redoStack.pop();
    if (!c) return null;
    c.redo();
    this.undoStack.push(c);
    this.onChange();
    return c;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get nextUndoLabel() {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }
  get nextRedoLabel() {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }
}
