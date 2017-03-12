'use strict'
import test from 'ava'
import { uniq } from '../utils'

test('uniq - uniqness', t => {
  t.not(uniq(), uniq())
})

test('uniq - length', t => {
  t.is(uniq().length, uniq().length)
  for (const len of [1, 7, 128, 4096]) {
    t.is(uniq(len).length, len)
  }
})
