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
  t.plan(2 * 3)
  messagingTest(t, tcpC2S, tcpJid, wsJid)
  messagingTest(t, wsC2S, wsJid, tcpJid)
})

function messagingTest (t, c2s, from, to) {
  var pingId = Math.random().toString().substring(2)

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
        },
        100
      )
    })

    client.on('stanza', function (stanza) {
      if (stanza.is('iq')) {
        switch (stanza.attrs.type) {
          case 'get':
            if (stanza.getChild('ping', 'urn:xmpp:ping')) {
              let pong = new xmpp.Stanza('iq', {
                from: client.jid,
                to: stanza.attrs.from,
                id: stanza.attrs.id,
                type: 'result'
              })
              client.send(pong)
            }
            break
          case 'result':
            t.is(stanza.attrs.id, pingId)
            setTimeout(
              () => {
                client.end()
              },
              100
            )
            break
        }
      }
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
