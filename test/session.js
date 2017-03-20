'use strict'
import test from 'ava'
import { C2S } from 'node-xmpp-server'
import xmpp from 'node-xmpp-client'
import { stanza as pkt } from 'node-xmpp-core'
import path from 'path'
import { uniq } from '../utils'

const testName = path.basename(__filename, '.js')

const port = 10000 + process.pid
// eslint-disable-next-line no-unused-vars
var router, c2s, Session
test.before(async t => {
  router = await require('./_router')(testName)
  c2s = await require('./_c2s')(new C2S.TCPServer({ port }), router)
  Session = require('../models/session')
})

test.cb.beforeEach(t => {
  t.context.client = new xmpp.Client({
    port,
    jid: uniq() + '@localhost',
    password: 'password'
  })
  t.context.client.on('online', sess => {
    t.context.client.session = sess
    t.end()
  })
})

test.cb.afterEach(t => {
  if (t.context.client) {
    t.context.client.on('end', t.end)
    t.context.client.end()
  } else {
    t.end()
  }
})

test('set & all', async t => {
  const user = uniq(3) + '@localhost'
  const res1 = uniq()
  const res2 = uniq()
  const res3 = uniq()
  const pres1 = pkt`<presence from="${user}/${res1}"/>`
  const pres2 = pkt`<presence from="${user}/${res2}"/>`
  const pres3 = pkt`<presence from="${user}/${res3}"/>`
  await Session.set(user, res1, 0, pres1)
  await Session.set(user, res2, 0, pres2)
  await Session.set(user, res3, 0, pres3)
  const sessions = await Session.all(user)
  t.is(Object.keys(sessions).length, 3)
  t.is(sessions[res1], pres1.toString())
  t.is(sessions[res2], pres2.toString())
  t.is(sessions[res3], pres3.toString())
})

test('set & one', async t => {
  const user = uniq(3) + '@localhost'
  const res1 = uniq()
  const res2 = uniq()
  const pres1 = pkt`<presence from="${user}/${res1}"/>`
  const pres2 = pkt`<presence from="${user}/${res2}"/>`
  await Session.set(user, res1, 0, pres1)
  await Session.set(user, res2, 0, pres2)
  const sess1 = await Session.one(user, res1)
  const sess2 = await Session.one(user, res2)
  t.is(sess1, pres1.toString())
  t.is(sess2, pres2.toString())
})

test('set & top', async t => {
  const user = uniq(3) + '@localhost'
  const res1 = uniq()
  const res2 = uniq()
  const res3 = uniq()
  const prio1 = String(123)
  const prio2 = String(42)
  const prio3 = String(1)
  const pres1 = pkt`<presence from="${user}/${res1}"><priority>${prio1}</priority></presence>`
  const pres2 = pkt`<presence from="${user}/${res2}"><priority>${prio2}</priority></presence>`
  const pres3 = pkt`<presence from="${user}/${res3}"><priority>${prio3}</priority></presence>`
  await Session.set(user, res1, prio1, pres1)
  await Session.set(user, res2, prio2, pres2)
  await Session.set(user, res3, prio3, pres3)
  const sessions = await Session.all(user)
  t.is(Object.keys(sessions).length, 3)
  let top = await Session.top(user)
  t.is(top, res1)
  await Session.del(user, res1)
  top = await Session.top(user)
  t.is(top, res2)
  await Session.del(user, res3)
  top = await Session.top(user)
  t.is(top, res2)
})

test('set & del', async t => {
  const user = uniq(3) + '@localhost'
  const res1 = uniq()
  const res2 = uniq()
  const pres1 = pkt`<presence from="${user}/${res1}"/>`
  const pres2 = pkt`<presence from="${user}/${res2}"/>`
  await Session.set(user, res1, 0, pres1)
  await Session.set(user, res2, 0, pres2)
  let sessions = await Session.all(user)
  t.is(Object.keys(sessions).length, 2)
  await Session.del(user, res1)
  sessions = await Session.all(user)
  t.is(Object.keys(sessions).length, 1)
  t.truthy(sessions[res2])
  await Session.del(user, res2)
  sessions = await Session.all(user)
  t.falsy(sessions)
  const top = await Session.top(user)
  t.falsy(top)
})

test.cb('start & end', t => {
  const client = t.context.client
  client.on('error', t.end)

  const from = client.session.jid.bare().toString()
  Session.all(from).then(sessions => {
    t.falsy(sessions)
    client.send(pkt`<presence/>`)
  })
  client.on('stanza', async stanza => {
    t.true(stanza.is('presence'))
    if (!stanza.type) {
      const sessions = await Session.all(from)
      t.is(Object.keys(sessions).length, 1)
      t.truthy(sessions[client.session.jid.resource])
      client.send(pkt`<presence type='unavailable'/>`)
    } else if (stanza.type === 'unavailable') {
      const sessions = await Session.all(from)
      const top = await Session.top(from)
      t.falsy(sessions)
      t.falsy(top)
      t.end()
    } else {
      t.end(stanza.type)
    }
  })
})

test.cb('start & teardown', t => {
  const client = t.context.client
  client.on('error', t.end)

  const from = client.session.jid.bare().toString()
  client.send(pkt`<presence/>`)
  client.on('stanza', async stanza => {
    t.true(stanza.is('presence'))
    if (!stanza.type) {
      const sessions = await Session.all(from)
      t.is(Object.keys(sessions).length, 1)
      client.end()
    } else {
      t.end(stanza.type)
    }
  })
  client.on('end', async () => {
    t.context.client = null
    const sessions = await Session.all(from)
    const top = await Session.top(from)
    t.falsy(sessions)
    t.falsy(top)
    t.end()
  })
})
