'use strict'
import test from 'ava'
import xmpp from 'node-xmpp-client'
import { C2S } from 'node-xmpp-server'
import ModC2S from '../modules/c2s'
import Router from '../modules/router'

const router = new Router()
const tcp = new C2S.TCPServer({ port: 10000 + process.pid })
const ws = new C2S.WebSocketServer({ port: 10001 + process.pid })
const tcpJid = Math.random().toString(36).substring(7) + '@localhost'
const wsJid = Math.random().toString(36).substring(7) + '@localhost'
var tcpC2S, wsC2S

test.before(t => {
  tcpC2S = new ModC2S({ server: tcp, router })
  wsC2S = new ModC2S({ server: ws, router })
})

test.cb('client messaging', t => {
  t.plan(2 * 2)
  messagingTest(t, tcpC2S, tcpJid, wsJid)
  messagingTest(t, wsC2S, wsJid, tcpJid)
})

function messagingTest (t, c2s, from, to) {
  c2s.server.on('online', () => {
    if (c2s.server.WS) {
      var websocket = {
        url: `ws://localhost:${c2s.server.port}/xmpp-websocket`
      }
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
      t.is(sess.jid.bare().toString(), from)
      client.end()
    })

    client.on('end', () => {
      t.context[from] = false
      if (!t.context[tcpJid] && !t.context[wsJid]) {
        t.end()
      }
    })

    client.connect()
  })

  c2s.server.listen(err => {
    t.ifError(err)
  })
}
