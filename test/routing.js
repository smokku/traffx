'use strict'
import test from 'ava'
import xmpp from 'node-xmpp-client'
import { C2S } from 'node-xmpp-server'
import ModC2S from '../c2s'
import Router from '../router'
import path from 'path'

const testName = path.basename(__filename, '.js')
const log = require('./_log')(testName)
const router = new Router({
  db: 1,
  prefix: testName,
  router: {
    send (stanza) {
      // wrap all outgoing packets back
      router.process(stanza, true)
    }
  },
  log
})
const tcpJid = 'tcp@localhost/res'
const wsJid = 'ws@otherhost/foo'
let tcp = wrapC2S(new C2S.TCPServer({ port: 10000 + process.pid }))
let ws = wrapC2S(new C2S.WebSocketServer({ port: 10001 + process.pid }))

function wrapC2S (server) {
  return new Promise((resolve, reject) => {
    const c2s = new ModC2S({ server, router, log })
    c2s.server.on('online', () => {
      resolve(c2s)
    })
  })
}

Promise.all([ tcp, ws ]).then(val => {
  [ tcp, ws ] = val
  // eslint-disable-next-line ava/test-ended
  test.cb('client messaging', t => {
    t.plan(2 * assertions)
    messagingTest(t, tcp, tcpJid, wsJid)
    messagingTest(t, ws, wsJid, tcpJid)
  })
})

const assertions = 4

function messagingTest (t, c2s, from, to) {
  var pingId = Math.random().toString().substring(2)
  var websocket

  if (c2s.server.WS) {
    websocket = { url: `ws://localhost:${c2s.server.port}/xmpp-websocket` }
  }
  const client = new xmpp.Client({
    autostart: false,
    port: c2s.server.port,
    jid: from,
    password: 'password',
    websocket
  })
  t.context[from] = true

  client.on('error', t.end)

  client.on('online', sess => {
    t.is(sess.jid.toString(), from)

    // wait for other client to get online
    setTimeout(
      () => {
        var ping = new xmpp.Stanza('iq', {
          from,
          to,
          id: pingId,
          type: 'get'
        }).c('ping', { xmlns: 'urn:xmpp:ping' })
        client.send(ping)
        process.nextTick(() => {
          var msg = new xmpp.Stanza('message', { to: new xmpp.JID(to).bare() })
          client.send(msg)
        })
      },
      500
    )
  })

  client.on('stanza', stanza => {
    if (stanza.is('iq')) {
      switch (stanza.attrs.type) {
        case 'get':
          if (stanza.getChild('ping', 'urn:xmpp:ping')) {
            const pong = new xmpp.Stanza('iq', {
              to: stanza.attrs.from,
              id: stanza.attrs.id,
              type: 'result'
            })
            client.send(pong)
          }
          break
        case 'result':
          t.is(stanza.id, pingId)
          setTimeout(() => client.end(), 500)
          break
      }
    }
    if (stanza.is('message')) {
      t.is(stanza.attrs.from, to)
      t.is(stanza.attrs.to, new xmpp.JID(from).bare().toString())
    }
  })

  client.on('end', () => {
    t.context[from] = false
    if (!t.context[tcpJid] && !t.context[wsJid]) {
      t.end()
    }
  })

  client.connect()
}
