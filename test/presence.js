'use strict'
import test from 'ava'
import { C2S } from 'node-xmpp-server'
import xmpp from 'node-xmpp-client'
import { stanza } from 'node-xmpp-core'
import path from 'path'

const testName = path.basename(__filename, '.js')
const uniq = function () { return Math.random().toString(36).substring(7) }

const port = 10000 + process.pid
var router, c2s // eslint-disable-line no-unused-vars
test.before(async t => {
  router = await require('./_router')(testName)
  c2s = await require('./_c2s')(
    new C2S.TCPServer({ port }),
    router
  )
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
    t.is(stanza.attrs.type, 'error')
    const err = stanza.getChild('error')
    t.truthy(err)
    t.is(err.attrs.type, 'modify')
    t.truthy(err.getChild('jid-malformed', 'urn:ietf:params:xml:ns:xmpp-stanzas'))
    t.end()
  })
})

test.cb('subscription stamping', t => {
  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)
  sendr.send(stanza`<presence type="subscribe" from="${sendr.session.jid.toString()}" to="${recvr.session.jid.toString()}"/>`)
  recvr.on('stanza', stanza => {
    t.true(stanza.is('presence'))
    t.is(stanza.attrs.type, 'subscribe')
    t.is(stanza.attrs.from, sendr.session.jid.bare().toString())
    t.is(stanza.attrs.to, recvr.session.jid.bare().toString())
    t.end()
  })
})
