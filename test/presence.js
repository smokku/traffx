'use strict'
import test from 'ava'
import { C2S } from 'node-xmpp-server'
import xmpp from 'node-xmpp-client'
import { stanza } from 'node-xmpp-core'
import path from 'path'
import { uniq } from '../utils'

const testName = path.basename(__filename, '.js')

const port = 10000 + process.pid
// eslint-disable-next-line no-unused-vars
var router, c2s, Roster
test.before(async t => {
  router = await require('./_router')(testName)
  c2s = await require('./_c2s')(new C2S.TCPServer({ port }), router)
  Roster = require('../models/roster')
})

test.cb.beforeEach(t => {
  t.context.sendr = new xmpp.Client({
    port,
    jid: uniq() + '@localhost',
    password: 'password'
  })
  t.context.sendr.on('online', sess => {
    t.context.sendr.session = sess
    t.context.recvr = new xmpp.Client({
      port,
      jid: uniq() + '@localhost',
      password: 'password'
    })
    t.context.recvr.on('online', sess => {
      t.context.recvr.session = sess
      t.end()
    })
  })
})

test.cb.afterEach(t => {
  t.context.sendr.on('end', t.end)
  t.context.sendr.end()
})

test.cb('invalid outbound "to"', t => {
  const client = t.context.sendr
  client.on('error', t.end)
  client.send(stanza`<presence type="subscribe" to=""/>`)
  client.on('stanza', stanza => {
    t.true(stanza.is('presence'))
    t.is(stanza.type, 'error')
    const err = stanza.getChild('error')
    t.truthy(err)
    t.is(err.attrs.type, 'modify')
    t.truthy(
      err.getChild('jid-malformed', 'urn:ietf:params:xml:ns:xmpp-stanzas')
    )
    t.end()
  })
})

test.cb('subscription stamping', t => {
  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)
  sendr.send(
    stanza`<presence type="subscribe" from="${sendr.session.jid.toString()}" to="${recvr.session.jid.toString()}"/>`
  )
  recvr.on('stanza', stanza => {
    t.true(stanza.is('presence'))
    t.is(stanza.type, 'subscribe')
    t.is(stanza.from, sendr.session.jid.bare().toString())
    t.is(stanza.to, recvr.session.jid.bare().toString())
    t.end()
  })
})

test.cb('subscription already approved', t => {
  t.plan(13)

  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)
  // subscription should be approved already
  recvr.on('stanza', stanza => t.end(stanza.toString()))

  const from = sendr.session.jid.bare().toString()
  const to = recvr.session.jid.bare().toString()
  Roster.update({ User: to, jid: from }, { from: true }, err => {
    if (err) return t.end(err)
    sendr.send(stanza`<presence type="subscribe" from="${from}" to="${to}"/>`)
  })
  sendr.on('stanza', stanza => {
    if (stanza.is('iq')) {
      // ask="subscribe" push
      t.is(stanza.type, 'set')
      const query = stanza.getChild('query', 'jabber:iq:roster')
      t.truthy(query)
      const items = query.getChildren('item')
      t.is(items.length, 1)
      const item = items[0]
      t.is(item.attrs.jid, to)
      if (item.attrs.ask) {
        t.is(item.attrs.ask, 'subscribe')
      } else {
        t.is(item.attrs.subscription, 'to')
        t.end()
      }
    } else if (stanza.is('presence')) {
      t.is(stanza.type, 'subscribed')
      t.is(stanza.from, to)
      t.is(stanza.to, from)
    } else {
      t.fail(stanza.name)
    }
  })
})
