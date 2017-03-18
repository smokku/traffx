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
  t.context.recvr.on('end', () => {
    t.context.sendr.on('end', t.end)
    t.context.sendr.end()
  })
  t.context.recvr.end()
})

function simpleBroadcast (t, pkt) {
  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const type = pkt.type
  const id = pkt.id
  sendr.send(pkt)
  sendr.on('stanza', stanza => {
    t.true(stanza.is('presence'))
    t.is(stanza.type, type)
    t.is(stanza.id, id)
    t.is(stanza.from, sendr.session.jid.toString())
    t.is(stanza.to, sendr.session.jid.bare().toString())
    t.end()
  })
}

// eslint-disable-next-line ava/test-ended
test.cb('broadcast - online simple', simpleBroadcast, pkt`<presence/>`)
// eslint-disable-next-line ava/test-ended
test.cb(
  'broadcast - online tracked',
  simpleBroadcast,
  pkt`<presence id="${uniq()}"/>`
)
// eslint-disable-next-line ava/test-ended
test.cb(
  'broadcast - offline',
  simpleBroadcast,
  pkt`<presence type="unavailable"/>`
)
// eslint-disable-next-line ava/test-ended
test.cb(
  'broadcast - online complex',
  simpleBroadcast,
  pkt`<presence><priority>12</priority><show>xa</show><status>foo</status></presence>`
)

test.cb('receive broadcast', t => {
  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)

  const from = sendr.session.jid.bare().toString()
  const to = recvr.session.jid.bare().toString()
  const id = uniq(3)
  Roster.update({ User: from, jid: to }, { from: true }, err => {
    t.ifError(err)
    sendr.send(pkt`<presence id="${id}"/>`)
  })
  recvr.on('stanza', stanza => {
    t.true(stanza.is('presence'))
    t.falsy(stanza.type)
    t.is(stanza.id, id)
    t.is(stanza.from, sendr.session.jid.toString())
    t.is(stanza.to, to)
    t.end()
  })
})

test.cb('direct - local', t => {
  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)

  const from = sendr.session.jid.toString()
  const to = recvr.session.jid.toString()
  const id = uniq(3)
  sendr.send(pkt`<presence id="${id}" to="${to}"/>`)
  recvr.on('stanza', stanza => {
    t.true(stanza.is('presence'))
    t.falsy(stanza.type)
    t.is(stanza.id, id)
    t.is(stanza.from, from)
    t.is(stanza.to, to)
    t.end()
  })
})

// this needs to be serialized because temporarly replaces router.send()
test.serial.cb('direct - federated', t => {
  const sendr = t.context.sendr
  sendr.on('error', t.end)

  const from = sendr.session.jid.toString()
  const to = uniq() + '@otherhost/' + uniq(24)
  const id = uniq(3)
  sendr.send(pkt`<presence id="${id}" to="${to}"/>`)
  const rs = router.router.send
  router.router.send = stanza => {
    t.true(stanza.is('presence'))
    t.falsy(stanza.type)
    t.is(stanza.id, id)
    t.is(stanza.from, from)
    t.is(stanza.to, to)

    router.router.send = rs
    t.end()
  }
})

test.cb('probe - unknown', t => {
  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)

  const from = sendr.session.jid.bare().toString()
  const to = recvr.session.jid.bare().toString()
  Roster.update({ User: from, jid: to }, { to: true }, err => {
    t.ifError(err)
    sendr.send(pkt`<presence/>`)
  })
  sendr.on('stanza', stanza => {
    // skip self-broadcast
    if (stanza.from === sendr.session.jid.toString()) return
    t.true(stanza.is('presence'))
    t.is(stanza.type, 'unsubscribed')
    t.is(stanza.from, to)
    t.is(stanza.to, from)
    t.end()
  })
})

test.cb('probe - one-way', t => {
  const sendr = t.context.sendr
  sendr.on('error', t.end)
  const recvr = t.context.recvr
  recvr.on('error', t.end)

  const from = sendr.session.jid.bare().toString()
  const to = recvr.session.jid.bare().toString()
  const id = uniq(3)
  Roster.update({ User: from, jid: to }, { to: true }, err => {
    t.ifError(err)
    Roster.update({ User: to, jid: from }, { from: true }, err => {
      t.ifError(err)
      // publish recvr presence to look for
      recvr.send(pkt`<presence id="${id}"/>`)
      recvr.on('stanza', stanza => {
        t.true(stanza.is('presence'))
        t.falsy(stanza.type)

        // let's wait a bit for recvr broadcast to settle
        setTimeout(
          () => {
            // finally let's trigger probe
            sendr.send(pkt`<presence/>`)
            sendr.on('stanza', stanza => {
              // skip self-broadcast
              if (stanza.from === sendr.session.jid.toString()) return
              t.true(stanza.is('presence'))
              t.falsy(stanza.type)
              t.is(stanza.id, id)
              t.is(stanza.from, recvr.session.jid.toString())
              t.is(stanza.to, from)
              t.end()
            })
          },
          500
        )
      })
    })
  })
})

test.failing.cb('probe - two-way', t => {
  t.end('failed')
})
test.failing.cb('probe - reverse-way', t => {
  t.end('failed')
})
test.failing.cb('probe - no reprobe', t => {
  // do not send probes after subsequent broadcast
  t.end('failed')
})
