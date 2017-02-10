'use strict'
import test from 'ava'
import client from 'node-xmpp-client'
import { C2S } from 'node-xmpp-server'
import ModC2S from '../modules/c2s'
import Router from '../modules/router'

const router = new Router()
const tcp = new C2S.TCPServer({ port: 10000 + process.pid })
const ws = new C2S.WebSocketServer({ port: 10001 + process.pid })

function clientTest (t, opts, port) {
  const c2s = new ModC2S(opts)

  c2s.server.on('connection', connection => {
    t.pass()
  })

  c2s.server.on('online', () => {
    const jid = Math.random().toString(36).substring(7) + '@localhost'
    const password = 'password'

    const entity = new client.Client({
      autostart: false,
      port: opts.server.port,
      jid,
      password
    })

    entity.on('error', t.end)

    entity.on('online', sess => {
      t.is(sess.jid.bare().toString(), jid)
      entity.end()
    })

    entity.on('end', t.end)

    entity.connect()
  })

  c2s.server.listen(err => {
    t.ifError(err, 'listen')
  })
}

test.cb('client:tcp', clientTest, { server: tcp, router, autostart: false })
test.cb('client:ws', clientTest, { server: ws, router, autostart: false })
