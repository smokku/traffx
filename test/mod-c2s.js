'use strict'
import test from 'ava'
import client from 'node-xmpp-client'
import { C2S } from 'node-xmpp-server'
import ModC2S from '../modules/c2s'

function clientTest (t, Server, port) {
  const c2s = new ModC2S({ server: new Server({ port }) })

  c2s.server.on('online', () => {
    const jid = Math.random().toString(36).substring(7) + '@localhost'
    const password = 'password'

    const entity = new client.Client({ autostart: false, jid, password, port })

    entity.on('error', t.end)

    entity.on('online', sess => {
      t.is(sess.jid.bare().toString(), jid)
      t.end()
    })

    entity.on('end', t.end)

    entity.connect()
  })
}

test.cb('client:tcp', clientTest, C2S.TCPServer, 10000 + process.pid)
test.cb('client:ws', clientTest, C2S.WebSocketServer, 10001 + process.pid)
