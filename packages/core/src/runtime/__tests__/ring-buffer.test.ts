import { describe, expect, it } from "vitest";
import { RingBuffer } from "../ring-buffer.js";

describe("RingBuffer", () => {
  it("keeps items in insertion order", () => {
    const buffer = new RingBuffer<number>(3);

    buffer.push(1);
    buffer.push(2);

    expect(buffer.toArray()).toEqual([1, 2]);
    expect(buffer.length).toBe(2);
  });

  it("drops the oldest item when capacity is exceeded", () => {
    const buffer = new RingBuffer<number>(2);

    buffer.push(1);
    buffer.push(2);
    buffer.push(3);

    expect(buffer.toArray()).toEqual([2, 3]);
    expect(buffer.droppedCount).toBe(1);
  });

  it("clears stored items and drop count", () => {
    const buffer = new RingBuffer<number>(1);

    buffer.push(1);
    buffer.push(2);
    buffer.clear();

    expect(buffer.toArray()).toEqual([]);
    expect(buffer.length).toBe(0);
    expect(buffer.droppedCount).toBe(0);
  });
});
