import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MIN_SIDE, boxesEqual, hitBox, hitHandle, moveBox, resizeBox, toBox, toRect,
} from './boxes.js'

const near = (got, want) => got.forEach((v, i) =>
  assert.ok(Math.abs(v - want[i]) < 1e-9, `index ${i}: got ${v}, want ${want[i]}`))

test('YOLO -> rect -> YOLO round-trips', () => {
  near(toBox(3, toRect([3, 0.5, 0.4, 0.2, 0.1])), [3, 0.5, 0.4, 0.2, 0.1])
})

test('drawing', () => {
  near(toBox(0, { x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.5 }), [0, 0.4, 0.35, 0.4, 0.3])
  // a drag up and to the left is the same box
  near(toBox(0, { x0: 0.6, y0: 0.5, x1: 0.2, y1: 0.2 }), [0, 0.4, 0.35, 0.4, 0.3])
  near(toBox(0, { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 }), [0, 0.25, 0.25, 0.5, 0.5])
  assert.equal(toBox(0, { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 })[3], MIN_SIDE)
})

test('moving stops at the edge without squashing', () => {
  near(moveBox([0, 0.5, 0.5, 0.2, 0.2], 0.1, -0.1), [0, 0.6, 0.4, 0.2, 0.2])
  near(moveBox([0, 0.5, 0.5, 0.2, 0.2], 9, 0), [0, 0.9, 0.5, 0.2, 0.2])
  near(moveBox([0, 0.5, 0.5, 0.2, 0.2], -9, 0), [0, 0.1, 0.5, 0.2, 0.2])
})

test('resizing', () => {
  near(resizeBox([0, 0.5, 0.5, 0.2, 0.2], 'se', 0.8, 0.8), [0, 0.6, 0.6, 0.4, 0.4])
  near(resizeBox([0, 0.5, 0.5, 0.2, 0.2], 'n', 0.9, 0.2), [0, 0.5, 0.4, 0.2, 0.4])
  near(resizeBox([0, 0.5, 0.5, 0.2, 0.2], 'w', 0.2, 0.9), [0, 0.4, 0.5, 0.4, 0.2])
  // dragged past the far corner, the box flips rather than inverting
  near(resizeBox([0, 0.5, 0.5, 0.2, 0.2], 'se', 0.1, 0.1), [0, 0.25, 0.25, 0.3, 0.3])
})

test('hit testing', () => {
  const boxes = [[0, 0.3, 0.3, 0.2, 0.2], [1, 0.32, 0.32, 0.2, 0.2]]
  assert.equal(hitBox(boxes, 0.3, 0.3), 1, 'the box drawn on top wins')
  assert.equal(hitBox(boxes, 0.9, 0.9), -1)
  assert.equal(hitBox(boxes, 0.3, 0.3, (b) => b[0] === 1), 0, 'a hidden class is skipped')
  assert.equal(hitHandle(boxes[0], 0.2, 0.2, 0.02)?.id, 'nw')
  assert.equal(hitHandle(boxes[0], 0.3, 0.2, 0.02)?.id, 'n')
  assert.equal(hitHandle(boxes[0], 0.3, 0.3, 0.02), null)
})

test('equality ignores sub-micron noise but not class', () => {
  assert.ok(boxesEqual([[0, 0.5, 0.5, 0.2, 0.2]], [[0, 0.5, 0.5, 0.2, 0.2000000001]]))
  assert.ok(!boxesEqual([[0, 0.5, 0.5, 0.2, 0.2]], [[1, 0.5, 0.5, 0.2, 0.2]]))
  assert.ok(!boxesEqual([], [[0, 0.5, 0.5, 0.2, 0.2]]))
})
