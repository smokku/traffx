'use strict'
import test from 'ava'
import xmpp from 'node-xmpp-client'
import { C2S } from 'node-xmpp-server'
import ModC2S from '../modules/c2s'
import Router from '../modules/router'

const router = new Router()
const tcp = new C2S.TCPServer({ port: 10000 + process.pid })
const ws = new C2S.WebSocketServer({ port: 10001 + process.pid })
const tcpJid = 'tcp@localhost/res'
const wsJid = 'ws@localhost/foo'
var tcpC2S, wsC2S

test.before(t => {
  tcpC2S = new ModC2S({ server: tcp, router })
  wsC2S = new ModC2S({ server: ws, router })
})

const assertions = 5

test.cb('client messaging', t => {
  t.plan(2 * assertions)
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
      t.is(sess.jid.toString(), from)

      // wait for other client to get online
      setTimeout(() => {
        var ping = new xmpp.Stanza('iq', {
          from,
          to,
          id: pingId,
          type: 'get'
        }).c('ping', { xmlns: 'urn:xmpp:ping' })
        client.send(ping)
        process.nextTick(() => {
          var msg = new xmpp.Stanza('message', {
            to: new xmpp.JID(to).bare()
          })
          client.send(msg)
        })
      }, 100)
    })

    client.on('stanza', function (stanza) {
      if (stanza.is('iq')) {
        switch (stanza.attrs.type) {
          case 'get':
            if (stanza.getChild('ping', 'urn:xmpp:ping')) {
              let pong = new xmpp.Stanza('iq', {
                to: stanza.attrs.from,
                id: stanza.attrs.id,
                type: 'result'
              })
              client.send(pong)
            }
            break
          case 'result':
            t.is(stanza.id, pingId)
            setTimeout(() => client.end(), 100)
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
  })

  c2s.server.listen(err => {
    t.ifError(err)
  })
}
