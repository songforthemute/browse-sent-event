export class RingBuffer<T> {
  readonly #items: (T | undefined)[];
  #start = 0;
  #length = 0;
  #droppedCount = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("RingBuffer capacity must be a positive integer.");
    }

    this.#items = Array.from<T | undefined>({ length: capacity });
  }

  get length(): number {
    return this.#length;
  }

  get droppedCount(): number {
    return this.#droppedCount;
  }

  push(item: T): void {
    if (this.#length < this.capacity) {
      this.#items[(this.#start + this.#length) % this.capacity] = item;
      this.#length += 1;
      return;
    }

    this.#items[this.#start] = item;
    this.#start = (this.#start + 1) % this.capacity;
    this.#droppedCount += 1;
  }

  toArray(): T[] {
    const result: T[] = [];

    for (let index = 0; index < this.#length; index += 1) {
      const item = this.#items[(this.#start + index) % this.capacity];

      if (item !== undefined) {
        result.push(item);
      }
    }

    return result;
  }

  clear(): void {
    this.#items.fill(undefined);
    this.#start = 0;
    this.#length = 0;
    this.#droppedCount = 0;
  }
}
