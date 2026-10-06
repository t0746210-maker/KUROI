// GLTFExporter が使う FileReader の最小ポリフィル（Node 環境用）
if (typeof (globalThis as any).FileReader === 'undefined') {
  class FR {
    result: any = null;
    onload: ((e: any) => void) | null = null;
    onloadend: ((e: any) => void) | null = null;
    onerror: ((e: any) => void) | null = null;
    private done() {
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }
    readAsArrayBuffer(b: Blob) {
      b.arrayBuffer().then((ab) => {
        this.result = ab;
        this.done();
      }, (e) => this.onerror?.(e));
    }
    readAsDataURL(b: Blob) {
      b.arrayBuffer().then((ab) => {
        this.result = `data:${b.type || 'application/octet-stream'};base64,${(globalThis as any).Buffer.from(ab).toString('base64')}`;
        this.done();
      }, (e) => this.onerror?.(e));
    }
  }
  (globalThis as any).FileReader = FR;
}
